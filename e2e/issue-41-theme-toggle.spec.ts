import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * super-board QA (issue #41) — theme toggle, REVISED for Jon's 2026-07-09
 * bounce. The control is now:
 *   • a two-state light ↔ dark button (no monitor / "system" glyph anywhere);
 *   • placed in the sidebar BRANDING row, immediately left of the collapse
 *     control (not in the footer);
 *   • its glyph a pure function of the *resolved* theme (light → sun,
 *     dark → moon);
 *   • `system` survives only as the silent first-visit default: the first
 *     click writes the explicit opposite of the resolved theme and stops
 *     following the OS; there is no route back to `system` from the UI.
 *
 * One observable, browser-level test per acceptance-criterion clause that the
 * unit suite (src/lib/theme.test.ts, the pure core) cannot reach: the DOM /
 * storage shell — pre-paint FOUC prevention, persistence, System live-follow
 * before the first click, the class-based dark strategy, both presentations +
 * the collapsed rail, the absence of the monitor glyph, and the #8 a11y bar.
 *
 * Test hooks (from the Builder's handoff):
 *   data-testid="theme-toggle"        — the toggle button
 *   data-testid="theme-announcement"  — the polite live region
 *   data-testid="sidebar-branding"    — the branding row it now lives in
 *   data-testid="sidebar-footer"      — the footer (now Feedback + GitHub only)
 *   apx.theme.v1                      — the localStorage key
 */

const THEME_KEY = "apx.theme.v1";
const EVIDENCE_DIR = "docs/super-board/runs/issue-41-qa-v2";

type Resolved = "light" | "dark";
/** The accessible name the button renders for a given resolved theme:
 *  `Theme: <state>. Switch to <other> theme.` (state + action). */
const nameFor = (resolved: Resolved) =>
  `Theme: ${resolved}. Switch to ${resolved === "dark" ? "light" : "dark"} theme.`;

const toggle = (page: Page) => page.getByTestId("theme-toggle");
const announcement = (page: Page) => page.getByTestId("theme-announcement");
const githubLink = (page: Page) =>
  page.getByRole("link", { name: /GitHub repository/ });
const collapseBtn = (page: Page) =>
  page.getByRole("button", { name: "Collapse sidebar" });
const expandBtn = (page: Page) =>
  page.getByRole("button", { name: "Expand sidebar" });

type HtmlState = { dark: boolean; colorScheme: string };
const htmlState = (page: Page): Promise<HtmlState> =>
  page.evaluate(() => ({
    dark: document.documentElement.classList.contains("dark"),
    colorScheme: document.documentElement.style.colorScheme,
  }));

/**
 * Identify the rendered glyph structurally, without leaning on brittle path
 * data: the SUN is the only glyph with a <circle>, the MONITOR was the only
 * glyph with a <rect>, and the MOON has neither. So `{circles:1,rects:0}` ⇒
 * sun, `{circles:0,rects:0}` ⇒ moon, and any `rects>0` would mean the deleted
 * monitor glyph resurfaced. Scoped to the toggle's own <svg> (the collapse
 * control's panel glyph, which does use a <rect>, is a different element).
 */
const glyph = (page: Page) =>
  toggle(page)
    .locator("svg")
    .evaluate((svg) => ({
      circles: svg.querySelectorAll("circle").length,
      rects: svg.querySelectorAll("rect").length,
    }));

/** Seed the stored preference before any app script runs (pre-paint path). */
async function seedTheme(page: Page, value: string) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [THEME_KEY, value] as const,
  );
}

/**
 * Read the body's painted background as concrete sRGB, colour-space-agnostic:
 * Tailwind v4 emits `slate-950` in `lab()`/`oklab()`, so string-comparing
 * `rgb(2,6,23)` is brittle. Painting the computed colour onto a 1×1 canvas and
 * sampling the pixel normalises whatever space the engine chose. `sum` is
 * r+g+b (0–765): near 0 = near-black (dark theme), near 765 = white (light).
 */
async function bodyBg(page: Page): Promise<{ sum: number }> {
  return page.evaluate(() => {
    const c = getComputedStyle(document.body).backgroundColor;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { sum: r + g + b };
  });
}

// ── Icon semantics: glyph = resolved theme; monitor is gone ──────────────────

test("AC: glyph reflects the resolved theme on first load — light OS → sun", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/"); // default preference = system → resolves light

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  expect(await glyph(page)).toEqual({ circles: 1, rects: 0 }); // sun
  expect((await htmlState(page)).dark).toBe(false);
});

test("AC: glyph reflects the resolved theme on first load — dark OS → moon", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/"); // default = system → resolves dark (follows the OS)

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect(await glyph(page)).toEqual({ circles: 0, rects: 0 }); // moon
  expect((await htmlState(page)).dark).toBe(true);
});

test("AC: the monitor glyph is absent in every state (deleted)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/"); // system (moon)
  expect((await glyph(page)).rects, "no monitor on the system default").toBe(0);

  await toggle(page).click(); // system(dark) → explicit light (sun)
  expect((await glyph(page)).rects, "no monitor after first click").toBe(0);
  await toggle(page).click(); // light → dark (moon)
  expect((await glyph(page)).rects, "no monitor after a second click").toBe(0);
  await toggle(page).click(); // dark → light (sun)
  expect((await glyph(page)).rects, "no monitor ever").toBe(0);
});

// ── Behavior: first click out of system, then a plain two-state toggle ───────

test("AC: first click out of system picks the opposite of the resolved theme — OS dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  // First visit: silent system, resolves dark (moon), no stored preference yet.
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBeNull();

  // First click writes the explicit OPPOSITE of the resolved (dark) theme.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  expect(await glyph(page)).toEqual({ circles: 1, rects: 0 }); // sun
  expect((await htmlState(page)).dark).toBe(false);
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe(
    "light",
  );
});

test("AC: first click out of system picks the opposite of the resolved theme — OS light", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  await toggle(page).click(); // resolves light → explicit dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect((await htmlState(page)).dark).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe(
    "dark",
  );
});

test("AC: after the first click it is a plain two-state light ↔ dark toggle", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await toggle(page).click(); // system → dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  await toggle(page).click(); // dark → light
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  await toggle(page).click(); // light → dark  (never lands back on system)
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
});

test("AC: an explicit choice stops following the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/"); // system, resolves dark

  await toggle(page).click(); // → explicit light
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));

  // OS is (still) dark, and now flips around — the explicit light must win.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  expect((await htmlState(page)).dark).toBe(false);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(150);
  expect((await htmlState(page)).dark).toBe(false);
});

test("AC: System mode follows a live OS change (before any click)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/"); // default = system

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  expect((await htmlState(page)).dark).toBe(false);

  // OS → dark: system follows it live (no reload, no click) → moon.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await htmlState(page)).dark).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));

  // OS → light again: follows back.
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await htmlState(page)).dark).toBe(false);
});

test("AC: choice persists across reload/session under apx.theme.v1", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await toggle(page).click(); // system(light) → explicit dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe(
    "dark",
  );

  await page.reload();

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect((await htmlState(page)).dark).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe(
    "dark",
  );
});

test("AC: a stored 'system' still resolves correctly on load", async ({
  page,
}) => {
  // system is never written by the UI anymore, but a value persisted before
  // this change (or hand-set) must still resolve and live-follow the OS.
  await seedTheme(page, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect((await htmlState(page)).dark).toBe(true);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await htmlState(page)).dark).toBe(false);
});

test("AC: a malformed stored value degrades to system (no crash)", async ({
  page,
}) => {
  await seedTheme(page, "chartreuse");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  // Degrades to system → follows the (dark) OS, and the control still works.
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  expect((await htmlState(page)).dark).toBe(true);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
});

// ── No FOUC / color-scheme / class strategy / SSR-safety ─────────────────────

test("AC: no flash of the wrong theme (pre-paint apply) — Dark stored on a light OS", async ({
  page,
}) => {
  await seedTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(
    (await htmlState(page)).dark,
    "pre-paint script must apply .dark before first paint",
  ).toBe(true);
  expect((await bodyBg(page)).sum, "body already painted dark (no white flash)")
    .toBeLessThan(120);
});

test("AC: color-scheme is set to match the active theme (native UI)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  expect((await htmlState(page)).colorScheme).toBe("light"); // system → light
  await toggle(page).click(); // → dark
  expect((await htmlState(page)).colorScheme).toBe("dark");
  await toggle(page).click(); // → light
  expect((await htmlState(page)).colorScheme).toBe("light");
});

test("AC: class strategy — .dark on <html> flips existing dark: utilities", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const lightBg = await bodyBg(page);
  expect(lightBg.sum, "light body is near-white").toBeGreaterThan(700);

  await toggle(page).click(); // system(light) → explicit dark
  expect((await htmlState(page)).dark).toBe(true);
  const darkBg = await bodyBg(page);
  expect(darkBg.sum, "dark body is near-black").toBeLessThan(120);
  expect(darkBg.sum).toBeLessThan(lightBg.sum);
});

test("AC: SSR-safe store — no hydration mismatch warning with a stored preference", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await seedTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/", { waitUntil: "networkidle" });

  const hydrationNoise = errors.filter((t) =>
    /hydrat|did not match|mismatch/i.test(t),
  );
  expect(
    hydrationNoise,
    `hydration warnings: ${hydrationNoise.join(" | ")}`,
  ).toEqual([]);
});

// ── Placement & presentation ────────────────────────────────────────────────

test("AC: lives in the branding row, immediately left of the collapse control, same size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  await expect(toggle(page)).toBeVisible();
  await expect(collapseBtn(page)).toBeVisible();

  // In the branding row (above the support row), not in either support row.
  // Issue #60 added a second support row inside the site footer — the toggle
  // must not have followed it there either.
  const branding = page.getByTestId("sidebar-branding");
  await expect(branding.getByTestId("theme-toggle")).toBeVisible();
  await expect(
    page.getByTestId("sidebar-footer").getByTestId("theme-toggle"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("footer-support-links").getByTestId("theme-toggle"),
  ).toHaveCount(0);

  const t = await toggle(page).boundingBox();
  const c = await collapseBtn(page).boundingBox();
  expect(t && c).toBeTruthy();
  // Same icon-box size as the collapse control (both h-8 w-8 at lg): within 2px.
  expect(Math.abs(t!.width - c!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(t!.height - c!.height)).toBeLessThanOrEqual(2);
  // Immediately to the LEFT of the collapse control (per Jon's bounce).
  expect(t!.x).toBeLessThan(c!.x);
});

test("AC: h1 stays uncrowded / untruncated after the move (1024 and 1920)", async ({
  page,
}) => {
  for (const width of [1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1, name: "AP Exam Planner" });
    await expect(h1).toBeVisible();
    // The single h1 is not clipped by its `truncate` guard (scrollWidth would
    // exceed clientWidth if it were), so the title reads in full beside the
    // two-control cluster.
    const clipped = await h1.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(clipped, `h1 truncated at ${width}px`).toBe(false);
    // Toggle sits between the title and the collapse control.
    const h1Box = await h1.boundingBox();
    const tBox = await toggle(page).boundingBox();
    const cBox = await collapseBtn(page).boundingBox();
    expect(h1Box!.x + h1Box!.width).toBeLessThanOrEqual(tBox!.x + 1);
    expect(tBox!.x).toBeLessThan(cBox!.x);
  }
});

test("AC: renders in the mobile presentation with a 44px touch target", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  await expect(toggle(page)).toBeVisible();
  const box = await toggle(page).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("AC: reachable & operable when the desktop sidebar is collapsed (rail)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(toggle(page)).toBeVisible();
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();

  // Theme toggle AND the GitHub mark both stay reachable in the ~40px rail.
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toBeEnabled();
  await expect(githubLink(page)).toBeVisible();

  // Operable from the rail.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
});

for (const width of [320, 375, 1024, 1920]) {
  test(`AC: no horizontal page scroll at ${width}px (expanded)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  });
}

test("AC: no horizontal scroll with the collapsed rail (desktop)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

// ── Accessibility (the #8 bar) ───────────────────────────────────────────────

test("AC: real button semantics; name conveys state + action", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const tag = await toggle(page).evaluate((el) => el.tagName);
  expect(tag).toBe("BUTTON");
  await expect(toggle(page)).toHaveAttribute(
    "aria-label",
    /^Theme: (light|dark)\. Switch to (light|dark) theme\.$/,
  );
});

test("AC: new state announced on activation (polite live region)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(announcement(page)).toHaveText(""); // nothing read on load
  expect(await announcement(page).getAttribute("aria-live")).toBe("polite");

  await toggle(page).click(); // → dark
  await expect(announcement(page)).toHaveText("Theme: dark.");
  await toggle(page).click(); // → light
  await expect(announcement(page)).toHaveText("Theme: light.");
});

test("AC: keyboard operable (Enter / Space activate from focus)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await toggle(page).focus();
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
  ).toBe("theme-toggle");

  await page.keyboard.press("Enter"); // system(light) → dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  await page.keyboard.press(" "); // dark → light
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
});

test("AC: icon is decorative (aria-hidden); button carries the name", async ({
  page,
}) => {
  await page.goto("/");
  const svgHidden = await toggle(page)
    .locator("svg")
    .first()
    .getAttribute("aria-hidden");
  expect(svgHidden).toBe("true");
  const name = await toggle(page).getAttribute("aria-label");
  expect(name && name.length).toBeGreaterThan(0);
});

test("AC: respects prefers-reduced-motion (no theme-transition animation)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/");

  const htmlDur = await page.evaluate(
    () => getComputedStyle(document.documentElement).transitionDuration,
  );
  const bodyDur = await page.evaluate(
    () => getComputedStyle(document.body).transitionDuration,
  );
  expect(parseFloat(htmlDur)).toBe(0);
  expect(parseFloat(bodyDur)).toBe(0);

  await toggle(page).click(); // still functions under reduced motion
  expect((await htmlState(page)).dark).toBe(true);
});

test("AC: branding control cluster is axe-clean in both themes (AA contrast)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const scanBranding = async () =>
    new AxeBuilder({ page })
      .include('[data-testid="sidebar-branding"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

  // Light (explicit)
  await toggle(page).click(); // system(light) → dark
  await toggle(page).click(); // dark → light
  const light = await scanBranding();
  const lightSerious = light.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    lightSerious,
    `light branding violations: ${lightSerious.map((v) => v.id).join(", ")}`,
  ).toEqual([]);

  // Dark (explicit)
  await toggle(page).click(); // light → dark
  expect((await htmlState(page)).dark).toBe(true);
  const dark = await scanBranding();
  const darkSerious = dark.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    darkSerious,
    `dark branding violations: ${darkSerious.map((v) => v.id).join(", ")}`,
  ).toEqual([]);
});

// ── Evidence capture (light/dark, expanded/collapsed, desktop/mobile) ────────

test("evidence — branding-row toggle: light & dark, expanded & collapsed, desktop & mobile", async ({
  page,
}) => {
  // Desktop 1920 — system default on a light OS (sun, light theme). This shot
  // also documents the h1 still reading as centered/balanced after the move.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(toggle(page)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/desktop.png`, fullPage: true });
  await page.screenshot({ path: `${EVIDENCE_DIR}/light-desktop.png`, fullPage: true });

  // Desktop dark (explicit)
  await toggle(page).click(); // → dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  await page.screenshot({ path: `${EVIDENCE_DIR}/dark-desktop.png`, fullPage: true });

  // Collapsed rail — dark, then light (both controls + GitHub reachable)
  await collapseBtn(page).click();
  await expect(expandBtn(page)).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/collapsed-dark-desktop.png`,
    fullPage: true,
  });
  await toggle(page).click(); // dark → light in the rail
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("light"));
  await page.screenshot({
    path: `${EVIDENCE_DIR}/collapsed-light-desktop.png`,
    fullPage: true,
  });

  // Tablet 1024×768 — system/light
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(toggle(page)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/tablet.png`, fullPage: true });

  // Mobile 375×667 — system/light (default), then explicit dark
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(toggle(page)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/mobile.png`, fullPage: true });
  await toggle(page).click(); // → dark
  await expect(toggle(page)).toHaveAttribute("aria-label", nameFor("dark"));
  await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-dark.png`, fullPage: true });
});
