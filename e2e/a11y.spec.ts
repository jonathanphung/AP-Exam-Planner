import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import apData from "../src/data/ap-2026.json";
import { pressViewChip } from "./support/view-chip";

/**
 * Responsive + accessibility hardening (issue #8).
 *
 * One observable test per acceptance criterion:
 *   AC1 — keyboard: tab order, visible focus indicators, focus-trapped
 *         dialogs (conflict + info panel) that close on Escape.
 *   AC2 — axe-core scans (via @axe-core/playwright) across the main page
 *         states report zero serious/critical violations.
 *   AC3 — conflict warning + "moved to late testing" styles measure ≥ 4.5:1
 *         (ratios are printed in the assertion messages for QA evidence).
 *   AC4 — 375×667: no horizontal scroll (dialogs included), primary tap
 *         targets ≥ 44×44 px.
 *   AC5 — landmarks/labels: one h1, labelled search, named icon buttons,
 *         states distinguishable by more than color.
 *
 * AC6 (build + full e2e suite green) is the run itself.
 *
 * Fixtures (same dataset-derived ids as issue #5's suite):
 *   biology + latin           — same-slot collision (2026-05-04 AM)
 *   chemistry + human-geography — second collision whose movers share
 *                                 biology's late slot (late-late warning)
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
};
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const byId = (id: string): Subject => {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};

const BIOLOGY = byId("biology");
const LATIN = byId("latin");
const CHEMISTRY = byId("chemistry");
const HUMAN_GEO = byId("human-geography");

if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");

// A selection with NO conflicts (matches issue #4's fixture set).
const CALM_SELECTION = ["biology", "seminar", "drawing", "cybersecurity"];

const conflictPrompt = (page: Page) => page.getByTestId("conflict-prompt");
const dialog = (page: Page) => page.getByRole("dialog");
const exportButton = (page: Page) => page.getByTestId("export-ics-button");
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
// Issues #22/#24 grouped-chip IA: at every width the details button lives
// inside a chip's expanded Tier-1 panel, revealed by this expand affordance.
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

/**
 * Issue #19 (second bounce) made the CALENDAR the default view. States that
 * live in the LIST view (the modal-on-collision conflict dialog, the
 * moved-to-late badge, the late-collision warning) switch to it first.
 * The press is hydration-safe (see e2e/support/view-chip.ts).
 */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(page.locator('section[aria-label="My schedule"]')).toBeVisible();
}

/** Seed a stored resolution: keep `keeperId`, move the rest to late testing. */
async function seedResolutions(
  page: Page,
  resolutions: Array<{
    date: string;
    session: "AM" | "PM";
    keeperId: string;
    memberIds: string[];
  }>,
) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RESOLUTIONS_KEY, JSON.stringify(resolutions)] as const,
  );
}

/** Resolve biology/latin → latin keeps; biology moves to its late slot. */
const RESOLVED_BIO_LATIN = {
  date: BIOLOGY.exam!.date,
  session: BIOLOGY.exam!.session,
  keeperId: LATIN.id,
  memberIds: [BIOLOGY.id, LATIN.id],
};
/** Resolve chemistry/human-geography → chemistry moves (late-late overlap). */
const RESOLVED_CHEM_HGEO = {
  date: CHEMISTRY.exam!.date,
  session: CHEMISTRY.exam!.session,
  keeperId: HUMAN_GEO.id,
  memberIds: [CHEMISTRY.id, HUMAN_GEO.id],
};

// ---------------------------------------------------------------------------
// AC2 — axe scans across the main page states: zero serious/critical.
// The Next dev overlay (<nextjs-portal>) is excluded — it is dev-only chrome,
// not shipped UI.
// ---------------------------------------------------------------------------

/**
 * Settle all in-flight CSS transitions/animations before an axe scan.
 *
 * Without this, `AxeBuilder.analyze()` can sample interpolated colors from
 * `transition-colors` hydration flips (e.g. the export button's disabled ->
 * enabled transition when selections are seeded via localStorage) and report
 * a serious color-contrast violation against a settled UI that is compliant
 * (PR #18 review thread — flake also hit the "info panel open" scan here).
 *
 * `Animation.finished` rejects on cancel, hence the per-animation catch. The
 * app has no infinite animations, but the 2s race is a safety valve so a
 * future one can never hang the scan.
 */
async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const done = Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  });
}

async function expectNoSeriousViolations(page: Page, state: string) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = severe.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }));
  expect(
    severe,
    `axe (${state}): expected zero serious/critical violations, got:\n` +
      JSON.stringify(summary, null, 2),
  ).toEqual([]);
}

test.describe("AC2 — axe-core scans report zero serious/critical violations", () => {
  test("empty state (nothing selected)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Search subjects")).toBeVisible();
    await expectNoSeriousViolations(page, "empty");
  });

  test("with selections (schedule populated), light and dark", async ({
    page,
    browser,
  }) => {
    await seedSelection(page, CALM_SELECTION);
    await page.goto("/");
    await expect(exportButton(page)).toBeEnabled();
    await expectNoSeriousViolations(page, "selections-light");

    const darkCtx = await browser.newContext({ colorScheme: "dark" });
    const dark = await darkCtx.newPage();
    await seedSelection(dark, CALM_SELECTION);
    await dark.goto("/");
    await expect(exportButton(dark)).toBeEnabled();
    await expectNoSeriousViolations(dark, "selections-dark");
    await darkCtx.close();
  });

  test("conflict dialog open", async ({ page }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);
    await expect(dialog(page)).toBeVisible();
    await expect(conflictPrompt(page)).toBeVisible();
    await expectNoSeriousViolations(page, "conflict-dialog-open");
  });

  test("info panel open", async ({ page }) => {
    await page.goto("/");
    // Issues #22/#24: reveal the Tier-1 panel to reach the details button.
    await expandButton(page, "AP Biology").click();
    await infoButton(page, "AP Biology").click();
    await expect(dialog(page)).toBeVisible();
    await expectNoSeriousViolations(page, "info-panel-open");
  });

  test("resolved schedule (moved-to-late + late-late warning), light and dark", async ({
    page,
    browser,
  }) => {
    await seedSelection(page, [
      BIOLOGY.id,
      LATIN.id,
      CHEMISTRY.id,
      HUMAN_GEO.id,
    ]);
    await seedResolutions(page, [RESOLVED_BIO_LATIN, RESOLVED_CHEM_HGEO]);
    await page.goto("/");
    await openList(page);
    await expect(page.getByTestId("late-collision-warning")).toBeVisible();
    await expect(
      page.getByText("Moved to late testing").first(),
    ).toBeVisible();
    await expectNoSeriousViolations(page, "resolved-light");

    const darkCtx = await browser.newContext({ colorScheme: "dark" });
    const dark = await darkCtx.newPage();
    await seedSelection(dark, [
      BIOLOGY.id,
      LATIN.id,
      CHEMISTRY.id,
      HUMAN_GEO.id,
    ]);
    await seedResolutions(dark, [RESOLVED_BIO_LATIN, RESOLVED_CHEM_HGEO]);
    await dark.goto("/");
    await openList(dark);
    await expect(dark.getByTestId("late-collision-warning")).toBeVisible();
    await expectNoSeriousViolations(dark, "resolved-dark");
    await darkCtx.close();
  });
});

// ---------------------------------------------------------------------------
// AC1 — keyboard: tab order, visible focus indicators, dialog focus traps.
// ---------------------------------------------------------------------------

/** Identify the currently focused element for order assertions. */
async function focusedDescriptor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { kind: "body" as const };
    return {
      kind: "element" as const,
      id: el.id || null,
      ariaLabel: el.getAttribute("aria-label"),
      testid: el.getAttribute("data-testid"),
      pressed: el.hasAttribute("aria-pressed"),
      // Issue #24: the category filter group became the quick-jump nav.
      inQuickJump: !!el.closest('nav[aria-label="Jump to category"]'),
      inCatalog: !!el.closest('section[aria-label="Subject catalog"]'),
      inSchedule: !!el.closest('section[aria-label="My exams"]'),
      text: (el.textContent ?? "").trim().slice(0, 40),
    };
  });
}

/** A focus indicator is visible: non-none outline or a ring box-shadow. */
async function expectVisibleFocusIndicator(page: Page, what: string) {
  const indicator = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(indicator, `${what}: no focused element`).not.toBeNull();
  const hasOutline =
    indicator!.outlineStyle !== "none" && indicator!.outlineWidth !== "0px";
  const hasRing = indicator!.boxShadow !== "none";
  expect(
    hasOutline || hasRing,
    `${what}: focused element must show a visible indicator ` +
      `(outline=${indicator!.outlineStyle}/${indicator!.outlineWidth}, ` +
      `box-shadow=${indicator!.boxShadow})`,
  ).toBe(true);
}

test.describe("AC1 — keyboard operability", () => {
  test("tab order: search → quick-jump chip → chip toggle → its disclosure → view switcher → export; visible focus indicators throughout", async ({
    page,
  }) => {
    // A non-conflicting selection so the export button is enabled (disabled
    // controls are not tabbable) and the schedule is populated.
    await seedSelection(page, CALM_SELECTION);
    await page.goto("/");
    // Filter the catalog to one chip so the walk is deterministic and short.
    await page.getByLabel("Search subjects").fill("AP Biology");
    await expect(
      page.locator(
        'section[aria-label="Subject catalog"] ul > li button[aria-pressed]',
      ),
    ).toHaveCount(1);

    // Walk starts from the focused search input (typing focused it).
    let d = await focusedDescriptor(page);
    expect(d, "walk starts on the search input").toMatchObject({
      id: "subject-search",
    });
    await expectVisibleFocusIndicator(page, "search input");

    // The quick-jump nav comes next (issue #24: the filter chips' successor).
    // Only categories with matches render a chip, so the "AP Biology" search
    // leaves exactly one — STEM.
    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d, "tab stop 2 must be the STEM quick-jump chip").toMatchObject({
      inQuickJump: true,
      text: "STEM",
    });
    await expectVisibleFocusIndicator(page, "quick-jump chip");

    // The subject chip's select toggle (the section heading is tabIndex -1)...
    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d, "next stop: the chip select toggle").toMatchObject({
      inCatalog: true,
      pressed: true,
      inQuickJump: false,
    });
    await expectVisibleFocusIndicator(page, "subject chip");

    // ...immediately followed by ITS disclosure affordance (the Tier-1
    // expand button; the details button lives inside the revealed panel).
    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d.ariaLabel, "next stop: the chip's expand affordance").toBe(
      "Show exam dates for AP Biology",
    );
    await expectVisibleFocusIndicator(page, "expand affordance");

    // Then the shared "My Schedule" toolbar (issue #31 relayout): the
    // List/Calendar segmented switcher leads the toolbar row and the Export
    // button sits at its end, so focus order — matching the left-to-right
    // visual order — is List, Calendar, then Export. (`pressed` here means
    // the aria-pressed attribute exists, not that it is "true".)
    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d, "next stop: the List view chip").toMatchObject({
      text: "List",
      pressed: true,
      inCatalog: false,
    });
    await expectVisibleFocusIndicator(page, "List view chip");

    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d, "next stop: the Calendar view chip").toMatchObject({
      text: "Calendar",
      pressed: true,
      inCatalog: false,
    });
    await expectVisibleFocusIndicator(page, "Calendar view chip");

    await page.keyboard.press("Tab");
    d = await focusedDescriptor(page);
    expect(d, "next stop: the export button").toMatchObject({
      testid: "export-ics-button",
      inSchedule: true,
    });
    await expectVisibleFocusIndicator(page, "export button");
  });

  test("conflict dialog: modal, focus-trapped, Escape closes (prompt stays available inline)", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);

    // Opens as a real modal dialog with focus inside.
    const modal = dialog(page);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("aria-modal", "true");
    expect(
      await modal.evaluate((el) => el.contains(document.activeElement)),
      "focus must move into the conflict dialog on open",
    ).toBe(true);

    // Tab cycles: focus never leaves the dialog.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await modal.evaluate((el) => el.contains(document.activeElement)),
        `focus escaped the conflict dialog on Tab #${i + 1}`,
      ).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await modal.evaluate((el) => el.contains(document.activeElement)),
        `focus escaped the conflict dialog on Shift+Tab #${i + 1}`,
      ).toBe(true);
    }

    // Escape closes the dialog; the same prompt remains available inline
    // (issue #5: conflicts are never a forced gate) and scroll is unlocked.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(conflictPrompt(page)).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    // Resolving from the inline prompt still works.
    await conflictPrompt(page)
      .getByRole("button", { name: `Keep ${LATIN.name} at the regular time` })
      .click();
    await expect(conflictPrompt(page)).toHaveCount(0);
  });

  test("conflict dialog: choosing a keeper inside the modal resolves and closes it", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await openList(page);
    const modal = dialog(page);
    await expect(modal).toBeVisible();

    await modal
      .getByRole("button", { name: `Keep ${LATIN.name} at the regular time` })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(conflictPrompt(page)).toHaveCount(0);
    await expect(
      page.getByText("Moved to late testing").first(),
    ).toBeVisible();
  });

  test("info panel: focus-trapped and closes on Escape (regression, shared modal helper)", async ({
    page,
  }) => {
    await page.goto("/");
    // Issues #22/#24: reveal the Tier-1 panel to reach the details button.
    await expandButton(page, "AP Biology").click();
    await infoButton(page, "AP Biology").click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(
        await panel.evaluate((el) => el.contains(document.activeElement)),
        `focus escaped the info panel on Tab #${i + 1}`,
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(infoButton(page, "AP Biology")).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// AC3 — measured contrast ratios (printed in assertion messages for the QA
// evidence). Same canvas-based helper as issue #5's suite: composites alpha
// backgrounds the way they actually render.
// ---------------------------------------------------------------------------

async function contrastRatio(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const parse = (css: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillStyle = css;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const layers: RGBA[] = [];
    let node: Element | null = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) {
        layers.unshift(bg);
        if (bg[3] >= 1) break;
      }
      node = node.parentElement;
    }
    let base: RGBA = [255, 255, 255, 1];
    for (const layer of layers) {
      const a = layer[3];
      base = [
        layer[0] * a + base[0] * (1 - a),
        layer[1] * a + base[1] * (1 - a),
        layer[2] * a + base[2] * (1 - a),
        1,
      ];
    }
    const fgRaw = parse(getComputedStyle(el).color);
    const a = fgRaw[3];
    const fg: RGBA = [
      fgRaw[0] * a + base[0] * (1 - a),
      fgRaw[1] * a + base[1] * (1 - a),
      fgRaw[2] * a + base[2] * (1 - a),
      1,
    ];
    const lum = (c: RGBA) => {
      const chan = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
    };
    const l1 = lum(fg);
    const l2 = lum(base);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
}

test.describe("AC3 — conflict + moved-to-late styles measure ≥ 4.5:1", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`measured ratios (${scheme} mode)`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();

      // Unresolved conflict → prompt (modal) text.
      await seedSelection(page, [BIOLOGY.id, LATIN.id]);
      await page.goto("/");
      await openList(page);
      await expect(conflictPrompt(page)).toBeVisible();
      const promptBody = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] p',
      );
      expect(
        promptBody,
        `conflict prompt body (${scheme}) = ${promptBody.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      const promptHeading = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] h3',
      );
      expect(
        promptHeading,
        `conflict prompt heading (${scheme}) = ${promptHeading.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      const keepButton = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] div > button',
      );
      expect(
        keepButton,
        `keep-at-regular-time button (${scheme}) = ${keepButton.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      await ctx.close();

      // Resolved double conflict → moved badge + late-late warning.
      const ctx2 = await browser.newContext({ colorScheme: scheme });
      const resolved = await ctx2.newPage();
      await seedSelection(resolved, [
        BIOLOGY.id,
        LATIN.id,
        CHEMISTRY.id,
        HUMAN_GEO.id,
      ]);
      await seedResolutions(resolved, [
        RESOLVED_BIO_LATIN,
        RESOLVED_CHEM_HGEO,
      ]);
      await resolved.goto("/");
      await openList(resolved);

      await expect(
        resolved.getByText("Moved to late testing").first(),
      ).toBeVisible();
      const movedBadge = await contrastRatio(
        resolved,
        'section[aria-label="My schedule"] ol li span:text("Moved to late testing")',
      );
      expect(
        movedBadge,
        `"Moved to late testing" badge (${scheme}) = ${movedBadge.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);

      await expect(
        resolved.getByTestId("late-collision-warning"),
      ).toBeVisible();
      const warning = await contrastRatio(
        resolved,
        '[data-testid="late-collision-warning"] p',
      );
      expect(
        warning,
        `late-collision warning (${scheme}) = ${warning.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      await ctx2.close();
    });
  }
});

// ---------------------------------------------------------------------------
// AC4 — 375×667: no horizontal scroll anywhere (dialogs included); primary
// tap targets ≥ 44×44 px.
// ---------------------------------------------------------------------------

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
  );

async function expectTapTarget(
  locator: ReturnType<Page["locator"]>,
  what: string,
) {
  const box = await locator.boundingBox();
  expect(box, `${what}: not visible`).not.toBeNull();
  expect(
    box!.width,
    `${what}: width ${box!.width}px must be ≥ 44px`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box!.height,
    `${what}: height ${box!.height}px must be ≥ 44px`,
  ).toBeGreaterThanOrEqual(44);
}

test.describe("AC4 — 375×667 layout", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("no horizontal scroll: populated schedule, conflict dialog, info panel", async ({
    page,
    browser,
  }) => {
    await seedSelection(page, CALM_SELECTION);
    await page.goto("/");
    await expect(exportButton(page)).toBeEnabled();
    expect(await noHorizontalScroll(page), "base page overflows").toBe(true);

    // Issue #22 mobile IA: expand the chip (Tier 1), then open the details
    // dialog (Tier 2) from the revealed panel.
    await expandButton(page, "AP Biology").click();
    expect(
      await noHorizontalScroll(page),
      "expanded chip panel overflows",
    ).toBe(true);
    await infoButton(page, "AP Biology").click();
    await expect(dialog(page)).toBeVisible();
    expect(await noHorizontalScroll(page), "info panel overflows").toBe(true);
    await page.keyboard.press("Escape");

    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const conflict = await ctx.newPage();
    await seedSelection(conflict, [BIOLOGY.id, LATIN.id]);
    await conflict.goto("/");
    await openList(conflict);
    await expect(dialog(conflict)).toBeVisible();
    expect(
      await noHorizontalScroll(conflict),
      "conflict dialog overflows",
    ).toBe(true);
    await ctx.close();
  });

  test("primary tap targets are ≥ 44×44 px", async ({ page, browser }) => {
    await seedSelection(page, CALM_SELECTION);
    await page.goto("/");

    await expectTapTarget(page.getByLabel("Search subjects"), "search input");
    // Issue #22 mobile IA: the sticky quick-jump chip replaces the flat
    // category filter, and the chip's expand affordance replaces the per-card
    // info button (the details button lives in the expanded Tier-1 panel).
    await expectTapTarget(
      page
        .getByRole("navigation", { name: "Jump to category" })
        .getByRole("button", { name: "STEM", exact: true }),
      "category quick-jump chip",
    );
    await expectTapTarget(
      expandButton(page, "AP Biology"),
      "expand affordance",
    );
    await expandButton(page, "AP Biology").click();
    await expectTapTarget(
      infoButton(page, "AP Biology"),
      "details affordance",
    );
    // The select toggle is the whole chip body — ≥44px tall.
    await expectTapTarget(
      page
        .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
        .first(),
      "subject chip toggle",
    );
    await expectTapTarget(exportButton(page), "export button");

    await infoButton(page, "AP Biology").click();
    await expect(dialog(page)).toBeVisible();
    await expectTapTarget(
      dialog(page).getByRole("button", { name: "Close" }),
      "info panel close button",
    );
    await page.keyboard.press("Escape");

    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const conflict = await ctx.newPage();
    await seedSelection(conflict, [BIOLOGY.id, LATIN.id]);
    await conflict.goto("/");
    await openList(conflict);
    await expect(dialog(conflict)).toBeVisible();
    await expectTapTarget(
      dialog(conflict)
        .getByRole("button", { name: /^Keep .* at the regular time$/ })
        .first(),
      "keep-at-regular-time button",
    );
    await expectTapTarget(
      dialog(conflict).getByRole("button", { name: "Close" }),
      "conflict dialog close button",
    );
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// AC5 — landmarks, labels, and more-than-color state indicators.
// ---------------------------------------------------------------------------

test.describe("AC5 — landmarks and labels", () => {
  test("exactly one h1; search input is labelled; icon-only buttons have accessible names", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByLabel("Search subjects")).toBeVisible();

    // Icon-only buttons: every chip's disclosure affordance carries a
    // per-subject name (issues #22/#24: the details button lives inside the
    // expanded Tier-1 panel, so the always-visible icon control is the
    // expand chevron).
    const expandButtons = page.getByRole("button", {
      name: /^Show exam dates for /,
    });
    expect(await expandButtons.count()).toBeGreaterThan(0);
    await expandButton(page, "AP Biology").click();
    await expect(infoButton(page, "AP Biology")).toBeVisible();

    // Dialog close buttons are named.
    await infoButton(page, "AP Biology").click();
    await expect(
      dialog(page).getByRole("button", { name: "Close" }),
    ).toBeVisible();
  });

  test("selected and moved states are distinguishable by more than color", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, LATIN.id]);
    await seedResolutions(page, [RESOLVED_BIO_LATIN]);
    await page.goto("/");
    await openList(page); // the moved-to-late text badge renders in the list

    // Selected card: aria-pressed for AT + a visible ✓ glyph for sighted users.
    const bioCard = page
      .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
      .filter({ hasText: BIOLOGY.name });
    await expect(bioCard).toHaveAttribute("aria-pressed", "true");
    const checkColor = await bioCard
      .locator("span[aria-hidden]")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(
      checkColor,
      `selected checkmark must be painted (got ${checkColor})`,
    ).not.toMatch(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/);

    // Moved exam: a text badge, not just a color shift.
    await expect(page.getByText("Moved to late testing")).toBeVisible();
    // Pending data: rendered as the literal text badge (issue #6 contract).
    // Issues #22/#24: reveal the Tier-1 panel to reach the details button.
    await expandButton(page, "AP Cybersecurity").click();
    await infoButton(page, "AP Cybersecurity").click();
    await expect(
      dialog(page).getByText("pending", { exact: true }),
    ).toBeVisible();
  });
});
