// Capture README screenshots of the running app with Playwright.
//
//   pnpm dev                       # in one terminal (or any PORT)
//   node scripts/capture-screenshots.mjs
//
// Seeds a realistic "My Exams" selection via localStorage (the same
// `apx.selection.v1` key the app uses) so the schedule renders with real
// exam dates and portfolio deadlines, then writes PNGs to docs/screenshots/.
//
// BASE_URL overrides the target (defaults to http://localhost:3000).

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";

// A spread of exams (AM + PM) plus two through-course portfolio deadlines
// (AP Seminar + AP CSP, both due 2026-04-30) so the schedule shows off the
// portfolio-deadline styling alongside regular exam days.
const SELECTION = ["biology", "calculus-bc", "seminar", "computer-science-principles"];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  async function shoot({ name, width, height, deviceScaleFactor = 2, fullPage = false, selector }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
    await context.addInitScript((ids) => {
      window.localStorage.setItem("apx.selection.v1", JSON.stringify(ids));
    }, SELECTION);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByTestId("site-footer").waitFor();
    await page.getByRole("heading", { name: "My Schedule" }).waitFor();
    // Wait for a seeded schedule entry so we never capture an empty state.
    await page.getByText("AP Biology").first().waitFor();
    await page.waitForTimeout(400);

    const path = `${OUT_DIR}/${name}.png`;
    if (selector) {
      await page.locator(selector).screenshot({ path });
    } else {
      await page.screenshot({ path, fullPage });
    }
    console.log(`wrote ${path}`);
    await context.close();
  }

  // Desktop: whole app top-to-bottom (catalog + schedule + footer).
  await shoot({ name: "home-desktop", width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true });
  // Just the populated schedule section — the money shot for the README.
  await shoot({ name: "schedule", width: 1440, height: 900, selector: 'section[aria-label="My schedule"]' });
  // Mobile: proves the responsive, no-horizontal-scroll layout.
  await shoot({ name: "home-mobile", width: 390, height: 844, fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
