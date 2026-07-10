import { test, expect, type Locator, type Page } from "@playwright/test";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #45, v3 — rebuild after the statistics.frqType bounce).
 *
 * History: v1 fixed seven wrong question counts; v2 (after the totalMinutes
 * bounce) corrected four language-exam durations to 150 and reverted two false
 * "pending" overwrites to 120. The Orchestrator's third bounce found the last
 * false pending: `statistics.format.frqType` had been set to "pending" even
 * though BOTH College Board pages publish the Section-II composition. Commit
 * 50f225c set it to the sourced string
 *   "3 multi-part questions + 1 inference question (hypothesis test or
 *    confidence interval)"
 * (AP Central "Question 3: Inference (Hypothesis Test or Confidence Interval)"
 * + three multi-focus/multi-part questions; AP Students the same as multi-part
 * questions). This v3 supersedes v2, whose statistics case asserted a "pending"
 * frqType badge that no longer renders.
 *
 * The exam-details popup, the mobile Tier-2 details, and the calendar event
 * popup all render the SAME `InfoPanel`, so proving the values on the catalog
 * popup at desktop + mobile covers the first two surfaces directly; a
 * calendar-popup test covers the third.
 *
 * Screenshots land in docs/super-board/runs/issue-45-qa-v3/ and are committed
 * to the issue branch so they render inline on the issue / PR. Every value
 * asserted here is the College Board published figure recorded verbatim in
 * docs/super-board/research/collegeboard-2026/<id>.json (post-171cb15) and
 * src/data/sources.md.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-45-qa-v3";

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

// ---- InfoPanel (catalog popup) locators — mirror e2e/issue-6 ---------------
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const dialog = (page: Page) => page.getByRole("dialog");
/** <dd> value for a labelled row inside the panel's description list. */
const rowValue = (page: Page, label: string): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: label }).locator("dd");

// Issue #44 port: MCQ/FRQ counts render as rows of the sections table now.
const sectionRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });
// Issue #44 PR #48 bounce: exams with NO published parts render spacious
// dl rows instead of the table — Statistics is the one such subject here.
const summaryRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: name });
const MC_ROW = /multiple.?choice/i;
const FR_ROW = /free.?response/i;

/** Reveal a subject's Tier-1 panel and open its exam-details dialog (Tier 2). */
async function openCatalogInfo(page: Page, name: string) {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(name);
}

/**
 * The seven corrected subjects. `mcq`/`frq` are the published counts; `length`
 * is `formatMinutes(totalMinutes)` — French/German/Italian/Spanish are the
 * corrected 150 -> "2 h 30 min", Chinese/Japanese the reverted 120 -> "2 h",
 * Statistics the unchanged 180 -> "3 h".
 *
 * Issue #44 port: the flat MCQ/FRQ rows became rows of the per-section table,
 * and the language exams' old aggregate `frqType` strings ("1 written task +
 * 2 spoken tasks") were superseded by their published Part/Question rows —
 * `structure` asserts one such published part renders for each. Statistics'
 * pinned Section-II composition lives on as its free-response section note.
 *
 * Issue #44 PR #48 bounce port: Statistics has no published parts, so its
 * sections render as spacious dl rows (`layout: "rows"`); the six language
 * exams keep the table (`layout: "table"`).
 */
const CORRECTED = [
  {
    name: "AP Statistics",
    mcq: "42",
    frq: "4",
    length: "3 h",
    // The bounce fix: a published composition, never a pending badge.
    structure: "3 multi-part questions + 1 inference question (hypothesis test or confidence interval)",
    layout: "rows",
  },
  {
    name: "AP French Language and Culture",
    mcq: "55",
    frq: "3",
    length: "2 h 30 min",
    structure: "Project Presentation",
    layout: "table",
  },
  {
    name: "AP German Language and Culture",
    mcq: "55",
    frq: "3",
    length: "2 h 30 min",
    structure: "Project Presentation",
    layout: "table",
  },
  {
    name: "AP Italian Language and Culture",
    mcq: "55",
    frq: "3",
    length: "2 h 30 min",
    structure: "Project Presentation",
    layout: "table",
  },
  {
    name: "AP Spanish Language and Culture",
    mcq: "55",
    frq: "3",
    length: "2 h 30 min",
    structure: "Project Presentation",
    layout: "table",
  },
  {
    name: "AP Chinese Language and Culture",
    mcq: "55",
    frq: "4",
    length: "2 h",
    structure: "Project Presentation",
    layout: "table",
  },
  {
    name: "AP Japanese Language and Culture",
    mcq: "55",
    frq: "4",
    length: "2 h",
    structure: "Project Presentation",
    layout: "table",
  },
] as const;

test.describe("issue #45 — corrected counts + durations + statistics frqType render in InfoPanel", () => {
  test("AC5 — all seven subjects' catalog exam-details popup shows the corrected counts, frqType, and length; none pending", async ({
    page,
  }) => {
    await page.goto("/");

    for (const s of CORRECTED) {
      await openCatalogInfo(page, s.name);

      if (s.layout === "table") {
        // Issue #44: counts render in the per-section table rows. Part rows
        // carry an sr-only "<section> — " prefix (programmatic association),
        // so the name filter also matches them — .first() is the parent
        // section row, which always precedes its parts in DOM order.
        const mcQuestions = sectionRow(page, MC_ROW)
          .first()
          .getByRole("cell")
          .first();
        await expect(mcQuestions, `${s.name} MCQ`).toContainText(s.mcq);
        // Scoped to the Questions cell: a row's *minutes* may legitimately be
        // pending (several language-exam part rows have no printed single
        // figure) — the count itself must never be.
        await expect(
          mcQuestions.getByText("pending", { exact: true }),
          `${s.name} MCQ count must not be pending`,
        ).toHaveCount(0);
        const frCells = sectionRow(page, FR_ROW).first().getByRole("cell");
        await expect(frCells.first(), `${s.name} FRQ`).toHaveText(s.frq);
      } else {
        // Issue #44 PR #48 bounce: a partless exam (Statistics) renders its
        // sections as spacious dl rows — "<count> questions · <length> ·
        // <weight>% of score" — with no table at all.
        await expect(dialog(page).locator("table")).toHaveCount(0);
        const mcValue = summaryRow(page, MC_ROW).locator("dd");
        await expect(mcValue, `${s.name} MCQ`).toContainText(
          `${s.mcq} questions`,
        );
        await expect(
          mcValue.getByText("pending", { exact: true }),
          `${s.name} MCQ count must not be pending`,
        ).toHaveCount(0);
        await expect(
          summaryRow(page, FR_ROW).locator("dd"),
          `${s.name} FRQ`,
        ).toContainText(`${s.frq} questions`);
      }
      // The published structure renders — statistics via its section note,
      // the language exams via their published Part/Question rows.
      await expect(dialog(page), `${s.name} structure`).toContainText(
        s.structure,
      );
      await expect(rowValue(page, "Exam length"), `${s.name} length`).toHaveText(
        s.length,
      );
      // The published overall duration is never a pending badge.
      await expect(
        rowValue(page, "Exam length").getByText("pending"),
        `${s.name} length must not be pending`,
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Close" }).click();
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  // The headline of this pass: AP Statistics' Section-II composition renders as
  // the sourced string, with each published term present and the dropped
  // "investigative task" absent.
  test("AC5 — AP Statistics' free-response section note shows the sourced Section-II composition (no investigative task, no pending)", async ({
    page,
  }) => {
    await page.goto("/");
    await openCatalogInfo(page, "AP Statistics");
    // Issue #44 PR #48 bounce: Statistics is partless → spacious dl row; the
    // note renders beneath the section name in the row's label.
    const frq = summaryRow(page, FR_ROW);
    await expect(frq.locator("dd")).toContainText("4 questions");
    await expect(frq).toContainText("multi-part");
    await expect(frq).toContainText("inference");
    await expect(frq).toContainText("hypothesis test or confidence interval");
    await expect(frq.getByText("investigative")).toHaveCount(0);
    await expect(frq.getByText("pending", { exact: true })).toHaveCount(0);
  });

  // Visual evidence at the three standard viewports. Statistics is the headline
  // fix of THIS pass (frqType pending -> sourced composition); French is the
  // headline duration fix of the prior pass (180 -> 150 = "3 h" -> "2 h 30 min").
  // Mobile 375x667 is the "Tier-2 details" surface the ticket names explicitly.
  for (const vp of viewports) {
    test(`AC5 evidence — AP Statistics exam-details popup (${vp.name} ${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await openCatalogInfo(page, "AP Statistics");
      // Issue #44 PR #48 bounce: partless Statistics → spacious dl rows.
      await expect(summaryRow(page, MC_ROW).locator("dd")).toContainText(
        "42 questions",
      );
      await expect(summaryRow(page, FR_ROW)).toContainText(
        "3 multi-part questions + 1 inference question (hypothesis test or confidence interval)",
      );
      await expect(rowValue(page, "Exam length")).toHaveText("3 h");
      await dialog(page).screenshot({
        path: `${EVIDENCE_DIR}/catalog-statistics-${vp.name}.png`,
      });
    });

    test(`AC5 evidence — AP French exam-details popup (${vp.name} ${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await openCatalogInfo(page, "AP French Language and Culture");
      await expect(sectionRow(page, MC_ROW).first()).toContainText("55");
      await expect(
        sectionRow(page, FR_ROW).first().getByRole("cell").first(),
      ).toHaveText("3");
      await expect(rowValue(page, "Exam length")).toHaveText("2 h 30 min");
      await dialog(page).screenshot({
        path: `${EVIDENCE_DIR}/catalog-french-${vp.name}.png`,
      });
    });
  }

  // Third surface: the calendar event popup. Same InfoPanel, so proving French
  // renders "2 h 30 min" here confirms the corrected duration flows to every
  // surface. Select only French (no slot conflict -> clicking the block opens
  // details directly, not the conflict dialog).
  test("AC5 evidence — AP French calendar event popup renders the corrected 2 h 30 min", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    // Select French from the catalog.
    const frenchCard = page
      .locator('section[aria-label="Subject catalog"] ul > li button[aria-pressed]')
      .filter({ hasText: "AP French Language and Culture" })
      .first();
    await frenchCard.click();
    await expect(frenchCard).toHaveAttribute("aria-pressed", "true");

    // Switch to the calendar and page forward until French's block appears.
    await pressViewChip(page, "Calendar");
    const block = page.locator(
      '[data-testid="calendar-block"][data-subject-id="french-language-and-culture"]',
    );
    const nextWeek = page.getByRole("button", { name: /^Next week/ });
    for (let guard = 0; guard < 8 && (await block.count()) === 0; guard += 1) {
      await nextWeek.click();
    }
    await expect(block, "French calendar block not found in any week").toHaveCount(1);
    await block.scrollIntoViewIfNeeded();
    await block.click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("AP French Language and Culture");
    await expect(sectionRow(page, MC_ROW).first()).toContainText("55");
    await expect(
      sectionRow(page, FR_ROW).first().getByRole("cell").first(),
    ).toHaveText("3");
    await expect(rowValue(page, "Exam length")).toHaveText("2 h 30 min");
    await dialog(page).screenshot({
      path: `${EVIDENCE_DIR}/calendar-french-desktop.png`,
    });
  });
});
