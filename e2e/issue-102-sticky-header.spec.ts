import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * Issue #102 — the catalog's search box, quick-jump pills and `{n} selected`
 * count are ONE sticky bar.
 *
 * ## What changed
 *
 * The header used to be two stacked lines and only the second one stuck: a
 * non-sticky `Search subjects` row (label + input on the left, count on the
 * right), then the `sticky top-0 z-30` pill nav. Scrolling the catalog kept
 * the pills and dropped the other two, so narrowing a 43-subject list meant
 * scrolling back to the top to reach the field. They are now one pinned unit:
 * search left, pills centre (flex-1, horizontally scrollable), count pinned to
 * the right edge.
 *
 * ## What this spec pins that the older specs do not
 *
 * `issue-22-qa` / `issue-24-qa` assert the NAV is sticky; `issue-3-catalog-grid`
 * asserts the search filters. Neither notices whether the search and the count
 * are still on screen once you scroll — which was the whole bug. Every
 * assertion below is therefore taken *after a deep scroll*, or is about the
 * geometry of the condensed row (count flush right, search left of the first
 * pill) that did not exist before.
 *
 * The no-matches case gets its own test: the bar used to live inside the
 * `groups.length > 0` branch, so a query that matched nothing unmounted the
 * search input along with the pills — the one state where the user most needs
 * that field, because it is the only way to clear the query.
 */

const EVIDENCE_DIR = evidenceDir("issue-102-build-v1");

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const bar = (page: Page) => page.getByTestId("catalog-header");
const search = (page: Page) => page.getByLabel("Search subjects");
const quickJump = (page: Page) =>
  catalog(page).getByRole("navigation", { name: "Jump to category" });
const pills = (page: Page) => quickJump(page).getByRole("button");
const counter = (page: Page) => page.getByText(/^\d+ selected$/);
const subjectChips = (page: Page) =>
  catalog(page).locator("ul > li button[aria-pressed]");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const box = async (locator: Locator): Promise<Box> => {
  const b = await locator.boundingBox();
  expect(b, "element has no box").not.toBeNull();
  return b!;
};

const centerY = (b: Box) => b.y + b.height / 2;
const right = (b: Box) => b.x + b.width;

/** The bar's CONTENT right edge — below `sm` the bar bleeds edge-to-edge and
 *  restores its inset with `px-6`, so the raw rect right is 24px too far. */
async function barContentRight(page: Page): Promise<number> {
  return bar(page).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.right - parseFloat(getComputedStyle(el).paddingRight);
  });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

/**
 * Scroll until the LAST category section sits near the top of the viewport.
 *
 * A fixed pixel depth would be a guess that changes with viewport width (the
 * chip grid is 1/2/3 columns), and scrolling past the catalog would release
 * the sticky bar for a legitimate reason and make this spec lie. Anchoring on
 * the last section keeps the catalog — the bar's containing block — in view at
 * every width. Returns the resulting scrollY so callers can assert the scroll
 * actually happened.
 */
async function scrollToLastCategory(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sections = document.querySelectorAll(
      'section[aria-label="Subject catalog"] section',
    );
    const last = sections[sections.length - 1];
    if (!last) return window.scrollY;
    window.scrollTo(
      0,
      window.scrollY + last.getBoundingClientRect().top - 200,
    );
    return window.scrollY;
  });
}

/** Everything the bar owns, still painted at the top of the screen. */
async function expectBarPinnedWithAllThreeControls(page: Page) {
  const barBox = await box(bar(page));
  expect(
    Math.abs(barBox.y),
    `bar must be pinned to the viewport top (y=${barBox.y})`,
  ).toBeLessThanOrEqual(1);
  await expect(search(page)).toBeInViewport();
  await expect(pills(page).first()).toBeInViewport();
  await expect(counter(page)).toBeInViewport();
}

// ---------------------------------------------------------------------------
// AC1 — one sticky bar, three controls, left → right.
// ---------------------------------------------------------------------------

test.describe("AC1 — a single sticky bar replaces the two header lines", () => {
  test("the bar carries the nav's old sticky chrome and holds all three controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(subjectChips(page)).toHaveCount(43);

    const chrome = await bar(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        position: style.position,
        top: style.top,
        zIndex: style.zIndex,
        borderBottomWidth: style.borderBottomWidth,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      };
    });
    expect(chrome.position).toBe("sticky");
    expect(chrome.top).toBe("0px");
    expect(chrome.zIndex).toBe("30");
    expect(parseFloat(chrome.borderBottomWidth)).toBeGreaterThan(0);
    expect(chrome.backdropFilter).toContain("blur");

    // All three controls resolve to the SAME bar — i.e. one line, not two.
    const owners = await page.evaluate(() => {
      const owner = (el: Element | null) =>
        el?.closest("[data-testid='catalog-header']") ?? null;
      const input = document.querySelector("#subject-search");
      const nav = document.querySelector(
        "nav[aria-label='Jump to category']",
      );
      const count = [...document.querySelectorAll("p")].find((p) =>
        /^\d+ selected$/.test((p.textContent ?? "").trim()),
      );
      const barEl = document.querySelector("[data-testid='catalog-header']");
      return {
        input: owner(input) === barEl,
        nav: owner(nav) === barEl,
        count: owner(count ?? null) === barEl,
        // The bar is the catalog's first element child: nothing renders above
        // it any more (the old search row did).
        isFirstChild:
          document.querySelector("section[aria-label='Subject catalog']")
            ?.firstElementChild === barEl,
      };
    });
    expect(owners).toEqual({
      input: true,
      nav: true,
      count: true,
      isFirstChild: true,
    });
  });

  test("desktop is one row: search left of the first pill, count flush right", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);

    const searchBox = await box(search(page));
    const firstPill = await box(pills(page).first());
    const countBox = await box(counter(page));

    // One row: the three share a centre line (±2px for differing heights).
    expect(
      Math.abs(centerY(searchBox) - centerY(firstPill)),
      "search and pills must sit on one row",
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(centerY(countBox) - centerY(firstPill)),
      "count and pills must sit on one row",
    ).toBeLessThanOrEqual(2);

    // Left → right: search, then pills, then the count.
    expect(
      right(searchBox),
      "search input must sit left of the first pill",
    ).toBeLessThanOrEqual(firstPill.x);
    expect(
      right(firstPill),
      "the first pill must sit left of the count",
    ).toBeLessThanOrEqual(countBox.x);

    // The count is pinned to the bar's right edge, not merely to the right of
    // the pills.
    expect(
      Math.abs(right(countBox) - (await barContentRight(page))),
      "count's right edge must sit at the bar's right edge",
    ).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC2 — one row at `sm`+, a wrapped-but-united bar below it, edge bleed kept.
// ---------------------------------------------------------------------------

test.describe("AC2 — responsive shape of the bar", () => {
  test("below sm the bar wraps internally, keeps all three controls, and bleeds edge-to-edge", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);

    const searchBox = await box(search(page));
    const firstPill = await box(pills(page).first());
    const countBox = await box(counter(page));

    // Wrapped: the search is its own full-width row above the pills…
    expect(
      centerY(searchBox),
      "at 375px the search sits on its own row above the pills",
    ).toBeLessThan(centerY(firstPill));
    // …and the count rides the pill row, still flush right.
    expect(
      Math.abs(centerY(countBox) - centerY(firstPill)),
      "count shares the pill row below sm",
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(right(countBox) - (await barContentRight(page))),
      "count stays flush with the bar's content right edge below sm",
    ).toBeLessThanOrEqual(1);

    // Still ONE unit: the whole bar is a single sticky box.
    const barBox = await box(bar(page));
    expect(barBox.y).toBeLessThanOrEqual(searchBox.y);
    expect(barBox.y + barBox.height).toBeGreaterThanOrEqual(
      firstPill.y + firstPill.height,
    );

    // Edge bleed (`-mx-6 px-6`): the bar cancels the page shell's `px-6` and
    // reaches the shell's own edges. Compared against the shell rather than
    // `window.innerWidth`, because issue #49 permanently reserves a
    // `scrollbar-gutter: stable` strip that innerWidth counts and layout does
    // not (10px in headless Chromium) — and the shell IS the full layout width
    // at 375px, which the second pair of assertions pins.
    const bleed = await page.evaluate(() => {
      const rect = document
        .querySelector("[data-testid='catalog-header']")!
        .getBoundingClientRect();
      const shell = document
        .querySelector("[data-scroll-lock-anchor]")!
        .getBoundingClientRect();
      return {
        barLeft: rect.left,
        barRight: rect.right,
        shellLeft: shell.left,
        shellRight: shell.right,
        shellWidth: shell.width,
        layoutWidth: document.body.clientWidth,
      };
    });
    expect(Math.abs(bleed.barLeft - bleed.shellLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(bleed.barRight - bleed.shellRight)).toBeLessThanOrEqual(1);
    expect(bleed.shellLeft).toBeLessThanOrEqual(1);
    expect(
      Math.abs(bleed.shellWidth - bleed.layoutWidth),
    ).toBeLessThanOrEqual(1);
  });

  test("at sm and up it is a single row inset with the catalog column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);

    const searchBox = await box(search(page));
    const firstPill = await box(pills(page).first());
    expect(
      Math.abs(centerY(searchBox) - centerY(firstPill)),
      "one row at 1024px",
    ).toBeLessThanOrEqual(2);

    // `sm:mx-0 sm:px-0` — the bleed is gone, so the bar is narrower than the
    // viewport and starts inside it.
    const inset = await page.evaluate(() => {
      const rect = document
        .querySelector("[data-testid='catalog-header']")!
        .getBoundingClientRect();
      return { left: rect.left, width: rect.width, vw: window.innerWidth };
    });
    expect(inset.left).toBeGreaterThan(1);
    expect(inset.width).toBeLessThan(inset.vw);
  });
});

// ---------------------------------------------------------------------------
// AC3 — the accessible names survive losing the visible label.
// ---------------------------------------------------------------------------

test("AC3 — search keeps id + \"Search subjects\" name via an sr-only label; count keeps aria-live", async ({
  page,
}) => {
  await page.goto("/");

  // getByLabel resolves to the same node as #subject-search.
  await expect(search(page)).toHaveAttribute("id", "subject-search");
  await expect(search(page)).toBeVisible();

  // The label element is still a real <label for>, just visually hidden — the
  // placeholder must not be doing the naming.
  const label = await page.evaluate(() => {
    const el = document.querySelector(
      "label[for='subject-search']",
    ) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      text: (el.textContent ?? "").trim(),
      width: rect.width,
      height: rect.height,
    };
  });
  expect(label, "a real <label for='subject-search'> must remain").not.toBeNull();
  expect(label!.text).toBe("Search subjects");
  expect(
    Math.max(label!.width, label!.height),
    "the label is sr-only, so it must not occupy layout",
  ).toBeLessThanOrEqual(2);

  await expect(counter(page)).toHaveAttribute("aria-live", "polite");
});

// ---------------------------------------------------------------------------
// AC4 — the no-matches state must not unmount the search box.
// ---------------------------------------------------------------------------

test("AC4 — a query that matches nothing keeps the search + count in the sticky bar", async ({
  page,
}) => {
  await page.goto("/");
  await search(page).fill("zzzz-no-such-subject");

  await expect(
    catalog(page).getByText("No subjects match your search."),
  ).toBeVisible();
  await expect(pills(page)).toHaveCount(0);

  // The two controls that are not the pills survive.
  await expect(search(page)).toBeVisible();
  await expect(counter(page)).toBeVisible();
  expect(
    await bar(page).evaluate((el) => getComputedStyle(el).position),
  ).toBe("sticky");

  // Still flush right with the pills gone — `ml-auto`, not "whatever the nav
  // pushed it to".
  expect(
    Math.abs(right(await box(counter(page))) - (await barContentRight(page))),
    "count stays flush right in the empty state",
  ).toBeLessThanOrEqual(1);

  // And it is usable: the query can be cleared from this state.
  await search(page).fill("");
  await expect(subjectChips(page)).toHaveCount(43);
});

// ---------------------------------------------------------------------------
// AC5 + AC8 — the point of the whole card: it all survives a deep scroll.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test(`AC5 — scrolled deep at ${vp.name} ${vp.width}x${vp.height}: search, pills and count all stay pinned, no h-overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(subjectChips(page)).toHaveCount(43);

    const depth = await scrollToLastCategory(page);
    expect(depth, `${vp.name}: the page must actually scroll`).toBeGreaterThan(
      300,
    );

    await expectBarPinnedWithAllThreeControls(page);
    expect(
      await noHorizontalScroll(page),
      `${vp.name}: page must not overflow horizontally`,
    ).toBe(true);

    // The pills, not the page, are what scrolls sideways when they outrun the
    // bar.
    const overflowX = await quickJump(page)
      .locator("ul")
      .evaluate((el) => getComputedStyle(el).overflowX);
    expect(["auto", "scroll"]).toContain(overflowX);
  });
}

test("AC8 — toggling a subject updates the count while the bar is stuck", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(counter(page)).toHaveText("0 selected");

  await scrollToLastCategory(page);
  await expectBarPinnedWithAllThreeControls(page);

  // A chip that is on screen at this depth, so the click cannot re-scroll the
  // page out from under the assertion.
  const visibleChip = subjectChips(page).last();
  await visibleChip.click();
  await expect(counter(page)).toHaveText("1 selected");
  await expectBarPinnedWithAllThreeControls(page);

  await visibleChip.click();
  await expect(counter(page)).toHaveText("0 selected");
  await expectBarPinnedWithAllThreeControls(page);
});

// ---------------------------------------------------------------------------
// AC6 — keyboard order and quick-jump behaviour are unchanged.
// ---------------------------------------------------------------------------

test("AC6 — tab order is search → pills with visible focus rings, and quick-jump still scrolls + focuses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);

  await search(page).focus();
  await expect(search(page)).toBeFocused();
  for (const name of [
    "STEM",
    "Humanities",
    "Languages",
    "Arts",
    "Career Kickstart",
  ]) {
    await page.keyboard.press("Tab");
    await expect(pills(page).filter({ hasText: name }).first()).toBeFocused();
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return {
        outline: `${s.outlineStyle}/${s.outlineWidth}`,
        boxShadow: s.boxShadow,
      };
    });
    expect(
      ring.boxShadow !== "none" || !ring.outline.startsWith("none"),
      `${name}: focused pill must paint a visible indicator (${JSON.stringify(ring)})`,
    ).toBe(true);
  }

  // Quick-jump still scrolls to the section AND lands the heading BELOW the
  // bar rather than behind it (the `scroll-mt` that the taller wrapped bar
  // needed at mobile).
  await pills(page).filter({ hasText: "Arts" }).first().click();
  const heading = catalog(page).getByRole("heading", { name: /^Arts/ });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  const clearance = await page.evaluate(() => {
    const barRect = document
      .querySelector("[data-testid='catalog-header']")!
      .getBoundingClientRect();
    const h = document.activeElement!.getBoundingClientRect();
    return h.top - barRect.bottom;
  });
  expect(
    clearance,
    "the jumped-to heading must land below the sticky bar, not behind it",
  ).toBeGreaterThanOrEqual(0);
});

test("AC6 (mobile) — the wrapped bar still clears the jumped-to heading at 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await pills(page).filter({ hasText: "Career Kickstart" }).first().click();
  const heading = catalog(page).getByRole("heading", {
    name: /^Career Kickstart/,
  });
  await expect(heading).toBeFocused();
  const clearance = await page.evaluate(() => {
    const barRect = document
      .querySelector("[data-testid='catalog-header']")!
      .getBoundingClientRect();
    const h = document.activeElement!.getBoundingClientRect();
    return h.top - barRect.bottom;
  });
  expect(
    clearance,
    "375px: the two-row bar must not cover the jumped-to heading",
  ).toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// Issue #75 interplay — a dialog opened from a scrolled catalog must not move
// the bar. `overflow: clip` (not `hidden`) is what keeps sticky resolving
// against the viewport; this card adds the search box to that sticky box, so
// the regression would now cost the search field too.
// ---------------------------------------------------------------------------

test("#75 interplay — opening the InfoPanel while scrolled leaves the bar pinned", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await scrollToLastCategory(page);
  const before = await box(bar(page));

  const expander = page
    .getByRole("button", { name: /^Show exam dates for / })
    .last();
  await expander.scrollIntoViewIfNeeded();
  await expander.click();
  const details = page.getByRole("button", { name: /^View exam details for / });
  await details.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const during = await box(bar(page));
  expect(
    Math.abs(during.y - before.y),
    `bar moved ${during.y - before.y}px when the dialog opened`,
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await box(bar(page));
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Evidence — the condensed bar, stuck, at the three standard viewports in both
// themes. Captured mid-scroll on purpose: at scrollY 0 the "after" state is
// indistinguishable from the "before" one.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence — sticky header scrolled (${vp.name} ${vp.width}x${vp.height}, ${scheme})`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await page.goto("/");
      await expect(subjectChips(page)).toHaveCount(43);
      await subjectChips(page).first().click();
      await expect(counter(page)).toHaveText("1 selected");
      await scrollToLastCategory(page);
      await expectBarPinnedWithAllThreeControls(page);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}-${scheme}.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}
