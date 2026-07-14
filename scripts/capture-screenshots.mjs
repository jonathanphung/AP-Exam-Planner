// Capture README screenshots of the running app with Playwright.
//
//   pnpm build && PORT=3000 pnpm start   # in one terminal (or `pnpm dev`)
//   node scripts/capture-screenshots.mjs
//
// Seeds realistic saved schedules via localStorage (the app's own
// `apx.schedules.v1` store) so every view renders with real exam dates,
// portfolio deadlines, and a populated "My Schedules" switcher — then writes
// the README PNGs to docs/screenshots/.
//
// BASE_URL overrides the target (defaults to http://localhost:3000).

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";

// The showcase plan: a heavy-but-real May 2026 load. Week 1 (May 4–8) fills
// with six non-colliding exams plus the two April 30 portfolio deadlines
// (AP Seminar + AP CSP) that anchor to it; week 2 carries the rest. A couple
// of extra saved schedules give the "My Schedules" switcher something to show.
const SCHEDULES = {
  activeId: "s1",
  schedules: [
    {
      id: "s1",
      name: "Full load",
      selection: [
        "biology",
        "microeconomics",
        "chemistry",
        "physics-1",
        "statistics",
        "united-states-history",
        "calculus-bc",
        "seminar",
        "computer-science-principles",
      ],
      resolutions: [],
    },
    {
      id: "s2",
      name: "STEM focus",
      selection: ["biology", "chemistry", "physics-1", "calculus-bc", "statistics"],
      resolutions: [],
    },
    {
      id: "s3",
      name: "Backup plan",
      selection: ["united-states-history", "psychology"],
      resolutions: [],
    },
  ],
};

// A deliberately colliding plan: AP Chemistry and AP Human Geography both sit
// in the May 5 morning slot, so the list view surfaces the conflict prompt.
const CONFLICT = {
  activeId: "c1",
  schedules: [
    {
      id: "c1",
      name: "My plan",
      selection: ["chemistry", "human-geography", "biology", "calculus-bc"],
      resolutions: [],
    },
  ],
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  async function open({ width, height, dsf = 1, store }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dsf,
    });
    await context.addInitScript((s) => {
      window.localStorage.setItem("apx.schedules.v1", JSON.stringify(s));
    }, store);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByTestId("site-footer").waitFor();
    await page.getByRole("heading", { name: "My Schedule", exact: true }).waitFor();
    // The cycle banner only renders once the schedule section has mounted.
    await page.getByText(/Dates reflect the .* AP exam cycle\./).waitFor();
    await page.waitForTimeout(400);
    return { context, page };
  }

  // 1 — Desktop hero: the sidebar (branding + My Schedules) beside the
  //     category-grouped catalog with a live selection. The app's front door.
  {
    const { context, page } = await open({ width: 1440, height: 1000, store: SCHEDULES });
    await page.getByText("9 selected").waitFor();
    await page.screenshot({ path: `${OUT_DIR}/home-desktop.png` });
    console.log("wrote home-desktop.png");
    await context.close();
  }

  // 2 — Calendar view: the week-paged grid with duration-proportional event
  //     blocks and the labeled +30-minute setup buffer (default view on load).
  {
    const { context, page } = await open({ width: 1440, height: 1000, store: SCHEDULES });
    const section = page.locator('section[aria-label="My exams"]');
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await section.screenshot({ path: `${OUT_DIR}/calendar-desktop.png` });
    console.log("wrote calendar-desktop.png");
    await context.close();
  }

  // 3 — Per-course details: the shared InfoPanel dialog reached from a catalog
  //     chip (timing/date → full exam details → official College Board link).
  {
    const { context, page } = await open({ width: 1440, height: 1000, store: SCHEDULES });
    await page.getByRole("button", { name: "Show exam dates for AP Biology" }).click();
    await page.getByRole("button", { name: "View exam details for AP Biology" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.getByRole("link", { name: /Official College Board page/ }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT_DIR}/subject-details.png` });
    console.log("wrote subject-details.png");
    await context.close();
  }

  // 4 — Sidebar: the "My Schedules" switcher (multiple client-side plans, no
  //     account) above the Resources list of verified official links.
  {
    const { context, page } = await open({ width: 1440, height: 1000, dsf: 2, store: SCHEDULES });
    const sidebar = page.locator('[data-testid="resources-sidebar"]');
    await sidebar.screenshot({ path: `${OUT_DIR}/sidebar-desktop.png` });
    console.log("wrote sidebar-desktop.png");
    await context.close();
  }

  // 5 — Conflict resolution: two exams in one slot; the list view prompts to
  //     move one to its official late-testing date.
  {
    const { context, page } = await open({ width: 1440, height: 1000, store: CONFLICT });
    await page.getByRole("button", { name: "List" }).click();
    await page.getByTestId("conflict-prompt").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT_DIR}/conflict-dialog.png` });
    console.log("wrote conflict-dialog.png");
    await context.close();
  }

  // 6 — Mobile: the responsive layout — no horizontal scroll at 390px.
  {
    const { context, page } = await open({ width: 390, height: 844, dsf: 2, store: SCHEDULES });
    await page.getByText("9 selected").waitFor();
    await page.screenshot({ path: `${OUT_DIR}/home-mobile.png` });
    console.log("wrote home-mobile.png");
    await context.close();
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
