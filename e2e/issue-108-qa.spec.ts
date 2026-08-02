import { test, expect, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * Issue #108 — QA pass v1 (super-board Tester lane).
 *
 * `SubjectChip` used to carry `scroll-mt-20` on its `<li>` wrapper, but the
 * focusable elements are the three `<button>`s inside it. Native focus-driven
 * scrolling (what the browser does when Tab/Shift+Tab moves focus to an
 * element outside the viewport) reads `scroll-margin` from the FOCUSED
 * element only — never from an ancestor — so the `<li>`'s margin never
 * participated. Walking the catalog BACKWARDS with Shift+Tab parked the
 * newly focused chip at viewport y=0, fully behind the sticky catalog header
 * (`[data-testid="catalog-header"]`, ~113px tall below `sm`, ~61px at `sm`+).
 *
 * This defect predates #102 (measured on `main`) and was filed as a follow-up
 * from the trailing comment in `e2e/issue-102-qa.spec.ts` rather than bounced
 * against that card.
 *
 * The fix moves the responsive `scroll-mt-32 sm:scroll-mt-20` pair (the same
 * pair `CategorySection`'s heading already uses) off the `<li>` and onto all
 * three focusable buttons — select-toggle, expand chevron, "Full exam
 * details" — so whichever one ends up focused clears the bar.
 *
 * ## What this spec proves, per AC
 *
 * - AC1/AC2 — the margin lives on the focusable buttons and is the same
 *   responsive pair as `CategorySection`, matching the bar's two heights.
 *   Asserted indirectly: the Shift+Tab clearance checks below only pass if a
 *   `scroll-margin-top` sized to the CURRENT breakpoint's header height is
 *   present on whichever button the browser focuses.
 * - AC3 — real Shift+Tab traversal, backwards, through the whole catalog at
 *   375×667 and 1920×1080: every chip button the browser focuses clears the
 *   sticky header (mobile is the 1-column grid, desktop is the 3-column
 *   grid — DOM order is identical, but the visual row-boundary crossings
 *   that trigger the browser's focus-scroll differ, so both are exercised).
 * - AC2 (boundary) — 639px vs 640px: the same backward traversal at the exact
 *   `sm` pixel boundary proves the CORRECT header height's margin applies on
 *   each side, not just "some" margin.
 * - AC4 — forward Tab traversal is unchanged (no clipped/hidden focus), and
 *   the full `e2e/issue-102-*.spec.ts` suite (quick-jump heading clearance,
 *   tab order, sticky chrome) is re-run as part of this QA pass — see the
 *   Tester's PR handoff comment for the combined run log.
 * - AC5 — this file.
 *
 * Evidence: `docs/super-board/runs/issue-108-qa-v1/`.
 */

const EVIDENCE_DIR = evidenceDir("issue-108-qa-v1");

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const bar = (page: Page) => page.getByTestId("catalog-header");

/** Only the `<li>`s that hold a `SubjectChip` — excludes the quick-jump
 *  nav's own `ul > li` (categories aren't `<section aria-labelledby>`). */
const categorySections = (page: Page) =>
  catalog(page).locator('section[aria-labelledby^="catalog-category-"]');
/** `:visible` matters here: the collapsed chip's Tier-1 panel (which holds
 *  the "Full exam details" button) is `hidden`, so its button exists in the
 *  DOM but is neither visible nor in the Tab order — including it would let
 *  `.last()` resolve to an unclickable node and hang every test. */
const chipButtons = (page: Page) =>
  categorySections(page).locator("ul > li button:visible");

async function headerBottom(page: Page): Promise<number> {
  return bar(page).evaluate((el) => el.getBoundingClientRect().bottom);
}

/** The bar's own height — unlike {@link headerBottom}, valid before the page
 *  has scrolled far enough to pin it (its `bottom` pre-pin is just "wherever
 *  it sits on the page", not its size). */
async function headerHeight(page: Page): Promise<number> {
  return bar(page).evaluate((el) => el.getBoundingClientRect().height);
}

async function barPinned(page: Page): Promise<boolean> {
  const box = await bar(page).evaluate((el) => el.getBoundingClientRect().top);
  return Math.abs(box) <= 1;
}

interface FocusedChip {
  top: number;
  bottom: number;
  label: string;
}

/** `null` once focus has walked out of the subject-chip list entirely
 *  (reached the quick-jump pills / search box, which #102 already covers). */
async function focusedChip(page: Page): Promise<FocusedChip | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const section = el.closest('section[aria-labelledby^="catalog-category-"]');
    if (!section) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      label:
        el.getAttribute("aria-label") ??
        el.textContent?.trim() ??
        el.tagName,
    };
  });
}

/**
 * Focus the LAST chip button, then walk Shift+Tab backwards, asserting every
 * chip button the browser lands on clears the sticky header. Stops early once
 * focus exits the chip list (into the quick-jump/search controls).
 *
 * Returns the number of chip-button stops actually checked, so callers can
 * assert the loop exercised a meaningful number of row-boundary crossings
 * (a loop that exits after 0-1 steps proves nothing).
 */
async function walkShiftTabBackwards(
  page: Page,
  maxSteps: number,
): Promise<number> {
  // `.focus()`, not `.click()`: the last default-visible button is the
  // expand chevron, and a real click would toggle its panel open — revealing
  // the "Full exam details" button and making it the new last VISIBLE
  // button, out from under a `.last()` re-query. `.focus()` sets DOM focus
  // directly without dispatching a click, so the chevron's onClick never
  // fires. It still triggers the browser's native focus-scroll (the exact
  // mechanism under test), matching how Chromium behaves for Tab as well.
  const last = chipButtons(page).last();
  await last.focus();
  await expect(last).toBeFocused();
  expect(
    await barPinned(page),
    "the catalog must actually be scrolled deep enough to pin the header, or this test proves nothing",
  ).toBe(true);

  let checked = 0;
  for (let i = 0; i < maxSteps; i++) {
    await page.keyboard.press("Shift+Tab");
    const chip = await focusedChip(page);
    if (!chip) break; // walked out of the subject-chip list
    const hBottom = await headerBottom(page);
    checked++;
    expect(
      chip.top,
      `step ${i}: focused "${chip.label}" landed at top=${chip.top}px while the sticky header's bottom edge is at ${hBottom}px — the chip is covered`,
    ).toBeGreaterThanOrEqual(hBottom - 1);
  }
  return checked;
}

// ---------------------------------------------------------------------------
// AC3 — Shift+Tab backwards through the WHOLE catalog, both target viewports.
// ---------------------------------------------------------------------------

for (const vp of [
  { name: "mobile", width: 375, height: 667 },
  { name: "desktop", width: 1920, height: 1080 },
] as const) {
  test(`Shift+Tab backwards never parks a chip behind the sticky header (${vp.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(chipButtons(page).first()).toBeVisible();

    const checked = await walkShiftTabBackwards(page, 60);
    expect(
      checked,
      "the backward walk must exercise several chip-to-chip steps to be a meaningful regression check",
    ).toBeGreaterThan(10);
  });
}

// ---------------------------------------------------------------------------
// AC2 (boundary) — 639px must clear the 113px wrapped bar with
// `scroll-mt-32`; 640px must clear the 61px one-row bar with
// `sm:scroll-mt-20`. Neither the Builder's nor the #102 suite exercises this
// exact pixel pair for the CHIP buttons (only for CategorySection headings).
// ---------------------------------------------------------------------------

for (const width of [639, 640] as const) {
  test(`Shift+Tab clears the correct header height at the sm boundary (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await expect(chipButtons(page).first()).toBeVisible();

    const hHeight = await headerHeight(page);
    if (width < 640) {
      expect(hHeight, "below sm the wrapped bar should be ~113px tall").toBeGreaterThan(90);
    } else {
      expect(hHeight, "at sm+ the one-row bar should be ~61px tall").toBeLessThan(90);
    }

    const checked = await walkShiftTabBackwards(page, 40);
    expect(checked).toBeGreaterThan(5);
  });
}

// ---------------------------------------------------------------------------
// AC4 — forward Tab traversal is unchanged: stepping forward through the
// first several chips never lands a button somewhere unexpected/off-screen.
// ---------------------------------------------------------------------------

test("AC4 — Tab forward through the first chips still lands each button in view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(chipButtons(page).first()).toBeVisible();

  await chipButtons(page).first().focus();
  await expect(chipButtons(page).first()).toBeFocused();

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const chip = await focusedChip(page);
    if (!chip) break;
    const hBottom = await headerBottom(page);
    expect(
      chip.top,
      `forward step ${i}: focused "${chip.label}" landed at top=${chip.top}px, header bottom=${hBottom}px`,
    ).toBeGreaterThanOrEqual(hBottom - 1);
    await expect(page.locator(":focus")).toBeInViewport();
  }
});

// ---------------------------------------------------------------------------
// Evidence — the newly focused chip, landed via backward Shift+Tab, fully
// clear of the sticky header. Three viewports, both themes.
// ---------------------------------------------------------------------------

for (const vp of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence — ${vp.name} ${vp.width}x${vp.height} ${scheme}`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await page.goto("/");
      await expect(chipButtons(page).first()).toBeVisible();

      // `.focus()`, not `.click()` — see the comment in `walkShiftTabBackwards`:
      // the last default-visible button is the expand chevron, and clicking
      // it would toggle its panel open for the screenshot.
      await chipButtons(page).last().focus();
      // Walk back a handful of steps so the screenshot shows a chip that HAD
      // scrolled out of view being freshly (re)revealed below the bar, not
      // just the last chip's own already-visible position.
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Shift+Tab");
      }
      const chip = await focusedChip(page);
      expect(chip, "focus should still be on a chip button after 8 Shift+Tabs").not.toBeNull();
      const hBottom = await headerBottom(page);
      expect(
        chip!.top,
        `evidence capture: focused chip must clear the header (top=${chip!.top}, header bottom=${hBottom})`,
      ).toBeGreaterThanOrEqual(hBottom - 1);

      const suffix = scheme === "light" ? "" : "-dark";
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}${suffix}.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}
