import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * super-board QA v2 (issue #73, Jon's Done → Ready bounce, 2026-07-25) —
 * ONE presentation for every exam.
 *
 * QA v1 signed off the data work (63 part weights, the three-denominator
 * handling, the printed section titles) and the Reviewer grounded it at
 * 93/100. Jon then bounced the card because the *presentation* still split in
 * two: an exam whose sections publish part rows got the
 * `section | questions | length | weight` table, an exam with no parts got the
 * PR #48 prose blocks. This lane's gate is the bounce's own acceptance
 * criteria, and it is written against the risks a mechanical port creates —
 * not against the diff.
 *
 * Independence from the builder's `issue-73-one-presentation.spec.ts` is
 * deliberate in three places:
 *
 *   1. **The 18 subjects are hardcoded from Jon's bounce text**, not derived
 *      from `ap-2027.json`. The builder's spec computes them with the same
 *      `parts?.length` predicate the component uses, so a dataset edit moves
 *      the guard and the implementation together. Jon's list cannot move.
 *   2. **The prose block is asserted absent by its own markup** (`dl > div`
 *      carrying a section name — the shape `summaryRow` used to target in the
 *      #44 specs), not only by its `stat-phrase` test id.
 *   3. **Honest degradation is checked as AT output, not pixels.** "Never a
 *      blank cell" is swept across all 38 sit-down subjects, and the AAS row
 *      that carries an omission and a pending side by side is asserted through
 *      the sr-only `none published` label vs the visible `pending` badge — the
 *      two states a mechanical port most plausibly collapses into one blank.
 *
 * The 320px clip detector proves itself against a forced positive before any
 * assertion trusts it (same discipline as the #44 v3 suite).
 *
 * **Why no test title here carries a literal subject count.** `#71 AC5`
 * (`src/data/doc-freshness.test.ts`) allows a roster count in a title only when
 * the dataset itself produces that number — ROSTER_SIZE plus the per-category
 * counts. `18` ("sections but no parts") and `38` ("has sections") are real
 * dataset facts but not members of that set, and widening a #71 guard to admit
 * them would bake in a predicate THIS branch just deleted: after the port,
 * "sections but no parts" is no longer a rendering branch at all. So the counts
 * live in `expect()` calls at the top of the sweeps that depend on them, where
 * they fail loudly if the scope drifts — a title that merely says "18" cannot
 * fail. Don't put the literals back in the titles.
 */

const EVIDENCE_DIR = evidenceDir("issue-73-qa-v2");
const SELECTION_KEY = "apx.selection.v1";
const THEME_KEY = "apx.theme.v1";

/** The sr-only label the not-published dash carries. */
const NONE_PUBLISHED = "none published";

/**
 * The 18 subjects Jon's bounce lists — 17 with two sections plus the
 * 3-section AP Music Theory. Transcribed from the bounce comment on #73, NOT
 * computed from the dataset: a count- or parts-derived list would drift with
 * the same edit that breaks the behaviour.
 */
const BOUNCE_18 = [
  "biology",
  "chemistry",
  "comparative-government-and-politics",
  "computer-science-a",
  "computer-science-principles",
  "cybersecurity",
  "english-language-and-composition",
  "english-literature-and-composition",
  "environmental-science",
  "human-geography",
  "latin",
  "physics-1",
  "physics-2",
  "physics-c-electricity-and-magnetism",
  "physics-c-mechanics",
  "statistics",
  "united-states-government-and-politics",
  "music-theory",
] as const;

type Section = {
  name: string;
  parts?: { name: string }[];
};
type Subject = {
  id: string;
  name: string;
  format: { sections: Section[] };
};

const SUBJECTS = apData.subjects as unknown as Subject[];
const byId = (id: string): Subject => {
  const subject = SUBJECTS.find((s) => s.id === id);
  if (!subject) throw new Error(`unknown subject id in spec fixture: ${id}`);
  return subject;
};
const WITH_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length > 0);

const dialog = (page: Page) => page.getByRole("dialog");
const sectionsTable = (page: Page) => dialog(page).locator("table");

const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

/**
 * Reveal a subject's Tier-1 panel and open its details dialog (Tier 2).
 *
 * The expand control is a TOGGLE and the panel stays open after the dialog is
 * dismissed, so a spec that opens the same subject twice must not click it
 * again — the second click would collapse the panel and hide the info button.
 */
async function openInfo(page: Page, name: string) {
  if (!(await infoButton(page, name).isVisible())) {
    await expandButton(page, name).click();
  }
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeInfo(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
}

const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

test.describe("issue #73 bounce (QA v2) — one presentation, honestly degraded", () => {
  test("bounce AC1 — every subject on Jon's bounce list renders the table, and the PR #48 prose block survives in no form: no dl row carries a section name, no stat phrase, no zone divider", async ({
    page,
  }) => {
    // The scope claim, asserted rather than stated in the title (see the
    // "why no literal count" note at the top of this file): if the transcribed
    // list ever loses an entry, this sweep must fail rather than quietly cover
    // less than the bounce asked for.
    expect(BOUNCE_18, "Jon's bounce lists 18 subjects").toHaveLength(18);

    await page.goto("/");

    const noTable: string[] = [];
    const proseSurvivors: string[] = [];
    const wrongRows: string[] = [];

    for (const id of BOUNCE_18) {
      const subject = byId(id);
      await openInfo(page, subject.name);

      if ((await sectionsTable(page).count()) !== 1) noTable.push(id);

      // A partless section is exactly ONE row — no placeholder, no empty part
      // row. These 18 publish no parts at all, so rows === sections.
      const bodyRows = await sectionsTable(page).locator("tbody tr").count();
      if (bodyRows !== subject.format.sections.length) {
        wrongRows.push(
          `${id}: expected ${subject.format.sections.length}, got ${bodyRows}`,
        );
      }

      // The superseded presentation, by its own markup: `SectionBlock` put
      // each section name in a `dl > div` (what `summaryRow` targeted in the
      // #44 specs) alongside a `[data-testid=stat-phrase]` stats line.
      for (const section of subject.format.sections) {
        const proseBlock = dialog(page)
          .locator("dl > div")
          .filter({ hasText: section.name });
        if ((await proseBlock.count()) > 0) {
          proseSurvivors.push(`${id}: "${section.name}" still in a dl row`);
        }
      }
      await expect(dialog(page).getByTestId("stat-phrase")).toHaveCount(0);

      await closeInfo(page);
    }

    expect(noTable, "subjects still rendering no sections table").toEqual([]);
    expect(wrongRows, "subjects with the wrong body-row count").toEqual([]);
    expect(proseSurvivors, "prose-block markup survivors").toEqual([]);
  });

  test("bounce AC3 — never a blank cell: every value cell of every section and part row, across every sit-down subject, renders something", async ({
    page,
  }) => {
    // `WITH_SECTIONS` is derived, so it is the one sweep here that could shrink
    // silently — a dataset edit that dropped a subject's sections would narrow
    // the walk with nothing failing. Pin the sit-down count (43 roster − 5
    // portfolio-only).
    expect(WITH_SECTIONS, "sit-down subjects swept").toHaveLength(38);

    await page.goto("/");

    const blanks: string[] = [];

    for (const subject of WITH_SECTIONS) {
      await openInfo(page, subject.name);
      const rows = sectionsTable(page).locator("tbody tr");
      const rowCount = await rows.count();

      for (let i = 0; i < rowCount; i += 1) {
        const cells = rows.nth(i).locator("th, td");
        const texts = await cells.allInnerTexts();
        // innerText hides sr-only spans in some engines, so fall back to the
        // full text content: a cell may legitimately render ONLY the sr-only
        // "none published" label plus an aria-hidden glyph.
        const contents = await cells.allTextContents();
        texts.forEach((text, column) => {
          const filled =
            text.trim().length > 0 || contents[column].trim().length > 0;
          if (!filled) blanks.push(`${subject.id} row ${i} column ${column}`);
        });
      }
      await closeInfo(page);
    }

    expect(blanks, "blank cells in the sections table").toEqual([]);
  });

  test("bounce AC3 — no unpublished cell is a bare glyph or a blank in AT output: AAS Individual Student Project reads 'none published' for both its questions and its length", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    const isp = row(page, /^Individual Student Project$/);
    const cells = isp.getByRole("cell");

    // Questions: College Board prints none. The sr-only label is what AT
    // reads; the glyph beside it is decorative.
    await expect(cells.nth(0).getByText(NONE_PUBLISHED)).toHaveAttribute(
      "class",
      /sr-only/,
    );
    await expect(cells.nth(0).locator("[aria-hidden='true']")).toHaveText("—");

    // Length: issue #84 re-verified this against the live page — the project
    // has no exam-day time allocation, so it takes the SAME affordance, with
    // the same sr-only label. One dash style, never a bare glyph.
    await expect(cells.nth(1).getByText(NONE_PUBLISHED)).toHaveAttribute(
      "class",
      /sr-only/,
    );
    await expect(cells.nth(1).locator("[aria-hidden='true']")).toHaveText("—");

    // Weight: published — no unpublished affordance at all.
    await expect(cells.nth(2)).toHaveText("8.5%");
    await expect(cells.nth(2).getByText(NONE_PUBLISHED)).toHaveCount(0);

    // The badge this row used to carry is gone from the dialog entirely.
    await expect(
      dialog(page).getByText("pending", { exact: true }),
    ).toHaveCount(0);
  });

  test("bounce AC4 — the a11y contract the dt/dd pairing used to give the newly-tabled subjects: same caption, four column headers, a scoped row header on every row, and the sr-only section prefix still scoping part rows", async ({
    page,
  }) => {
    await page.goto("/");

    const shapeOf = async (name: string) => {
      await openInfo(page, name);
      const table = sectionsTable(page);
      const shape = {
        caption: await table.locator("caption").innerText(),
        captionIsSrOnly: await table
          .locator("caption")
          .evaluate((el) => el.className.includes("sr-only")),
        columnHeaders: await table
          .locator("thead th[scope='col']")
          .allInnerTexts(),
        bodyRows: await table.locator("tbody tr").count(),
        scopedRowHeaders: await table.locator("tbody th[scope='row']").count(),
      };
      await closeInfo(page);
      return shape;
    };

    const control = await shapeOf("AP Calculus BC");
    expect(control.columnHeaders).toEqual([
      "Section",
      "Questions",
      "Length",
      "Weight",
    ]);
    expect(control.captionIsSrOnly).toBe(true);

    for (const id of ["human-geography", "english-language-and-composition", "music-theory"]) {
      const subject = byId(id);
      const shape = await shapeOf(subject.name);
      expect(shape.caption, `${id} caption`).toBe(control.caption);
      expect(shape.columnHeaders, `${id} column headers`).toEqual(
        control.columnHeaders,
      );
      expect(shape.scopedRowHeaders, `${id} scoped row headers`).toBe(
        shape.bodyRows,
      );
      expect(shape.bodyRows, `${id} body rows`).toBe(
        subject.format.sections.length,
      );
    }

    // Part rows keep their programmatic association with their section — the
    // sr-only "<section> — " prefix inside the row header.
    await openInfo(page, "AP Calculus BC");
    const partHeader = dialog(page)
      .getByRole("rowheader")
      .filter({ hasText: "Part A" })
      .first();
    await expect(partHeader).toContainText("Section I: Multiple Choice");
    await expect(
      partHeader.locator("span.sr-only"),
      "the section prefix must stay sr-only, not printed twice on screen",
    ).toHaveCount(1);
    await closeInfo(page);
  });

  test("bounce AC5 — the longest College Board section names wrap instead of clipping at 320px, and neither the dialog nor the page scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");

    /**
     * Clip detector: a wrapped cell grows taller and its content still fits
     * its box; a clipped one overflows horizontally. Proven against a forced
     * positive below before any subject is trusted to it.
     *
     * The self-test uses a detached probe rather than nowrapping a live `<th>`:
     * inside a table, `white-space: nowrap` widens the COLUMN instead of
     * overflowing the cell, so an in-table forced positive measures the table
     * algorithm, not the detector.
     */
    const clipped = (target: Locator) =>
      target.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

    const cases: [string, string][] = [
      // Longest name in the dataset (89 chars).
      [
        "business-with-personal-finance",
        "Section II, Part A: Free-Response Question 1: Business Canvas Project Exam-Day Validation",
      ],
      // Longest among the 18 subjects this bounce moved onto the table.
      [
        "computer-science-principles",
        "Section II: Create Performance Task and Written Response",
      ],
      // Both names Jon's AC5 calls out by hand.
      [
        "african-american-studies",
        "Section IB: Individual Student Project—Exam Day Validation Question",
      ],
      [
        "world-history-modern",
        "Section II: Document-Based Question and Long Essay",
      ],
    ];

    // Self-test: the detector must fire on forced clipping and stay quiet on
    // wrapped text, in this exact rendering engine, before it is trusted.
    const probe = await page.evaluate(() => {
      const measure = (extra: string) => {
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;top:0;left:0;width:40px;";
        const cell = document.createElement("div");
        cell.textContent =
          "Section II: Create Performance Task and Written Response";
        cell.style.cssText = `font-size:14px;line-height:20px;${extra}`;
        host.appendChild(cell);
        document.body.appendChild(host);
        const overflow = cell.scrollWidth - cell.clientWidth;
        host.remove();
        return overflow;
      };
      return {
        clipped: measure("white-space:nowrap;overflow:hidden;"),
        wrapped: measure("overflow-wrap:break-word;"),
      };
    });
    expect(probe.clipped, "detector must fire on forced clipping").toBeGreaterThan(1);
    expect(
      probe.wrapped,
      "detector must stay quiet on wrapped text",
    ).toBeLessThanOrEqual(1);
    const detectorProven = probe.clipped > 1 && probe.wrapped <= 1;

    for (const [id, sectionName] of cases) {
      const subject = byId(id);
      await openInfo(page, subject.name);

      const header = dialog(page)
        .getByRole("rowheader", { name: sectionName })
        .first();
      await expect(header, `${id}: "${sectionName}" must render`).toBeVisible();
      // Verbatim, not shortened and not elided — the "never truncated"
      // guarantee the prose block gave by putting the name on its own line.
      // `toContainText`, not `toHaveText`: a section's published note renders
      // as a second muted line inside the same row header.
      await expect(header, `${id}: full College Board title`).toContainText(
        sectionName,
      );

      expect(await clipped(header), `${id}: section name clipped at 320px`).toBe(
        false,
      );

      const dialogFits = await dialog(page).evaluate(
        (el) => el.scrollWidth <= el.clientWidth + 1,
      );
      expect(dialogFits, `${id}: dialog scrolls sideways at 320px`).toBe(true);

      const pageFits = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      );
      expect(pageFits, `${id}: page scrolls sideways at 320px`).toBe(true);

      await closeInfo(page);
    }

    expect(detectorProven).toBe(true);
  });

  test("bounce AC4 — axe: no serious/critical violations with a newly-tabled dialog open (AP Human Geography, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Human Geography");
    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    const severe = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(severe, "axe serious/critical (Human Geography light)").toEqual([]);
  });

  test("bounce AC4 — axe: no serious/critical violations with the 3-section AP Music Theory dialog open (dark)", async ({
    page,
  }) => {
    await seedDarkTheme(page);
    await page.goto("/");
    await openInfo(page, "AP Music Theory");
    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    const severe = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(severe, "axe serious/critical (Music Theory dark)").toEqual([]);
  });

  test("the third surface agrees: a newly-tabled exam's calendar event popup renders the same table, not the prose block", async ({
    page,
  }) => {
    await seedSelection(page, ["human-geography"]);
    await page.goto("/");

    const block = page.locator(
      '[data-testid="calendar-block"][data-subject-id="human-geography"]',
    );
    await block.scrollIntoViewIfNeeded();
    await block.click();
    await expect(dialog(page)).toBeVisible();
    await expect(sectionsTable(page)).toHaveCount(1);
    await expect(sectionsTable(page).locator("tbody tr")).toHaveCount(
      byId("human-geography").format.sections.length,
    );
    await expect(dialog(page).getByTestId("stat-phrase")).toHaveCount(0);
  });

  test.describe("visual evidence — the bounce's four named subjects, light and dark", () => {
    const cases: [string, string][] = [
      ["AP Human Geography", "human-geography"],
      ["AP English Language and Composition", "english-language"],
      ["AP Music Theory", "music-theory"],
      ["AP Calculus BC", "calculus-bc"],
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const [name, slug] of cases) {
        test(`evidence — ${slug} exam details (${theme})`, async ({ page }) => {
          if (theme === "dark") await seedDarkTheme(page);
          await page.setViewportSize({ width: 1920, height: 1080 });
          await page.goto("/");
          await openInfo(page, name);
          await dialog(page).screenshot({
            path: `${EVIDENCE_DIR}/${slug}-${theme}-desktop.png`,
          });
        });
      }
    }

    for (const [label, width, height] of [
      ["desktop", 1920, 1080],
      ["tablet", 1024, 768],
      ["mobile", 375, 667],
      ["narrow", 320, 640],
    ] as const) {
      test(`evidence — AP Human Geography at ${label} ${width}x${height}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        await openInfo(page, "AP Human Geography");
        const fits = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        );
        expect(fits, `${label} must not scroll horizontally`).toBe(true);
        await page.screenshot({ path: `${EVIDENCE_DIR}/${label}.png` });
      });
    }
  });
});
