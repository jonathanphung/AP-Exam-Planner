import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #5) — same-slot conflict detection + resolution to
 * official late-testing slots.
 *
 * One observable, browser-level test per acceptance criterion, plus screenshot
 * capture at the three standard super-board viewports (desktop 1920x1080,
 * tablet 1024x768, mobile 375x667). Screenshots land in the run evidence
 * folder and are committed to the issue branch so they render inline on the
 * issue / PR.
 *
 * AC4 (3+ subjects on one slot) cannot be exercised in the browser: the
 * shipped May-2026 dataset contains only 2-way collisions. Its observable
 * test lives at the pure-function layer instead — see
 * `src/lib/conflicts.qa.test.ts` (runs under `pnpm test:unit`).
 *
 * Dataset-driven fixtures (asserted from the shipped JSON, never hardcoded
 * beyond ids):
 *   - AP Biology   2026-05-04 AM  → late 2026-05-20 PM
 *   - AP Latin     2026-05-04 AM  → late 2026-05-18 PM   (collides w/ Biology)
 *   - AP Chemistry 2026-05-05 AM  → late 2026-05-20 PM   (late slot = Biology's)
 *   - AP Human Geography 2026-05-05 AM → late 2026-05-18 PM (collides w/ Chem)
 *   - AP Drawing + AP 2-D Art and Design — portfolio-only, deadline 2026-05-08
 */

// Env-overridable so a re-verification pass writes a fresh evidence set
// instead of rewriting a prior run's committed screenshots.
const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-5-qa-v2";

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

const COORDINATOR_NOTE =
  "This is a planning choice — the actual late-testing swap is arranged through your school's AP coordinator.";

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
  portfolio: { deadline: string } | null;
};

const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const byId = (id: string): Subject => {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};

const BIOLOGY = byId("biology");
const LATIN = byId("latin");
const CHEMISTRY = byId("chemistry");
const HUMAN_GEO = byId("human-geography");
const DRAWING = byId("drawing");
const TWO_D = byId("2-d-art-and-design");

// Guard the fixture assumptions against dataset edits — if these ever fail,
// the spec's scenario (not the app) needs re-picking.
if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");
if (
  BIOLOGY.lateTesting!.date !== CHEMISTRY.lateTesting!.date ||
  BIOLOGY.lateTesting!.session !== CHEMISTRY.lateTesting!.session
)
  throw new Error("fixture drift: biology/chemistry late slots differ");
if (DRAWING.portfolio!.deadline !== TWO_D.portfolio!.deadline)
  throw new Error("fixture drift: drawing/2-d portfolio deadlines differ");

/** "Monday, May 4, 2026" — must match src/lib/schedule.ts formatDateLabel. */
function dateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const lateWarning = (page: Page) =>
  page.getByTestId("late-collision-warning");
/** The <li> date group whose heading is the given date. */
const dateGroup = (page: Page, iso: string) =>
  schedule(page)
    .locator("ol > li")
    .filter({ has: page.locator("h3", { hasText: dateLabel(iso) }) });
const rowsIn = (page: Page, iso: string) =>
  dateGroup(page, iso).locator("ul > li");

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

async function select(page: Page, name: string) {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

async function deselect(page: Page, name: string) {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "false");
}

async function keep(page: Page, name: string) {
  await prompt(page)
    .getByRole("button", { name: `Keep ${name} at the regular time` })
    .first()
    .click();
}

/**
 * Issue #19 (second bounce) made the CALENDAR the default view; this suite
 * exercises the LIST view (where issue #5's modal-on-collision behavior
 * lives), so every test switches to it via the "List" chip after load.
 * The press is hydration-safe (see e2e/support/view-chip.ts).
 */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

/** Seed localStorage before any app script runs (persisted-load path). */
async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

// NOTE: any "fresh page" inside a test MUST come from `browser.newContext()`,
// never `page.context().newPage()` — pages in one context share localStorage,
// and the app's live pruning effect on the first page races any storage
// seeding done for the second.

/**
 * WCAG 2.x contrast ratio between an element's computed text color and its
 * effective background (walks up the tree compositing alpha backgrounds, so
 * `bg-red-950/40` over the dark body is measured as actually rendered).
 */
async function contrastRatio(
  page: Page,
  selector: string,
): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    type RGBA = [number, number, number, number];
    // Tailwind v4 colors compute to oklch(...); resolve ANY css color to
    // sRGB bytes by painting it on a 1x1 canvas.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const parse = (css: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillStyle = css; // invalid css leaves the previous value
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    // Composite the element's ancestor backgrounds bottom-up until opaque.
    const layers: RGBA[] = [];
    let node: Element | null = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) {
        layers.unshift(bg);
        if (bg[3] >= 1) break;
      }
      node = node.parentElement;
    }
    let base: RGBA = [255, 255, 255, 1]; // ultimate fallback: white canvas
    for (const layer of layers) {
      const a = layer[3];
      base = [
        layer[0] * a + base[0] * (1 - a),
        layer[1] * a + base[1] * (1 - a),
        layer[2] * a + base[2] * (1 - a),
        1,
      ];
    }
    const fgRaw = parse(getComputedStyle(el).color);
    const a = fgRaw[3];
    const fg: RGBA = [
      fgRaw[0] * a + base[0] * (1 - a),
      fgRaw[1] * a + base[1] * (1 - a),
      fgRaw[2] * a + base[2] * (1 - a),
      1,
    ];
    const lum = (c: RGBA) => {
      const chan = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
    };
    const l1 = lum(fg);
    const l2 = lum(base);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
}

test.describe("issue #5 — same-slot conflicts resolve to official late-testing slots", () => {
  test("AC1 — conflict prompt appears when the collision comes into existence (second selection AND persisted load), naming both subjects + the shared slot", async ({
    page,
    browser,
  }) => {
    // Path 1: collision created by selecting the second subject.
    await page.goto("/");
    await openList(page);
    await select(page, BIOLOGY.name);
    await expect(prompt(page)).toHaveCount(0); // one subject → no conflict
    await select(page, LATIN.name);

    await expect(prompt(page)).toHaveCount(1);
    await expect(prompt(page)).toContainText("Exam time conflict");
    await expect(prompt(page)).toContainText(BIOLOGY.name);
    await expect(prompt(page)).toContainText(LATIN.name);
    // The shared slot: date + session.
    await expect(prompt(page)).toContainText(dateLabel(BIOLOGY.exam!.date));
    await expect(prompt(page)).toContainText(
      `${BIOLOGY.exam!.session} session`,
    );
    // Asks which one stays at the regular time.
    await expect(prompt(page)).toContainText(
      "Which exam will you take at the regular time?",
    );
    await expect(
      prompt(page).getByRole("button", {
        name: `Keep ${BIOLOGY.name} at the regular time`,
      }),
    ).toBeVisible();
    await expect(
      prompt(page).getByRole("button", {
        name: `Keep ${LATIN.name} at the regular time`,
      }),
    ).toBeVisible();

    // Path 2: a persisted colliding selection loads → prompt appears on load.
    const isolated = await browser.newContext();
    const fresh = await isolated.newPage();
    await seedSelection(fresh, [BIOLOGY.id, LATIN.id]);
    await fresh.goto("/");
    await openList(fresh);
    await expect(prompt(fresh)).toHaveCount(1);
    await expect(prompt(fresh)).toContainText(BIOLOGY.name);
    await expect(prompt(fresh)).toContainText(LATIN.name);
    await isolated.close();
  });

  test("AC2 — choosing the keeper moves each non-keeper to ITS OWN late-testing slot, shown under the late date with a 'Moved to late testing' tag", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);
    await keep(page, LATIN.name);

    await expect(prompt(page)).toHaveCount(0);

    // Keeper stays at the regular slot.
    const regularRows = rowsIn(page, LATIN.exam!.date);
    await expect(regularRows).toHaveCount(1);
    await expect(regularRows.first()).toContainText(LATIN.name);

    // Non-keeper renders under ITS OWN late-testing date (2026-05-20 for
    // Biology — NOT Latin's 05-18) with the visible moved tag.
    const lateRows = rowsIn(page, BIOLOGY.lateTesting!.date);
    await expect(lateRows).toHaveCount(1);
    await expect(lateRows.first()).toContainText(BIOLOGY.name);
    await expect(lateRows.first()).toContainText("Moved to late testing");
    await expect(
      lateRows
        .first()
        .getByText(BIOLOGY.lateTesting!.session, { exact: true }),
    ).toBeVisible();
  });

  test("AC3 — resolution persists in apx.resolutions.v1 across reload; deselecting an involved subject clears it and restores the regular slot; re-creating the collision re-prompts", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);
    await keep(page, LATIN.name);
    await expect(rowsIn(page, BIOLOGY.lateTesting!.date)).toHaveCount(1);

    // Persisted under the versioned key with the chosen keeper.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      RESOLUTIONS_KEY,
    );
    expect(stored, "apx.resolutions.v1 must exist after resolving").toBeTruthy();
    const parsed = JSON.parse(stored!) as Array<{
      keeperId: string;
      memberIds: string[];
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].keeperId).toBe(LATIN.id);
    expect([...parsed[0].memberIds].sort()).toEqual(
      [BIOLOGY.id, LATIN.id].sort(),
    );

    // Survives reload: no prompt, exam still on the late date. The reload
    // resets the view switcher to its calendar default (#19 bounce B6), so
    // re-open the list where these rows and the would-be prompt live.
    await page.reload();
    await openList(page);
    await expect(prompt(page)).toHaveCount(0);
    await expect(rowsIn(page, BIOLOGY.lateTesting!.date)).toHaveCount(1);

    // Deselect the keeper → resolution cleared, Biology back at its regular slot.
    await deselect(page, LATIN.name);
    await expect(rowsIn(page, BIOLOGY.exam!.date)).toHaveCount(1);
    await expect(rowsIn(page, BIOLOGY.exam!.date).first()).toContainText(
      BIOLOGY.name,
    );
    await expect(rowsIn(page, BIOLOGY.lateTesting!.date)).toHaveCount(0);
    await expect
      .poll(
        async () =>
          await page.evaluate(
            (key) => window.localStorage.getItem(key) ?? "[]",
            RESOLUTIONS_KEY,
          ),
        { message: "stale resolution must be pruned from storage" },
      )
      .toBe("[]");

    // Re-create the same collision → the prompt must come back (no silent re-apply).
    await select(page, LATIN.name);
    await expect(prompt(page)).toHaveCount(1);
  });

  // AC4 (three or more subjects on one slot → same choose-one flow, all
  // non-keepers move to their own late slots) has no browser-reachable fixture:
  // the shipped 2026 dataset has no slot shared by 3+ subjects. Observable
  // coverage lives in `src/lib/conflicts.qa.test.ts` (pnpm test:unit), which
  // chains grouping → keeper choice → resolveSlots exactly as the UI does.

  test("AC5 — two moved exams landing on the same late slot show a named warning; both entries render; no forced second resolution", async ({
    page,
  }) => {
    await seedSelection(page, [
      BIOLOGY.id,
      LATIN.id,
      CHEMISTRY.id,
      HUMAN_GEO.id,
    ]);
    await page.goto("/");
    await openList(page);

    // Two independent conflicts (May 4 AM, May 5 AM) → two prompts.
    await expect(prompt(page)).toHaveCount(2);
    await keep(page, LATIN.name); // Biology → late 2026-05-20 PM
    await keep(page, HUMAN_GEO.name); // Chemistry → late 2026-05-20 PM

    // Both moved exams now share 2026-05-20 PM → visible warning naming them.
    await expect(lateWarning(page)).toBeVisible();
    await expect(lateWarning(page)).toContainText("Late-testing slots overlap");
    await expect(lateWarning(page)).toContainText(BIOLOGY.name);
    await expect(lateWarning(page)).toContainText(CHEMISTRY.name);
    // The shared slot must be named READABLY: "<date> (<session> session)".
    // Guards the JSX whitespace-collapse regression that renders
    // "(PMsession)" — the compiled text node loses the space between the
    // session expression and the word "session".
    await expect(lateWarning(page)).toContainText(
      `${dateLabel(BIOLOGY.lateTesting!.date)} (${BIOLOGY.lateTesting!.session} session)`,
    );

    // No silent overwrite: BOTH exams render under the shared late date.
    const lateRows = rowsIn(page, BIOLOGY.lateTesting!.date);
    await expect(lateRows).toHaveCount(2);
    await expect(
      lateRows.filter({ hasText: BIOLOGY.name }),
    ).toHaveCount(1);
    await expect(
      lateRows.filter({ hasText: CHEMISTRY.name }),
    ).toHaveCount(1);

    // No forced second resolution: zero conflict prompts remain.
    await expect(prompt(page)).toHaveCount(0);
  });

  test("AC6 — both the prompt and the moved-exam tag carry the AP-coordinator planning-choice wording", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);

    await expect(prompt(page)).toContainText(COORDINATOR_NOTE);

    await keep(page, LATIN.name);
    const movedRow = rowsIn(page, BIOLOGY.lateTesting!.date).first();
    await expect(movedRow).toContainText("Moved to late testing");
    await expect(movedRow).toContainText(COORDINATOR_NOTE);
  });

  test("AC7 — portfolio deadlines sharing a date never trigger the conflict flow", async ({
    page,
  }) => {
    await seedSelection(page, [DRAWING.id, TWO_D.id]);
    await page.goto("/");
    await openList(page);

    // Both portfolio-only subjects render their deadline on the shared date...
    const portfolioRows = rowsIn(page, DRAWING.portfolio!.deadline);
    await expect(portfolioRows).toHaveCount(2);
    await expect(
      portfolioRows.filter({ hasText: DRAWING.name }),
    ).toHaveCount(1);
    // ...and no conflict prompt exists anywhere.
    await expect(prompt(page)).toHaveCount(0);
    await expect(lateWarning(page)).toHaveCount(0);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac7-portfolio-no-conflict-desktop.png`,
      fullPage: true,
    });
  });

  // AC8 (pure functions in src/lib/conflicts.ts with unit tests, runnable via
  // `pnpm test:unit`) is verified by running the command itself — output is
  // captured in the evidence folder (test-unit.log). The QA-added
  // `src/lib/conflicts.qa.test.ts` runs under the same script.

  test("AC9 — the schedule renders the RESOLVED slot (never the default) and the conflict styling meets WCAG AA contrast in light and dark", async ({
    page,
    browser,
  }) => {
    await seedSelection(page, [
      BIOLOGY.id,
      LATIN.id,
      CHEMISTRY.id,
      HUMAN_GEO.id,
    ]);
    await page.goto("/");
    await openList(page);

    // Contrast of the unresolved-prompt body text, light mode.
    const promptText = '[data-testid="conflict-prompt"] p';
    const lightPrompt = await contrastRatio(page, promptText);
    expect(
      lightPrompt,
      `prompt text contrast (light) = ${lightPrompt.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);

    await keep(page, LATIN.name);
    await keep(page, HUMAN_GEO.name);

    // Resolved slots render — the moved exams appear ONLY under their late
    // dates; their regular slots no longer list them.
    await expect(rowsIn(page, BIOLOGY.lateTesting!.date)).toHaveCount(2);
    await expect(
      rowsIn(page, BIOLOGY.exam!.date).filter({ hasText: BIOLOGY.name }),
    ).toHaveCount(0);
    await expect(
      rowsIn(page, CHEMISTRY.exam!.date).filter({ hasText: CHEMISTRY.name }),
    ).toHaveCount(0);

    // Contrast of the late-collision warning text, light mode.
    const warningText = '[data-testid="late-collision-warning"] p';
    await expect(lateWarning(page)).toBeVisible();
    const lightWarning = await contrastRatio(page, warningText);
    expect(
      lightWarning,
      `warning text contrast (light) = ${lightWarning.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);

    // Dark mode (Tailwind dark: variant follows prefers-color-scheme).
    await page.emulateMedia({ colorScheme: "dark" });
    const darkWarning = await contrastRatio(page, warningText);
    expect(
      darkWarning,
      `warning text contrast (dark) = ${darkWarning.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);

    // Dark-mode prompt contrast, on a fresh unresolved collision (isolated
    // context: no stored resolution can pre-resolve it).
    const isolated = await browser.newContext({ colorScheme: "dark" });
    const fresh = await isolated.newPage();
    await seedSelection(fresh, [BIOLOGY.id, LATIN.id]);
    await fresh.goto("/");
    await openList(fresh);
    await expect(prompt(fresh)).toHaveCount(1);
    const darkPrompt = await contrastRatio(fresh, promptText);
    expect(
      darkPrompt,
      `prompt text contrast (dark) = ${darkPrompt.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
    await fresh.screenshot({
      path: `${EVIDENCE_DIR}/ac9-dark-prompt-desktop.png`,
      fullPage: true,
    });
    await isolated.close();
  });
});

// ---------------------------------------------------------------------------
// Screenshot evidence at the three standard super-board viewports: the
// unresolved conflict prompt (the issue's core new UI), then the resolved
// moved-to-late state and the late-late warning at desktop.
// ---------------------------------------------------------------------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — conflict prompt renders at ${vp.name} ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);
    await expect(prompt(page)).toBeVisible();
    await prompt(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}

test("evidence — resolved state (moved tag) and late-late warning at desktop", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  await page.goto("/");
  await openList(page);
  await keep(page, LATIN.name);
  await expect(
    rowsIn(page, BIOLOGY.lateTesting!.date).first(),
  ).toContainText("Moved to late testing");
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac2-moved-to-late-desktop.png`,
    fullPage: true,
  });

  const isolated = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const fresh = await isolated.newPage();
  await seedSelection(fresh, [
    BIOLOGY.id,
    LATIN.id,
    CHEMISTRY.id,
    HUMAN_GEO.id,
  ]);
  await fresh.goto("/");
  await openList(fresh);
  await keep(fresh, LATIN.name);
  await keep(fresh, HUMAN_GEO.name);
  await expect(lateWarning(fresh)).toBeVisible();
  await fresh.screenshot({
    path: `${EVIDENCE_DIR}/ac5-late-late-warning-desktop.png`,
    fullPage: true,
  });
  // Close-up of the warning banner so its copy is legible in the evidence.
  await lateWarning(fresh).screenshot({
    path: `${EVIDENCE_DIR}/ac5-warning-closeup-desktop.png`,
  });
  await isolated.close();
});
