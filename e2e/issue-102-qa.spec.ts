import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";

/**
 * Issue #102 — QA pass v1 (super-board Tester lane).
 *
 * `issue-102-sticky-header.spec.ts` (Builder) already pins the bar's shape:
 * chrome, DOM ownership, one-row-at-`sm` geometry, the count flush right, the
 * no-match state, the deep-scroll survival, tab order, and the #75 dialog
 * interplay. This file deliberately does NOT re-assert any of that. It attacks
 * the four things the Builder's suite leaves unexercised:
 *
 * 1. **The user story, not the geometry.** Every Builder assertion about the
 *    scrolled bar measures rectangles. None of them ever *uses* the search box
 *    from a scrolled position — which is the entire reason the card exists.
 *    `filtering works from a deep scroll` types into the stuck input and
 *    checks the catalog actually narrows.
 * 2. **The `sm` boundary, 639/640px.** `CategorySection` now swaps
 *    `scroll-mt-32` → `sm:scroll-mt-20` at exactly the width where the bar
 *    collapses 113px → 61px. The Builder tests 375 and 1280 — both sides of
 *    the switch, neither adjacent to it. An off-by-one in the breakpoint pair
 *    lives at 639/640 and nowhere else.
 * 3. **The bar must be opaque enough to be a bar.** Chips now scroll *under*
 *    the search field, not just under the pills. `bg-white/95` + `blur` is the
 *    only thing between a scrolling chip and unreadable overlap.
 * 4. **axe in the states the change created.** `a11y.spec.ts` scans at
 *    scrollY 0 and never sees the sr-only label, the stuck bar, or the
 *    no-match state that now keeps rendering controls.
 *
 * Evidence: `docs/super-board/runs/issue-102-qa-v1/`.
 */

const EVIDENCE_DIR = evidenceDir("issue-102-qa-v1");

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const bar = (page: Page) => page.getByTestId("catalog-header");
const quickJump = (page: Page) =>
  catalog(page).getByRole("navigation", { name: "Jump to category" });
const pills = (page: Page) => quickJump(page).getByRole("button");
const counter = (page: Page) => page.getByText(/^\d+ selected$/);
const subjectChips = (page: Page) =>
  catalog(page).locator("ul > li button[aria-pressed]");

/** Scroll until the last category sits near the top — the bar is stuck here. */
async function scrollDeep(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sections = document.querySelectorAll(
      'section[aria-label="Subject catalog"] section',
    );
    const last = sections[sections.length - 1];
    if (!last) return window.scrollY;
    window.scrollTo(0, window.scrollY + last.getBoundingClientRect().top - 180);
    return window.scrollY;
  });
}

const barRect = (page: Page) =>
  bar(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });

async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const done = Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  });
}

async function expectNoSeriousViolations(page: Page, state: string) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    severe,
    `axe (${state}): expected zero serious/critical violations, got:\n` +
      JSON.stringify(
        severe.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
        })),
        null,
        2,
      ),
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// 1. The point of the card: the search box is USABLE from a deep scroll.
// ---------------------------------------------------------------------------

for (const vp of [
  { name: "mobile", width: 375, height: 667 },
  { name: "desktop", width: 1920, height: 1080 },
] as const) {
  test(`the stuck search box actually filters from a deep scroll (${vp.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(subjectChips(page)).toHaveCount(43);

    const depth = await scrollDeep(page);
    expect(depth, "the page must actually be scrolled").toBeGreaterThan(300);
    const stuck = await barRect(page);
    expect(
      Math.abs(stuck.top),
      `bar must be pinned before we touch it (top=${stuck.top})`,
    ).toBeLessThanOrEqual(1);

    // Reach the field the way a user does — click what is painted at the top
    // of the screen — rather than calling .focus() on a node that might be
    // scrolled out of reach.
    const searchbox = page.getByRole("searchbox", { name: "Search subjects" });
    await searchbox.click();
    await expect(searchbox).toBeFocused();
    await searchbox.pressSequentially("biolog", { delay: 15 });

    await expect(subjectChips(page)).toHaveCount(1);
    await expect(subjectChips(page).first()).toContainText("Biology");

    // The bar (and the field inside it) is still fully on screen after the
    // document shrank to one result. It is NOT asserted to be pinned at y=0
    // here: one result is shorter than the viewport at desktop, so the page
    // scrolls back to the top and sticky legitimately releases — the bar
    // returns to its natural offset. What must hold is that it never leaves
    // the screen and the field stays live.
    const rect = await barRect(page);
    expect(rect.top, `bar pushed off the top (top=${rect.top})`).toBeGreaterThanOrEqual(-1);
    await expect(bar(page)).toBeInViewport();
    await expect(searchbox).toBeInViewport();
    await expect(searchbox).toBeFocused();
    await expect(searchbox).toHaveValue("biolog");

    // …and clearing it from that same position restores the full catalog.
    await searchbox.fill("");
    await expect(subjectChips(page)).toHaveCount(43);
  });
}

test("the count keeps its VALUE (not just its position) through the no-match state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await subjectChips(page).nth(0).click();
  await subjectChips(page).nth(1).click();
  await expect(counter(page)).toHaveText("2 selected");

  const searchbox = page.getByRole("searchbox", { name: "Search subjects" });
  await searchbox.fill("zzzz-no-such-subject");
  await expect(catalog(page).getByText("No subjects match your search.")).toBeVisible();
  await expect(pills(page)).toHaveCount(0);
  // The counter is the only live region left in the bar; it must not reset or
  // unmount just because the filtered list is empty.
  await expect(counter(page)).toHaveText("2 selected");
  await expect(counter(page)).toHaveAttribute("aria-live", "polite");

  await searchbox.fill("");
  await expect(counter(page)).toHaveText("2 selected");
});

// ---------------------------------------------------------------------------
// 2. The `sm` boundary — where the bar height and the heading's scroll-margin
//    swap at the same breakpoint. 639 must clear a 113px bar with
//    `scroll-mt-32`; 640 must clear a 61px bar with `sm:scroll-mt-20`.
// ---------------------------------------------------------------------------

for (const width of [320, 639, 640, 641] as const) {
  test(`quick-jump clears the bar at the sm boundary (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);

    for (const category of ["Humanities", "Arts", "Career Kickstart"]) {
      await pills(page).filter({ hasText: category }).first().click();
      const heading = catalog(page).getByRole("heading", {
        name: new RegExp(`^${category}`),
      });
      await expect(heading).toBeFocused();
      const clearance = await page.evaluate(() => {
        const b = document
          .querySelector("[data-testid='catalog-header']")!
          .getBoundingClientRect();
        return document.activeElement!.getBoundingClientRect().top - b.bottom;
      });
      expect(
        clearance,
        `${width}px → "${category}": heading sits ${clearance}px relative to the bar's bottom edge; a negative value means the bar covers it`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
}

// ---------------------------------------------------------------------------
// 3. The bar has to read as a bar: opaque enough that chips passing underneath
//    do not show through the search field, in both themes.
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test(`chips scroll UNDER an opaque bar (${scheme})`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(subjectChips(page)).toHaveCount(43);
    await scrollDeep(page);

    const paint = await page.evaluate(() => {
      const el = document.querySelector(
        "[data-testid='catalog-header']",
      ) as HTMLElement;
      const s = getComputedStyle(el);
      const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(",").map((n) => parseFloat(n)) : [];
      const b = el.getBoundingClientRect();
      // Is anything from the catalog list actually sitting behind the bar?
      const behind = [
        ...document.querySelectorAll(
          "section[aria-label='Subject catalog'] ul > li",
        ),
      ].some((li) => {
        const r = li.getBoundingClientRect();
        return r.top < b.bottom && r.bottom > b.top;
      });
      return {
        alpha: parts.length === 4 ? parts[3] : 1,
        backdrop: s.backdropFilter || s.webkitBackdropFilter,
        zIndex: s.zIndex,
        behind,
      };
    });

    expect(
      paint.behind,
      "the scroll position must actually put catalog content behind the bar, or this test proves nothing",
    ).toBe(true);
    expect(
      paint.alpha,
      `${scheme}: bar background is only ${paint.alpha} opaque — content underneath will read through`,
    ).toBeGreaterThanOrEqual(0.9);
    expect(paint.backdrop).toContain("blur");
    expect(Number(paint.zIndex)).toBeGreaterThanOrEqual(30);

    await ctx.close();
  });
}

test("the right-pinned count never overlaps the pill list it sits next to", async ({
  page,
}) => {
  // At 375px the pill list is clipped mid-word by its own `overflow-x` right
  // where the count begins, so "flush right" and "on top of the pills" look
  // similar in a screenshot. Measure it: the count must clear the nav's box
  // by the bar's `gap-x-3`, at the width where the two are closest together.
  for (const width of [375, 640, 1920]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await expect(pills(page)).toHaveCount(5);

    const gap = await page.evaluate(() => {
      const nav = document
        .querySelector("nav[aria-label='Jump to category']")!
        .getBoundingClientRect();
      const count = [...document.querySelectorAll("p")]
        .find((p) => /^\d+ selected$/.test((p.textContent ?? "").trim()))!
        .getBoundingClientRect();
      return { navRight: nav.right, countLeft: count.left, delta: count.left - nav.right };
    });
    expect(
      gap.delta,
      `${width}px: the count's left edge (${gap.countLeft}) must sit clear of the pill list's right edge (${gap.navRight})`,
    ).toBeGreaterThanOrEqual(8);
  }
});

test("the pills — not the page — are what moves when the categories outrun the bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(pills(page)).toHaveCount(5);

  const list = quickJump(page).locator("ul");
  const overflows = await list.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(
    overflows,
    "at 375px the five category pills must overflow their list, or there is nothing to scroll",
  ).toBe(true);

  await list.evaluate((el) => el.scrollTo({ left: 9999 }));
  const after = await page.evaluate(() => {
    const el = document.querySelector(
      "nav[aria-label='Jump to category'] ul",
    ) as HTMLElement;
    return {
      listScrollLeft: el.scrollLeft,
      pageScrollX: window.scrollX,
      docOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(after.listScrollLeft).toBeGreaterThan(0);
  expect(after.pageScrollX, "the PAGE must not scroll sideways").toBe(0);
  expect(after.docOverflow, "no horizontal page overflow").toBeLessThanOrEqual(1);

  // The last pill is reachable by scrolling the list, and still jumps.
  await pills(page).last().click();
  await expect(
    catalog(page).getByRole("heading", { name: /^Career Kickstart/ }),
  ).toBeFocused();
});

// ---------------------------------------------------------------------------
// 4. axe in the two states this card invented: bar stuck mid-scroll, and the
//    no-match state that now keeps the search + count mounted.
// ---------------------------------------------------------------------------

test("axe — the stuck bar and the no-match bar are both clean", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(subjectChips(page)).toHaveCount(43);

  await scrollDeep(page);
  await expectNoSeriousViolations(page, "375px, bar stuck mid-scroll");

  await page.getByRole("searchbox", { name: "Search subjects" }).fill("zzzz");
  await expect(catalog(page).getByText("No subjects match your search.")).toBeVisible();
  await expectNoSeriousViolations(page, "375px, no-match state");
});

test("the sr-only label still names the field by ROLE, and nothing else claims that name", async ({
  page,
}) => {
  await page.goto("/");
  // Resolved by accessible name through the role API — the strict-mode count
  // check also proves the placeholder is not producing a second match.
  const byRole = page.getByRole("searchbox", { name: "Search subjects" });
  await expect(byRole).toHaveCount(1);
  await expect(byRole).toHaveAttribute("id", "subject-search");
  await expect(byRole).toBeVisible();
});

// ---------------------------------------------------------------------------
// Evidence — the stuck bar with a live selection, three viewports, both themes.
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
      await expect(subjectChips(page)).toHaveCount(43);
      await subjectChips(page).nth(0).click();
      await subjectChips(page).nth(1).click();
      await expect(counter(page)).toHaveText("2 selected");
      await scrollDeep(page);

      const rect = await barRect(page);
      expect(Math.abs(rect.top)).toBeLessThanOrEqual(1);
      await expect(
        page.getByRole("searchbox", { name: "Search subjects" }),
      ).toBeInViewport();
      await expect(pills(page).first()).toBeInViewport();
      await expect(counter(page)).toBeInViewport();

      const suffix = scheme === "light" ? "" : "-dark";
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}${suffix}.png`,
        caret: "initial",
      });
      await ctx.close();
    });
  }
}

/**
 * Follow-up, NOT a #102 defect (documented here so the finding is not lost):
 *
 * `SubjectChip`'s `<li>` carries `scroll-mt-20`, but the focusable element is
 * the `<button>` inside it, so focus-driven scrolling never sees that margin.
 * Walking BACKWARDS through the catalog with Shift+Tab at 375px therefore
 * parks the focused chip at viewport y=0 — behind the sticky bar. Measured on
 * `main` (61px bar) and on this branch (113px bar): the defect predates #102,
 * which only changes how much of the chip is covered. Not an AC of this card
 * and not introduced by it; filed in the QA handoff comment instead of bounced.
 */
