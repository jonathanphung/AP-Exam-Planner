import { type Page, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
  noExamReason?: string;
  passRate?: unknown;
};

/**
 * Load the dataset at runtime instead of a static relative import so this
 * file type-checks (and runs) both from its archived home under
 * docs/super-board/runs/issue-39-sweep-v1/specs/ and from the runnable
 * sweep/specs/ location. (A static "../../src/..." import only resolves from
 * sweep/specs/ and broke `pnpm build`, which typechecks docs/ too.)
 */
function findRepoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("repo root not found from " + from);
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);

const apData = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "src/data/ap-2026.json"), "utf8"),
) as { subjects: Subject[] };

export const SUBJECTS = apData.subjects;
export const ALL_IDS = SUBJECTS.map((s) => s.id);
export const EXAM_IDS = SUBJECTS.filter((s) => s.exam).map((s) => s.id);

export const SELECTION_KEY = "apx.selection.v1";
export const RESOLUTIONS_KEY = "apx.resolutions.v1";
export const SCHEDULES_KEY = "apx.schedules.v1";
export const THEME_KEY = "apx.theme.v1";

export const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  "docs/super-board/runs/issue-39-sweep-v1",
);
export const FINDINGS_FILE = path.resolve(__dirname, "../findings.ndjson");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

/** Append a structured finding (or clean-pass note) to the shared log. */
export function record(entry: {
  kind: "bug" | "a11y" | "suggestion" | "clean" | "console" | "note";
  area: string;
  summary: string;
  detail?: unknown;
}): void {
  fs.appendFileSync(
    FINDINGS_FILE,
    JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n",
  );
}

export function evidencePath(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

/** Attach console-error + pageerror collectors; returns live arrays. */
export function watchConsole(page: Page, label: string) {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return {
    errors,
    pageErrors,
    assertClean(context: string) {
      if (errors.length || pageErrors.length) {
        record({
          kind: "console",
          area: label,
          summary: `console/page errors during: ${context}`,
          detail: { errors, pageErrors },
        });
      }
      expect
        .soft(errors, `${label}: console errors during ${context}`)
        .toEqual([]);
      expect
        .soft(pageErrors, `${label}: page errors during ${context}`)
        .toEqual([]);
    },
  };
}

/** Seed selection (and optionally resolutions) before first navigation. */
export async function seed(
  page: Page,
  opts: {
    selection?: string[];
    resolutions?: Record<string, string>;
    raw?: Record<string, string>;
  },
): Promise<void> {
  await page.addInitScript(
    ({ selection, resolutions, raw, sk, rk }) => {
      if (selection) localStorage.setItem(sk, JSON.stringify(selection));
      if (resolutions) localStorage.setItem(rk, JSON.stringify(resolutions));
      if (raw) {
        for (const [k, v] of Object.entries(raw)) localStorage.setItem(k, v);
      }
    },
    {
      selection: opts.selection ?? null,
      resolutions: opts.resolutions ?? null,
      raw: opts.raw ?? null,
      sk: SELECTION_KEY,
      rk: RESOLUTIONS_KEY,
    },
  );
}

/** True when the page has no horizontal overflow. */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

/** The app rendered something real (not a white screen / error page). */
export async function expectAlive(page: Page, context: string): Promise<void> {
  const h1 = page.locator("h1");
  await expect
    .soft(h1.first(), `${context}: h1 should render (no white screen)`)
    .toBeVisible({ timeout: 10_000 });
  const catalog = page.locator('section[aria-label="Subject catalog"]');
  await expect
    .soft(catalog, `${context}: catalog should render`)
    .toBeVisible({ timeout: 10_000 });
}

export const searchInput = (page: Page) => page.locator("#subject-search");
export const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
export const scheduleSection = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
export const conflictPrompt = (page: Page) =>
  page.getByTestId("conflict-prompt");

export async function pressViewChip(
  page: Page,
  name: "List" | "Calendar",
): Promise<void> {
  const chip = page
    .getByRole("group", { name: "Schedule view" })
    .filter({ visible: true })
    .first()
    .getByRole("button", { name });
  await expect(async () => {
    // Center it first: the catalog's sticky quick-nav (z-30) can cover a
    // minimally-scrolled chip and permanently fail Playwright's hit-target
    // check (observed at 375px and with all-42 selections).
    await chip.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await chip.click({ timeout: 2000 });
    await expect(chip).toHaveAttribute("aria-pressed", "true", {
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * Conflict prompts render inline in the LIST view (the calendar shows
 * "unresolved" styling on blocks instead). Helper switches view and returns
 * the visible prompts.
 */
export async function gotoConflictList(page: Page) {
  await pressViewChip(page, "List");
  return conflictPrompt(page);
}

/** Select a subject chip by accessible name (aria-pressed toggle button). */
export function chipFor(page: Page, subjectName: string) {
  return catalog(page)
    .locator("button[aria-pressed]")
    .filter({ hasText: subjectName })
    .first();
}
