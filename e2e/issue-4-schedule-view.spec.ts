import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #4) — personal schedule view grouped by date & session
 * with portfolio deadlines.
 *
 * One observable, browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots are written to the
 * run evidence folder and committed to the issue branch so they render inline
 * on the issue / PR.
 *
 * Subject fixtures are read straight from the shipped dataset so the assertions
 * track the same source of truth the component renders from:
 *   - AP Biology            2026-05-04 AM  (exam)
 *   - AP European History   2026-05-04 PM  (exam, same day as Biology → PM after AM)
 *   - AP Chemistry          2026-05-05 AM  (exam, next day → later group)
 *   - AP Seminar            2026-05-11 PM  (exam)  + portfolio deadline 2026-04-30
 *   - AP Drawing            portfolio-only, deadline 2026-05-08
 *   - AP Cybersecurity      no May 2026 exam, no portfolio (Career Kickstart)
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-4-qa-v1";

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
// Entry rows live under the date-group <ol>; the undated <div> is a sibling of
// the <ol>, so this selector counts dated exam/portfolio entries only.
const rows = (page: Page) => schedule(page).locator("ol > li > ul > li");
const dateHeadings = (page: Page) => schedule(page).locator("ol > li > h3");

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
// Card toggle = the aria-pressed button (issue #6 wrapped cards in a div and
// added a sibling "View exam details" button, so `ul > li > button` no longer
// matches; same locator convention as the issue-3 spec).
const card = (page: Page, name: string) =>
  catalog(page).locator("ul > li button[aria-pressed]").filter({ hasText: name });

async function select(page: Page, name: string) {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

/**
 * Issue #19 (second bounce) made the CALENDAR the default view and moved the
 * "My Schedule" heading + cycle banner + Export button into a header shared
 * by both views. This suite targets the LIST view, so every test switches to
 * it via the "List" chip first.
 * The press is hydration-safe (see e2e/support/view-chip.ts).
 */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

test.describe("issue #4 — my schedule", () => {
  test("AC1 — entries render grouped by date ascending, AM before PM, with subject name + session", async ({
    page,
  }) => {
    await page.goto("/");
    await openList(page);

    // The heading lives in the shared header above the view switcher since
    // issue #19's second bounce (visible on both views).
    await expect(
      page.getByRole("heading", { level: 2, name: "My Schedule" }),
    ).toBeVisible();

    // Two exams on 2026-05-04 (Biology AM, European History PM) + one on
    // 2026-05-05 (Chemistry AM) exercises date-ascending grouping AND the
    // AM-before-PM ordering within a shared day.
    await select(page, "AP Chemistry"); // select later date first on purpose
    await select(page, "AP European History"); // PM before AM, out of order
    await select(page, "AP Biology"); // AM, same day as European History

    // Grouped under exactly two date headings, chronological.
    await expect(dateHeadings(page)).toHaveCount(2);
    await expect(dateHeadings(page).nth(0)).toContainText("May 4");
    await expect(dateHeadings(page).nth(1)).toContainText("May 5");

    // Three entry rows, in fully-sorted DOM order regardless of click order.
    await expect(rows(page)).toHaveCount(3);

    // Row 0: Biology — May 4 AM (subject name + session badge both shown).
    // The session is its own badge span, so assert it as an exact-text element
    // rather than a substring (the row's textContent is "AP BiologyAM").
    await expect(rows(page).nth(0)).toContainText("AP Biology");
    await expect(rows(page).nth(0).getByText("AM", { exact: true })).toBeVisible();
    // Row 1: European History — May 4 PM (AM sorted before PM on the same day).
    await expect(rows(page).nth(1)).toContainText("AP European History");
    await expect(rows(page).nth(1).getByText("PM", { exact: true })).toBeVisible();
    // Row 2: Chemistry — May 5 AM (later date sorts after May 4).
    await expect(rows(page).nth(2)).toContainText("AP Chemistry");
    await expect(rows(page).nth(2).getByText("AM", { exact: true })).toBeVisible();
  });

  test("AC2 — a subject with a portfolio renders a distinct 'Portfolio due' entry + internal-deadline note", async ({
    page,
  }) => {
    await page.goto("/");
    await openList(page);

    // AP Seminar has BOTH a sit-down exam (2026-05-11 PM) and a portfolio
    // deadline (2026-04-30) → two entries.
    await select(page, "AP Seminar");

    await expect(rows(page)).toHaveCount(2);
    // Deadline 2026-04-30 sorts before the 2026-05-11 exam.
    await expect(dateHeadings(page).nth(0)).toContainText("April 30");
    await expect(dateHeadings(page).nth(1)).toContainText("May 11");

    // Row 0 — the portfolio deadline entry.
    const portfolioRow = rows(page).nth(0);
    await expect(portfolioRow).toContainText("AP Seminar");
    await expect(portfolioRow.getByText("Portfolio due")).toBeVisible();
    await expect(portfolioRow).toContainText(/earlier internal deadline/i);

    // Row 1 — the sit-down exam entry, NOT tagged as portfolio.
    const examRow = rows(page).nth(1);
    await expect(examRow).toContainText("AP Seminar");
    await expect(examRow.getByText("PM", { exact: true })).toBeVisible();
    await expect(examRow.getByText("Portfolio due")).toHaveCount(0);

    // Visually distinct: the portfolio row paints a different background than
    // the exam row (amber accent vs neutral card).
    const portfolioBg = await portfolioRow.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const examBg = await examRow.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(portfolioBg).not.toBe(examBg);
  });

  test("AC3 — a portfolio-only subject appears only as a deadline entry, never as an exam", async ({
    page,
  }) => {
    await page.goto("/");
    await openList(page);

    // AP Drawing is portfolio-only (no sit-down exam).
    await select(page, "AP Drawing");

    // Exactly one entry, and it is the portfolio deadline.
    await expect(rows(page)).toHaveCount(1);
    const only = rows(page).nth(0);
    await expect(only).toContainText("AP Drawing");
    await expect(only.getByText("Portfolio due")).toBeVisible();
    // No AM/PM session badge — it is not a sit-down exam.
    await expect(only.getByText(/^(AM|PM)$/)).toHaveCount(0);
    await expect(dateHeadings(page).nth(0)).toContainText("May 8");
  });

  test("AC4 — a banner states the cycle, read from dataset metadata (not hardcoded)", async ({
    page,
  }) => {
    await page.goto("/");

    // The banner text is built from the dataset's `cycle` field. Asserting the
    // exact dataset value (rather than a literal) proves it is data-driven: a
    // dataset swap re-labels the banner without a code change.
    const cycle = apData.cycle; // e.g. "May 2026"
    expect(cycle).toMatch(/^May \d{4}$/);
    // The banner lives in the shared "My Schedule" header (issue #19 second
    // bounce) so it is visible regardless of the active view.
    await expect(
      page.getByText(new RegExp(`${cycle}\\s+AP exam cycle`)),
    ).toBeVisible();
    await openList(page);
    await expect(
      page.getByText(new RegExp(`${cycle}\\s+AP exam cycle`)),
    ).toBeVisible();
  });

  test("AC5 — zero selections shows an empty-state hint, not an empty list", async ({
    page,
  }) => {
    await page.goto("/");
    await openList(page);

    await expect(page.getByText(/^0 selected$/)).toBeVisible();
    // No entry rows are rendered.
    await expect(rows(page)).toHaveCount(0);
    // A short hint is shown instead.
    await expect(
      schedule(page).getByText(/Select subjects above to build your schedule/i),
    ).toBeVisible();
  });

  test("extra — a Career Kickstart subject with no May 2026 exam surfaces under a no-date note, not as an exam", async ({
    page,
  }) => {
    await page.goto("/");
    await openList(page);

    // AP Cybersecurity has no May 2026 exam and no portfolio → it must not be
    // silently dropped; it appears under the "No May 2026 exam date" note.
    await select(page, "AP Cybersecurity");

    await expect(rows(page)).toHaveCount(0); // never a dated exam/portfolio row
    await expect(schedule(page).getByText(/No May 2026 exam date/i)).toBeVisible();
    await expect(
      schedule(page).getByRole("listitem").filter({ hasText: "AP Cybersecurity" }),
    ).toHaveCount(1);
  });

  // One isolated test per viewport (each gets a fresh browser context, so the
  // selection store / localStorage starts empty and selecting a subject never
  // toggles a previously-selected one off).
  for (const width of [375, 1024, 1920]) {
    test(`AC6 — readable at ${width}px with no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await openList(page);

      // Populate a rich schedule (exam rows, portfolio row, undated note).
      await select(page, "AP Biology");
      await select(page, "AP Seminar");
      await select(page, "AP Drawing");
      await select(page, "AP Cybersecurity");

      await expect(schedule(page)).toBeVisible();
      await expect(rows(page).first()).toBeVisible();

      const noHScroll = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      );
      expect(noHScroll, `horizontal scroll present at ${width}px`).toBe(true);
    });
  }
});

// --- Evidence capture: the three mandatory super-board viewports ------------
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — populated schedule (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openList(page);

    // A selection that exercises every entry kind at once: two same-day exams,
    // a subject with both an exam and a portfolio, a portfolio-only subject,
    // and a Career Kickstart subject with no May 2026 date.
    await select(page, "AP Biology"); // 05-04 AM
    await select(page, "AP European History"); // 05-04 PM
    await select(page, "AP Seminar"); // portfolio 04-30 + exam 05-11 PM
    await select(page, "AP Drawing"); // portfolio-only 05-08
    await select(page, "AP Cybersecurity"); // undated

    await expect(schedule(page).getByText("Portfolio due").first()).toBeVisible();

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
