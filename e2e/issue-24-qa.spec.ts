import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * super-board QA (issue #24) — desktop catalog grouped by category by default,
 * converging on the mobile IA from #22.
 *
 * One observable browser-level assertion per acceptance criterion (AC1–AC7
 * from the PR body), plus AC8 — Jon's human bounce on PR #32:
 *
 *   "when you expand a card it shouldn't expand horizontally, only
 *    vertically. location of arrow to unexpand/expand shouldn't change."
 *
 * AC8 is verified with boundingBox geometry at 375 / 768 / 1024 / 1920:
 *   - the card's width and left edge are IDENTICAL collapsed vs expanded
 *     (vertical-only growth, no column-spanning, no width jump);
 *   - same-row neighbors do not move or resize (no horizontal reflow;
 *     rows below shifting down is allowed);
 *   - the expand/collapse chevron's boundingBox is IDENTICAL across
 *     collapsed → expanded → re-collapsed, so both clicks hit the same spot;
 *   - the card's computed grid-column does not change with disclosure state.
 *
 * Evidence (committed to the issue branch, embedded on the issue/PR):
 *   - desktop.png / tablet.png / mobile.png — standard super-board viewports;
 *   - geometry-<width>-collapsed.png / geometry-<width>-expanded.png — the
 *     SAME card in both states at each of the four bounce viewports.
 *
 * Category counts pinned by `pnpm test:data`: STEM 13, Humanities 14,
 * Languages 8, Arts 5, Career Kickstart 2 → 42 subjects.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-24-qa-v1";

const CANONICAL_ORDER = [
  "STEM",
  "Humanities",
  "Languages",
  "Arts",
  "Career Kickstart",
] as const;

const CATEGORY_COUNTS: readonly { name: string; count: number }[] = [
  { name: "STEM", count: 13 },
  { name: "Humanities", count: 14 },
  { name: "Languages", count: 8 },
  { name: "Arts", count: 5 },
  { name: "Career Kickstart", count: 2 },
];
const TOTAL_SUBJECTS = 42;

const DESKTOP = { width: 1920, height: 1080 } as const;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const quickJump = (page: Page) =>
  catalog(page).getByRole("navigation", { name: "Jump to category" });
const sectionRegion = (page: Page, name: string) =>
  catalog(page).getByRole("region", { name: new RegExp(`^${name}`) });
const sectionHeading = (page: Page, name: string) =>
  catalog(page).getByRole("heading", { level: 2, name: new RegExp(`^${name}`) });
const chip = (page: Page, name: string) =>
  catalog(page)
    .locator("li")
    .filter({
      has: page.getByRole("button", { name: `Show exam dates for ${name}` }),
    })
    .locator("button[aria-pressed]");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const detailsButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
const dialog = (page: Page) => page.getByRole("dialog");
const selectedCount = (page: Page) => page.getByText(/^\d+ selected$/);

const gotoDesktop = async (page: Page) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(quickJump(page)).toBeVisible();
};

const gridColumnCount = (list: Locator) =>
  list.evaluate(
    (el) =>
      getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean)
        .length,
  );

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

test.describe("issue #24 — desktop catalog grouped by category by default", () => {
  test("AC1 — desktop renders labeled category sections by default, not a flat grid", async ({
    page,
  }) => {
    await gotoDesktop(page);

    // Five labeled section landmarks with real headings and full counts —
    // the grouped IA is the DEFAULT (no toggle was pressed to get here).
    for (const { name, count } of CATEGORY_COUNTS) {
      await expect(sectionRegion(page, name)).toHaveCount(1);
      await expect(sectionHeading(page, name)).toBeVisible();
      await expect(
        sectionRegion(page, name).locator("button[aria-pressed]"),
      ).toHaveCount(count);
    }
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(
      TOTAL_SUBJECTS,
    );

    // Not one ungrouped grid: no subject chip lives outside a named
    // category section landmark.
    await expect(
      catalog(page).locator(
        "xpath=.//button[@aria-pressed and not(ancestor::section[@aria-labelledby])]",
      ),
    ).toHaveCount(0);
  });

  test("AC2 — sections are multi-column on desktop (more columns than mobile), same chip components", async ({
    page,
  }) => {
    await gotoDesktop(page);
    const stemList = sectionRegion(page, "STEM").locator("ul");

    // 3 columns at 1920 (xl), 2 at 1024 (sm+), 1 on mobile — desktop uses
    // the width, mobile stays a single column of the same cards.
    expect(await gridColumnCount(stemList)).toBe(3);

    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await gridColumnCount(stemList)).toBe(2);

    await page.setViewportSize({ width: 375, height: 667 });
    expect(await gridColumnCount(stemList)).toBe(1);

    // Visual/behavioral consistency: the identical chip structure (select
    // toggle + expand affordance) renders at every width — one shared DOM.
    await page.setViewportSize(DESKTOP);
    const firstChipLi = stemList.locator("li").first();
    await expect(firstChipLi.locator("button[aria-pressed]")).toHaveCount(1);
    await expect(firstChipLi.locator("button[aria-expanded]")).toHaveCount(1);
  });

  test("AC3 — search filters within/across groups; retired filter is now the quick-jump nav", async ({
    page,
  }) => {
    await gotoDesktop(page);

    // Design decision (documented in the PR): the #3 category filter group is
    // retired — the sticky quick-jump nav takes its place on desktop too.
    await expect(
      page.getByRole("group", { name: "Filter by category" }),
    ).toHaveCount(0);
    const navPosition = await quickJump(page).evaluate(
      (el) => getComputedStyle(el).position,
    );
    expect(navPosition).toBe("sticky");

    // Quick-jump works at desktop width: one click reaches a lower section,
    // moving focus to its heading.
    await quickJump(page).getByRole("button", { name: "Arts" }).click();
    await expect(sectionHeading(page, "Arts")).toBeFocused();
    await expect(sectionHeading(page, "Arts")).toBeInViewport();

    // Search filters across groups: "calc" leaves only the three STEM calc*
    // subjects; other sections and their quick-jump chips drop out.
    const search = page.getByLabel("Search subjects");
    await search.fill("calc");
    await expect(sectionHeading(page, "STEM")).toBeVisible();
    for (const { name } of CATEGORY_COUNTS.slice(1)) {
      await expect(sectionHeading(page, name)).toHaveCount(0);
    }
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(3);
    await expect(quickJump(page).getByRole("button")).toHaveCount(1);

    // No matches → empty state; clearing restores all 42.
    await search.fill("zzzz-no-such-subject");
    await expect(
      catalog(page).getByText("No subjects match your search."),
    ).toBeVisible();
    await search.fill("");
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(
      TOTAL_SUBJECTS,
    );
  });

  test("AC4 — chip click toggles the shared useSelection store; grouping changes no semantics", async ({
    page,
  }) => {
    await gotoDesktop(page);

    const bio = chip(page, "AP Biology");
    await bio.scrollIntoViewIfNeeded();
    await expect(bio).toHaveAttribute("aria-pressed", "false");

    // Select → count updates and the schedule surface (same store) lists it.
    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "true");
    await expect(selectedCount(page)).toHaveText("1 selected");
    await expect(
      page.locator("main").getByText("AP Biology").last(),
    ).toBeVisible();

    // Expanding is presentation-only — selection state is untouched.
    await expandButton(page, "AP Biology").click();
    await expect(bio).toHaveAttribute("aria-pressed", "true");
    await expect(selectedCount(page)).toHaveText("1 selected");
    await expandButton(page, "AP Biology").click();

    // Deselect returns to zero.
    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "false");
    await expect(selectedCount(page)).toHaveText("0 selected");
  });

  test("AC5 — desktop reuses #22's disclosure: Tier-1 timing → Tier-2 InfoPanel → Tier-3 CB link", async ({
    page,
  }) => {
    await gotoDesktop(page);

    // Tier 1: expand reveals the timing block with the published times.
    const expand = expandButton(page, "AP Biology");
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    const bioLi = catalog(page).locator("li").filter({ has: expand });
    await expect(bioLi.locator("dl")).toContainText(
      "Mon, May 4 · AM (8 a.m. local time)",
    );
    await expect(bioLi.locator("dl")).toContainText(
      "Wed, May 20 · PM (12 p.m. local time)",
    );

    // Tier 2: the same shared InfoPanel dialog as #6/#22.
    await detailsButton(page, "AP Biology").click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("AP Biology");
    await expect(panel).toContainText("Pass rate");

    // Tier 3: the verified official College Board link.
    await expect(
      panel.getByRole("link", { name: /Official College Board page/ }),
    ).toHaveAttribute(
      "href",
      "https://apcentral.collegeboard.org/courses/ap-biology/exam",
    );
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("AC6 — category order comes from the CATEGORIES constant, identical on desktop and mobile", async ({
    page,
  }) => {
    await gotoDesktop(page);

    const headingOrder = async () =>
      (
        await catalog(page)
          .getByRole("heading", { level: 2 })
          .allInnerTexts()
      ).map((text) => text.trim());

    // innerText reflects the CSS `uppercase` transform on the headings, so
    // compare case-insensitively.
    const desktopOrder = await headingOrder();
    expect(
      CANONICAL_ORDER.every((name, i) =>
        desktopOrder[i]?.toLowerCase().startsWith(name.toLowerCase()),
      ),
      `desktop order was: ${desktopOrder.join(" → ")}`,
    ).toBe(true);

    // Same DOM at mobile width — same canonical order.
    await page.setViewportSize({ width: 375, height: 667 });
    const mobileOrder = await headingOrder();
    expect(mobileOrder).toEqual(desktopOrder);

    // Quick-jump chips list the categories in the same canonical order.
    const navOrder = await quickJump(page).getByRole("button").allInnerTexts();
    expect(navOrder.map((t) => t.trim())).toEqual([...CANONICAL_ORDER]);
  });

  test("AC7 — a11y + responsive: real landmarks, buttons with aria-pressed, logical keyboard order, no h-scroll", async ({
    page,
  }) => {
    await gotoDesktop(page);

    // Real landmarks and headings; every chip is a real <button> exposing
    // selection state.
    await expect(catalog(page).getByRole("region")).toHaveCount(5);
    const chips = catalog(page).locator("button[aria-pressed]");
    await expect(chips).toHaveCount(TOTAL_SUBJECTS);
    expect(
      await chips.evaluateAll((els) =>
        els.every((el) => el.tagName === "BUTTON"),
      ),
    ).toBe(true);

    // Logical keyboard order: search → quick-jump chips (in order) → first
    // subject's select toggle → its expand affordance.
    await page.getByLabel("Search subjects").focus();
    for (const name of CANONICAL_ORDER) {
      await page.keyboard.press("Tab");
      await expect(
        quickJump(page).getByRole("button", { name }),
      ).toBeFocused();
    }
    await page.keyboard.press("Tab");
    const firstLi = sectionRegion(page, "STEM").locator("li").first();
    await expect(firstLi.locator("button[aria-pressed]")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstLi.locator("button[aria-expanded]")).toBeFocused();

    // No horizontal scroll at the issue's checkpoints (incl. 1440).
    for (const width of [1920, 1440, 1024, 375]) {
      await page.setViewportSize({
        width,
        height: width >= 768 ? 900 : 667,
      });
      expect(await noHorizontalScroll(page), `h-scroll at ${width}px`).toBe(
        true,
      );
    }
  });
});

// --- AC8 (human bounce): vertical-only expansion, stable arrow --------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const expectSameBox = (actual: Box, expected: Box, label: string) => {
  const tol = 0.5;
  expect(Math.abs(actual.x - expected.x), `${label}: x moved`).toBeLessThan(tol);
  expect(Math.abs(actual.y - expected.y), `${label}: y moved`).toBeLessThan(tol);
  expect(
    Math.abs(actual.width - expected.width),
    `${label}: width changed`,
  ).toBeLessThan(tol);
  expect(
    Math.abs(actual.height - expected.height),
    `${label}: height changed`,
  ).toBeLessThan(tol);
};

const GEOMETRY_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 768, height: 900 },
  { width: 375, height: 667 },
] as const;

for (const vp of GEOMETRY_VIEWPORTS) {
  test(`AC8 — expansion is vertical-only with a stable arrow at ${vp.width}×${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(quickJump(page)).toBeVisible();

    // The SAME card at every viewport: the first STEM chip (top of the first
    // section — when the grid has ≥2 columns it always has a right-hand
    // row neighbor, since STEM has 13 subjects).
    const stem = sectionRegion(page, "STEM");
    const lis = stem.locator("ul > li");
    const target = lis.first();
    const card = target.locator("div").first();
    const arrow = target.locator("button[aria-expanded]");
    await target.scrollIntoViewIfNeeded();

    // Collapsed-state geometry: the card, its arrow, its grid placement, and
    // every other card's box in the section.
    const cardBefore = (await card.boundingBox())!;
    const arrowBefore = (await arrow.boundingBox())!;
    const gridColumnBefore = await target.evaluate(
      (el) => getComputedStyle(el).gridColumn,
    );
    const allBefore = (await lis.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    )) as Box[];
    // Same-row neighbors = other cards whose top edge matches the target's.
    const neighborIdx = allBefore
      .map((box, i) => ({ box, i }))
      .filter(
        ({ box, i }) => i !== 0 && Math.abs(box.y - allBefore[0].y) < 1,
      )
      .map(({ i }) => i);
    if (vp.width >= 640) {
      expect(neighborIdx.length, "expected a same-row neighbor").toBeGreaterThan(0);
    }

    await page.screenshot({
      path: `${EVIDENCE_DIR}/geometry-${vp.width}-collapsed.png`,
    });

    // EXPAND. The disclosure panel appears below within the same width.
    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    await expect(target.locator("dl, p").first()).toBeVisible();

    const cardExpanded = (await card.boundingBox())!;
    const arrowExpanded = (await arrow.boundingBox())!;

    // Vertical-only: width and left edge identical, top edge unmoved,
    // height strictly grows downward.
    expect(
      Math.abs(cardExpanded.width - cardBefore.width),
      "card width changed on expand",
    ).toBeLessThan(0.5);
    expect(
      Math.abs(cardExpanded.x - cardBefore.x),
      "card left edge moved on expand",
    ).toBeLessThan(0.5);
    expect(
      Math.abs(cardExpanded.y - cardBefore.y),
      "card top edge moved on expand",
    ).toBeLessThan(0.5);
    expect(cardExpanded.height).toBeGreaterThan(cardBefore.height + 20);

    // No column-spanning: the grid placement is state-independent.
    const gridColumnExpanded = await target.evaluate(
      (el) => getComputedStyle(el).gridColumn,
    );
    expect(gridColumnExpanded).toBe(gridColumnBefore);

    // Stable arrow: the expand/collapse control has not moved at all.
    expectSameBox(arrowExpanded, arrowBefore, "arrow (expanded)");

    // No horizontal reflow: same-row neighbors have identical boxes.
    const allExpanded = (await lis.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    )) as Box[];
    for (const i of neighborIdx) {
      expectSameBox(allExpanded[i], allBefore[i], `row neighbor li[${i}]`);
    }
    // Every card keeps its column (x and width): only vertical movement of
    // rows below is allowed anywhere in the section.
    allExpanded.forEach((box, i) => {
      expect(
        Math.abs(box.x - allBefore[i].x),
        `li[${i}] shifted horizontally`,
      ).toBeLessThan(0.5);
      expect(
        Math.abs(box.width - allBefore[i].width),
        `li[${i}] changed width`,
      ).toBeLessThan(0.5);
    });

    await page.screenshot({
      path: `${EVIDENCE_DIR}/geometry-${vp.width}-expanded.png`,
    });

    // COLLAPSE. Everything returns exactly to the original geometry — the
    // second click hit the same arrow position as the first.
    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "false");
    const cardAfter = (await card.boundingBox())!;
    const arrowAfter = (await arrow.boundingBox())!;
    expectSameBox(cardAfter, cardBefore, "card (re-collapsed)");
    expectSameBox(arrowAfter, arrowBefore, "arrow (re-collapsed)");
  });
}

// --- Evidence capture: the three mandatory super-board viewports ------------

const EVIDENCE_VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of EVIDENCE_VIEWPORTS) {
  test(`evidence — grouped catalog, one selected + one expanded (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(quickJump(page)).toBeVisible();

    // One selected chip + one expanded chip so the screenshot demonstrates
    // the selected style AND the in-place vertical disclosure.
    const bio = chip(page, "AP Biology");
    await bio.scrollIntoViewIfNeeded();
    await bio.click();
    await expect(selectedCount(page)).toHaveText("1 selected");
    await expandButton(page, "AP Biology").click();
    await expect(
      expandButton(page, "AP Biology"),
    ).toHaveAttribute("aria-expanded", "true");

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
