import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * super-board QA (issue #6) — exam info panel with format details + pass rate.
 *
 * One observable browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots are written to the
 * run evidence folder and committed to the issue branch so they render inline
 * on the issue / PR.
 *
 * Fixtures (from src/data/ap-2026.json):
 *   - AP Biology           — full exam: mcq 60, frq 6 (2 long/4 short),
 *                            180 min → "3 h", calculator Permitted,
 *                            delivery Hybrid, pass rate 71%.
 *   - AP Cybersecurity     — passRate "pending" (only pending value in the
 *                            dialog → tests the muted badge, AC3).
 *   - AP Seminar           — portfolio weight 55% of final, deadline
 *                            2026-04-30 (AC4).
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-6-qa-v1";

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');

// The select toggle is the button carrying aria-pressed; the details affordance
// is a distinct button whose accessible name is "View exam details for <name>".
const toggle = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li")
    .filter({ hasText: name })
    .locator("button[aria-pressed]");
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
// Issues #22/#24 grouped-chip IA: at every width the details button lives
// inside a chip's expanded Tier-1 panel, revealed by this expand affordance.
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
/** Reveal a subject's Tier-1 panel and open its details dialog (Tier 2). */
const openInfo = async (page: Page, name: string) => {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
};
const dialog = (page: Page) => page.getByRole("dialog");
const selectedCount = (page: Page) => page.getByText(/^\d+ selected$/);

// The <dd> value for a labelled row inside the panel's description lists.
const rowValue = (page: Page, label: string): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: label }).locator("dd");

// Issue #44: a section (or part) row in the questions|length|weight table,
// located by its row header.
const sectionRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

test.describe("issue #6 — exam info panel", () => {
  test("AC1 — each chip has a details affordance distinct from the select toggle that opens the panel without selecting", async ({
    page,
  }) => {
    await page.goto("/");

    // Every rendered chip exposes its own per-subject disclosure affordance
    // (issues #22/#24: the info button moved into the expanded Tier-1 panel).
    await expect(
      page.getByRole("button", { name: /^Show exam dates for / }),
    ).toHaveCount(42);

    // Both controls exist for a subject and are distinct elements.
    const bioToggle = toggle(page, "AP Biology");
    await expect(bioToggle).toHaveCount(1);
    await expandButton(page, "AP Biology").click();
    const bioInfo = infoButton(page, "AP Biology");
    await expect(bioInfo).toHaveCount(1);
    await expect(bioInfo).toBeVisible();

    // Baseline: nothing selected (expanding is not selecting).
    await expect(selectedCount(page)).toHaveText("0 selected");
    await expect(bioToggle).toHaveAttribute("aria-pressed", "false");

    // Opening details opens the dialog…
    await bioInfo.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("AP Biology");

    // …and does NOT change the selection (the two controls are independent).
    await expect(bioToggle).toHaveAttribute("aria-pressed", "false");
    await expect(selectedCount(page)).toHaveText("0 selected");
  });

  test("AC2 — panel shows per-section questions|length|weight rows (issue #44), length as h/min, calculator, delivery, and the pass rate labeled 'scored 3 or higher'", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(dialog(page)).toBeVisible();

    // Issue #44: the published sections render as real table rows.
    const mc = sectionRow(page, "Multiple Choice");
    await expect(mc).toContainText("60");
    await expect(mc).toContainText("1 h 30 min");
    await expect(mc).toContainText("50%");
    const fr = sectionRow(page, "Free Response");
    await expect(fr).toContainText("6");
    await expect(fr).toContainText("1 h 30 min");
    await expect(fr).toContainText("50%");
    await expect(fr).toContainText("2 long, 4 short");

    // 180 minutes formatted as hours/minutes → "3 h".
    await expect(rowValue(page, "Exam length")).toHaveText("3 h");
    await expect(rowValue(page, "Calculator")).toHaveText("Permitted");
    await expect(rowValue(page, "Delivery")).toContainText("Hybrid");
    await expect(rowValue(page, "Pass rate")).toContainText("71%");
    await expect(rowValue(page, "Pass rate")).toContainText(
      "scored 3 or higher",
    );
  });

  test("AC3 — a 'pending' value renders as a visible muted badge, never blank or fabricated", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Cybersecurity");
    await expect(dialog(page)).toBeVisible();

    const passRate = rowValue(page, "Pass rate");
    // The pass-rate badge reads "pending" and is visible…
    await expect(passRate.getByText("pending", { exact: true })).toBeVisible();
    // …the human-readable label is still shown…
    await expect(passRate).toContainText("scored 3 or higher");
    // …and no fabricated percentage is rendered in its place.
    await expect(passRate).not.toContainText("%");

    // Cybersecurity's only pending field is the pass rate → exactly one badge.
    await expect(dialog(page).getByText("pending", { exact: true })).toHaveCount(
      1,
    );
  });

  test("AC4 — portfolio subjects show the portfolio's weight (% of final) and deadline in the panel", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Seminar");
    await expect(dialog(page)).toBeVisible();

    await expect(
      dialog(page).getByRole("heading", { name: "Portfolio component" }),
    ).toBeVisible();
    const weight = rowValue(page, "Weight");
    await expect(weight).toContainText("55%");
    await expect(weight).toContainText("of final score");
    // Deadline 2026-04-30 rendered as a local calendar date.
    await expect(rowValue(page, "Deadline")).toContainText("Apr 30, 2026");
  });

  test("AC5 — accessible: focus moves in on open, Escape and close button dismiss, focus returns, scroll locked while open", async ({
    page,
  }) => {
    await page.goto("/");
    // Reveal the Tier-1 panel; the info button stays visible throughout the
    // open/close cycles below because expanding is independent of the dialog.
    await expandButton(page, "AP Biology").click();
    const info = infoButton(page, "AP Biology");

    // Open → focus moves into the dialog (onto the close button) + scroll lock.
    await info.click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();
    const closeBtn = panel.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );

    // Escape dismisses, focus returns to the invoking info button, scroll freed.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(info).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    // The close button also dismisses and returns focus to the info button.
    await info.click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(info).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("AC6 — at 375px the panel is a full-width sheet with no horizontal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Issue #22 mobile IA: expand the chip (Tier 1), then open the details
    // dialog (Tier 2) from the revealed panel.
    await expandButton(page, "AP Biology").click();
    await infoButton(page, "AP Biology").click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();

    // Full-width sheet: the dialog spans (very nearly) the whole 375px viewport.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(360);

    // No horizontal overflow on the document while the sheet is open.
    const noHScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    );
    expect(noHScroll).toBe(true);
  });
});

// --- Evidence capture: the three mandatory super-board viewports ------------
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — info panel open (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    // Issues #22/#24: the details button is inside the chip's expanded
    // Tier-1 panel at every width.
    await expandButton(page, "AP Biology").click();
    await infoButton(page, "AP Biology").click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByText("scored 3 or higher"),
    ).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}
