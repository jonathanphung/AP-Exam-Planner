import { test, expect, type Locator, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v3 (issue #91, Jon's 2nd bounce) — the ON-SCREEN list row.
 *
 * Bounce 1 (QA v1/v2, `issue-91-qa.spec.ts`) governed the exported `.png`.
 * Bounce 2 moved the same decision onto `ScheduleView.tsx`, verbatim:
 *
 *   > "in list view the portfolio card shouldnt even have the block of text
 *   > either. it should look like another ordinary ap exam card but say
 *   > 'Portfolio due' instead of 'PM/AM' as the pill."
 *
 * So the contract this suite pins is:
 *
 *   1. NO prose on a portfolio row — not the 168–310 char verbatim College
 *      Board submission note, not the retired internal-deadline advisory, not
 *      anything else. Swept across EVERY note-bearing subject in the dataset,
 *      not just the one the issue-4 spec happens to select.
 *   2. The dated deadline row itself STAYS — the bounce removed the prose, not
 *      the schedule content. Every portfolio subject keeps exactly one entry,
 *      under the date heading the dataset's deadline falls on.
 *   3. "Ordinary card" is measured, not eyeballed: a portfolio `<li>` paints
 *      the same background / border / radius / padding an exam `<li>` paints,
 *      in BOTH themes.
 *   4. The `Portfolio due` pill is the SOLE differentiator — still present,
 *      still visually distinct from the session pill, still absent from exam
 *      rows (so "ordinary" did not flatten the two kinds into one another).
 *   5. No collateral damage: issue #71's published exam qualifier still prints
 *      on its own row, and the advisory the row dropped still ships in the
 *      subject's details dialog (`InfoPanel`) — which is what makes dropping it
 *      here a relocation rather than a loss.
 *
 * Fixtures are read from the shipped dataset, so a re-word of the note text
 * cannot make any of these assertions vacuously pass.
 */

const EVIDENCE_DIR = evidenceDir("issue-91-qa-v3");

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
  portfolio?: { deadline: string; note?: string } | null;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;

/** Every subject that reaches the list as a portfolio row. */
const PORTFOLIO_SUBJECTS = SUBJECTS.filter((s) => s.portfolio);

/** Every DISTINCT verbatim submission note the old row printed. */
const PORTFOLIO_NOTES = [
  ...new Set(
    PORTFOLIO_SUBJECTS.map((s) => s.portfolio?.note).filter(
      (n): n is string => !!n,
    ),
  ),
];

/** The retired standing advisory (its own paragraph on the old row). */
const RETIRED_ADVISORY = /earlier internal deadline/i;

/** The dataset's one qualified exam (May 2027: AP Networking) — issue #71. */
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam);

/** A subject carrying BOTH a portfolio deadline and a sit-down exam. */
const BOTH = PORTFOLIO_SUBJECTS.find((s) => s.exam);

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts (issue #71). */
const EXAM_NOTE_LABEL = "Published note";

/** Deliberate copy of `formatDateLabel` (src/lib/schedule.ts) — same output. */
function formatDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

async function seed(
  page: Page,
  selection: readonly string[],
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript(
    ([sel, th]) => {
      try {
        localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
        localStorage.setItem("apx.resolutions.v1", "[]");
        localStorage.setItem("apx.theme.v1", th as string);
      } catch {}
    },
    [selection, theme] as const,
  );
}

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
/** Dated entry rows only (the undated <div> is a sibling of the <ol>). */
const rows = (page: Page) => schedule(page).locator("ol > li > ul > li");
const groups = (page: Page) => schedule(page).locator("ol > li");

async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

/** The painted card chrome of a row — the thing "ordinary" is measured on. */
const CHROME = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  return [
    s.backgroundColor,
    s.borderTopColor,
    s.borderRightColor,
    s.borderBottomColor,
    s.borderLeftColor,
    s.borderTopWidth,
    s.borderStyle,
    s.borderRadius,
    s.padding,
  ].join(" | ");
};

const chromeOf = (row: Locator) => row.evaluate(CHROME);

test.describe("issue #91 QA v3 — the on-screen list row (Jon's 2nd bounce)", () => {
  test("fixture guard — the dataset still supplies the prose this bounce removes", () => {
    // If these drift, every "the text is gone" assertion below could pass for
    // the wrong reason.
    expect(PORTFOLIO_SUBJECTS.length).toBeGreaterThanOrEqual(12);
    expect(PORTFOLIO_NOTES.length).toBeGreaterThanOrEqual(5);
    // Every portfolio subject actually carries a note (so the sweep is total).
    expect(PORTFOLIO_SUBJECTS.filter((s) => !s.portfolio?.note)).toHaveLength(0);
    // The issue's headline defect: a 300+ char string, repeated across the
    // language subjects.
    const longest = [...PORTFOLIO_NOTES].sort((a, b) => b.length - a.length)[0];
    expect(longest.length).toBeGreaterThanOrEqual(300);
    expect(
      PORTFOLIO_SUBJECTS.filter((s) => s.portfolio?.note === longest).length,
    ).toBeGreaterThanOrEqual(6);
    expect(NOTED, "dataset has no qualified exam (issue #71 fixture)").toBeTruthy();
    expect(BOTH, "dataset has no portfolio+exam subject").toBeTruthy();
  });

  test("bounce 2 — no portfolio row carries prose, swept across EVERY note-bearing subject", async ({
    page,
  }) => {
    await seed(page, PORTFOLIO_SUBJECTS.map((s) => s.id));
    await page.goto("/");
    await openList(page);

    const portfolioRows = rows(page).filter({ hasText: "Portfolio due" });
    await expect(portfolioRows).toHaveCount(PORTFOLIO_SUBJECTS.length);

    // (a) Structural: a portfolio row has no <p> at all. Every block the old
    // row stacked was a <p>, so a count of 0 is "no block of text" in a form
    // that survives any re-wording of what was removed.
    for (let i = 0; i < PORTFOLIO_SUBJECTS.length; i += 1) {
      await expect(portfolioRows.nth(i).locator("p")).toHaveCount(0);
    }

    // (b) Textual, and scoped to the WHOLE list — not just the rows. The note
    // must not have been relocated into a strip / footnote / tooltip either;
    // Jon's directive is that it is not on the on-screen list at all.
    const listText = await schedule(page).innerText();
    for (const note of PORTFOLIO_NOTES) {
      expect(
        listText.includes(note),
        `portfolio note still on the list view: ${note.slice(0, 60)}…`,
      ).toBe(false);
    }
    expect(RETIRED_ADVISORY.test(listText)).toBe(false);

    // (c) A portfolio row is now name + pill. Nothing else.
    for (const subject of PORTFOLIO_SUBJECTS) {
      const row = rows(page).filter({ hasText: "Portfolio due" }).filter({
        hasText: subject.name,
      });
      await expect(row).toHaveCount(1);
      // Normalised: drop the issue-#20 category emoji the name is prefixed
      // with, and case-fold the pill (its `uppercase` is a CSS transform that
      // `innerText` reports). What is left must be EXACTLY name + pill.
      const text = (await row.innerText())
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .toLowerCase();
      expect(text).toBe(`${subject.name} portfolio due`.toLowerCase());
    }
  });

  test("bounce 2 — the deadline rows themselves stay, each under its dataset date", async ({
    page,
  }) => {
    await seed(page, PORTFOLIO_SUBJECTS.map((s) => s.id));
    await page.goto("/");
    await openList(page);

    // "Only the submission-note text goes" — the dated deadline is core
    // schedule content and must survive for every subject.
    for (const subject of PORTFOLIO_SUBJECTS) {
      const deadline = subject.portfolio!.deadline;
      const group = groups(page).filter({
        has: page.getByRole("heading", {
          level: 3,
          name: formatDateLabel(deadline),
        }),
      });
      await expect(
        group.locator("ul > li").filter({ hasText: subject.name }).filter({
          hasText: "Portfolio due",
        }),
        `${subject.name}'s ${deadline} deadline row disappeared`,
      ).toHaveCount(1);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`bounce 2 — a portfolio row paints exactly like an exam row (${theme})`, async ({
      page,
    }) => {
      // One subject that yields BOTH row kinds, so the two rows compared are
      // rendered by the same component under identical conditions.
      await seed(page, [BOTH!.id], theme);
      await page.goto("/");
      await openList(page);

      const portfolioRow = rows(page).filter({ hasText: "Portfolio due" });
      const examRow = rows(page).filter({ hasNotText: "Portfolio due" });
      await expect(portfolioRow).toHaveCount(1);
      await expect(examRow).toHaveCount(1);

      // The amber card chrome is gone: same background, same border, same
      // geometry. Compared against the exam row rather than a hardcoded rgb()
      // so a future palette change cannot silently re-separate the two.
      expect(await chromeOf(portfolioRow)).toBe(await chromeOf(examRow));

      // …and the pill still carries the distinction.
      const portfolioPill = portfolioRow.getByText("Portfolio due", {
        exact: true,
      });
      const examPill = examRow.getByText(BOTH!.exam!.session, { exact: true });
      await expect(portfolioPill).toBeVisible();
      await expect(examPill).toBeVisible();
      expect(
        await portfolioPill.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        ),
      ).not.toBe(
        await examPill.evaluate((el) => getComputedStyle(el).backgroundColor),
      );
    });
  }

  test("bounce 2 — the pill is the sole differentiator, and exam rows never wear it", async ({
    page,
  }) => {
    await seed(page, [BOTH!.id, ...(NOTED ? [NOTED.id] : [])]);
    await page.goto("/");
    await openList(page);

    const portfolioRows = rows(page).filter({ hasText: "Portfolio due" });
    await expect(portfolioRows).toHaveCount(1);
    // Verbatim on-screen string named by the directive.
    await expect(
      portfolioRows.getByText("Portfolio due", { exact: true }),
    ).toBeVisible();

    // Negative: no exam row acquired the pill when the amber body went away.
    const examRows = rows(page).filter({ hasNotText: "Portfolio due" });
    await expect(examRows).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect(
        examRows.nth(i).getByText("Portfolio due"),
      ).toHaveCount(0);
      // An exam row still shows its AM/PM session pill.
      await expect(
        examRows.nth(i).getByText(/^(AM|PM)$/),
      ).toHaveCount(1);
    }
  });

  test("no collateral damage — issue #71's published qualifier still prints on its exam row", async ({
    page,
  }) => {
    await seed(page, [NOTED!.id]);
    await page.goto("/");
    await openList(page);

    const note = rows(page).locator('[data-testid="schedule-exam-note"]');
    await expect(note).toHaveCount(1);
    await expect(note).toBeVisible();
    // Verbatim, with the label that names what the text IS.
    await expect(note).toContainText(EXAM_NOTE_LABEL);
    await expect(note).toContainText(NOTED!.examNote as string);
  });

  test("relocated, not lost — the retired advisory still ships in the details dialog", async ({
    page,
  }) => {
    await page.goto("/");
    // The advisory the row dropped is what makes this a relocation: InfoPanel
    // carries an equivalent line in the subject's own details dialog.
    await page
      .getByRole("button", { name: `Show exam dates for ${BOTH!.name}` })
      .click();
    await page
      .getByRole("button", { name: `View exam details for ${BOTH!.name}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(RETIRED_ADVISORY);
    // And the full verbatim submission note still has a home on-screen.
    await expect(dialog).toContainText(BOTH!.portfolio!.note as string);
  });

  test("visual evidence — the on-screen list at the standard viewports, both themes", async ({
    page,
  }) => {
    const viewports = [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "tablet", width: 1024, height: 768 },
      { name: "mobile", width: 375, height: 667 },
    ] as const;

    for (const theme of ["light", "dark"] as const) {
      for (const vp of viewports) {
        const context = await page.context().browser()!.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const p = await context.newPage();
        // The issue's worst realistic case, on-screen: the six language
        // subjects (identical 310-char note), the three Art & Design
        // portfolios, AP Seminar (portfolio + exam) and AP Networking (the
        // qualified exam).
        await seed(
          p,
          [
            ...PORTFOLIO_SUBJECTS.map((s) => s.id),
            ...(NOTED ? [NOTED.id] : []),
          ],
          theme,
        );
        await p.goto("/");
        await openList(p);
        await expect(rows(p).first()).toBeVisible();
        await p.screenshot({
          path: `${EVIDENCE_DIR}/list-${theme}-${vp.name}.png`,
          fullPage: true,
        });
        await context.close();
      }
    }
  });
});
