import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v2 (issue #44, Jon's PR #48 design bounce) — retargeted by
 * Jon's #73 bounce onto the single presentation that replaced it.
 *
 * ## What this suite used to verify, and why it changed
 *
 * PR #48's rule was parts-based, never count-based: an exam whose sections
 * carried parts got the 4-column table, and an exam with NO parts got one
 * spacious two-line block per section instead (no table, no column header —
 * medium-weight name line above a muted left-aligned stats line that wrapped
 * only between `·`-separated phrases). Jon's #73 bounce supersedes that: the
 * split meant AP Human Geography presented nothing like AP Calculus BC even
 * though every number the table needs is published for both. Every exam with
 * sections now renders the table.
 *
 * The four checks below are the same four, pointed at the surviving layout:
 *   1. the CALENDAR EVENT POPUP surface renders the table for a partless
 *      exam too (this suite's original point: the builder's calendar-popup
 *      test only ever exercised a part-carrying subject);
 *   2. a section `note` still renders for a partless exam (Biology's FR
 *      composition note) — the old flat `frqType` strings have now survived
 *      TWO layout switches;
 *   3. a multi-section partless exam (AP Music Theory, 3 sections) gets one
 *      table row per section and no nested rows — the case a naive
 *      `sections.length === 2` port would have missed;
 *   4. the metadata list keeps its `mt-2` spacing below the table — which is
 *      now the ONLY spacing case, since the prose block's zone divider is
 *      gone.
 *
 * Evidence is captured to the `issue-44-qa-v2` evidence folder resolved by
 * `evidenceDir()` (e2e/support/evidence.ts).
 *
 * Dataset ground truth after #73 (ap-2027.json): 5 portfolio-only subjects
 * with no sections at all, 20 with parts, 18 partless — and all 38 with
 * sections render the identical table.
 */

const EVIDENCE_DIR = evidenceDir("issue-44-qa-v2");
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

/**
 * A section (or part) row of the sections table, by its row header.
 *
 * Replaces this suite's `summaryRow` (`dl > div` filtered by dt text), which
 * read the PR #48 prose blocks — a `dl` that no longer carries sections.
 */
const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

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

test.describe("issue #44 QA v2 — one presentation (#73 bounce, superseding PR #48), independent checks", () => {
  test("calendar event popup (third surface) renders the table for a PARTLESS exam — the surface the original suite only ever checked with a part-carrying subject", async ({
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
    // #73 reaches this surface too — all three render the same InfoPanel.
    await expect(sectionsTable(page)).toHaveCount(1);
    await expect(dialog(page).getByRole("columnheader")).toHaveCount(4);
    const mc = row(page, /^Section I: Multiple Choice$/);
    await expect(mc.getByRole("cell")).toHaveText(["60", "1 h 30 min", "50%"]);
  });

  test("a section note survives the SECOND layout switch: Biology's FR composition note renders under the section name in the row header, below the printed title", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");

    const fr = row(page, /Section II: Free Response/);
    const header = fr.getByRole("rowheader");
    // Issue #73: the printed title carries College Board's "Section II:" prefix.
    await expect(header).toContainText("Section II: Free Response");
    await expect(fr.getByRole("cell")).toHaveText(["6", "1 h 30 min", "50%"]);

    const note = header.getByText(
      "6 free-response questions (2 long, 4 short)",
    );
    await expect(note).toBeVisible();
    // The note sits on its own line BELOW the section name, not inline with it.
    const headerBox = (await header.boundingBox())!;
    const noteBox = (await note.boundingBox())!;
    expect(noteBox.y).toBeGreaterThan(headerBox.y);
    expect(noteBox.height).toBeLessThan(headerBox.height);
  });

  // AP African American Studies was this suite's multi-section PARTLESS stress
  // case. Issue #73 collapsed its two invented sibling "Section II:" rows into
  // the single "Section II: Free Response" College Board prints, with the SAQ
  // and DBQ as parts, so AAS carries part rows now. AP Music Theory is the
  // remaining multi-section exam with NO parts — and the one subject Jon's #73
  // bounce called out by name as proof the fix cannot be `sections.length ===
  // 2`. It also carries the longest partless section name in the dataset.

  test("a 3-section exam with NO parts (AP Music Theory) gets one table row per section and no nested rows — the case a count-based port would miss", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Music Theory");

    await expect(sectionsTable(page)).toHaveCount(1);
    // Exactly 3 body rows for 3 sections: no nested part rows, no placeholders.
    await expect(sectionsTable(page).locator("tbody tr")).toHaveCount(3);
    await expect(
      sectionsTable(page).locator("tbody th[scope='row']"),
    ).toHaveCount(3);

    await expect(
      row(page, /^Section I: Multiple Choice$/).getByRole("cell"),
    ).toHaveText(["75", "1 h 20 min", "45%"]);
    await expect(
      row(page, /^Section IIA: Free Response: Written$/).getByRole("cell"),
    ).toHaveText(["7", "1 h 10 min", "45%"]);
    await expect(
      row(page, /^Section IIB: Free Response: Sight Singing$/).getByRole("cell"),
    ).toHaveText(["2", "10 min", "10%"]);

    // The longest partless section name wraps inside its cell rather than
    // clipping — the guarantee the prose block used to get for free.
    const longest = sectionsTable(page)
      .locator("tbody th[scope='row']")
      .filter({ hasText: /Sight Singing/ });
    const clip = await longest.evaluate((el) => ({
      horizontal: el.scrollWidth - el.clientWidth,
      vertical: el.scrollHeight - el.clientHeight,
    }));
    expect(clip.horizontal).toBeLessThanOrEqual(1);
    expect(clip.vertical).toBeLessThanOrEqual(1);
  });

  test("the metadata list keeps its mt-2 gap below the table — for the part-carrying case AND the partless one, which is now the same case", async ({
    page,
  }) => {
    for (const subject of ["AP Calculus AB", "AP Biology"] as const) {
      await page.goto("/");
      await openInfo(page, subject);

      await expect(sectionsTable(page)).toBeVisible();
      await expect(dialog(page).getByRole("columnheader")).toHaveCount(4);
      // The metadata <dl> keeps its table-offset margin (mt-2 = 8px).
      const marginTop = await dialog(page)
        .locator("dl")
        .first()
        .evaluate((el) => getComputedStyle(el).marginTop);
      expect(marginTop, `${subject} metadata margin`).toBe("8px");
      // No spacious section rows leak into the <dl> for either subject — the
      // prose block's "<n> questions · <length> · <weight>% of score" string
      // must not survive anywhere.
      await expect(
        dialog(page).locator("dl > div").filter({ hasText: "% of score" }),
        `${subject} prose leak`,
      ).toHaveCount(0);
    }
  });
});

// --- Evidence capture (Jon's mandated bounce set, light + dark) --------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

// 1 + 4: the fix itself (plain 2-section AP Biology, no parts) at the three
// standard viewports — mobile.png IS the mobile Tier-2 evidence.
for (const vp of viewports) {
  test(`evidence — partless Biology (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(row(page, /^Section I: Multiple Choice$/)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}

const evidenceCases = [
  {
    file: "biology-partless",
    subject: "AP Biology",
    ready: (page: Page) => row(page, /^Section I: Multiple Choice$/),
  },
  {
    file: "music-theory-3-sections-partless",
    subject: "AP Music Theory",
    ready: (page: Page) =>
      row(page, /^Section IIB: Free Response: Sight Singing$/),
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
