import { test, expect, type Page, type Locator } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * Issue #87 — "exam published, format unpublished" is a THIRD state.
 *
 * Until this issue the app had two: a sit-down exam with published sections,
 * and a portfolio-only subject with none. Both were keyed off the same
 * boolean, `format.sections.length > 0`. AP Networking is neither — a real
 * May 7 2027 date with no published format, because `/courses/ap-networking/
 * exam` 404s — so it took the portfolio-only branch and the details dialog
 * dropped its Exam length, Calculator and Delivery rows without a portfolio
 * block to replace them. Three unpublished values rendered as nothing at all,
 * against the data rule that says an unpublished value is always visible
 * (PRD §7.5).
 *
 * The regression this spec pins is a PAIR, because either half alone is
 * satisfiable by a wrong fix:
 *
 *   - make the three rows appear for Networking, and
 *   - keep them absent for all FOUR portfolio-only subjects.
 *
 * "Render the rows whenever `sections` is empty" passes the first and fails
 * the second; today's code passes the second and fails the first. Only a
 * branch that tells the two states apart passes both, which is why every
 * portfolio-only subject is asserted rather than a sampled one.
 *
 * The catalog-card half of the card (AC4) is asserted here too: the note that
 * qualifies the exam DATE hangs off the date, and the explanation of the
 * dialog's dashes is not on the card at all.
 */

const EVIDENCE_DIR = evidenceDir("issue-87-build-v1");

/** The sr-only text that travels with every not-published dash. */
const NONE_PUBLISHED = "none published";

/** The three rows this issue is about, in render order. */
const FORMAT_ROWS = ["Exam length", "Calculator", "Delivery"] as const;

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: string } | null;
  format: {
    sections: unknown[];
    totalMinutes?: number;
    calculator?: boolean;
    delivery?: string;
  };
  portfolio: unknown | null;
  examNote?: string;
  formatNote?: string;
};

const SUBJECTS = apData.subjects as unknown as Subject[];
const byId = (id: string): Subject => {
  const found = SUBJECTS.find((s) => s.id === id);
  if (!found) throw new Error(`fixture: no subject "${id}" in the dataset`);
  return found;
};

/**
 * Derived, never hardcoded — the point of the issue is that membership of
 * these two sets is a property of the data. A future Career Kickstart course
 * arriving mid-pilot joins UNPUBLISHED automatically and gets asserted.
 */
const UNPUBLISHED = SUBJECTS.filter(
  (s) =>
    s.exam !== null &&
    s.format.sections.length === 0 &&
    s.format.totalMinutes === undefined &&
    s.format.calculator === undefined &&
    s.format.delivery === undefined,
);
const PORTFOLIO_ONLY = SUBJECTS.filter(
  (s) => s.exam === null && s.portfolio !== null,
);

const dialog = (page: Page) => page.getByRole("dialog");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

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

/** A metadata `<dl>` row's value cell, located by its label. */
const rowValue = (page: Page, label: string): Locator =>
  dialog(page)
    .locator("dl > div")
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator("dd");

/**
 * The same contract `e2e/issue-84-qa.spec.ts` holds every unpublished cell to:
 * a visible dash marked decorative AND the sr-only label beside it. Asserting
 * only the glyph passes on a bare dash, which is silence to assistive tech;
 * asserting only the label passes on a cell nobody can see.
 */
async function expectNotPublished(cell: Locator, why: string) {
  await expect(
    cell.getByText(NONE_PUBLISHED),
    `${why}: sr-only label`,
  ).toHaveAttribute("class", /sr-only/);
  await expect(
    cell.locator("[aria-hidden='true']"),
    `${why}: decorative glyph`,
  ).toHaveText("—");
}

const chipFor = (page: Page, name: string): Locator =>
  page
    .locator('section[aria-label="Subject catalog"]')
    .locator("ul > li")
    .filter({ hasText: name })
    .first();

test.describe("issue #87 — the unpublished-format state", () => {
  test("fixture: the dataset really does carry both states", () => {
    // If either set empties, the assertions below stop covering anything and
    // would pass vacuously. Fail loudly instead.
    expect(
      UNPUBLISHED.map((s) => s.id),
      "no subject has an exam with an entirely unpublished format",
    ).toEqual(["networking"]);
    expect(
      PORTFOLIO_ONLY.map((s) => s.id).sort(),
      "the four portfolio-only subjects",
    ).toEqual([
      "2-d-art-and-design",
      "3-d-art-and-design",
      "drawing",
      "research",
    ]);
  });

  test("AC1/AC2 — an unpublished format renders all three rows as dashes, under prose, with no table", async ({
    page,
  }) => {
    await page.goto("/");
    for (const subject of UNPUBLISHED) {
      await openInfo(page, subject.name);

      // AC1 — the three rows are present and each says what is true. Before
      // this issue the dialog's only `dt` was "Pass rate".
      await expect(dialog(page).locator("dt")).toHaveText([
        ...FORMAT_ROWS,
        "Pass rate",
      ]);
      for (const label of FORMAT_ROWS) {
        await expectNotPublished(
          rowValue(page, label),
          `${subject.id} ${label}`,
        );
      }

      // AC2 — prose where the table would be, and no fabricated table.
      await expect(dialog(page).locator("table")).toHaveCount(0);
      const note = dialog(page).getByTestId("unpublished-format-note");
      await expect(note).toBeVisible();
      await expect(note).toContainText("Exam format not published yet");
      expect(
        subject.formatNote,
        `${subject.id} must carry a sourced formatNote`,
      ).toBeTruthy();
      await expect(note).toContainText(subject.formatNote!);

      // Nothing was invented to fill the hole.
      await expect(dialog(page)).not.toContainText(/\d+\s*h\s*\d*\s*min/i);
      await expect(dialog(page)).not.toContainText(/Permitted|Not permitted/i);
      await expect(dialog(page)).not.toContainText(
        /Digital|Paper|Hybrid/,
      );

      await closeInfo(page);
    }
  });

  test("AC3 — every portfolio-only subject is unchanged: no rows, no table, no prose block", async ({
    page,
  }) => {
    await page.goto("/");
    for (const subject of PORTFOLIO_ONLY) {
      await openInfo(page, subject.name);

      // Pass rate from the main list, then the portfolio block's own two rows.
      await expect(
        dialog(page).locator("dt"),
        `${subject.id} must not grow exam-format rows`,
      ).toHaveText(["Pass rate", "Weight", "Deadline"]);
      for (const label of FORMAT_ROWS) {
        await expect(
          dialog(page).getByText(label, { exact: true }),
          `${subject.id} must not render a ${label} row`,
        ).toHaveCount(0);
      }
      await expect(dialog(page).locator("table")).toHaveCount(0);
      await expect(
        dialog(page).getByTestId("unpublished-format-note"),
        `${subject.id} has no exam to describe — the portfolio block is the story`,
      ).toHaveCount(0);
      // The portfolio block still tells that story.
      await expect(dialog(page)).toContainText("Portfolio component");

      await closeInfo(page);
    }
  });

  test("AC4 — the card's qualifier hangs off the date it qualifies, and the format story is not on the card", async ({
    page,
  }) => {
    const networking = byId("networking");
    await page.goto("/");
    await expandButton(page, networking.name).click();
    const chip = chipFor(page, networking.name);

    // The qualifier is the Exam row's own note, not a loose paragraph: it sits
    // inside the `dd` whose sibling `dt` is "Exam".
    const examRow = chip.locator("dl > div").filter({ hasText: /^Exam/ });
    const note = examRow.getByTestId("chip-exam-note");
    await expect(note).toBeVisible();
    await expect(note).toHaveText(networking.examNote!);

    // It is a qualifier, not an essay. The 297-character version this issue
    // replaced was the only free prose in a 43-card catalog.
    expect(
      networking.examNote!.length,
      "the card's qualifier grew back into a paragraph",
    ).toBeLessThan(120);

    // And the why-everything-is-unpublished half is NOT on the card — it
    // explains the dialog's rows, and it now lives there.
    await expect(chip).not.toContainText(networking.formatNote!);
    await expect(chip).not.toContainText(/no exam page for it yet/i);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac4-catalog-chip-desktop.png`,
      fullPage: false,
    });
  });

  test("AC6 — the qualifier still reaches the dialog", async ({ page }) => {
    // The other three consumers (schedule row, calendar block, .ics/.txt/.png)
    // are covered by e2e/issue-71-exam-note.spec.ts against the same field;
    // this asserts the fourth call site, which moved in this change.
    const networking = byId("networking");
    await page.goto("/");
    await openInfo(page, networking.name);
    await expect(dialog(page)).toContainText(networking.examNote!);
    await closeInfo(page);
  });
});
