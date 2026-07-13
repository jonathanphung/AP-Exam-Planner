import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import apData from "../src/data/ap-2026.json";

/**
 * super-board QA (issue #49) — Tester evidence spec.
 *
 * The Builder's e2e/issue-49-scrollbar-gutter.spec.ts carries the per-dialog
 * no-shift regression (AC1/AC7, verified to fail 5/6 against pre-#49 main)
 * and the AC5 overflow sweep. This spec adds the QA-side observables the
 * remaining ACs demand:
 *
 *   - AC3: the thumb/track contrast is MEASURED from the live computed CSS
 *     custom properties in both themes and asserted ≥ 3:1 (WCAG 1.4.11
 *     non-text), written to ac3-contrast-ratios.txt; the variables must
 *     actually differ between themes (the scrollbar is themed, not static).
 *   - AC4 (the macOS trap): WITHOUT any injected test CSS, the app's own
 *     `::-webkit-scrollbar` styling forces Chromium out of overlay-scrollbar
 *     mode — the test asserts the trap is ARMED (the app scrollbar occupies
 *     real layout width on a machine that would otherwise use overlay bars)
 *     and DEFUSED (opening a dialog still produces zero horizontal shift).
 *     This is exactly the "verify on macOS that no shift appears where none
 *     exists today" clause: pre-#49 main has no shift here only because it
 *     has no custom scrollbar; the branch has one, so it must also carry the
 *     gutter+compensation that keeps the width constant.
 *   - AC6: a dialog body (`max-h-[90vh] overflow-y-auto`) actually overflows
 *     and therefore renders the same themed inner scrollbar (builder's
 *     documented call: unscoped `::-webkit-scrollbar*` + inherited
 *     `scrollbar-color`), captured as evidence.
 *   - AC8: evidence screenshots light + dark — the styled scrollbar on the
 *     catalog page and a dialog open with no shift — desktop + one mobile
 *     width, plus the standard super-board viewport set.
 *
 * Like the Builder's spec, this file drops Playwright's `--hide-scrollbars`
 * so real (author-styled) scrollbars participate in layout and paint.
 */

test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-49-qa-v1";

const DESKTOP = { width: 1920, height: 1080 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 375, height: 667 };

type Subject = { id: string; name: string };
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const BIOLOGY = SUBJECTS.find((s) => s.id === "biology");
if (!BIOLOGY) throw new Error("fixture subject missing from dataset: biology");

function evidencePath(name: string): string {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  return path.join(EVIDENCE_DIR, name);
}

function writeEvidence(name: string, content: string) {
  fs.writeFileSync(evidencePath(name), content);
}

/** Resolve the app to dark mode the same way the theme store does (system →
 *  OS preference), before first paint so there is no flash. */
async function useDarkTheme(page: Page) {
  await page.emulateMedia({ colorScheme: "dark" });
}

/** The page h1 lives inside the centered `max-w-7xl` shell — its x moves iff
 *  the viewport width changes under the scroll lock (same probe as the
 *  Builder's regression spec). */
function probeX(page: Page): Promise<number> {
  return page
    .getByRole("heading", { level: 1 })
    .evaluate((el) => el.getBoundingClientRect().x);
}

/** Width the document scrollbar actually occupies in layout. Overlay
 *  scrollbars (and `--hide-scrollbars`) measure 0. */
function scrollbarLayoutWidth(page: Page): Promise<number> {
  return page.evaluate(
    () => window.innerWidth - document.documentElement.clientWidth,
  );
}

/** Hydration-safe dialog open (same retry rationale as the Builder's spec:
 *  pre-hydration clicks are no-ops). */
async function openFeedbackDialog(page: Page) {
  // Issue #60: unscoped role query — the pair is rendered in the sidebar
  // (desktop) and the site footer (mobile) with complementary CSS visibility,
  // so exactly one copy is in the a11y tree at any viewport.
  const opener = page.getByRole("button", { name: "Send us Feedback" });
  const dialog = page.getByTestId("feedback-dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Two-step InfoPanel open per the #22/#24 grouped-chip IA: expand the
 *  subject chip, then click the details affordance. */
async function openExamDetails(page: Page) {
  const opener = page.getByRole("button", {
    name: `View exam details for ${BIOLOGY!.name}`,
  });
  await expect(async () => {
    if ((await opener.count()) === 0)
      await page
        .getByRole("button", { name: `Show exam dates for ${BIOLOGY!.name}` })
        .click();
    await expect(opener).toBeVisible({ timeout: 1000 });
  }).toPass();
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
}

// ── AC3 — measured thumb/track contrast, both themes ────────────────────────

/** WCAG relative luminance of a `#rrggbb` hex color. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrastRatio(hexA: string, hexB: string): number {
  const [la, lb] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort(
    (x, y) => y - x,
  );
  return (la + 0.05) / (lb + 0.05);
}

async function scrollbarPalette(page: Page) {
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      track: styles.getPropertyValue("--scrollbar-track").trim(),
      thumb: styles.getPropertyValue("--scrollbar-thumb").trim(),
      thumbHover: styles.getPropertyValue("--scrollbar-thumb-hover").trim(),
    };
  });
}

test("AC3 — thumb/track contrast measured from live CSS is ≥ 3:1 in light AND dark, and the palette is theme-aware", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const light = await scrollbarPalette(page);

  await useDarkTheme(page);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
  const dark = await scrollbarPalette(page);

  const hex = /^#[0-9a-f]{6}$/i;
  for (const [theme, palette] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    expect(palette.track, `${theme} track is a solid hex color`).toMatch(hex);
    expect(palette.thumb, `${theme} thumb is a solid hex color`).toMatch(hex);
    expect(
      palette.thumbHover,
      `${theme} hover thumb is a solid hex color`,
    ).toMatch(hex);
  }

  const measured = {
    light: {
      thumbVsTrack: contrastRatio(light.thumb, light.track),
      hoverVsTrack: contrastRatio(light.thumbHover, light.track),
    },
    dark: {
      thumbVsTrack: contrastRatio(dark.thumb, dark.track),
      hoverVsTrack: contrastRatio(dark.thumbHover, dark.track),
    },
  };

  // WCAG 1.4.11 non-text contrast: UI component vs adjacent color ≥ 3:1.
  expect(measured.light.thumbVsTrack).toBeGreaterThanOrEqual(3);
  expect(measured.light.hoverVsTrack).toBeGreaterThanOrEqual(3);
  expect(measured.dark.thumbVsTrack).toBeGreaterThanOrEqual(3);
  expect(measured.dark.hoverVsTrack).toBeGreaterThanOrEqual(3);

  // Themed, not static: the track must actually change with the theme.
  expect(dark.track).not.toBe(light.track);

  writeEvidence(
    "ac3-contrast-ratios.txt",
    [
      "AC3 — scrollbar thumb/track contrast, measured from computed CSS custom properties",
      "(WCAG relative luminance; requirement: ≥ 3:1 per WCAG 1.4.11 non-text contrast)",
      "",
      `light: thumb ${light.thumb} on track ${light.track} = ${measured.light.thumbVsTrack.toFixed(2)}:1`,
      `light: hover ${light.thumbHover} on track ${light.track} = ${measured.light.hoverVsTrack.toFixed(2)}:1`,
      `dark:  thumb ${dark.thumb} on track ${dark.track} = ${measured.dark.thumbVsTrack.toFixed(2)}:1`,
      `dark:  hover ${dark.thumbHover} on track ${dark.track} = ${measured.dark.hoverVsTrack.toFixed(2)}:1`,
      "",
    ].join("\n"),
  );
});

// ── AC4 — the macOS trap: app CSS alone forces classic mode; no shift ───────

test("AC4 — with NO injected CSS, the app's own scrollbar styling occupies layout width yet dialogs open with zero shift (the macOS trap is defused)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Trap armed: `::-webkit-scrollbar { width: 10px }` in globals.css forces
  // Chromium out of overlay mode, so the styled scrollbar takes real layout
  // width — on macOS this is exactly the regression a custom scrollbar
  // WITHOUT gutter stabilization would have introduced.
  const width = await scrollbarLayoutWidth(page);
  expect(
    width,
    "app CSS alone must force a classic (space-taking) scrollbar",
  ).toBeGreaterThan(0);

  // Trap defused: gutter reservation + one-place compensation keep the
  // probe fixed through open → close.
  const before = await probeX(page);
  await openFeedbackDialog(page);
  const whileOpen = await probeX(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feedback-dialog")).toHaveCount(0);
  const after = await probeX(page);

  expect(whileOpen, "no shift introduced where none exists today").toBe(
    before,
  );
  expect(after, "content returns to its exact position").toBe(before);

  writeEvidence(
    "ac4-macos-trap.txt",
    [
      "AC4 — macOS trap measurement (no test CSS injected; app styles only)",
      `document scrollbar layout width: ${width}px (classic mode forced by app ::-webkit-scrollbar styling)`,
      `probe x before open:  ${before}`,
      `probe x while open:   ${whileOpen}`,
      `probe x after close:  ${after}`,
      "zero shift through open → close: PASS",
      "",
    ].join("\n"),
  );
});

// ── AC6 — inner scrollables adopt the same themed scrollbar ─────────────────

test("AC6 — a dialog body overflows and scrolls with the same custom scrollbar (evidence screenshot)", async ({
  page,
}) => {
  // Short viewport so the exam-details panel (max-h-[90vh] overflow-y-auto)
  // actually overflows and shows its inner scrollbar.
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto("/");
  await openExamDetails(page);

  const panel = page.getByRole("dialog");
  const overflows = await panel.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  expect(overflows, "dialog body must overflow to exercise AC6").toBe(true);

  // The inner scroller must itself be classic-mode (the unscoped WebKit
  // styling applies to every scroller, not just the document).
  const innerScrollbarWidth = await panel.evaluate(
    (el) => (el as HTMLElement).offsetWidth - el.clientWidth,
  );
  expect(
    innerScrollbarWidth,
    "inner scrollable renders a space-taking themed scrollbar",
  ).toBeGreaterThan(0);

  await page.screenshot({
    path: evidencePath("ac6-inner-scrollbar-dialog-light-desktop.png"),
  });
});

// ── AC8 — evidence screenshots, light + dark, desktop + mobile ──────────────

test("AC8 — standard super-board viewport screenshots (light, catalog with styled scrollbar)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const [name, viewport] of [
    ["desktop.png", DESKTOP],
    ["tablet.png", TABLET],
    ["mobile.png", MOBILE],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: evidencePath(name) });
  }
});

test("AC8 — light desktop: styled scrollbar on the catalog + dialog open with no shift", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const before = await probeX(page);
  await page.screenshot({
    path: evidencePath("ac8-catalog-scrollbar-light-desktop.png"),
  });

  await openFeedbackDialog(page);
  expect(await probeX(page), "zero shift with the dialog open (light)").toBe(
    before,
  );
  await page.screenshot({
    path: evidencePath("ac8-dialog-open-no-shift-light-desktop.png"),
  });
});

test("AC8 — dark desktop: styled scrollbar on the catalog + dialog open with no shift", async ({
  page,
}) => {
  await useDarkTheme(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const before = await probeX(page);
  await page.screenshot({
    path: evidencePath("ac8-catalog-scrollbar-dark-desktop.png"),
  });

  await openFeedbackDialog(page);
  expect(await probeX(page), "zero shift with the dialog open (dark)").toBe(
    before,
  );
  await page.screenshot({
    path: evidencePath("ac8-dialog-open-no-shift-dark-desktop.png"),
  });
});

test("AC8 — mobile 375: catalog (light) + dialog open (dark), no horizontal overflow either way", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    "no horizontal overflow at 375 (light)",
  ).toBe(0);
  await page.screenshot({
    path: evidencePath("ac8-catalog-light-mobile.png"),
  });

  await useDarkTheme(page);
  await page.goto("/");
  await openExamDetails(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    "no horizontal overflow at 375 with a dialog open (dark)",
  ).toBe(0);
  await page.screenshot({
    path: evidencePath("ac8-dialog-open-dark-mobile.png"),
  });
});
