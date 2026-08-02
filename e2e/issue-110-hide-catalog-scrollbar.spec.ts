import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
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
 *
 * ## Pass 2 — the pills/count boundary (bounce, 2026-08-01)
 *
 * Hiding the scrollbar took away the only thing that separated the clipped
 * pill row from the "N selected" count, and the count is `shrink-0` inside a
 * `flex-nowrap` bar: every character it gains steals width from the `flex-1`
 * nav and walks the list's clip edge LEFT. At 1920px the five pills fitted
 * exactly through "9 selected"; the tenth selection widened the count by ~5px
 * and sliced the rounded right edge off "Career Kickstart", leaving a
 * guillotined pill 12px from the count.
 *
 * The fix is spacing only: `pr-3` on the `<nav>` (holds the clip edge 12px
 * inside the nav's border box, on top of the bar's own `gap-x-3`) and `px-3`
 * instead of `px-4` on the pills (40px of row width back across the five
 * categories). The AC9 block below is the regression: at 10 selected, the
 * clip container and the count must not intersect and must keep a real gap,
 * at every standard viewport in both themes.
 */

const EVIDENCE_DIR = evidenceDir("issue-110-build-v2");

/** Legacy selection key — the migration source the whole suite seeds through. */
const SELECTION_KEY = "apx.selection.v1";

/**
 * Ten subject ids — the reported trigger ("whenever 10+ ap exams are
 * selected"): the count's label goes double-digit and its slot grows.
 */
const TEN_SUBJECT_IDS = [
  "african-american-studies",
  "art-history",
  "biology",
  "business-with-personal-finance",
  "calculus-ab",
  "calculus-bc",
  "chemistry",
  "chinese-language-and-culture",
  "comparative-government-and-politics",
  "computer-science-a",
] as const;

/** Minimum painted background between the pill row's clip edge and the count. */
const MIN_BOUNDARY_GAP = 16;

/**
 * Every subject id in the shipped dataset — the WIDEST the count label can ever
 * get ("43 selected" today). QA v2 uses this instead of a hardcoded list so the
 * invariant tracks the dataset: if the catalog ever grows past 99 subjects the
 * count goes three digits and these tests are the ones that notice.
 */
const ALL_SUBJECT_IDS = (
  apData as { subjects: ReadonlyArray<{ id: string }> }
).subjects.map((subject) => subject.id);

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
const count = (page: Page) => page.getByText(/^\d+ selected$/);

/** Seed N selections before the app boots (legacy key → #29 migration path). */
async function seedSelection(page: Page, ids: readonly string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

/**
 * Geometry of the pills/count boundary, measured after hydration has settled
 * the count to its seeded value.
 *
 * `clip` is the `<ul>`'s border box — the pill row's clip container, i.e. the
 * rightmost pixel column any pill can paint into. `countBox` is the count
 * paragraph. `worstPillOverlap` walks every pill, intersects it with the clip
 * box (that intersection is the pill's *visible* part) and reports how far the
 * rightmost visible pixel of any pill reaches past the count's left edge — it
 * must stay negative.
 */
async function boundaryGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector(
      "[data-testid='catalog-header']",
    ) as HTMLElement;
    const ul = header.querySelector(
      "nav[aria-label='Jump to category'] ul",
    ) as HTMLElement;
    const countEl = [...header.querySelectorAll("p")].find((p) =>
      /^\d+ selected$/.test((p.textContent ?? "").trim()),
    ) as HTMLElement;

    const clip = ul.getBoundingClientRect();
    const countBox = countEl.getBoundingClientRect();

    let worstPillRight = -Infinity;
    for (const button of ul.querySelectorAll("button")) {
      const pill = button.getBoundingClientRect();
      // The pill's VISIBLE part: what survives the clip container.
      const visibleRight = Math.min(pill.right, clip.right);
      const visibleLeft = Math.max(pill.left, clip.left);
      if (visibleRight <= visibleLeft) continue; // fully scrolled out of view
      worstPillRight = Math.max(worstPillRight, visibleRight);
    }

    const headerStyle = getComputedStyle(header);
    return {
      countText: (countEl.textContent ?? "").trim(),
      clipRight: clip.right,
      countLeft: countBox.left,
      countRight: countBox.right,
      barContentRight:
        header.getBoundingClientRect().right -
        parseFloat(headerStyle.paddingRight),
      gap: countBox.left - clip.right,
      worstPillOverlap: worstPillRight - countBox.left,
      overflowing: ul.scrollWidth > ul.clientWidth + 1,
      scrollWidth: ul.scrollWidth,
      clientWidth: ul.clientWidth,
    };
  });
}

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
// AC9 (pass 2) — at 10+ selected the pill row's clip container and the count
// never intersect and keep a real gap, at every standard viewport, both
// themes. This is the bounce's regression test.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`AC9 — at 10 selected the pill row keeps a clear gap before the count (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await seedSelection(page, TEN_SUBJECT_IDS);
      await page.goto("/");
      await expect(pills(page)).toHaveCount(5);
      // Wait for hydration to settle the count to the seeded value — the
      // server snapshot is always "0 selected", which is the NARROW case this
      // test must not measure.
      await expect(count(page)).toHaveText("10 selected");

      const geo = await boundaryGeometry(page);

      expect(
        geo.gap,
        `${vp.name}/${scheme}: painted background between the pill row's clip edge (${geo.clipRight}) and the count (${geo.countLeft}) must be ≥ ${MIN_BOUNDARY_GAP}px`,
      ).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);

      expect(
        geo.worstPillOverlap,
        `${vp.name}/${scheme}: no pill's visible pixels may reach the count's left edge`,
      ).toBeLessThan(0);

      // The count stays fully visible and right-pinned — the fix must not have
      // bought its gap by pushing the count off the bar's edge (issue #102).
      expect(
        Math.abs(geo.countRight - geo.barContentRight),
        `${vp.name}/${scheme}: count must stay flush with the bar's content right edge`,
      ).toBeLessThanOrEqual(1);

      await ctx.close();
    });
  }
}

test("AC9 — growing the count from 9 to 10 selected does not slice a pill that was whole at 9 (1920x1080)", async ({
  browser,
}) => {
  // The reported trigger, measured at the width where it was reported: the
  // desktop bar used to fit the five pills exactly, so the count's extra digit
  // walked the clip edge back into "Career Kickstart" and guillotined it.
  const measure = async (ids: readonly string[], label: string) => {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await seedSelection(page, ids);
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);
    await expect(count(page)).toHaveText(label);
    const geo = await boundaryGeometry(page);
    await ctx.close();
    return geo;
  };

  const nine = await measure(TEN_SUBJECT_IDS.slice(0, 9), "9 selected");
  const ten = await measure(TEN_SUBJECT_IDS, "10 selected");

  expect(
    nine.overflowing,
    "premise: at 1920px the pill row fits without scrolling at 9 selected",
  ).toBe(false);
  expect(
    ten.overflowing,
    `at 1920px the tenth selection must not push the pill row into overflow (${ten.scrollWidth}px of pills in a ${ten.clientWidth}px list)`,
  ).toBe(false);
  expect(ten.gap).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);
});

test("AC9 — the row is still scrollable at 10 selected, and the pills keep their ≥44px targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seedSelection(page, TEN_SUBJECT_IDS);
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);
  await expect(count(page)).toHaveText("10 selected");

  const before = await boundaryGeometry(page);
  expect(
    before.overflowing,
    "premise: at 375px with 10 selected the pills still overflow their list",
  ).toBe(true);

  await pillList(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(
    await pillList(page).evaluate((el) => el.scrollLeft),
    "the narrowed row must still scroll",
  ).toBeGreaterThan(0);

  // …and scrolling to the end must not have pushed a pill onto the count.
  const scrolled = await boundaryGeometry(page);
  expect(scrolled.worstPillOverlap).toBeLessThan(0);
  expect(scrolled.gap).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);

  // `px-3` (down from `px-4`) must not have taken any pill below the 44px
  // tap-target floor the a11y suite enforces.
  const widths = await pillList(page).evaluate((el) =>
    [...el.querySelectorAll("button")].map(
      (b) => b.getBoundingClientRect().width,
    ),
  );
  for (const width of widths) {
    expect(width, "every quick-jump pill stays ≥44px wide").toBeGreaterThanOrEqual(44);
  }
  expect(widths).toHaveLength(5);
});

// ---------------------------------------------------------------------------
// QA v2 — the bounce's directive is "no visual overlap … at ANY selected-count
// width". The build's AC9 block proves that at the reported repro (10), which
// is where the count first goes double-digit. These three lock the two ends the
// build only argued for in prose: the WIDEST label the shipped catalog can
// produce ("43 selected"), and the narrowest viewport the suite supports.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`QA v2 — the boundary gap survives the widest possible count (whole catalog selected) (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await seedSelection(page, ALL_SUBJECT_IDS);
      await page.goto("/");
      await expect(pills(page)).toHaveCount(5);
      await expect(count(page)).toHaveText(
        `${ALL_SUBJECT_IDS.length} selected`,
      );

      const geo = await boundaryGeometry(page);

      expect(
        geo.gap,
        `${vp.name}/${scheme}: the gap must not shrink at the catalog's maximum count (${geo.countText})`,
      ).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);
      expect(
        geo.worstPillOverlap,
        `${vp.name}/${scheme}: no pill's visible pixels may reach the count at maximum count`,
      ).toBeLessThan(0);
      expect(
        Math.abs(geo.countRight - geo.barContentRight),
        `${vp.name}/${scheme}: the widest count must still sit flush with the bar's content edge`,
      ).toBeLessThanOrEqual(1);

      await ctx.close();
    });
  }
}

test("QA v2 — the desktop row still fits whole at the catalog's maximum count (1920x1080)", async ({
  page,
}) => {
  // The build's justification for `px-3` was "the desktop row now fits whole at
  // any selection size (43 subjects max, so the count never exceeds two
  // digits)". That claim is only measured at 10 there; measure it at the top.
  expect(
    ALL_SUBJECT_IDS.length,
    "a catalog past 99 subjects makes the count three digits — re-measure the desktop fit before shipping that",
  ).toBeLessThan(100);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, ALL_SUBJECT_IDS);
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);
  await expect(count(page)).toHaveText(`${ALL_SUBJECT_IDS.length} selected`);

  const geo = await boundaryGeometry(page);
  expect(
    geo.overflowing,
    `at 1920px the widest count must not push the pill row back into overflow (${geo.scrollWidth}px of pills in a ${geo.clientWidth}px list)`,
  ).toBe(false);
});

test("QA v2 — gap, page-scroll and scrollability invariants hold at the 320px floor with the whole catalog selected", async ({
  page,
}) => {
  // 320px is the narrowest width the suite's overflow guard covers
  // (`e2e/support/scroll-shift.ts`), and it is the worst case for this card:
  // the least room for the pill row, the widest count label.
  await page.setViewportSize({ width: 320, height: 667 });
  await seedSelection(page, ALL_SUBJECT_IDS);
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);
  await expect(count(page)).toHaveText(`${ALL_SUBJECT_IDS.length} selected`);

  const geo = await boundaryGeometry(page);
  expect(geo.overflowing, "premise: the pills overflow at 320px").toBe(true);
  expect(geo.gap).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);
  expect(geo.worstPillOverlap).toBeLessThan(0);
  expect(await noPageHorizontalScroll(page)).toBe(true);

  // Still the escape valve: the row scrolls, and scrolling to the end does not
  // walk a pill onto the count.
  await pillList(page).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(
    await pillList(page).evaluate((el) => el.scrollLeft),
    "the row must still scroll at 320px",
  ).toBeGreaterThan(0);

  const scrolled = await boundaryGeometry(page);
  expect(scrolled.gap).toBeGreaterThanOrEqual(MIN_BOUNDARY_GAP);
  expect(scrolled.worstPillOverlap).toBeLessThan(0);
  expect(await noPageHorizontalScroll(page)).toBe(true);
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

// Pass-2 evidence — the same bar at the reported repro state ("10 selected"),
// cropped to the sticky header so the pills/count boundary is legible.
for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence — pills/count boundary at 10 selected (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await seedSelection(page, TEN_SUBJECT_IDS);
      await page.goto("/");
      await expect(pills(page)).toHaveCount(5);
      await expect(count(page)).toHaveText("10 selected");
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}-${scheme}-10-selected.png`,
        caret: "initial",
      });
      await page.locator("[data-testid='catalog-header']").screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}-${scheme}-10-selected-bar.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}

// QA-v2 evidence — the same boundary at the widest label the catalog can
// produce, cropped to the bar. Pairs with the "widest possible count" tests.
for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence — pills/count boundary at the catalog's maximum count (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await seedSelection(page, ALL_SUBJECT_IDS);
      await page.goto("/");
      await expect(pills(page)).toHaveCount(5);
      await expect(count(page)).toHaveText(
        `${ALL_SUBJECT_IDS.length} selected`,
      );
      await page.locator("[data-testid='catalog-header']").screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}-${scheme}-max-selected-bar.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}
