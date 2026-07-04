import { test, expect } from "@playwright/test";

/**
 * super-board QA (issue #1) — evidence spec.
 *
 * One observable assertion per acceptance-criterion clause that is visible in
 * the browser, plus screenshot capture at the three standard super-board
 * viewports (desktop 1920x1080, tablet 1024x768, mobile 375x667). Screenshots
 * are written to the run evidence folder and committed to the issue branch so
 * they render inline on the issue / PR.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-1-qa-v1";

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC2 — / renders header + empty main with no console errors (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    // Document title
    await expect(page).toHaveTitle("AP Exam Planner");

    // Visible h1 header
    const h1 = page.getByRole("heading", { level: 1, name: "AP Exam Planner" });
    await expect(h1).toBeVisible();

    // Empty main region (AC2: "an empty main region")
    const main = page.getByRole("main");
    await expect(main).toBeAttached();
    await expect(main).toBeEmpty();

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });

    // Zero browser console errors (favicon noise ignored — none expected here).
    const meaningfulErrors = consoleErrors.filter((t) => !/favicon/i.test(t));
    expect(
      pageErrors,
      `Unexpected page errors: ${pageErrors.join(", ")}`,
    ).toEqual([]);
    expect(
      meaningfulErrors,
      `Unexpected console errors: ${meaningfulErrors.join(", ")}`,
    ).toEqual([]);
  });
}
