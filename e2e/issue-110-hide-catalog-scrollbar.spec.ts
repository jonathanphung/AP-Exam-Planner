import { test, expect, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * Issue #110 — hide the horizontal scrollbar chrome under the sticky
 * catalog header's quick-jump pill row, while keeping the row itself
 * scrollable.
 *
 * ## Background
 *
 * Issue #102 gave the pill `<ul>` (`src/components/CatalogGrid.tsx`)
 * `min-w-0 flex-1 overflow-x-auto` so the pills — not the page — scroll
 * sideways once the five category pills outrun the space between the
 * search field and the "N selected" count. But every scroll container on
 * the page also inherits issue #49's global custom-scrollbar treatment
 * (`::-webkit-scrollbar` sizing + `scrollbar-width: thin` in Firefox), so
 * on non-overlay-scrollbar platforms (e.g. Windows) the row painted a
 * permanent classic-scrollbar track under the pinned bar.
 *
 * This card adds `.catalog-quickjump-scroll` (globals.css), scoped to just
 * this list, which sets `scrollbar-width: none` and
 * `::-webkit-scrollbar { display: none }`. Scroll behavior — wheel/
 * trackpad/touch panning, programmatic `scrollLeft`, and keyboard
 * focus-scroll — must all keep working; only the painted chrome goes away.
 *
 * One observable test per AC, plus evidence screenshots of the sticky bar
 * with pills overflowing, light + dark, at the three standard viewports.
 */

const EVIDENCE_DIR = evidenceDir("issue-110-build-v1");

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

// Viewports narrow enough that the five category pills are guaranteed to
// outrun the bar (the AC's explicit floor).
const OVERFLOW_VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 1024, height: 768 },
] as const;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const quickJump = (page: Page) =>
  catalog(page).getByRole("navigation", { name: "Jump to category" });
const pillList = (page: Page) => quickJump(page).locator("ul");
const pills = (page: Page) => quickJump(page).getByRole("button");
const search = (page: Page) => page.getByLabel("Search subjects");

const noPageHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

async function gotoAndAssertOverflowing(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);
  const overflowing = await pillList(page).evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(
    overflowing,
    `pill list must overflow at ${width}x${height} for this spec's premise to hold`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// AC1 — no scrollbar is painted: scrollbar-width is `none`, and the element's
// own box does not grow to accommodate a horizontal scrollbar.
// ---------------------------------------------------------------------------

for (const vp of OVERFLOW_VIEWPORTS) {
  test(`AC1 — at ${vp.name} ${vp.width}x${vp.height}, the overflowing pill list paints no scrollbar`, async ({
    page,
  }) => {
    await gotoAndAssertOverflowing(page, vp.width, vp.height);

    const measurements = await pillList(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        scrollbarWidth: style.scrollbarWidth,
        offsetHeight: el.offsetHeight,
        clientHeight: el.clientHeight,
        borderTop: parseFloat(style.borderTopWidth),
        borderBottom: parseFloat(style.borderBottomWidth),
      };
    });

    expect(measurements.scrollbarWidth).toBe("none");
    // offsetHeight includes borders + any scrollbar thickness; clientHeight
    // excludes both. If a horizontal scrollbar were painted it would add its
    // thickness to that gap on top of the borders — so the gap must equal
    // exactly the border box, with nothing left over for scrollbar chrome.
    const borderBox = measurements.borderTop + measurements.borderBottom;
    expect(
      measurements.offsetHeight - measurements.clientHeight,
      "no extra height must be consumed by a painted scrollbar",
    ).toBeCloseTo(borderBox, 0);
  });
}

// ---------------------------------------------------------------------------
// AC2 — the row still scrolls: scrollLeft moves the pills, and the last pill
// can be brought fully into view at 375px.
// ---------------------------------------------------------------------------

test("AC2 — scrollLeft still moves the pill row, and the last pill reaches full visibility at 375px", async ({
  page,
}) => {
  await gotoAndAssertOverflowing(page, 375, 667);

  const before = await pillList(page).evaluate((el) => el.scrollLeft);
  expect(before).toBe(0);

  const maxScrollLeft = await pillList(page).evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(maxScrollLeft).toBeGreaterThan(0);

  await pillList(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const after = await pillList(page).evaluate((el) => el.scrollLeft);
  expect(after, "scrollLeft must actually move the row").toBeGreaterThan(0);

  const lastPill = pills(page).filter({ hasText: "Career Kickstart" });
  await expect(lastPill).toBeInViewport();
  const withinList = await pillList(page).evaluate((ul) => {
    const list = ul.getBoundingClientRect();
    const last = ul.querySelector("li:last-child button");
    if (!last) return false;
    const rect = last.getBoundingClientRect();
    return rect.left >= list.left - 1 && rect.right <= list.right + 1;
  });
  expect(
    withinList,
    "the last pill must be fully inside the list's visible viewport",
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// AC3 — tab-focusing the last pill at 375px scrolls it into view.
// ---------------------------------------------------------------------------

test("AC3 — tab-focusing the last (off-screen) pill scrolls it into view at 375px", async ({
  page,
}) => {
  await gotoAndAssertOverflowing(page, 375, 667);

  // Reset scroll so the last pill starts off-screen.
  await pillList(page).evaluate((el) => {
    el.scrollLeft = 0;
  });
  const lastPill = pills(page).filter({ hasText: "Career Kickstart" });
  expect(
    await lastPill.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const listRect = (el.closest("ul") as HTMLElement).getBoundingClientRect();
      return r.right <= listRect.right;
    }),
  ).toBe(false);

  await search(page).focus();
  for (const category of ["STEM", "Humanities", "Languages", "Arts", "Career Kickstart"]) {
    await page.keyboard.press("Tab");
    await expect(pills(page).filter({ hasText: category })).toBeFocused();
  }

  // The now-focused last pill must be on screen — never focused off-screen.
  await expect(lastPill).toBeInViewport();
});

// ---------------------------------------------------------------------------
// AC4 — jumpToCategory still fires from every pill, including ones that
// started off-screen.
// ---------------------------------------------------------------------------

test("AC4 — every pill still jumps to its category, including ones that start off-screen", async ({
  page,
}) => {
  await gotoAndAssertOverflowing(page, 375, 667);

  for (const category of ["STEM", "Humanities", "Languages", "Arts", "Career Kickstart"]) {
    // Reset to top so each jump is a real navigation, not a no-op.
    await page.evaluate(() => window.scrollTo(0, 0));
    await pills(page).filter({ hasText: category }).click();
    const heading = catalog(page).getByRole("heading", {
      name: new RegExp(`^${category}`),
    });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  }
});

// ---------------------------------------------------------------------------
// AC5 — no page-level horizontal scroll at 375px, light and dark.
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test(`AC5 — no page-level horizontal scroll at 375px (${scheme} mode)`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    await gotoAndAssertOverflowing(page, 375, 667);
    expect(await noPageHorizontalScroll(page)).toBe(true);
    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// AC6 — the scrollbar-hiding is scoped to this list only; other scroll
// containers (the document) are untouched.
// ---------------------------------------------------------------------------

test("AC6 — scrollbar hiding is scoped to the pill list; the document scroller keeps its own scrollbar styling", async ({
  page,
}) => {
  await gotoAndAssertOverflowing(page, 375, 667);

  const listScrollbarWidth = await pillList(page).evaluate(
    (el) => getComputedStyle(el).scrollbarWidth,
  );
  expect(listScrollbarWidth).toBe("none");

  // The document root must NOT have picked up `scrollbar-width: none` — issue
  // #49's themed scrollbar (or the browser default outside Firefox) still
  // governs it.
  const rootScrollbarWidth = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollbarWidth,
  );
  expect(rootScrollbarWidth).not.toBe("none");

  // `.catalog-quickjump-scroll` must not have leaked onto anything besides
  // the quick-jump `<ul>`.
  const scopedCount = await page.evaluate(
    () => document.querySelectorAll(".catalog-quickjump-scroll").length,
  );
  expect(scopedCount).toBe(1);
});

// ---------------------------------------------------------------------------
// Evidence — the sticky bar with pills overflowing, light + dark, at the
// three standard viewports.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence — pill row overflowing, no scrollbar painted (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await page.goto("/");
      await expect(pills(page)).toHaveCount(5);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}-${scheme}.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}
