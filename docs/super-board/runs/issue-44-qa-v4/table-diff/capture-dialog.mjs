/**
 * QA v4 (issue #44 / PR #53) — captures the AP Calculus AB details-dialog
 * ELEMENT screenshot (light + dark) against a running app instance.
 *
 * Used for the AC2 "parts/table branch byte-untouched" runtime proof:
 * run once against origin/main and once against issue-44-9px-matched-spacing
 * (same machine, same Chromium, same fonts), then pixel-diff the pairs —
 * an untouched table branch must produce 0 differing pixels.
 *
 * Usage: node capture-dialog.mjs <baseURL> <outPrefix>
 *   e.g.: node capture-dialog.mjs http://localhost:3211 main
 */
import { chromium } from "@playwright/test";

const [baseURL, outPrefix] = process.argv.slice(2);
if (!baseURL || !outPrefix) {
  console.error("usage: node capture-dialog.mjs <baseURL> <outPrefix>");
  process.exit(1);
}

const THEME_KEY = "apx.theme.v1";
const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();
  if (theme === "dark") {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [THEME_KEY, "dark"],
    );
  }
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Show exam dates for AP Calculus AB" })
    .click();
  await page
    .getByRole("button", { name: "View exam details for AP Calculus AB" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.locator("table").waitFor({ state: "visible" });
  await page.waitForTimeout(400); // let any open-transition settle
  await dialog.screenshot({
    path: `${outPrefix}-calc-dialog-${theme}.png`,
    animations: "disabled",
  });
  await context.close();
}

await browser.close();
console.log(`captured ${outPrefix}-calc-dialog-{light,dark}.png`);
