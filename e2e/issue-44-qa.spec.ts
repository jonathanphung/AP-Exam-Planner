import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #44) — exam details popup: per-section
 * questions | length | weight with nested part rows; sections the exam
 * lacks are omitted (never rendered, never "pending").
 *
 * One observable browser-level test per acceptance criterion, plus evidence
 * screenshots at the three standard viewports and the AC18 subject matrix
 * (multi-part Calculus AB, range-valued AP Chinese, portfolio-only
 * AP Drawing; light + dark).
 *
 * Fixtures (values traced to docs/super-board/research/collegeboard-2027/
 * and independently live-spot-checked during this QA pass):
 *   - AP Calculus AB   — MC 45q/105min/50% with Part A 30q/60min (no
 *                        calculator) + Part B 15q/45min (graphing calculator);
 *                        FR 6q/90min/50% with its own A/B split.
 *   - AP Chinese       — Section I: Free-Response FIRST (the 2026 page's
 *                        printed order), 4q/"40–45"min/50%, four part rows
 *                        whose minutes are genuinely unpublished ("pending");
 *                        Section II: Multiple-Choice 55q/65min/50%.
 *                        totalMinutes 120 is the published figure — sections
 *                        deliberately do not sum to it.
 *   - AP Seminar       — NO multiple-choice section exists: the three
 *                        components College Board's Assessment Format prints,
 *                        with printed NESTED weights on their part rows
 *                        (issue #73), zero "pending".
 *   - AP Drawing       — portfolio-only: no sections, no table at all.
 *   - AP African American Studies — the four components College Board prints
 *                        (issue #73 collapsed two invented sibling "Section
 *                        II:" rows into the single printed one); the
 *                        Individual Student Project row distinguishes
 *                        omission (no question count printed) from pending
 *                        (minutes exist but unpublished).
 *
 * Layout (Jon's #73 bounce, 2026-07-25): ONE presentation. Every exam with at
 * least one published section renders this table, whether or not its sections
 * carry parts. That supersedes Jon's PR #48 design bounce, pass 2, which this
 * suite used to verify: partless exams (Biology, Music Theory) rendered
 * spacious two-line blocks instead — no table, no column header, a
 * medium-weight name line above a muted left-aligned stats line that wrapped
 * only between `·`-separated phrases. The two cases below that pinned that
 * layout now pin the single one: a partless exam renders the same table, one
 * row per section with no nested rows, and it survives 375/320 without
 * horizontal scroll. The prose block was a deliberate call, replaced by a
 * later deliberate call — see src/lib/exam-sections.ts for the full history.
 */

const EVIDENCE_DIR = evidenceDir("issue-44-qa-v1");
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

/** The sections table inside the open dialog. */
const sectionsTable = (page: Page) => dialog(page).locator("table");

/** A section/part row located by its row header's accessible name. */
const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

/** The <dd> value for a labelled row in the dialog's description lists. */
const rowValue = (page: Page, label: string): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: label }).locator("dd");

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

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

test.describe("issue #44 — per-section exam details", () => {
  test("AC3/AC11 — AP Seminar has NO multiple-choice row: its three published components render with College Board's names and printed nested weights, and omission is never shown as 'pending'", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Seminar");

    // Issue #73: the components carry printed part rows, so the 4-column
    // table is the correct layout (PR #48 bounce rule is parts-based).
    await expect(sectionsTable(page)).toHaveCount(1);

    // Exactly the three components College Board's Assessment Format prints.
    await expect(
      row(page, /^Performance Task 1: Team Project and Presentation$/),
    ).toHaveCount(1);
    await expect(
      row(
        page,
        /^Performance Task 2: Individual Research-Based Essay and Presentation$/,
      ),
    ).toHaveCount(1);
    await expect(row(page, /^End-of-Course Exam$/)).toHaveCount(1);

    // The nonexistent MC section is omitted entirely.
    await expect(dialog(page).getByText(/multiple.?choice/i)).toHaveCount(0);

    // Nested weights render VERBATIM — never multiplied into an exam share.
    await expect(
      row(page, /Individual research report \(1,200 words\)/),
    ).toContainText("50% of 20%");
    await expect(row(page, /Oral defense/)).toContainText("10% of 35%");
    await expect(
      row(page, /Understanding and analyzing an argument/),
    ).toContainText("30% of 45%");
    await expect(row(page, /Evidence-Based argument essay/)).toContainText(
      "70% of 45%",
    );
    // The multiplied-out figures the dataset used to carry must be gone.
    await expect(dialog(page).getByText("13.5%")).toHaveCount(0);
    await expect(dialog(page).getByText("31.5%")).toHaveCount(0);

    // The three components' own weights are the printed exam-denominated ones.
    await expect(
      row(page, /^Performance Task 1: Team Project and Presentation$/),
    ).toContainText("20%");
    await expect(row(page, /^End-of-Course Exam$/)).toContainText("45%");
  });

  test("AC2 — a portfolio-only subject (AP Drawing) renders NO section table and no exam-format rows; its portfolio block carries the story", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Drawing");

    // No sections table at all — not an empty or zeroed one.
    await expect(sectionsTable(page)).toHaveCount(0);
    // No sit-down-exam format rows either.
    await expect(dialog(page).getByText("Exam length")).toHaveCount(0);
    await expect(dialog(page).getByText("Calculator")).toHaveCount(0);
    await expect(dialog(page).getByText("Delivery")).toHaveCount(0);

    // The dialog says what this subject actually is…
    await expect(dialog(page)).toContainText(
      "Portfolio-only — no written exam",
    );
    // …and the portfolio block shows the published weight + deadline.
    await expect(
      dialog(page).getByRole("heading", { name: "Portfolio component" }),
    ).toBeVisible();
    await expect(rowValue(page, "Weight")).toContainText("100%");
    await expect(rowValue(page, "Deadline")).toContainText("May 7, 2027");
  });

  test("AC12/AC7 — Calculus AB nests its published Part A/B rows beneath each section, visually subordinate and programmatically associated with the parent", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");

    // Section row: name | questions | length | weight.
    const mc = row(page, /^Section I: Multiple Choice$/);
    await expect(mc).toContainText("42");
    await expect(mc).toContainText("1 h 40 min");
    await expect(mc).toContainText("50%");

    // Part rows are programmatically associated: the row header's accessible
    // name carries the sr-only "<section> — " prefix.
    const mcPartA = row(page, /Multiple Choice\s*—\s*Part A/);
    await expect(mcPartA).toContainText("29");
    await expect(mcPartA).toContainText("1 h 2 min");
    await expect(mcPartA).toContainText("calculator not permitted");
    // Issue #73: the weight cell is the published share, not a dash.
    await expect(mcPartA).toContainText("35%");
    const mcPartB = row(page, /Multiple Choice\s*—\s*Part B/);
    await expect(mcPartB).toContainText("13");
    await expect(mcPartB).toContainText("38 min");
    await expect(mcPartB).toContainText("graphing calculator required");
    await expect(mcPartB).toContainText("15%");

    // The Free Response section has its own, distinct A/B split.
    const frPartA = row(page, /Free Response\s*—\s*Part A/);
    await expect(frPartA).toContainText("graphing calculator required");
    const frPartB = row(page, /Free Response\s*—\s*Part B/);
    await expect(frPartB).toContainText("calculator not permitted");

    // Visual subordination: the part row header is indented further than its
    // section row header.
    const sectionPad = await mc
      .locator("th")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    const partPad = await mcPartA
      .locator("th")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(partPad).toBeGreaterThan(sectionPad);

    // "Exam length" stays the published 190 total (= 3 h 10 min).
    await expect(rowValue(page, "Exam length")).toHaveText("3 h 10 min");
  });

  test("AC4/AC14 — AP Chinese renders its published ranges verbatim, in the page's printed section order, and 'Exam length' stays the published total (never a section sum)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Chinese Language and Culture");

    // The 2027 page prints Free-Response FIRST; the table preserves that order.
    const rowHeaders = sectionsTable(page).locator("tbody th[scope='row']");
    await expect(rowHeaders.first()).toContainText("Section I: Free-Response");

    // The published "40–45 Minutes" range renders verbatim — never averaged.
    const fr = row(page, /^Section I: Free-Response$/);
    await expect(fr).toContainText("4");
    await expect(fr).toContainText("40–45 min");
    await expect(fr).toContainText("50%");

    const mcq = row(page, /^Section II: Multiple-Choice$/);
    await expect(mcq).toContainText("55");
    await expect(mcq).toContainText("1 h 5 min");
    await expect(mcq).toContainText("50%");

    // Nested listening/reading parts under the MC section.
    await expect(row(page, /Multiple-Choice\s*—\s*Part A: Listening/)).toContainText(
      "25",
    );
    await expect(row(page, /Multiple-Choice\s*—\s*Part B: Reading/)).toContainText(
      "40 min",
    );

    // Published total 120 → "2 h". The printed sections ("40–45" + 65) do NOT
    // sum to it, proving the total is not recomputed from sections.
    await expect(rowValue(page, "Exam length")).toHaveText("2 h");
  });

  test("AC13 — genuinely unpublished values degrade to a visible 'pending' badge; the row keeps its name, count, and published note", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Chinese Language and Culture");

    // Q3's minutes are unpublished (the page prints only a combined figure).
    const q3 = row(page, /Question 3: Story Narration/);
    await expect(q3.getByText("pending", { exact: true })).toBeVisible();
    await expect(q3).toContainText("1"); // question count still shown
    await expect(q3).toContainText("Questions 3 & 4 combined 30 minutes");

    // All four FR part rows carry the badge — none are blanked or dropped.
    await expect(
      sectionsTable(page).getByText("pending", { exact: true }),
    ).toHaveCount(4);
  });

  test("AC3/AC13 — omission and 'pending' are distinct states in one row (AAS Individual Student Project: no printed question count vs unpublished minutes)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    // Issue #73: the two invented sibling "Section II:" rows collapsed into
    // the single "Section II: Free Response" College Board prints, with the
    // Short-Answer Questions (18%) and Document-Based Question (12%) as its
    // published parts — so AAS renders the 4-column table (the PR #48 branch
    // rule is parts-based) rather than the spacious partless blocks.
    await expect(sectionsTable(page)).toHaveCount(1);

    // The four published components, in College Board's printed order.
    for (const name of [
      /^Section I: Multiple Choice$/,
      /^Section IB: Individual Student Project—Exam Day Validation Question$/,
      /^Section II: Free Response$/,
      /^Individual Student Project$/,
    ] as const) {
      await expect(row(page, name)).toHaveCount(1);
    }
    // Section II's printed 4 questions / 1 h 25 min / 30%, with its parts
    // nested and carrying their own published weights.
    const frq = row(page, /^Section II: Free Response$/);
    await expect(frq).toContainText("4");
    await expect(frq).toContainText("1 h 25 min");
    await expect(frq).toContainText("30%");
    await expect(row(page, /Free Response\s*—\s*Short-Answer Questions/)).toContainText("18%");
    await expect(row(page, /Free Response\s*—\s*Document-Based Question/)).toContainText("12%");

    const isp = row(page, /^Individual Student Project$/);
    const cells = isp.getByRole("cell");
    // Questions: the page prints NO count (it's a project, not a question
    // set) → the not-published dash, not a fabricated count and not "pending".
    await expect(cells.nth(0)).toContainText("—");
    // Minutes: a duration exists but is unpublished → the pending badge.
    await expect(
      cells.nth(1).getByText("pending", { exact: true }),
    ).toBeVisible();
    // Weight: published 8.5% renders.
    await expect(cells.nth(2)).toHaveText("8.5%");
  });

  test("Jon's #73 bounce — an exam with NO published parts (AP Biology) renders the SAME table as a part-carrying exam: exactly one row per section, no nested or placeholder rows, and the prose presentation is gone", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");

    // The table, with the same four column headers Calculus AB gets.
    await expect(sectionsTable(page)).toHaveCount(1);
    const colHeaders = sectionsTable(page).locator("thead th[scope='col']");
    await expect(colHeaders).toHaveCount(4);
    await expect(colHeaders).toHaveText([
      "Section",
      "Questions",
      "Length",
      "Weight",
    ]);

    // Exactly 2 body rows for Biology's 2 sections — a section with no parts
    // is ONE row and nothing else: not an empty part row, not a placeholder.
    await expect(sectionsTable(page).locator("tbody tr")).toHaveCount(2);
    // …and every one of them is a scoped section row header (a11y parity with
    // the part-carrying case, which the dt/dd blocks used to provide).
    await expect(
      sectionsTable(page).locator("tbody th[scope='row']"),
    ).toHaveCount(2);

    const mc = row(page, /^Section I: Multiple Choice$/);
    await expect(mc.getByRole("cell").nth(0)).toHaveText("60");
    await expect(mc.getByRole("cell").nth(1)).toHaveText("1 h 30 min");
    await expect(mc.getByRole("cell").nth(2)).toHaveText("50%");
    const fr = row(page, /Section II: Free Response/);
    await expect(fr.getByRole("cell").nth(0)).toHaveText("6");
    await expect(fr.getByRole("cell").nth(1)).toHaveText("1 h 30 min");
    await expect(fr.getByRole("cell").nth(2)).toHaveText("50%");
    // The published FRQ-composition note survives the port, in the row header.
    await expect(fr).toContainText("2 long, 4 short");

    // No trace of the superseded prose presentation: no stat phrases, and the
    // metadata group carries the table branch's shipped mt-2 with no zone
    // divider (the divider only ever existed to separate the prose blocks).
    await expect(dialog(page).getByTestId("stat-phrase")).toHaveCount(0);
    const meta = await dialog(page)
      .locator("dl")
      .filter({ hasText: "Exam length" })
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { marginTop: cs.marginTop, borderTopWidth: cs.borderTopWidth };
      });
    expect(meta.marginTop).toBe("8px");
    expect(meta.borderTopWidth).toBe("0px");
  });

  test("Jon's #73 bounce — mobile Tier-2 (375×667 and 320px): a partless exam's table fits with no horizontal scroll, and the dataset's longest College Board section name wraps instead of clipping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await openInfo(page, "AP Biology");

    await expect(sectionsTable(page)).toBeVisible();
    await expect(row(page, /^Section I: Multiple Choice$/)).toBeVisible();
    await expect(row(page, /Section II: Free Response/)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    // #8 bar holds at 320px with the partless dialog open.
    await page.setViewportSize({ width: 320, height: 667 });
    await expect(row(page, /^Section I: Multiple Choice$/)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // The narrowest-width guarantee the prose block gave for free ("nothing
    // shares the line") has to be re-earned by the table: the dataset's
    // longest section name — 89 characters, AP Business with Personal
    // Finance — must wrap inside its cell, never clip or force page scroll.
    await openInfo(page, "AP Business with Personal Finance");
    const longest = sectionsTable(page)
      .locator("tbody th[scope='row']")
      .filter({ hasText: /^Section II, Part A: Free-Response Question 1/ });
    await expect(longest).toHaveText(
      "Section II, Part A: Free-Response Question 1: Business Canvas Project Exam-Day Validation",
    );
    const clip = await longest.evaluate((el) => ({
      horizontal: el.scrollWidth - el.clientWidth,
      vertical: el.scrollHeight - el.clientHeight,
    }));
    expect(clip.horizontal, "section name clips horizontally").toBeLessThanOrEqual(1);
    expect(clip.vertical, "section name clips vertically").toBeLessThanOrEqual(1);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("AC15 — the calendar event popup shares the same sections table", async ({
    page,
  }) => {
    await seedSelection(page, ["calculus-ab"]);
    await page.goto("/");

    // The calendar is the default view; clicking a placed exam block opens
    // the same details popup as the catalog's info button.
    const block = page.locator(
      '[data-testid="calendar-block"][data-subject-id="calculus-ab"]',
    );
    await block.scrollIntoViewIfNeeded();
    await block.click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("AP Calculus AB");
    await expect(sectionsTable(page)).toBeVisible();
    await expect(row(page, /Multiple Choice\s*—\s*Part A/)).toBeVisible();
  });

  test("AC15/AC16 — mobile Tier-2 details (375×667) render the table with no horizontal scroll, including at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");

    await expect(sectionsTable(page)).toBeVisible();
    await expect(row(page, /Multiple Choice\s*—\s*Part A/)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    // #8 bar holds at 320px with the dialog open.
    await page.setViewportSize({ width: 320, height: 667 });
    await expect(sectionsTable(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("AC16 — real table semantics (caption + scoped headers) and zero serious/critical axe violations with the dialog open", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");

    const table = sectionsTable(page);
    // A caption names the relationship for AT.
    await expect(table.locator("caption")).toHaveText(
      "Exam sections: questions, length, and share of score",
    );
    // Four scoped column headers: Section | Questions | Length | Weight.
    const colHeaders = table.locator("thead th[scope='col']");
    await expect(colHeaders).toHaveCount(4);
    await expect(colHeaders.nth(0)).toHaveText("Section");
    await expect(colHeaders.nth(1)).toHaveText("Questions");
    await expect(colHeaders.nth(2)).toHaveText("Length");
    await expect(colHeaders.nth(3)).toHaveText("Weight");
    // Every body row is headed by a scoped row header (sections AND parts).
    const bodyRows = await table.locator("tbody tr").count();
    await expect(table.locator("tbody th[scope='row']")).toHaveCount(bodyRows);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id}: ${v.description}`),
    ).toEqual([]);
  });
});

// --- Evidence capture --------------------------------------------------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — multi-part Calculus AB (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");
    await expect(row(page, /Multiple Choice\s*—\s*Part A/)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}

const evidenceCases = [
  {
    file: "chinese-range",
    subject: "AP Chinese Language and Culture",
    ready: (page: Page) => row(page, /^Section I: Free-Response$/),
  },
  {
    file: "portfolio-drawing",
    subject: "AP Drawing",
    ready: (page: Page) =>
      dialog(page).getByRole("heading", { name: "Portfolio component" }),
  },
  {
    // Issue #73 replaced AP Seminar's two invented `End-of-Course Exam –
    // Short-Answer/Essay Section` rows (whose 13.5% / 31.5% were `30% of 45%`
    // and `70% of 45%` multiplied out) with the three components College Board
    // prints. Seminar therefore has parts now, so it renders the 4-column
    // TABLE rather than the partless `dl` this case used to wait on — the
    // readiness locator has to be a table row, not a summary row, or the
    // screenshot is taken against an element that no longer exists.
    file: "seminar-no-mc",
    subject: "AP Seminar",
    ready: (page: Page) => row(page, /^End-of-Course Exam$/),
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

test("evidence — multi-part Calculus AB (desktop, dark)", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedDarkTheme(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await openInfo(page, "AP Calculus AB");
  await expect(row(page, /Multiple Choice\s*—\s*Part A/)).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/calculus-ab-dark-desktop.png`,
  });
});
