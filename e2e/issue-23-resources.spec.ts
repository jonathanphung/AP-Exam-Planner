import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * super-board QA (issue #23) — Resources sidebar of curated official College
 * Board links.
 *
 * Per Jon's design bounce on PR #25, the resources no longer live on a dedicated
 * `/resources` route. They render inside the main app as a persistent left
 * sidebar on desktop (≥1024px) and a collapsed disclosure near the top of the
 * page on mobile/tablet (<1024px). These specs assert both presentations.
 *
 * One observable assertion per acceptance-criterion clause:
 *   AC1 — grouped headings + real anchors with descriptive text (never "click here").
 *   AC2 — every link is a real https collegeboard.org URL; no placeholder/# hrefs.
 *   AC3 — links open in a new tab (target=_blank + rel=noopener noreferrer) with a
 *         visible ↗ and an assistive-tech "(opens in a new tab)" hint.
 *   AC4 — reachable in the app's primary layout without breaking the single-page
 *         planner flow: a persistent sidebar on desktop, a disclosure on mobile.
 *   AC5 — the "Not affiliated with College Board" footer notice stays visible.
 *   AC6 — cycle-labeled links read the cycle from apData.cycle (not hardcoded).
 *   AC7 — accessible + responsive at 375 / 1024 / 1920 px, no horizontal overflow,
 *         keyboard-focusable links.
 */

const REPO_ROOT = resolve(__dirname, "..");
const CYCLE = (
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, "src/data/ap-2026.json"), "utf8"),
  ) as { cycle: string }
).cycle;

const GROUP_HEADINGS = ["Exam logistics", "Scores", "Planning & deadlines"];

const SIDEBAR = "aside[data-testid='resources-sidebar']";
const RESOURCE_LINKS = `${SIDEBAR} #resources-panel a[target='_blank']`; // scoped: the #29 footer row added non-resource links to the sidebar

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 667 };

/**
 * On mobile the sidebar is a collapsed disclosure; expand it so its links are
 * rendered/focusable. On desktop the panel is always shown, so this is a no-op.
 */
async function revealSidebar(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: /^resources$/i });
  if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded === "false") await toggle.click();
  }
}

// ── AC1: grouped headings + descriptive anchors ─────────────────────────────
test("AC1 — grouped headings with real, descriptively-labeled anchors", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Sidebar landmark + its "Resources" heading are present on the main app.
  await expect(page.locator(SIDEBAR)).toBeVisible();
  await expect(
    page.locator(`${SIDEBAR} h2:visible`, { hasText: "Resources" }),
  ).toBeVisible();

  for (const heading of GROUP_HEADINGS) {
    await expect(
      page.getByRole("heading", { level: 3, name: heading }),
    ).toBeVisible();
  }

  const links = page.locator(RESOURCE_LINKS);
  const count = await links.count();
  expect(count, "expected several curated resource links").toBeGreaterThanOrEqual(6);

  for (let i = 0; i < count; i++) {
    const text = (await links.nth(i).innerText()).trim();
    expect(text.length).toBeGreaterThan(3);
    expect(text.toLowerCase()).not.toMatch(/click here|read more|learn more/);
  }
});

// ── AC2: every href is a real official collegeboard.org URL ─────────────────
test("AC2 — every resource link is a real https collegeboard.org URL, no placeholders", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const hrefs = await page.locator(RESOURCE_LINKS).evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
  );

  expect(hrefs.length).toBeGreaterThanOrEqual(6);
  for (const href of hrefs) {
    expect(href).not.toBe("#");
    expect(href.startsWith("https://"), `not https: ${href}`).toBe(true);
    const host = new URL(href).hostname;
    expect(host.endsWith("collegeboard.org"), `not collegeboard.org: ${href}`).toBe(
      true,
    );
    expect(href.toLowerCase()).not.toMatch(/example\.|localhost|placeholder|todo|tbd/);
  }
  // No duplicate links.
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

// ── AC3: new-tab semantics + external-link affordance ───────────────────────
test("AC3 — links open in a new tab with rel=noopener noreferrer and an accessible arrow icon", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const links = page.locator(RESOURCE_LINKS);
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(6);

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");

    // Visible external-link indicator (inline SVG icon, issue #50) present.
    await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);

    // The indicator is decorative (aria-hidden) and the new-tab hint is
    // conveyed to assistive tech via visually-hidden text.
    await expect(link.locator("[aria-hidden='true']")).toHaveCount(1);
    await expect(
      link.getByText("(opens in a new tab)", { exact: false }),
    ).toHaveCount(1);

    // Accessible name includes the new-tab hint (screen readers announce it).
    const accName = await link.evaluate((el) => el.textContent ?? "");
    expect(accName.toLowerCase()).toContain("opens in a new tab");
  }
});

// ── AC4a: persistent sidebar beside the planner on desktop ──────────────────
test("AC4 (desktop) — persistent sidebar renders beside the intact single-page planner", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // The single-page planner is intact: header, catalog, and schedule content.
  await expect(
    page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
  ).toBeVisible();
  await expect(page.getByRole("main", { name: "Exam planner" })).toBeVisible();

  // The sidebar and its links are visible with no interaction (persistent).
  const sidebar = page.locator(SIDEBAR);
  await expect(sidebar).toBeVisible();
  await expect(page.locator(RESOURCE_LINKS).first()).toBeVisible();

  // No route change — still the single-page app.
  await expect(page).toHaveURL(/\/$/);

  // The mobile disclosure toggle is hidden at desktop width.
  await expect(page.getByRole("button", { name: /^resources$/i })).toBeHidden();
});

// ── AC4b: collapsed disclosure on mobile ────────────────────────────────────
test("AC4 (mobile) — resources collapse into an accessible disclosure near the top", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  const toggle = page.getByRole("button", { name: /^resources$/i });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "resources-panel");

  // Collapsed by default: links are not yet shown.
  await expect(page.locator(RESOURCE_LINKS).first()).toBeHidden();

  // Expanding the disclosure reveals the same curated links.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(RESOURCE_LINKS).first()).toBeVisible();
  expect(await page.locator(RESOURCE_LINKS).count()).toBeGreaterThanOrEqual(6);

  // The planner content sits below the disclosure and stays intact.
  await expect(
    page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
  ).toBeVisible();

  // Collapsible again.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(RESOURCE_LINKS).first()).toBeHidden();
});

// ── AC5: non-affiliation footer notice stays visible ────────────────────────
test("AC5 — the non-affiliation footer notice is present on the home page", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const footer = page.locator('footer[data-testid="site-footer"]');
  await expect(footer).toBeVisible();
  await expect(
    footer.getByText("Not affiliated with College Board.", { exact: false }),
  ).toBeVisible();
});

// ── AC6: cycle-labeled link derives from apData.cycle ───────────────────────
test("AC6 — cycle-labeled links read the cycle from the dataset metadata", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  // The exam-dates and late-testing links are labeled with the dataset cycle.
  const cycleLinks = page.locator(RESOURCE_LINKS, { hasText: `${CYCLE} AP` });
  expect(await cycleLinks.count()).toBeGreaterThanOrEqual(1);
  await expect(cycleLinks.first()).toContainText(CYCLE);
});

// ── AC7: accessible + responsive, no horizontal overflow ────────────────────
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC7 — no horizontal overflow and keyboard-focusable links (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/", { waitUntil: "networkidle" });

    const overflows = async (label: string) => {
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(
        scrollWidth,
        `Horizontal overflow (${label}) at ${vp.width}px: scrollWidth=${scrollWidth}`,
      ).toBeLessThanOrEqual(vp.width + 1);
    };

    // No overflow in the default (collapsed on mobile) state...
    await overflows("default");

    // ...nor once the resource links are revealed.
    await revealSidebar(page);
    await overflows("sidebar-open");

    // First resource link is keyboard-focusable (real anchor, receives focus).
    const firstLink = page.locator(RESOURCE_LINKS).first();
    await firstLink.focus();
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        tag: el?.tagName.toLowerCase() ?? "",
        target: el?.getAttribute("target") ?? "",
      };
    });
    expect(focused.tag).toBe("a");
    expect(focused.target).toBe("_blank");
  });
}

// ── Clean render (no console/page errors) ───────────────────────────────────
test("Home page with the resources sidebar renders without console or page errors", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator(SIDEBAR)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
  ).toBeVisible();

  expect(pageErrors, `page errors: ${pageErrors.join(", ")}`).toEqual([]);
  const meaningful = consoleErrors.filter((t) => !/favicon/i.test(t));
  expect(meaningful, `console errors: ${meaningful.join(", ")}`).toEqual([]);
});
