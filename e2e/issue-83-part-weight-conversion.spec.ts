import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * Builder gate for issue #83 — part weights are shown as exam shares.
 *
 * ## What Jon reported
 *
 * The AP Microeconomics card's Weight column spent four wrapped lines printing
 * College Board's phrasing verbatim: `50% of section score`, `each worth 25% of
 * section score`. That was #73's deliberate rule — a relative weight must not
 * be relabelled as an exam share, because "50%" next to a section row's "50%"
 * would say one free-response question is half the grade.
 *
 * #83 separates relabelling from arithmetic. Section II is 33% of the exam, so
 * 50% of it is 16.5% OF THE EXAM — true, short, and the number the student was
 * working out by hand. 11 part rows across 3 subjects convert; the other 52
 * weighted parts were already exam-denominated and must not move.
 *
 * ## What this suite pins
 *
 *   1. The 11 converted cells, subject by subject, against the ticket's table.
 *   2. `each` — 8.25% is what ONE of two short FRQs is worth, and the
 *      qualifier is VISIBLE, not merely in the accessible name. A bare 8.25%
 *      on a 2-question row understates it by a factor of two.
 *   3. The absence, across EVERY subject that renders a table, of any leftover
 *      relative phrasing — asserted as a sweep rather than on the three
 *      subjects the ticket names, because a half-applied conversion is the
 *      plausible regression here.
 *   4. AC7 evidence: the three affected subjects at three viewports in both
 *      themes.
 *
 * The arithmetic itself, the schema's fail-loudly guards, and the
 * parts-sum-to-their-section reconciliation are unit-level and live in
 * `src/data/ap-2027.weights.test.ts` + `src/lib/exam-sections.test.ts` — this
 * file is about what reaches the screen.
 */

const EVIDENCE_DIR = evidenceDir("issue-83-part-weight-conversion");
const THEME_KEY = "apx.theme.v1";

type Subject = {
  id: string;
  name: string;
  format: { sections: { name: string }[] };
};
const SUBJECTS = apData.subjects as unknown as Subject[];
const WITH_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length > 0);

const dialog = (page: Page) => page.getByRole("dialog");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

/** A section/part row located by its row header's accessible name. */
const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

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

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

/** The ticket's scope table: subject → [part matcher, rendered weight]. */
const CONVERTED: Record<string, [RegExp, string][]> = {
  "AP Macroeconomics": [
    [/Long free-response question/, "16.5%"],
    [/Short free-response questions/, "8.25%"],
  ],
  "AP Microeconomics": [
    [/Long free-response question/, "16.5%"],
    [/Short free-response questions/, "8.25%"],
  ],
  "AP Seminar": [
    [/Individual research report/, "10%"],
    [/Team multimedia presentation and defense/, "10%"],
    [/Individual written argument/, "24.5%"],
    [/Individual multimedia presentation/, "7%"],
    [/Oral defense/, "3.5%"],
    [/Understanding and analyzing an argument/, "13.5%"],
    [/Evidence-Based argument essay/, "31.5%"],
  ],
};

test.describe("issue #83 — part weights render as exam shares", () => {
  for (const [subject, rows] of Object.entries(CONVERTED)) {
    test(`AC1/AC2 — ${subject}: every relatively-weighted part shows its share of the exam, rounded to 2dp with no trailing zeros`, async ({
      page,
    }) => {
      await page.goto("/");
      await openInfo(page, subject);

      for (const [name, weight] of rows) {
        await expect(row(page, name), `${name} → ${weight}`).toContainText(
          weight,
        );
      }

      const body = (await dialog(page).innerText()).replace(/\s+/g, " ");
      // Nothing relative is left for the reader to multiply out …
      expect(body, "a relative denominator survived").not.toMatch(
        /of section score|% of \d+(\.\d+)?%/,
      );
      // … and no cell prints a padded or noisy decimal ("16.50%", "24.4999%").
      expect(body, "a weight rendered with float noise or a padded decimal")
        .not.toMatch(/\d\.\d{3,}%|\d\.\d*0%/);
    });
  }

  test("AC3 — a per-question weight says so on screen, next to a Questions cell that reads 2", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Microeconomics");

    const shortFrqs = row(page, /Short free-response questions/);
    const cells = shortFrqs.locator("td");
    // Questions | Length | Weight — the row this weight is per-question OF.
    await expect(cells.nth(0)).toHaveText("2");
    await expect(cells.nth(2)).toContainText("8.25%");

    // The qualifier is a VISIBLE part of the cell, not only an sr-only word:
    // it survives `visibility`-aware innerText, and it is not inside .sr-only.
    const qualifier = cells.nth(2).locator("span").first();
    await expect(qualifier).toBeVisible();
    await expect(qualifier).toHaveText(/^each/);
    await expect(qualifier).not.toHaveClass(/sr-only/);
    expect(await cells.nth(2).innerText()).toMatch(/8\.25%\s*each/);

    // …and the accessible name still disambiguates what "each" counts.
    await expect(
      cells.nth(2).locator("span.sr-only"),
      "the accessible name should say each WHAT",
    ).toHaveText(/question/);
  });

  test("AC4/AC6 — the sweep: no subject anywhere still renders a relative denominator, and every other weight cell is a plain percent, a pending pill or a dash", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/");
    expect(
      WITH_SECTIONS.length,
      "the sweep must cover every subject that renders a table",
    ).toBeGreaterThan(30);

    const problems: string[] = [];
    for (const subject of WITH_SECTIONS) {
      await openInfo(page, subject.name);
      const cells = await dialog(page).evaluate((el) =>
        [...el.querySelectorAll("table tbody tr")].map((tr) => ({
          label: (tr.children[0]?.textContent ?? "").trim().slice(0, 60),
          weight: (tr.children[3]?.textContent ?? "").trim().replace(/\s+/g, " "),
        })),
      );
      for (const cell of cells) {
        // "8.25%each question" (textContent, sr-only word included and no
        // whitespace because the qualifier is a block element on its own
        // line), "43.75%", "pending", the aria-hidden dash + its "none
        // published" label — and nothing else.
        const ok =
          /^\d+(\.\d{1,2})?%\s*(each question)?$/.test(cell.weight) ||
          cell.weight === "pending" ||
          /^—\s*none published$/.test(cell.weight);
        if (!ok) problems.push(`${subject.id} "${cell.label}": "${cell.weight}"`);
      }
      await closeInfo(page);
    }
    expect(
      problems,
      "weight cells that are neither an exam share, a pending pill nor an honest dash",
    ).toEqual([]);
  });

  test("AC1 — no section-level weight moved: the conversion touches part rows only", async ({
    page,
  }) => {
    await page.goto("/");

    await openInfo(page, "AP Macroeconomics");
    await expect(row(page, /^Section I: Multiple Choice$/)).toContainText("66%");
    await expect(row(page, /^Section II: Free Response$/)).toContainText("33%");
    await closeInfo(page);

    // Seminar is the real test — three sections, seven converted parts.
    await openInfo(page, "AP Seminar");
    await expect(
      row(page, /^Performance Task 1: Team Project and Presentation$/),
    ).toContainText("20%");
    await expect(
      row(
        page,
        /^Performance Task 2: Individual Research-Based Essay and Presentation$/,
      ),
    ).toContainText("35%");
    await expect(row(page, /^End-of-Course Exam$/)).toContainText("45%");
  });

  test.describe("AC7 — evidence: the three affected subjects, three viewports, both themes", () => {
    const viewports = [
      { label: "desktop", width: 1920, height: 1080 },
      { label: "tablet", width: 1024, height: 768 },
      { label: "mobile", width: 375, height: 667 },
    ];
    const cases = [
      ["AP Microeconomics", "microeconomics"],
      ["AP Macroeconomics", "macroeconomics"],
      ["AP Seminar", "seminar"],
    ] as const;

    for (const [name, id] of cases) {
      for (const theme of ["light", "dark"] as const) {
        test(`evidence — ${id} (${theme})`, async ({ page }) => {
          if (theme === "dark") await seedDarkTheme(page);
          for (const vp of viewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto("/");
            if (theme === "dark") {
              await expect(page.locator("html")).toHaveClass(/dark/);
            }
            await openInfo(page, name);
            await expect(dialog(page).locator("table")).toBeVisible();
            await dialog(page).screenshot({
              path: `${EVIDENCE_DIR}/${id}-${vp.label}-${theme}.png`,
            });
            await closeInfo(page);
          }
        });
      }
    }
  });
});
