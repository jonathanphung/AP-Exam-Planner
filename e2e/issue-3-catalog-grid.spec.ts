import { test, expect, type Page } from "@playwright/test";

/**
 * super-board QA (issue #3) — catalog grid, search, category filter, selection.
 *
 * One observable browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots are written to the
 * run evidence folder and committed to the issue branch so they render inline
 * on the issue / PR.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-3-qa-v1";

const TOTAL_SUBJECTS = 42;
const STEM_COUNT = 13;

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const cards = (page: Page) => catalog(page).locator("ul > li > button");
const chip = (page: Page, name: string) =>
  catalog(page)
    .getByRole("group", { name: "Filter by category" })
    .getByRole("button", { name, exact: true });
const selectedCount = (page: Page) =>
  page.getByText(/^\d+ selected$/);

test.describe("issue #3 — subject catalog", () => {
  test("AC1 — renders every subject as a card with name, category, and date/deadline meta", async ({
    page,
  }) => {
    await page.goto("/");

    // Every subject in ap-2026.json is rendered as a card.
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);

    // An exam subject shows name + category + exam date & session.
    const bio = cards(page).filter({ hasText: "AP Biology" });
    await expect(bio).toHaveCount(1);
    await expect(bio).toContainText("STEM");
    await expect(bio).toContainText("May"); // exam date, formatted
    await expect(bio).toContainText(/\bAM\b/); // session

    // A portfolio-only subject shows its deadline instead of an exam slot.
    const research = cards(page).filter({ hasText: "AP Research" });
    await expect(research).toHaveCount(1);
    await expect(research).toContainText("Humanities");
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

  test("AC3 — category chips filter, and combine with search", async ({
    page,
  }) => {
    await page.goto("/");

    // All + the five categories are present as chips.
    for (const name of [
      "All",
      "STEM",
      "Humanities",
      "Languages",
      "Arts",
      "Career Kickstart",
    ]) {
      await expect(chip(page, name)).toBeVisible();
    }

    // Tapping STEM shows only STEM subjects.
    await chip(page, "STEM").click();
    await expect(cards(page)).toHaveCount(STEM_COUNT);

    // Reset to All.
    await chip(page, "All").click();
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);

    // Search + category combine: "history" matches 4 subjects across two
    // categories (1 Arts — "AP Art History" — and 3 Humanities). Narrowing to
    // Humanities keeps only the 3 Humanities matches and drops the Arts one,
    // proving the two filters intersect rather than either winning outright.
    await page.getByLabel("Search subjects").fill("history");
    await expect(cards(page)).toHaveCount(4);
    await chip(page, "Humanities").click();
    await expect(cards(page)).toHaveCount(3);
    await expect(
      cards(page).filter({ hasText: "AP Art History" }),
    ).toHaveCount(0);
    await expect(
      cards(page).filter({ hasText: "AP European History" }),
    ).toHaveCount(1);
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

    // DOM order: tabbing past the last category chip lands on the first card.
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

  test("AC7 — responsive columns: 1–2 at 375px with no h-scroll, multiple at 1920px", async ({
    page,
  }) => {
    const grid = catalog(page).locator("ul");

    // Mobile: 1–2 columns, no horizontal overflow.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    const mobileCols = await grid.evaluate(
      (el) =>
        getComputedStyle(el)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
    );
    expect(mobileCols).toBeGreaterThanOrEqual(1);
    expect(mobileCols).toBeLessThanOrEqual(2);

    const noHScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(noHScroll).toBe(true);

    // Desktop: multiple columns.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const desktopCols = await grid.evaluate(
      (el) =>
        getComputedStyle(el)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
    );
    expect(desktopCols).toBeGreaterThanOrEqual(2);
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
