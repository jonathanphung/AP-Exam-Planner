import { test, expect, type Locator, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";

/**
 * Issue #73, Jon's Done → Ready bounce (2026-07-25) — ONE presentation.
 *
 * The bounce: "an exam whose sections have published part rows renders the
 * `section | questions | length | weight` table; an exam whose sections have
 * no parts renders the spacious prose blocks instead. So AP Human Geography
 * and AP English Language and Composition present nothing like AP Calculus
 * BC, even though every number the table needs is published for them."
 *
 * This spec is the whole-dataset guard the removed `sectionsHavePartRows`
 * unit block used to be. It walks EVERY subject rather than a fixture pair,
 * because the two ways to get this wrong are both invisible in a spot check:
 *
 *   - **Implementing the fix as `sections.length === 2`.** Jon's bounce names
 *     this trap outright. 17 of the 18 affected subjects have 2 sections; AP
 *     Music Theory has 3, so a count-based port leaves exactly one prose card
 *     on the board — recreating the inconsistency the issue exists to remove,
 *     in the one place nobody looks.
 *   - **Sweeping the 5 portfolio-only subjects in.** They have no sections at
 *     all and must still render NO table (issue #44) — their portfolio block
 *     carries the story. "Every exam gets the table" must not become "every
 *     subject gets a table", including an empty one.
 *
 * Everything here derives from `src/data/ap-2027.json`, so a subject added to
 * a future cycle is covered the day it lands.
 */

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
const WITH_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length > 0);
const WITHOUT_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length === 0);

/** Subjects whose sections publish NO parts — the 18 Jon's bounce lists. */
const PARTLESS = WITH_SECTIONS.filter(
  (s) => !s.format.sections.some((sec) => (sec.parts?.length ?? 0) > 0),
);

const dialog = (page: Page) => page.getByRole("dialog");
const sectionsTable = (page: Page) => dialog(page).locator("table");

const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

async function openInfo(page: Page, name: string) {
  await expandButton(page, name).click();
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

test.describe("issue #73 bounce — one presentation for every exam", () => {
  test("the dataset itself still matches the bounce's scope: 18 partless subjects including the 3-section AP Music Theory, and 5 portfolio-only subjects with no sections", () => {
    // If this drifts, the two tests below silently cover less than they claim.
    expect(PARTLESS).toHaveLength(18);
    expect(PARTLESS.map((s) => s.id)).toContain("music-theory");
    expect(
      PARTLESS.filter((s) => s.format.sections.length !== 2).map((s) => s.id),
    ).toEqual(["music-theory"]);
    expect(WITHOUT_SECTIONS).toHaveLength(5);
    expect(WITH_SECTIONS).toHaveLength(38);
  });

  test("EVERY subject with at least one section renders the sections table — no exam renders the prose-block presentation", async ({
    page,
  }) => {
    await page.goto("/");

    const missingTable: string[] = [];
    const wrongRowCount: string[] = [];

    for (const subject of WITH_SECTIONS) {
      await openInfo(page, subject.name);

      if ((await sectionsTable(page).count()) !== 1) {
        missingTable.push(subject.id);
      } else {
        // A section without parts is ONE row: not an empty part row, not a
        // placeholder. So body rows === sections + parts, exactly.
        const expected = subject.format.sections.reduce(
          (total, section) => total + 1 + (section.parts?.length ?? 0),
          0,
        );
        const actual = await sectionsTable(page).locator("tbody tr").count();
        if (actual !== expected) {
          wrongRowCount.push(`${subject.id}: expected ${expected}, got ${actual}`);
        }
      }
      // The superseded prose presentation must not survive for any subject.
      await expect(
        dialog(page).getByTestId("stat-phrase"),
        `${subject.id} renders prose stat phrases`,
      ).toHaveCount(0);

      await closeInfo(page);
    }

    expect(missingTable, "subjects rendering no sections table").toEqual([]);
    expect(wrongRowCount, "subjects with the wrong body-row count").toEqual([]);
  });

  test("the 5 portfolio-only subjects still render NO table — 'every exam gets the table' must not become 'every subject gets one'", async ({
    page,
  }) => {
    await page.goto("/");

    for (const subject of WITHOUT_SECTIONS) {
      await openInfo(page, subject.name);
      await expect(
        sectionsTable(page),
        `${subject.id} must render no sections table`,
      ).toHaveCount(0);
      // …and no zeroed exam-format rows either (issue #44 AC2).
      await expect(dialog(page).getByText("Exam length")).toHaveCount(0);
      await closeInfo(page);
    }
  });

  test("the two subjects Jon named by hand present identically to AP Calculus BC: same caption, same four column headers, same scoped row headers", async ({
    page,
  }) => {
    await page.goto("/");

    const shapeOf = async (name: string) => {
      await openInfo(page, name);
      const table = sectionsTable(page);
      const shape = {
        caption: await table.locator("caption").innerText(),
        columnHeaders: await table.locator("thead th[scope='col']").allInnerTexts(),
        bodyRows: await table.locator("tbody tr").count(),
        scopedRowHeaders: await table.locator("tbody th[scope='row']").count(),
      };
      await closeInfo(page);
      return shape;
    };

    const calcBc = await shapeOf("AP Calculus BC");
    for (const name of [
      "AP Human Geography",
      "AP English Language and Composition",
      "AP Music Theory",
    ] as const) {
      const other = await shapeOf(name);
      expect(other.caption, `${name} caption`).toBe(calcBc.caption);
      expect(other.columnHeaders, `${name} column headers`).toEqual(
        calcBc.columnHeaders,
      );
      // Every body row is headed by a scoped row header — the a11y guarantee
      // the prose block's dt/dd pairing used to provide for these subjects.
      expect(other.scopedRowHeaders, `${name} scoped row headers`).toBe(
        other.bodyRows,
      );
    }
  });

  test("honest degradation survives the port per cell: a published range renders verbatim and an unpublished value shows the not-published dash — never collapsed into a blank", async ({
    page,
  }) => {
    await page.goto("/");

    // Published RANGE — AP Chinese's "40–45 Minutes", verbatim, never averaged.
    await openInfo(page, "AP Chinese Language and Culture");
    await expect(
      row(page, /^Section I: Free-Response$/).getByRole("cell").nth(1),
    ).toHaveText("40–45 min");
    await closeInfo(page);

    // UNPUBLISHED vs PUBLISHED in one row — AAS's Individual Student Project:
    // College Board prints no question count (a project, not a question set)
    // and, as issue #84 confirmed against the live page, no time allocation
    // either. Both cells dash; the published 8.5% is untouched beside them.
    await openInfo(page, "AP African American Studies");
    const isp = row(page, /^Individual Student Project$/);
    const cells = isp.getByRole("cell");
    await expect(cells.nth(0)).toContainText("—");
    await expect(cells.nth(1)).toContainText("—");
    await expect(cells.nth(2)).toHaveText("8.5%");
    await expect(
      dialog(page).getByText("pending", { exact: true }),
    ).toHaveCount(0);
    await closeInfo(page);
  });
});
