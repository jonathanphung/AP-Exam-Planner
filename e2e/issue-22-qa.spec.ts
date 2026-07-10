import { test, expect, type Page } from "@playwright/test";

/**
 * super-board QA (issue #22) — category-grouped mobile chips with
 * expandable course details (3-tier progressive disclosure).
 *
 * One observable browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports. Screenshots
 * are written to the run evidence folder and committed to the issue branch so
 * they render inline on the issue / PR.
 *
 * Fixtures (from src/data/ap-2026.json):
 *   - AP Biology        — STEM; exam Mon May 4 AM (8 a.m.), late Wed May 20 PM
 *                         (12 p.m.); pattern CB URL `ap-biology/exam`.
 *   - AP Drawing        — Arts; portfolio-only, deadline Fri May 8 2026;
 *                         exception CB URL `ap-drawing/portfolio`.
 *   - AP Cybersecurity  — Career Kickstart; `noExamReason` (first exam 2027);
 *                         no date/time may be shown.
 *   - AP World History: Modern — exception CB URL `ap-world-history/exam`
 *                         (no "-modern" suffix; patterned URL 404s).
 *
 * Category counts pinned by `pnpm test:data`: STEM 13, Humanities 14,
 * Languages 8, Arts 5, Career Kickstart 2 → 42 subjects.
 *
 * AC10/AC11 (verified-link rule + single source of truth) are additionally
 * pinned at unit level by `src/lib/college-board-links.test.ts` (full 42/42
 * coverage, no-guess rule); the e2e layer spot-checks one URL per exception
 * class below.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-22-qa-v1";

const MOBILE = { width: 375, height: 667 } as const;

const CATEGORY_COUNTS: readonly { name: string; count: number }[] = [
  { name: "STEM", count: 13 },
  { name: "Humanities", count: 14 },
  { name: "Languages", count: 8 },
  { name: "Arts", count: 5 },
  { name: "Career Kickstart", count: 2 },
];
const TOTAL_SUBJECTS = 42;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const quickJump = (page: Page) =>
  catalog(page).getByRole("navigation", { name: "Jump to category" });
const sectionHeading = (page: Page, name: string) =>
  catalog(page).getByRole("heading", { level: 2, name: new RegExp(`^${name}`) });
// The select toggle is the chip-body button carrying aria-pressed.
const chip = (page: Page, name: string) =>
  catalog(page)
    .locator("li")
    .filter({ has: page.getByRole("button", { name: `Show exam dates for ${name}` }) })
    .locator("button[aria-pressed]");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const detailsButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
const dialog = (page: Page) => page.getByRole("dialog");
const selectedCount = (page: Page) => page.getByText(/^\d+ selected$/);

const gotoMobile = async (page: Page) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  // The mobile layout mounts post-hydration (SSR-safe matchMedia hook); the
  // quick-jump nav is the stable signal that the sectioned view is live.
  await expect(quickJump(page)).toBeVisible();
};

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

test.describe("issue #22 — mobile category-grouped chips + progressive disclosure", () => {
  test("AC1 — mobile catalog is grouped under category headings, not a flat list", async ({
    page,
  }) => {
    await gotoMobile(page);

    // Five distinct category sections, each a real landmark named by its
    // heading, in canonical order, with its full subject count.
    for (const { name, count } of CATEGORY_COUNTS) {
      const region = catalog(page).getByRole("region", {
        name: new RegExp(`^${name}`),
      });
      await expect(region).toHaveCount(1);
      await expect(sectionHeading(page, name)).toBeVisible();
      await expect(region.locator("button[aria-pressed]")).toHaveCount(count);
    }

    // All 42 subjects present overall. Since issue #24 the sectioned layout
    // is one shared grid at every width; on mobile each section's list is a
    // SINGLE column of full-width cards (not the flat multi-column desktop
    // grid, and not a width-jumping pill flow — expansion is vertical-only).
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(
      TOTAL_SUBJECTS,
    );
    const mobileCols = await catalog(page)
      .getByRole("region", { name: /^STEM/ })
      .locator("ul")
      .evaluate(
        (el) =>
          getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean)
            .length,
      );
    expect(mobileCols).toBe(1);
  });

  test("AC2 — chip: emoji + name, unmistakable selected state, ≥44px tap targets", async ({
    page,
  }) => {
    await gotoMobile(page);

    const bio = chip(page, "AP Biology");
    await bio.scrollIntoViewIfNeeded();

    // Emoji from the #20 single source of truth, aria-hidden, name announced.
    await expect(bio).toContainText("🧬");
    await expect(bio).toContainText("AP Biology");

    // Unselected → selected flips aria-pressed AND the visible ✓ indicator.
    await expect(bio).toHaveAttribute("aria-pressed", "false");
    const unselectedBorder = await bio.evaluate(
      (el) => getComputedStyle(el.closest("li > div") as Element).borderColor,
    );
    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "true");
    const selectedBorder = await bio.evaluate(
      (el) => getComputedStyle(el.closest("li > div") as Element).borderColor,
    );
    expect(selectedBorder).not.toBe(unselectedBorder);
    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "false");

    // Tap targets (issue #8 bar): chip body and expand control both ≥44px.
    const bodyBox = await bio.boundingBox();
    expect(bodyBox!.height).toBeGreaterThanOrEqual(44);
    const expandBox = await expandButton(page, "AP Biology").boundingBox();
    expect(expandBox!.height).toBeGreaterThanOrEqual(44);
    expect(expandBox!.width).toBeGreaterThanOrEqual(44);
  });

  test("AC3 — sticky quick-jump nav reaches a lower category without scrolling the catalog", async ({
    page,
  }) => {
    await gotoMobile(page);

    // The nav is sticky, so it stays reachable mid-scroll.
    const position = await quickJump(page).evaluate(
      (el) => getComputedStyle(el).position,
    );
    expect(position).toBe("sticky");

    // From the top, one tap reaches the last category: the section heading
    // receives focus and is scrolled into the viewport.
    await quickJump(page)
      .getByRole("button", { name: "Career Kickstart" })
      .click();
    const heading = sectionHeading(page, "Career Kickstart");
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test("AC4 — search filters the sectioned view; empty categories hide; no-matches state", async ({
    page,
  }) => {
    await gotoMobile(page);
    const search = page.getByLabel("Search subjects");

    // "calc" matches only the three STEM calc* courses (Calculus AB/BC,
    // Precalculus): one section left, quick-jump shrinks with it, no dead
    // whitespace from empty categories.
    await search.fill("calc");
    await expect(sectionHeading(page, "STEM")).toBeVisible();
    for (const { name } of CATEGORY_COUNTS.slice(1)) {
      await expect(sectionHeading(page, name)).toHaveCount(0);
    }
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(3);
    await expect(quickJump(page).getByRole("button")).toHaveCount(1);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile-search-filtered.png`,
      fullPage: true,
    });

    // Gibberish → the no-matches state, no orphaned section shells.
    await search.fill("zzzz-no-such-subject");
    await expect(
      catalog(page).getByText("No subjects match your search."),
    ).toBeVisible();
    await expect(catalog(page).getByRole("region")).toHaveCount(0);

    // Clearing restores the full sectioned view.
    await search.fill("");
    await expect(catalog(page).locator("button[aria-pressed]")).toHaveCount(
      TOTAL_SUBJECTS,
    );
  });

  test("AC5 — chip tap toggles the shared selection store; schedule reflects immediately", async ({
    page,
  }) => {
    await gotoMobile(page);

    const bio = chip(page, "AP Biology");
    await bio.scrollIntoViewIfNeeded();
    await bio.click();
    await expect(selectedCount(page)).toHaveText("1 selected");

    // The schedule surface (shared useSelection store) lists the subject
    // immediately — same store, presentation-only change.
    const schedule = page.locator(
      'section[aria-label="Subject catalog"] ~ *, main',
    );
    await expect(
      schedule.getByText("AP Biology").last(),
    ).toBeVisible();

    await bio.click();
    await expect(selectedCount(page)).toHaveText("0 selected");
  });

  test("AC6 — expand and select are separate controls; neither triggers the other", async ({
    page,
  }) => {
    await gotoMobile(page);

    const bio = chip(page, "AP Biology");
    const expand = expandButton(page, "AP Biology");
    await bio.scrollIntoViewIfNeeded();

    // Distinct accessible labels on distinct elements.
    await expect(bio).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(expand).not.toHaveAttribute("aria-pressed", /.*/);

    // Expanding never selects…
    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(bio).toHaveAttribute("aria-pressed", "false");
    await expect(selectedCount(page)).toHaveText("0 selected");

    // …and selecting never collapses/expands.
    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "true");
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await bio.click();
    await expand.click();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
  });

  test("AC7 (Tier 1) — expand reveals exam date, session start time, late testing; portfolio deadline; sourced no-exam reason", async ({
    page,
  }) => {
    await gotoMobile(page);

    // Full exam subject: date + AM session with the published start time,
    // plus the late-testing slot.
    await expandButton(page, "AP Biology").click();
    const bioPanel = catalog(page)
      .locator("li")
      .filter({ hasText: "AP Biology" })
      .locator("dl");
    await expect(bioPanel).toContainText("Mon, May 4 · AM (8 a.m. local time)");
    await expect(bioPanel).toContainText(
      "Wed, May 20 · PM (12 p.m. local time)",
    );

    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile-tier1-timing.png`,
      fullPage: false,
    });

    // Portfolio subject: deadline shown, no invented exam slot.
    await expandButton(page, "AP Drawing").click();
    const drawingLi = catalog(page)
      .locator("li")
      .filter({ has: expandButton(page, "AP Drawing") });
    await expect(drawingLi).toContainText("Portfolio due");
    await expect(drawingLi).toContainText("Fri, May 8, 2026");
    await expect(drawingLi.locator("dt", { hasText: "Exam" })).toHaveCount(0);

    // noExamReason subject: the sourced reason verbatim — never a date/time.
    await expandButton(page, "AP Cybersecurity").click();
    const cyberLi = catalog(page)
      .locator("li")
      .filter({ has: expandButton(page, "AP Cybersecurity") });
    await expect(cyberLi).toContainText(
      "First end-of-course exam administration is May 2027",
    );
    await expect(cyberLi.locator("dt")).toHaveCount(0);
    await expect(cyberLi).not.toContainText("May 4");

    await cyberLi.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile-tier1-noexam.png`,
      fullPage: false,
    });
  });

  test("AC8 (Tier 2) — 'Full exam details' opens the shared InfoPanel with the #6 dataset content", async ({
    page,
  }) => {
    await gotoMobile(page);

    await expandButton(page, "AP Biology").click();
    const details = detailsButton(page, "AP Biology");
    await expect(details).toHaveAttribute("aria-haspopup", "dialog");
    await details.click();

    // Same InfoPanel as issue #6: named dialog with the format/pass-rate rows.
    const panel = dialog(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("AP Biology");
    // Issue #44: the flat MCQ/FRQ rows became the per-section table, whose
    // row headers use College Board's published section titles.
    await expect(panel).toContainText("Multiple Choice");
    await expect(panel).toContainText("Free Response");
    await expect(panel).toContainText("Calculator");
    await expect(panel).toContainText("Pass rate");
  });

  test("AC9/AC10 (Tier 3) — verified official College Board link: new tab, noopener noreferrer, ↗, exceptions honored", async ({
    page,
  }) => {
    await gotoMobile(page);

    // Pattern subject: ap-<id>/exam.
    await expandButton(page, "AP Biology").click();
    await detailsButton(page, "AP Biology").click();
    const link = dialog(page).getByRole("link", {
      name: /Official College Board page/,
    });
    await expect(link).toHaveAttribute(
      "href",
      "https://apcentral.collegeboard.org/courses/ap-biology/exam",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Visible ↗ affordance + AT announcement of the new tab.
    await expect(link.locator('span[aria-hidden="true"]')).toHaveText("↗");
    await expect(link.locator(".sr-only")).toHaveText("(opens in a new tab)");

    await link.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile-tier3-official-link.png`,
      fullPage: false,
    });
    await page.keyboard.press("Escape");

    // Exception class 1: official slug differs from the dataset id.
    await expandButton(page, "AP World History: Modern").click();
    await detailsButton(page, "AP World History: Modern").click();
    await expect(
      dialog(page).getByRole("link", { name: /Official College Board page/ }),
    ).toHaveAttribute(
      "href",
      "https://apcentral.collegeboard.org/courses/ap-world-history/exam",
    );
    await page.keyboard.press("Escape");

    // Exception class 2: portfolio-only course → /portfolio page, not /exam.
    await expandButton(page, "AP Drawing").click();
    await detailsButton(page, "AP Drawing").click();
    await expect(
      dialog(page).getByRole("link", { name: /Official College Board page/ }),
    ).toHaveAttribute(
      "href",
      "https://apcentral.collegeboard.org/courses/ap-drawing/portfolio",
    );
  });

  test("AC12 — disclosure is keyboard/SR-accessible: aria-controls wiring, dialog focus trap + restore", async ({
    page,
  }) => {
    await gotoMobile(page);

    const expand = expandButton(page, "AP Biology");
    await expand.scrollIntoViewIfNeeded();

    // aria-controls points at the real Tier-1 panel; hidden until expanded.
    const controlsId = await expand.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const panel = page.locator(`[id="${controlsId}"]`);
    await expect(panel).toBeHidden();

    // Keyboard-only expand.
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();

    // Revealed content is next in focus order: Tab lands inside the panel.
    await page.keyboard.press("Tab");
    const details = detailsButton(page, "AP Biology");
    await expect(details).toBeFocused();

    // Opening the details dialog moves focus into it (trap)…
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    const focusInDialog = await page.evaluate(() =>
      document
        .querySelector('[role="dialog"]')
        ?.contains(document.activeElement),
    );
    expect(focusInDialog).toBe(true);

    // …and Escape closes it and restores focus to the opener.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(details).toBeFocused();
  });

  test("AC13 — real landmarks/headings, chips are buttons with aria-pressed, reduced-motion honored", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoMobile(page);

    // Real section landmarks named by real <h2> headings.
    await expect(catalog(page).getByRole("region")).toHaveCount(5);
    for (const { name } of CATEGORY_COUNTS) {
      await expect(sectionHeading(page, name)).toHaveCount(1);
    }

    // Every chip is a real <button> exposing selection state.
    const chips = catalog(page).locator("button[aria-pressed]");
    await expect(chips).toHaveCount(TOTAL_SUBJECTS);
    expect(
      await chips.evaluateAll((els) =>
        els.every((el) => el.tagName === "BUTTON"),
      ),
    ).toBe(true);

    // Quick-jump still works with reduced motion (auto scroll, focus moves).
    await quickJump(page).getByRole("button", { name: "Languages" }).click();
    await expect(sectionHeading(page, "Languages")).toBeFocused();
    await expect(sectionHeading(page, "Languages")).toBeInViewport();
  });

  // Issue #24 intentionally converged desktop on this ticket's grouped IA:
  // the flat grid + category filter chips were replaced by the same labeled
  // sections and quick-jump nav at every width, so "unregressed" now means
  // the grouped layout holds on desktop with more columns per section.
  test("AC14 — desktop shares the grouped IA (issue #24); no horizontal scroll at 375/768/1024/1920", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    // The retired filter group is gone; the quick-jump nav is mounted.
    await expect(
      page.getByRole("group", { name: "Filter by category" }),
    ).toHaveCount(0);
    await expect(quickJump(page)).toBeVisible();
    // All five labeled sections render, and each section's chip list becomes
    // a multi-column grid on the wide viewport.
    await expect(catalog(page).getByRole("region")).toHaveCount(5);
    const sectionList = catalog(page)
      .getByRole("region", { name: /^STEM/ })
      .locator("ul");
    const cols = await sectionList.evaluate(
      (el) =>
        getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean)
          .length,
    );
    expect(cols).toBeGreaterThanOrEqual(2);

    // No horizontal page scroll at any of the four checkpoints.
    for (const width of [1920, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 667 });
      expect(await noHorizontalScroll(page), `h-scroll at ${width}px`).toBe(
        true,
      );
    }
  });
});

// --- Evidence capture: the three mandatory super-board viewports ------------
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — catalog with a selection (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    if (vp.name === "mobile") {
      // Sectioned chip view with one selected + one expanded chip, so the
      // screenshot demonstrates the selected style AND Tier-1 disclosure.
      await expect(quickJump(page)).toBeVisible();
      await chip(page, "AP Biology").click();
      await expandButton(page, "AP Biology").click();
      await expect(selectedCount(page)).toHaveText("1 selected");
    } else {
      await catalog(page)
        .locator("li")
        .filter({ hasText: "AP Biology" })
        .locator("button[aria-pressed]")
        .first()
        .click();
      await expect(selectedCount(page)).toHaveText("1 selected");
    }

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
