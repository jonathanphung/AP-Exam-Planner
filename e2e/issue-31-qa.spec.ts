import { test, expect, type Page } from "@playwright/test";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #31) — mobile: Export + List/Calendar in ONE
 * "My Schedule" toolbar row.
 *
 * One observable browser-level test per acceptance criterion (AC1–AC7 from
 * the PR #36 body). Geometry is asserted with boundingBox math; states with
 * computed styles + a keyboard Tab walk (focus-visible must come from real
 * keyboard focus, not scripted `.focus()`).
 *
 * Key geometry facts under test (builder's design decisions):
 * - One toolbar row below the header at EVERY width and on BOTH views:
 *   segmented List/Calendar switcher leads, Export trails (justify-between).
 * - Control heights (issue #31 pill-slimming bounce): a slim 32px VISIBLE
 *   pill (h-8) on all three controls at EVERY width. On touch viewports
 *   (< sm) a transparent, centered ::before hit-area extends the EFFECTIVE
 *   tap target back to ≥44px (issue #8 AC4) behind the slimmer pill; on sm:+
 *   pointer viewports the 32px height is the target. Tests assert the slim
 *   visible box (boundingBox) AND, on touch, the ≥44px effective tap height.
 * - The switcher pair intentionally shares an edge (-ml-px segmented
 *   control); the ≥8px anti-mis-tap gap applies between the two DISTINCT
 *   controls (switcher group ↔ Export).
 * - Below 360px CSS width the visible Export label shortens to "Export"
 *   (the " to Calendar" span hides); the accessible name stays
 *   "Export to Calendar" via aria-label at every width.
 *
 * Evidence (committed to the issue branch, embedded on the issue/PR):
 * desktop.png / tablet.png / mobile.png at the standard super-board
 * viewports, plus ac4-320-short-label.png (narrow fallback),
 * ac7-list-view-mobile.png (toolbar identical on the List view).
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-31-qa-v1";

const SELECTION_KEY = "apx.selection.v1";
// Non-conflicting selection (same as a11y.spec.ts) so Export is enabled.
const CALM_SELECTION = ["biology", "seminar", "drawing", "cybersecurity"];

const MOBILE = { width: 375, height: 667 } as const;
const NARROW = { width: 320, height: 667 } as const;
const TABLET = { width: 1024, height: 768 } as const;
const DESKTOP = { width: 1920, height: 1080 } as const;

// --------------------------------------------------------------------------
// Locators
// --------------------------------------------------------------------------

const schedule = (page: Page) => page.locator('section[aria-label="My exams"]');
const heading = (page: Page) =>
  schedule(page).getByRole("heading", { level: 2, name: "My Schedule" });
const banner = (page: Page) =>
  schedule(page).getByText(/Dates reflect the .+ AP exam cycle\./);
const switcher = (page: Page) =>
  schedule(page).getByRole("group", { name: "Schedule view" });
const listChip = (page: Page) =>
  switcher(page).getByRole("button", { name: "List" });
const calendarChip = (page: Page) =>
  switcher(page).getByRole("button", { name: "Calendar" });
const exportBtn = (page: Page) => page.getByTestId("export-ics-button");
const exportLabelSuffix = (page: Page) =>
  exportBtn(page).getByText("to Calendar");

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

async function gotoAt(
  page: Page,
  viewport: { width: number; height: number },
  opts: { seed?: boolean } = {},
) {
  if (opts.seed ?? true) await seedSelection(page, CALM_SELECTION);
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(switcher(page)).toBeVisible();
  await expect(exportBtn(page)).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: ReturnType<typeof exportBtn>): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, "control must be laid out (non-null boundingBox)").not.toBeNull();
  return b!;
}

const SLIM_PILL_PX = 32; // h-8 visible pill height (issue #31 slimming bounce)
const TAP_FLOOR_PX = 44; // issue #8 AC4 effective touch tap-target floor

/**
 * Effective vertical tap target for a slimmed pill: the taller of the visible
 * border box and the centered `::before` hit-area pseudo that (on touch
 * viewports) extends touch reach behind the 32px pill. On sm:+ the pseudo has
 * no generated content, so this collapses to the visible box height.
 */
async function effectiveTapHeight(
  locator: ReturnType<typeof exportBtn>,
): Promise<number> {
  return locator.evaluate((el) => {
    const own = el.getBoundingClientRect().height;
    const before = parseFloat(getComputedStyle(el, "::before").height);
    return Number.isFinite(before) ? Math.max(own, before) : own;
  });
}

/** All three toolbar control boxes, left-to-right: List, Calendar, Export. */
async function toolbarBoxes(page: Page) {
  return {
    list: await box(listChip(page)),
    calendar: await box(calendarChip(page)),
    export: await box(exportBtn(page)),
  };
}

/**
 * Document-space toolbar boxes (getBoundingClientRect + scroll offset).
 * Playwright's boundingBox() is viewport-relative, so any interaction that
 * auto-scrolls (e.g. the AC7 view-switch click) would shift every `y` even
 * though nothing moved in the layout. Document space is scroll-invariant.
 */
async function toolbarDocBoxes(page: Page) {
  return page.evaluate(() => {
    const grab = (el: Element | null) => {
      if (!el) throw new Error("toolbar control missing from the DOM");
      const r = (el as HTMLElement).getBoundingClientRect();
      return {
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        width: r.width,
        height: r.height,
      };
    };
    const group = document.querySelector(
      '[role="group"][aria-label="Schedule view"]',
    )!;
    const [list, calendar] = Array.from(group.querySelectorAll("button"));
    return {
      list: grab(list),
      calendar: grab(calendar),
      export: grab(document.querySelector('[data-testid="export-ics-button"]')),
    };
  });
}

/** Vertical overlap in px between two boxes (row membership test). */
function verticalOverlap(a: Box, b: Box): number {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

/** Assert a and b sit on ONE row: ≥80% of the shorter box overlaps. */
function expectSameRow(a: Box, b: Box, what: string) {
  const overlap = verticalOverlap(a, b);
  const bar = 0.8 * Math.min(a.height, b.height);
  expect(
    overlap,
    `${what}: expected one-row vertical overlap ≥${bar.toFixed(1)}px, got ${overlap.toFixed(1)}px (a.y=${a.y}, b.y=${b.y})`,
  ).toBeGreaterThanOrEqual(bar);
}

/** No page-level horizontal scroll (AC4 / AC6). */
async function expectNoHorizontalScroll(page: Page, what: string) {
  const m = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    m.scrollWidth,
    `${what}: page must not scroll horizontally (scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth})`,
  ).toBeLessThanOrEqual(m.clientWidth);
}

/** Assert the full one-row toolbar contract at the current viewport. */
async function expectOneRowToolbar(page: Page, expectedHeight: number, what: string) {
  const boxes = await toolbarBoxes(page);

  // One row: all three controls share a vertical band.
  expectSameRow(boxes.list, boxes.calendar, `${what} (List↔Calendar)`);
  expectSameRow(boxes.calendar, boxes.export, `${what} (Calendar↔Export)`);
  expectSameRow(boxes.list, boxes.export, `${what} (List↔Export)`);

  // Consistent control heights (AC2/AC6) — all equal to the per-width spec.
  for (const [name, b] of Object.entries(boxes)) {
    expect(
      Math.abs(b.height - expectedHeight),
      `${what}: ${name} height ${b.height}px must be ${expectedHeight}px (±1)`,
    ).toBeLessThanOrEqual(1);
  }

  // Toolbar sits BELOW the header (heading + banner never share the row).
  const head = await box(heading(page));
  const ban = await box(banner(page));
  const toolbarTop = Math.min(boxes.list.y, boxes.export.y);
  expect(
    head.y + head.height,
    `${what}: heading must end above the toolbar row`,
  ).toBeLessThanOrEqual(toolbarTop + 1);
  expect(
    ban.y + ban.height,
    `${what}: cycle banner (informational) must end above the control row`,
  ).toBeLessThanOrEqual(toolbarTop + 1);

  // Switcher is a true segmented pair: Calendar starts at List's right edge
  // (-ml-px border collapse → gap ∈ [-2, 1]px).
  const seam = boxes.calendar.x - (boxes.list.x + boxes.list.width);
  expect(
    seam,
    `${what}: List/Calendar must share a segmented edge (seam ${seam.toFixed(1)}px)`,
  ).toBeLessThanOrEqual(1);
  expect(seam).toBeGreaterThanOrEqual(-2);

  // ≥8px gap between the two distinct controls: switcher group ↔ Export.
  const gap = boxes.export.x - (boxes.calendar.x + boxes.calendar.width);
  expect(
    gap,
    `${what}: switcher↔Export gap ${gap.toFixed(1)}px must be ≥8px (mis-tap bar)`,
  ).toBeGreaterThanOrEqual(8);

  return boxes;
}

// --------------------------------------------------------------------------
// AC1 — one row below the header on mobile; banner stays informational
// --------------------------------------------------------------------------

test("AC1 — 375px: Export, List, Calendar sit on ONE row below the My Schedule header; cycle banner keeps its own line", async ({
  page,
}) => {
  await gotoAt(page, MOBILE);
  await expectOneRowToolbar(page, SLIM_PILL_PX, "AC1 mobile");

  // The banner shares no vertical band with any control (it is not a control).
  const ban = await box(banner(page));
  const boxes = await toolbarBoxes(page);
  for (const [name, b] of Object.entries(boxes)) {
    expect(
      verticalOverlap(ban, b),
      `AC1: banner must not share the control row with ${name}`,
    ).toBeLessThanOrEqual(0);
  }

  await page.screenshot({ path: `${EVIDENCE_DIR}/mobile.png`, fullPage: true });
});

// --------------------------------------------------------------------------
// AC2 — reads as one toolbar: heights, segmented grouping, Export distinct
// --------------------------------------------------------------------------

test("AC2 — 375px: segmented switcher endcaps + filled Export visually distinct from outline chips", async ({
  page,
}) => {
  await gotoAt(page, MOBILE);

  // Segmented endcaps: List rounds only its left side, Calendar only its
  // right, so the pair reads as ONE grouped control.
  const radii = await page.evaluate(() => {
    const group = document.querySelector<HTMLElement>(
      '[role="group"][aria-label="Schedule view"]',
    )!;
    const [list, calendar] = Array.from(group.querySelectorAll("button"));
    const r = (el: Element) => {
      const s = getComputedStyle(el);
      return {
        topLeft: parseFloat(s.borderTopLeftRadius),
        topRight: parseFloat(s.borderTopRightRadius),
      };
    };
    return { list: r(list), calendar: r(calendar) };
  });
  expect(radii.list.topLeft, "List left endcap must be rounded").toBeGreaterThan(8);
  expect(radii.list.topRight, "List right edge must be square (shared seam)").toBe(0);
  expect(radii.calendar.topLeft, "Calendar left edge must be square (shared seam)").toBe(0);
  expect(radii.calendar.topRight, "Calendar right endcap must be rounded").toBeGreaterThan(8);

  // Export (enabled, primary) is filled; the inactive chip is outline-style —
  // their backgrounds must differ, and active vs inactive chips must differ.
  await expect(exportBtn(page)).toBeEnabled();
  const bg = async (sel: string) =>
    page.evaluate(
      (s) => getComputedStyle(document.querySelector(s)!).backgroundColor,
      sel,
    );
  const exportBg = await bg('[data-testid="export-ics-button"]');
  const chips = switcher(page).getByRole("button");
  const activeBg = await calendarChip(page).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const inactiveBg = await listChip(page).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(await chips.count()).toBe(2);
  expect(exportBg, "filled Export must differ from the outline chip").not.toBe(
    inactiveBg,
  );
  expect(activeBg, "active chip must differ from inactive chip").not.toBe(
    inactiveBg,
  );
});

// --------------------------------------------------------------------------
// AC3 — slim 32px visible pills, ≥44px EFFECTIVE tap target (via the centered
//        ::before hit-area) and ≥8px control spacing on touch viewports
// --------------------------------------------------------------------------

for (const vp of [MOBILE, NARROW]) {
  test(`AC3 — ${vp.width}px: slim ${SLIM_PILL_PX}px pills with ≥${TAP_FLOOR_PX}px effective tap targets, ≥8px switcher↔Export gap`, async ({
    page,
  }) => {
    await gotoAt(page, vp);
    // Visible pills are slim (32px, asserted here) — Jon's pill-slimming bounce.
    await expectOneRowToolbar(page, SLIM_PILL_PX, `AC3 @${vp.width}`);

    // …but the EFFECTIVE touch tap target stays ≥44×44px: width from the
    // visible box, height from the centered ::before hit-area behind the pill.
    const controls = [
      ["list", listChip(page)],
      ["calendar", calendarChip(page)],
      ["export", exportBtn(page)],
    ] as const;
    for (const [name, locator] of controls) {
      const b = await box(locator);
      expect(
        b.width,
        `${name} tap width @${vp.width}px`,
      ).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
      const tapHeight = await effectiveTapHeight(locator);
      expect(
        tapHeight,
        `${name} effective tap height @${vp.width}px (visible ${b.height}px pill + ::before hit-area) must be ≥${TAP_FLOOR_PX}px`,
      ).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
    }
  });
}

// --------------------------------------------------------------------------
// AC4 — fits at 375px; degrades to ~320px by shortening the Export label
// --------------------------------------------------------------------------

test("AC4 — 375px & 360px: full 'Export to Calendar' label, one row, no page h-scroll", async ({
  page,
}) => {
  await gotoAt(page, MOBILE);
  await expectNoHorizontalScroll(page, "AC4 @375");
  await expect(exportLabelSuffix(page)).toBeVisible(); // full label
  await expectOneRowToolbar(page, SLIM_PILL_PX, "AC4 @375");

  // Breakpoint boundary: 360px CSS width still shows the full label.
  await page.setViewportSize({ width: 360, height: 667 });
  await expect(exportLabelSuffix(page)).toBeVisible();
  await expectNoHorizontalScroll(page, "AC4 @360");
  await expectOneRowToolbar(page, SLIM_PILL_PX, "AC4 @360");
});

test("AC4 — 320px: Export label shortens to 'Export' (never stacks), one row, no page h-scroll", async ({
  page,
}) => {
  await gotoAt(page, NARROW);
  await expectNoHorizontalScroll(page, "AC4 @320");
  // Below the 360px breakpoint the visible label drops " to Calendar"…
  await expect(exportLabelSuffix(page)).toBeHidden();
  await expect(exportBtn(page)).toContainText("Export");
  // …but the toolbar still reads as ONE row (no re-stacking).
  await expectOneRowToolbar(page, SLIM_PILL_PX, "AC4 @320");
  // Accessible name survives the shortened visible label (WCAG 2.5.3).
  await expect(exportBtn(page)).toHaveAccessibleName("Export to Calendar");

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac4-320-short-label.png`,
    fullPage: true,
  });
});

// --------------------------------------------------------------------------
// AC5 — states: aria-pressed semantics, focus-visible via real keyboard
//        focus, hover differentiation, accessible name at every width
// --------------------------------------------------------------------------

test("AC5 — switcher keeps aria-pressed semantics; hover state distinguishable", async ({
  page,
}) => {
  await gotoAt(page, MOBILE);

  // Selected state exposed programmatically (calendar is the default view).
  await expect(calendarChip(page)).toHaveAttribute("aria-pressed", "true");
  await expect(listChip(page)).toHaveAttribute("aria-pressed", "false");
  await pressViewChip(page, "List");
  await expect(listChip(page)).toHaveAttribute("aria-pressed", "true");
  await expect(calendarChip(page)).toHaveAttribute("aria-pressed", "false");

  // Hover on the (now inactive) Calendar chip changes its background.
  const before = await calendarChip(page).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await calendarChip(page).hover();
  await expect
    .poll(
      () =>
        calendarChip(page).evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        ),
      { message: "AC5: hover must change the inactive chip background" },
    )
    .not.toBe(before);
});

test("AC5 — keyboard focus reaches List → Calendar → Export in visual order, each with a visible focus indicator", async ({
  page,
}) => {
  await gotoAt(page, MOBILE); // seeded → Export enabled → tabbable

  // Filter the catalog to ONE chip (a11y.spec.ts pattern) so the tab walk to
  // the schedule toolbar is short and deterministic. "AP Biology" is in the
  // seeded selection, so Export stays enabled.
  await page.getByLabel("Search subjects").fill("AP Biology");
  await expect(
    page.locator(
      'section[aria-label="Subject catalog"] ul > li button[aria-pressed]',
    ),
  ).toHaveCount(1);

  const descriptor = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { name: "body", indicator: false };
      const s = getComputedStyle(el);
      const hasOutline = s.outlineStyle !== "none" && s.outlineWidth !== "0px";
      const hasRing = s.boxShadow !== "none";
      return {
        name:
          el.getAttribute("data-testid") ??
          (el.textContent ?? "").trim().slice(0, 20),
        pressed: el.hasAttribute("aria-pressed"),
        indicator: hasOutline || hasRing,
      };
    });

  // Tab from the (focused) search input until the List chip takes focus —
  // bounded walk: search → quick-jump chip → chip toggle → disclosure → List.
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    await page.keyboard.press("Tab");
    const d = await descriptor();
    if (d.name === "List" && d.pressed) found = true;
  }
  expect(found, "keyboard focus must reach the List chip").toBe(true);
  expect((await descriptor()).indicator, "List chip focus indicator").toBe(true);

  // Visual order is List → Calendar → Export, so tab order must match.
  await page.keyboard.press("Tab");
  let d = await descriptor();
  expect(d.name, "next stop after List must be Calendar").toBe("Calendar");
  expect(d.indicator, "Calendar chip focus indicator").toBe(true);

  await page.keyboard.press("Tab");
  d = await descriptor();
  expect(d.name, "next stop after Calendar must be Export").toBe(
    "export-ics-button",
  );
  expect(d.indicator, "Export focus indicator").toBe(true);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac5-focus-export-mobile.png`,
    fullPage: false,
  });
});

// --------------------------------------------------------------------------
// AC6 — desktop/tablet not regressed: one coherent slim 32px row, no h-scroll
//        (sm:+ pointer viewports: the slim pill height is the target — no
//        ::before hit-area, matching the design decision)
// --------------------------------------------------------------------------

const SM_PLUS = [
  { name: "tablet-768", width: 768, height: 1024, shot: null },
  { name: "tablet-1024", ...TABLET, shot: "tablet.png" },
  { name: "desktop-1920", ...DESKTOP, shot: "desktop.png" },
] as const;

for (const vp of SM_PLUS) {
  test(`AC6 — ${vp.width}px: one-row toolbar at slim ${SLIM_PILL_PX}px control height, no h-scroll`, async ({
    page,
  }) => {
    await gotoAt(page, { width: vp.width, height: vp.height });
    await expectNoHorizontalScroll(page, `AC6 @${vp.width}`);
    await expectOneRowToolbar(page, SLIM_PILL_PX, `AC6 @${vp.width}`);
    await expect(exportLabelSuffix(page)).toBeVisible(); // full label at sm:+
    if (vp.shot) {
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.shot}`,
        fullPage: true,
      });
    }
  });
}

// --------------------------------------------------------------------------
// AC7 — identical toolbar on both views: zero geometry drift on view switch
// --------------------------------------------------------------------------

for (const vp of [MOBILE, DESKTOP]) {
  test(`AC7 — ${vp.width}px: toolbar geometry identical between Calendar and List views`, async ({
    page,
  }) => {
    await gotoAt(page, vp);

    const before = await toolbarDocBoxes(page); // calendar (default view)
    await pressViewChip(page, "List");
    await expect(
      page.locator('section[aria-label="My schedule"]'),
    ).toBeVisible();
    const after = await toolbarDocBoxes(page);

    for (const key of ["list", "calendar", "export"] as const) {
      for (const dim of ["x", "y", "width", "height"] as const) {
        expect(
          Math.abs(after[key][dim] - before[key][dim]),
          `AC7 @${vp.width}: ${key}.${dim} must not move on view switch ` +
            `(calendar=${before[key][dim]}, list=${after[key][dim]})`,
        ).toBeLessThanOrEqual(1);
      }
    }

    if (vp.width === MOBILE.width) {
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac7-list-view-mobile.png`,
        fullPage: true,
      });
    }
  });
}
