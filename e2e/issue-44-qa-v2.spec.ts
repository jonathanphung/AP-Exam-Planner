import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * super-board QA v2 (issue #44, Jon's PR #48 design bounce) — independent
 * verification of the partless spacious layout.
 *
 * The bounce rule under test (parts-based, never count-based):
 *   - ANY section has published parts → the 4-column table, completely
 *     unchanged (Calculus AB, the language exams).
 *   - NO section has parts → no table, no column header: one spacious
 *     two-line block per section (bounce pass 2 — medium-weight name line
 *     above a muted left-aligned stats line that wraps only between
 *     `·`-separated stat phrases), in a group visually distinct from the
 *     metadata rows below ("Exam length", "Calculator", …).
 *
 * This suite adds coverage the builder's revision did not have:
 *   1. the CALENDAR EVENT POPUP surface renders the partless layout too
 *      (the builder's calendar-popup test only exercised the table case);
 *   2. a section `note` renders in the partless layout (Biology's FR
 *      composition note) — the old flat `frqType` strings must survive the
 *      layout switch;
 *   3. singular "1 question" inside a multi-section partless exam (AAS
 *      Section IB) — the branch rule's real test is AAS's 5 partless rows;
 *   4. the table case keeps its `mt-2` spacing above the metadata list
 *      (pixel-untouched includes the gap between table and rows below).
 *
 * Evidence (Jon's mandated bounce set, light AND dark) is captured to
 * docs/super-board/runs/issue-44-qa-v2/.
 *
 * Dataset ground truth for the branch rule (verified against ap-2026.json in
 * this QA pass): 4 portfolio-only, 14 with parts, 24 partless — the partless
 * set includes AAS (5 sections), music-theory and business-with-personal-
 * finance (3 each), so a count-based branch would visibly fail them.
 * Note: Jon's bounce comment suggested Psychology / World History: Modern as
 * partless fixtures — both actually HAVE parts (Part A/B splits), so Biology
 * and AAS are the correct fixtures, as the builder's handoff flagged.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-44-qa-v2";
const SELECTION_KEY = "apx.selection.v1";
const THEME_KEY = "apx.theme.v1";

const dialog = (page: Page) => page.getByRole("dialog");

const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

/** Reveal a subject's Tier-1 panel and open its details dialog (Tier 2). */
async function openInfo(page: Page, name: string) {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

const sectionsTable = (page: Page) => dialog(page).locator("table");

/** A spacious/metadata row of the dialog's <dl>, by its dt text. */
const summaryRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: name });

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

test.describe("issue #44 QA v2 — partless layout (PR #48 bounce), independent checks", () => {
  test("calendar event popup (third surface) renders the partless spacious layout — no table, no column header, exact value string", async ({
    page,
  }) => {
    await seedSelection(page, ["biology"]);
    await page.goto("/");

    const block = page.locator(
      '[data-testid="calendar-block"][data-subject-id="biology"]',
    );
    await block.scrollIntoViewIfNeeded();
    await block.click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("AP Biology");
    // The bounce reaches this surface too: no table, no column header.
    await expect(sectionsTable(page)).toHaveCount(0);
    await expect(dialog(page).getByRole("columnheader")).toHaveCount(0);
    await expect(
      summaryRow(page, "Multiple Choice").locator("dd"),
    ).toHaveText("60 questions · 1 h 30 min · 50% of score");
  });

  test("a section note survives the layout switch: Biology's FR composition note renders as the block's third muted line, below the exact stats line", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");

    // Bounce pass 2: line 1 = name (dt), line 2 = stats, line 3 = note.
    const fr = summaryRow(page, "Free Response");
    await expect(fr.locator("dt")).toHaveText("Free Response");
    await expect(fr.locator("dd")).toContainText(
      "6 questions · 1 h 30 min · 50% of score",
    );
    const note = fr
      .locator("dd")
      .getByText("6 free-response questions (2 long, 4 short)");
    await expect(note).toBeVisible();
    // The note sits on its own line BELOW the last stat phrase.
    const lastPhrase = fr.getByTestId("stat-phrase").last();
    const phraseBox = (await lastPhrase.boundingBox())!;
    const noteBox = (await note.boundingBox())!;
    expect(noteBox.y).toBeGreaterThanOrEqual(phraseBox.y + phraseBox.height - 1);
  });

  test("singular '1 question' inside the 5-section partless exam (AAS Section IB), and all five blocks are two-line: name above left-aligned stats, no stat phrase ever wrapping — even for AAS's longest section name", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    await expect(sectionsTable(page)).toHaveCount(0);
    await expect(
      summaryRow(page, /Section IB: Individual Student Project/).locator("dd"),
    ).toHaveText("1 question · 10 min · 1.5% of score");
    await expect(
      summaryRow(page, "Section II: Document-Based Question").locator("dd"),
    ).toHaveText("1 question · 45 min · 12% of score");

    // Bounce pass 2: every section is a two-line block — the name line (dt,
    // medium weight) sits fully above the stats line (dd), both left-aligned
    // to the same edge, and no `·`-separated stat phrase ever line-breaks.
    // AAS is the stress test: 5 blocks, including the longest section name in
    // the dataset ("Section IB: …—Exam Day Validation Question"), which may
    // wrap freely on its own line without squeezing the stats.
    for (const name of [
      "Section I: Multiple Choice",
      /Section IB: Individual Student Project/,
      "Section II: Short-Answer Questions",
      "Section II: Document-Based Question",
      /^Individual Student Project/,
    ] as const) {
      const block = summaryRow(page, name).first();
      const nameBox = (await block.locator("dt").boundingBox())!;
      const statsBox = (await block.locator("dd").boundingBox())!;
      expect(
        nameBox.y + nameBox.height,
        `${String(name)}: name line must sit above the stats line`,
      ).toBeLessThanOrEqual(statsBox.y + 1);
      expect(
        Math.abs(nameBox.x - statsBox.x),
        `${String(name)}: stats must be left-aligned with the name`,
      ).toBeLessThanOrEqual(1);
      await expect(block.locator("dt")).toHaveCSS("font-weight", "500");

      // Mid-phrase wrap = a fragment on a fully separate line. Chromium
      // fragments an inline span's client rects per text node (and the
      // pending badge is its own atomic fragment), so rect count cannot
      // detect wrapping — vertical separation can.
      const phrases = block.getByTestId("stat-phrase");
      const count = await phrases.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        expect(
          await phrases.nth(i).evaluate((el) => {
            const rects = [...el.getClientRects()].filter(
              (r) => r.width > 0 && r.height > 0,
            );
            return rects.some((a) =>
              rects.some((b) => a.top >= b.bottom - 0.5),
            );
          }),
          `${String(name)}: stat phrase ${i} must not wrap mid-phrase`,
        ).toBe(false);
      }
    }
  });

  test("table case pixel-untouched: Calculus AB keeps the 4-column table, part rows, AND the mt-2 gap above the metadata list", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");

    await expect(sectionsTable(page)).toBeVisible();
    await expect(dialog(page).getByRole("columnheader")).toHaveCount(4);
    // The metadata <dl> keeps its table-offset margin (mt-2 = 8px).
    const marginTop = await dialog(page)
      .locator("dl")
      .first()
      .evaluate((el) => getComputedStyle(el).marginTop);
    expect(marginTop).toBe("8px");
    // And no spacious section rows leak into the <dl> for the table case.
    await expect(
      dialog(page).locator("dl > div").filter({ hasText: "% of score" }),
    ).toHaveCount(0);
  });
});

// --- Evidence capture (Jon's mandated bounce set, light + dark) --------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

// 1 + 4: the fix itself (plain 2-section AP Biology) at the three standard
// viewports — mobile.png IS the mobile Tier-2 partless evidence.
for (const vp of viewports) {
  test(`evidence — partless Biology (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(summaryRow(page, "Multiple Choice").locator("dd")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}

const evidenceCases = [
  {
    file: "biology-partless",
    subject: "AP Biology",
    ready: (page: Page) => summaryRow(page, "Multiple Choice").locator("dd"),
  },
  {
    file: "aas-5-sections-partless",
    subject: "AP African American Studies",
    ready: (page: Page) =>
      summaryRow(page, "Section II: Document-Based Question").locator("dd"),
  },
  {
    file: "calculus-ab-table-unchanged",
    subject: "AP Calculus AB",
    ready: (page: Page) => sectionsTable(page),
  },
] as const;

for (const c of evidenceCases) {
  for (const theme of ["light", "dark"] as const) {
    test(`evidence — ${c.file} (desktop, ${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      if (theme === "dark") await seedDarkTheme(page);
      await page.goto("/");
      if (theme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      }
      await openInfo(page, c.subject);
      await expect(c.ready(page)).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${c.file}-${theme}-desktop.png`,
      });
    });
  }
}
