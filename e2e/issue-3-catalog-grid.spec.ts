import { test, expect, type Page } from "@playwright/test";

/**
 * super-board QA (issue #3) — catalog grid, search, category filter, selection.
 *
 * One observable browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots are written to the
 * run evidence folder and committed to the issue branch so they render inline
 * on the issue / PR.
 *
 * Updated for issue #24: the desktop catalog converged on the mobile IA from
 * issue #22 — category-grouped sections of chips at every width. The category
 * *filter* chips ("All" + one per category) were retired and repurposed as
 * the quick-jump nav, a subject's category is now conveyed by its section
 * (not per-card text), and date/deadline meta lives in the chip's expandable
 * Tier-1 panel. Assertions below track that intentional behavior change while
 * preserving each AC's original intent.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-3-qa-v1";

const TOTAL_SUBJECTS = 42;
const STEM_COUNT = 13;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
// The select toggle is the button carrying aria-pressed. Issue #6 adds a second
// per-card control (the "View exam details" info button, no aria-pressed), so
// this scopes the catalog's card helper to the selection toggle specifically.
const cards = (page: Page) =>
  catalog(page).locator("ul > li button[aria-pressed]");
// Issue #24: the "Filter by category" chip group became the quick-jump nav.
const chip = (page: Page, name: string) =>
  catalog(page)
    .getByRole("navigation", { name: "Jump to category" })
    .getByRole("button", { name, exact: true });
// A category's section landmark, named by its heading ("STEM 13 subjects").
const region = (page: Page, name: string) =>
  catalog(page).getByRole("region", { name: new RegExp(`^${name}`) });
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const selectedCount = (page: Page) =>
  page.getByText(/^\d+ selected$/);

test.describe("issue #3 — subject catalog", () => {
  test("AC1 — renders every subject with name, category, and date/deadline meta", async ({
    page,
  }) => {
    await page.goto("/");

    // Every subject in ap-2026.json is rendered as a chip.
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);

    // An exam subject: named chip inside its category's labeled section
    // (issue #24 — category is conveyed by the section, not per-card text),
    // with the exam date & session in the expandable Tier-1 panel.
    const bio = region(page, "STEM")
      .locator("li")
      .filter({ has: page.getByRole("button", { name: /AP Biology/ }) });
    await expect(bio.locator("button[aria-pressed]")).toHaveCount(1);
    await expandButton(page, "AP Biology").click();
    await expect(bio).toContainText("May"); // exam date, formatted
    await expect(bio).toContainText(/\bAM\b/); // session

    // A portfolio-only subject shows its deadline instead of an exam slot.
    const research = region(page, "Humanities")
      .locator("li")
      .filter({ has: page.getByRole("button", { name: /AP Research/ }) });
    await expect(research.locator("button[aria-pressed]")).toHaveCount(1);
    await expandButton(page, "AP Research").click();
    await expect(research).toContainText(/Portfolio due/i);
  });

  test("AC2 — labeled search filters by name, case-insensitively, live as you type", async ({
    page,
  }) => {
    await page.goto("/");
    const search = page.getByLabel("Search subjects");
    await expect(search).toBeVisible();

    await search.fill("bio");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("AP Biology");

    // Case-insensitive: uppercase yields the same single match.
    await search.fill("BIO");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("AP Biology");

    // Clearing restores the full grid (live, no reload).
    await search.fill("");
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);
  });

  // Issue #24 design decision: with every category always visible as a
  // labeled section, the standalone filter was retired and its chips
  // repurposed as the quick-jump nav (the same control issue #22 shipped on
  // mobile) — category access is jump-to-section, search is the one filter.
  test("AC3 — category chips are a quick-jump to their section, and track search", async ({
    page,
  }) => {
    await page.goto("/");

    // The five categories are present as quick-jump chips (no "All": nothing
    // is filtered out anymore). Each category renders as a labeled section.
    for (const name of [
      "STEM",
      "Humanities",
      "Languages",
      "Arts",
      "Career Kickstart",
    ]) {
      await expect(chip(page, name)).toBeVisible();
      await expect(region(page, name)).toHaveCount(1);
    }
    await expect(region(page, "STEM").locator("button[aria-pressed]"))
      .toHaveCount(STEM_COUNT);

    // Tapping a chip scrolls to its section and moves focus to the heading.
    await chip(page, "Languages").click();
    const languagesHeading = catalog(page).getByRole("heading", {
      name: /^Languages/,
    });
    await expect(languagesHeading).toBeFocused();
    await expect(languagesHeading).toBeInViewport();

    // Search still filters across/within groups: "history" matches 4
    // subjects in two categories (1 Arts — "AP Art History" — and 3
    // Humanities); emptied categories drop their section AND their
    // quick-jump chip, so the nav never points at a dead target.
    await page.getByLabel("Search subjects").fill("history");
    await expect(cards(page)).toHaveCount(4);
    await expect(region(page, "Humanities").locator("button[aria-pressed]"))
      .toHaveCount(3);
    await expect(region(page, "Arts").locator("button[aria-pressed]"))
      .toHaveCount(1);
    await expect(region(page, "STEM")).toHaveCount(0);
    await expect(chip(page, "STEM")).toHaveCount(0);
    await expect(chip(page, "Humanities")).toBeVisible();
  });

  test("AC4 — tapping a card toggles My Exams and updates the running count", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(selectedCount(page)).toHaveText("0 selected");

    const bio = cards(page).filter({ hasText: "AP Biology" });
    await expect(bio).toHaveAttribute("aria-pressed", "false");

    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "true");
    await expect(selectedCount(page)).toHaveText("1 selected");

    await bio.click();
    await expect(bio).toHaveAttribute("aria-pressed", "false");
    await expect(selectedCount(page)).toHaveText("0 selected");
  });

  test("AC5 — selection persists in localStorage apx.selection.v1 across reload", async ({
    page,
  }) => {
    await page.goto("/");

    await cards(page).filter({ hasText: "AP Biology" }).click();
    await cards(page).filter({ hasText: "AP Research" }).click();
    await expect(selectedCount(page)).toHaveText("2 selected");

    // The versioned key holds a JSON array of the two selected ids.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("apx.selection.v1"),
    );
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as string[]).length).toBe(2);

    // Full reload: the same cards render selected and the count matches.
    await page.reload();
    await expect(selectedCount(page)).toHaveText("2 selected");
    await expect(
      cards(page).filter({ hasText: "AP Biology" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      cards(page).filter({ hasText: "AP Research" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("AC6 — cards are keyboard focusable in DOM order and toggle on Enter/Space", async ({
    page,
  }) => {
    await page.goto("/");

    // DOM order: tabbing past the last quick-jump chip lands on the first
    // subject chip's select toggle (section headings are tabIndex={-1}).
    await chip(page, "Career Kickstart").focus();
    await page.keyboard.press("Tab");
    const firstCard = cards(page).first();
    await expect(firstCard).toBeFocused();

    // Space toggles selection on.
    await page.keyboard.press("Space");
    await expect(firstCard).toHaveAttribute("aria-pressed", "true");
    await expect(selectedCount(page)).toHaveText("1 selected");

    // Enter toggles it back off.
    await page.keyboard.press("Enter");
    await expect(firstCard).toHaveAttribute("aria-pressed", "false");
    await expect(selectedCount(page)).toHaveText("0 selected");

    // Focus indicator: keyboard-focused card matches :focus-visible and paints
    // a non-empty box-shadow ring (Tailwind focus-visible:ring-2).
    const ring = await firstCard.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    expect(ring).not.toBe("none");
  });

  // Issue #22 redesigned the mobile IA: at <640px the flat grid is replaced
  // by category-grouped sections (real headings + a sticky quick-jump nav)
  // with one chip per subject. Issue #24 converged desktop on the SAME
  // grouped IA — the sections' chip lists widen to a multi-column grid.
  test("AC7 — responsive: category-sectioned chips at 375px with no h-scroll, grouped multi-column sections at 1920px", async ({
    page,
  }) => {
    // Mobile: the sectioned view — quick-jump nav, all five category
    // headings, every subject present as a chip, no horizontal overflow.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    await expect(
      catalog(page).getByRole("navigation", { name: "Jump to category" }),
    ).toBeVisible();
    for (const name of [
      "STEM",
      "Humanities",
      "Languages",
      "Arts",
      "Career Kickstart",
    ]) {
      await expect(
        catalog(page).getByRole("heading", { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
    }
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);

    const noHScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(noHScroll).toBe(true);

    // Desktop (issue #24): the same grouped sections + quick-jump nav, with
    // each section's chip list laid out as a multi-column grid.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(
      catalog(page).getByRole("navigation", { name: "Jump to category" }),
    ).toBeVisible();
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);
    const sectionList = region(page, "STEM").locator("ul");
    const desktopCols = await sectionList.evaluate(
      (el) =>
        getComputedStyle(el)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
    );
    expect(desktopCols).toBeGreaterThanOrEqual(2);

    const noHScrollDesktop = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(noHScrollDesktop).toBe(true);
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

    // Show a populated selected state so the screenshot demonstrates the
    // selected card style + running count.
    await cards(page).filter({ hasText: "AP Biology" }).click();
    await expect(selectedCount(page)).toHaveText("1 selected");

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
