import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #90) — export filenames carry the active schedule's
 * name.
 *
 * Before this ticket every format saved as `ap-exams-2027.*` regardless of
 * which schedule it came from, so two schedules collided in Downloads behind
 * the browser's meaningless " (1)" suffix. The Builder's fix threads
 * `active.name` through a new pure slug pipeline in `src/lib/exports.ts`
 * (`scheduleNameSlug` → `scheduleExportBaseName` → `exportFileName` /
 * `weekPngFileName`). The slug function itself is unit-tested exhaustively in
 * `src/lib/exports.test.ts` (AC4/AC5/AC7); the pre-existing specs
 * (issue-7/37/51/56) pin the default-schedule (`schedule-1-…`) names. What NO
 * other spec covers — and what this one adds — is the headline bug driven
 * end-to-end through the real UI:
 *
 *   AC1/AC6 — rename + second schedule: each format's real Playwright
 *             download is named for the ACTIVE schedule, and the same format
 *             saved from two different schedules yields two different
 *             filenames (the Downloads collision this issue is about).
 *   AC2     — per-week .png files from a RENAMED schedule keep both the week
 *             slug and the view suffix after the schedule slug (list vs
 *             calendar never collide).
 *   AC3     — the year in every asserted name is DERIVED from the dataset
 *             cycle (`apData.cycle`), never hardcoded here.
 *   edge    — a name full of Windows-reserved characters downloads under its
 *             sanitized slug, while the .json CONTENT still carries the
 *             verbatim user-typed name (filenames only — contents untouched).
 *   edge    — a name that slugs to nothing ("???") falls back to the bare
 *             cycle stem: `ap-exams-<year>.ics`, never a leading-dash name.
 *
 * AC8 (ICS_FILE_NAME untouched for other consumers) is pinned at the unit
 * layer (`ics.test.ts` asserts the literal, `exports.test.ts` asserts the
 * stem derivation) and needs no browser assertion.
 */

const EVIDENCE_DIR = evidenceDir("issue-90-qa-v1");

// AC3 — derive the year from the dataset cycle ("May 2027" → "2027"); this
// spec must keep passing on the next annual swap with zero edits.
const CYCLE_YEAR = (apData as { cycle: string }).cycle.split(" ")[1];
const STEM = `ap-exams-${CYCLE_YEAR}`;

const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 375, height: 667 };

// ── Locators / helpers (issue-29 + issue-51 spec patterns) ──────────────────

const exportButton = (page: Page) => page.getByTestId("export-menu-button");
const exportMenu = (page: Page) => page.getByTestId("export-menu");
const radiogroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "My schedules" });
const radios = (page: Page) => radiogroup(page).getByRole("radio");
const catalogCard = (page: Page, name: string) =>
  page
    .locator('section[aria-label="Subject catalog"]')
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

/** Hydration-safe chip select (issue-5 pattern). */
async function selectSubject(page: Page, name: string) {
  const c = catalogCard(page, name);
  await expect(async () => {
    await c.click();
    await expect(c).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
}

/** Biology (Week 1 exam) + Seminar (Week 2 exam + Apr 30 portfolio): the
 *  issue-#7/#51 fixture pair — exam AND portfolio rows, no slot conflict. */
async function selectBiologyAndSeminar(page: Page) {
  await selectSubject(page, "AP Biology");
  await selectSubject(page, "AP Seminar");
  await expect(exportButton(page)).toBeEnabled();
}

/** Hydration-safe "New schedule" press (issue-29 pattern). */
async function createSchedule(page: Page) {
  const before = await radios(page).count();
  await expect(async () => {
    await page.getByRole("button", { name: "New schedule" }).click();
    await expect(radios(page)).toHaveCount(before + 1, { timeout: 1000 });
  }).toPass();
}

/** Inline-rename the schedule currently named `from` to `to` (issue-29 AC7).
 *  Hydration-safe: a pre-hydration click on the rename button no-ops, so
 *  retry until the inline field actually appears (issue-5/29 pattern). */
async function renameSchedule(page: Page, from: string, to: string) {
  const renameButton = page.getByRole("button", { name: `Rename ${from}` });
  const field = page.getByRole("textbox", { name: `New name for ${from}` });
  await expect(async () => {
    await renameButton.click();
    await expect(field).toBeVisible({ timeout: 1000 });
  }).toPass();
  await field.fill(to);
  await field.press("Enter");
  await expect(
    radiogroup(page).getByRole("radio", { name: to }),
  ).toBeVisible();
}

/** Open the export menu and wait for it to render. */
async function openMenu(page: Page) {
  await exportButton(page).click();
  await expect(exportMenu(page)).toBeVisible();
}

/** Trigger one single-file download via its menu item and return it. */
async function downloadVia(page: Page, itemName: string): Promise<Download> {
  await openMenu(page);
  const item = page.getByRole("menuitem", { name: itemName, exact: true });
  await expect(item).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await item.click();
  return downloadPromise;
}

/** Collect the per-week burst a .png menu item emits (n = expected count). */
async function downloadPngs(
  page: Page,
  itemName: string,
  n: number,
): Promise<string[]> {
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await openMenu(page);
  await page.getByRole("menuitem", { name: itemName, exact: true }).click();
  await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(n);
  return downloads.map((d) => d.suggestedFilename());
}

// ── AC1 + AC6 — the headline bug, end-to-end ────────────────────────────────

test("AC1/AC6 — every format is named for the ACTIVE schedule; two schedules give two different filenames", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Schedule 1: the pre-#90 filenames, now slug-prefixed.
  await selectBiologyAndSeminar(page);
  const s1: Record<string, string> = {};
  for (const [item, ext] of [
    ["Save as .ics", "ics"],
    ["Save as .json", "json"],
    ["Save as .txt", "txt"],
  ] as const) {
    const download = await downloadVia(page, item);
    s1[ext] = download.suggestedFilename();
    expect(s1[ext]).toBe(`schedule-1-${STEM}.${ext}`);
  }

  // Second schedule, renamed through the real inline-rename UI.
  await createSchedule(page);
  await renameSchedule(page, "Schedule 2", "Ambitious Draft");
  // The new schedule is empty and active — pick a DIFFERENT selection to
  // prove the name (not the content) drives the filename.
  await selectSubject(page, "AP Chemistry");
  await expect(exportButton(page)).toBeEnabled();

  // Evidence: two-schedule sidebar with the renamed schedule active.
  await page.screenshot({
    path: `${EVIDENCE_DIR}/desktop.png`,
    fullPage: false,
  });

  for (const [item, ext] of [
    ["Save as .ics", "ics"],
    ["Save as .json", "json"],
    ["Save as .txt", "txt"],
  ] as const) {
    const download = await downloadVia(page, item);
    const name = download.suggestedFilename();
    // AC1: one shared convention — <schedule-slug>-<stem>.<ext>.
    expect(name).toBe(`ambitious-draft-${STEM}.${ext}`);
    // AC6: same format, different schedule → different filename.
    expect(name).not.toBe(s1[ext]);
  }
});

// ── AC2 — per-week .png keeps week slug + view suffix after the schedule slug

test("AC2 — per-week .pngs from a renamed schedule keep week slug AND view suffix (list/calendar never collide)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  await renameSchedule(page, "Schedule 1", "My Plan");
  await selectBiologyAndSeminar(page);

  // Biology (Week 1) + Seminar (Week 2, portfolio rides Week 1) → exactly two
  // week cards per view (the issue-51/56 fixture arithmetic).
  const list = await downloadPngs(page, "Save as list view .png", 2);
  expect(list).toEqual([
    `my-plan-${STEM}-week-1-list.png`,
    `my-plan-${STEM}-week-2-list.png`,
  ]);

  const calendar = await downloadPngs(page, "Save as calendar view .png", 2);
  expect(calendar).toEqual([
    `my-plan-${STEM}-week-1-calendar.png`,
    `my-plan-${STEM}-week-2-calendar.png`,
  ]);

  // The view suffix is what keeps a week's two variants apart.
  for (const [i, name] of list.entries()) {
    expect(name).not.toBe(calendar[i]);
  }
});

// ── Slug hardening, observed through the real UI ────────────────────────────

test("edge — Windows-reserved characters are sanitized in the filename while the .json CONTENT keeps the verbatim name", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Every character in the Windows-reserved set, plus trailing punctuation.
  const wild = 'plan: "final"?';
  await renameSchedule(page, "Schedule 1", wild);
  await selectBiologyAndSeminar(page);

  const download = await downloadVia(page, "Save as .json");
  // Reserved chars collapse to single dashes; no leading/trailing dash.
  expect(download.suggestedFilename()).toBe(`plan-final-${STEM}.json`);

  // Filenames only — the envelope still carries the user-typed name verbatim.
  const doc = JSON.parse(readFileSync(await download.path(), "utf8")) as {
    schedule: { name: string };
  };
  expect(doc.schedule.name).toBe(wild);
});

test("edge — a name that slugs to nothing falls back to the bare cycle stem, never a leading-dash filename", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // "???" passes validateScheduleName (non-blank after trim) but has zero
  // sluggable characters.
  await renameSchedule(page, "Schedule 1", "???");
  await selectBiologyAndSeminar(page);

  const download = await downloadVia(page, "Save as .ics");
  expect(download.suggestedFilename()).toBe(`${STEM}.ics`);
});

// ── Evidence — mobile viewport shot of the renamed-schedule export menu ─────

test("evidence — mobile export menu open on a renamed schedule", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  // At mobile width "My schedules" is a native disclosure, collapsed by
  // default (#23 behavior, kept for #29) — expand it before renaming.
  await expect(async () => {
    await page.getByRole("button", { name: "My schedules" }).click();
    await expect(radios(page).first()).toBeVisible({ timeout: 1000 });
  }).toPass();
  await renameSchedule(page, "Schedule 1", "Ambitious Draft");
  await selectBiologyAndSeminar(page);
  await openMenu(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/mobile.png` });
});
