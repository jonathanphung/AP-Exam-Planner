import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import apData from "../src/data/ap-2026.json";

/**
 * super-board QA (issue #8) — Tester evidence spec.
 *
 * The Builder's e2e/a11y.spec.ts carries the per-AC assertions. This spec
 * captures the durable QA artifacts the ACs demand on top of green tests:
 *
 *   - standard super-board viewport screenshots (1920x1080 / 1024x768 /
 *     375x667) of the a11y-hardened UI in its richest state (resolved
 *     conflict -> "Moved to late testing" badge + late-collision warning);
 *   - AC1: screenshots of a visible focus indicator and the focus-trapped
 *     conflict modal;
 *   - AC2: the axe-core violation summary written to JSON (must be empty at
 *     serious/critical);
 *   - AC3: the MEASURED contrast ratios written to contrast-ratios.txt
 *     (the AC says "state the measured ratios in the QA evidence");
 *   - AC4: mobile conflict-dialog screenshot + measured tap-target boxes;
 *   - AC5: info panel screenshot showing the textual "pending" badge.
 */

const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-8-qa-v1";

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

const RESOLVED_BIO_LATIN = {
  date: BIOLOGY.exam!.date,
  session: BIOLOGY.exam!.session,
  keeperId: LATIN.id,
  memberIds: [BIOLOGY.id, LATIN.id],
};
const RESOLVED_CHEM_HGEO = {
  date: CHEMISTRY.exam!.date,
  session: CHEMISTRY.exam!.session,
  keeperId: HUMAN_GEO.id,
  memberIds: [CHEMISTRY.id, HUMAN_GEO.id],
};

async function seed(page: Page, ids: string[], resolutions?: unknown[]) {
  await page.addInitScript(
    ([selKey, selVal, resKey, resVal]) => {
      window.localStorage.setItem(selKey, selVal);
      if (resVal) window.localStorage.setItem(resKey, resVal);
    },
    [
      SELECTION_KEY,
      JSON.stringify(ids),
      RESOLUTIONS_KEY,
      resolutions ? JSON.stringify(resolutions) : "",
    ] as const,
  );
}

function writeEvidence(name: string, content: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), content);
}

/** Same canvas-compositing contrast helper as e2e/a11y.spec.ts (AC3). */
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

const RESOLVED_IDS = [BIOLOGY.id, LATIN.id, CHEMISTRY.id, HUMAN_GEO.id];
const RESOLUTIONS = [RESOLVED_BIO_LATIN, RESOLVED_CHEM_HGEO];

test.describe("issue #8 QA evidence", () => {
  test("standard viewports — resolved schedule with moved badge + late warning", async ({
    browser,
  }) => {
    const viewports = [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "tablet", width: 1024, height: 768 },
      { name: "mobile", width: 375, height: 667 },
    ] as const;
    for (const vp of viewports) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await ctx.newPage();
      await seed(page, RESOLVED_IDS, RESOLUTIONS);
      await page.goto("/");
      await expect(
        page.getByText("Moved to late testing").first(),
      ).toBeVisible();
      await expect(page.getByTestId("late-collision-warning")).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}.png`,
        fullPage: true,
      });
      await ctx.close();
    }
  });

  test("AC1 evidence — visible focus indicator + focus-trapped conflict modal", async ({
    page,
  }) => {
    await seed(page, ["biology", "seminar", "drawing", "cybersecurity"]);
    await page.goto("/");
    const exportBtn = page.getByTestId("export-ics-button");
    await expect(exportBtn).toBeEnabled();
    // Keyboard-focus the export button so the ring renders (not a click focus).
    await exportBtn.focus();
    await expect(exportBtn).toBeFocused();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac1-focus-indicator-export-desktop.png`,
    });
  });

  test("AC1 evidence — conflict modal open with focus inside", async ({
    page,
  }) => {
    await seed(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("aria-modal", "true");
    expect(
      await modal.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac1-conflict-modal-desktop.png`,
    });
  });

  test("AC2 evidence — axe summary across states written to JSON", async ({
    page,
    browser,
  }) => {
    const summary: Record<
      string,
      { total: number; seriousOrCritical: number; ids: string[] }
    > = {};

    const scan = async (p: Page, state: string) => {
      const results = await new AxeBuilder({ page: p })
        .exclude("nextjs-portal")
        .analyze();
      const severe = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      summary[state] = {
        total: results.violations.length,
        seriousOrCritical: severe.length,
        ids: results.violations.map((v) => `${v.id} (${v.impact})`),
      };
      expect(severe, `axe serious/critical in state: ${state}`).toEqual([]);
    };

    await page.goto("/");
    await scan(page, "empty");

    const ctx1 = await browser.newContext();
    const withSel = await ctx1.newPage();
    await seed(withSel, ["biology", "seminar", "drawing", "cybersecurity"]);
    await withSel.goto("/");
    await scan(withSel, "with-selections");
    await ctx1.close();

    const ctx2 = await browser.newContext();
    const conflict = await ctx2.newPage();
    await seed(conflict, [BIOLOGY.id, LATIN.id]);
    await conflict.goto("/");
    await expect(conflict.getByRole("dialog")).toBeVisible();
    await scan(conflict, "conflict-dialog-open");
    await ctx2.close();

    const ctx3 = await browser.newContext();
    const info = await ctx3.newPage();
    await info.goto("/");
    await info
      .getByRole("button", { name: "View exam details for AP Biology" })
      .click();
    await expect(info.getByRole("dialog")).toBeVisible();
    await scan(info, "info-panel-open");
    await ctx3.close();

    const ctx4 = await browser.newContext({ colorScheme: "dark" });
    const dark = await ctx4.newPage();
    await seed(dark, RESOLVED_IDS, RESOLUTIONS);
    await dark.goto("/");
    await expect(dark.getByTestId("late-collision-warning")).toBeVisible();
    await scan(dark, "resolved-dark");
    await dark.screenshot({
      path: `${EVIDENCE_DIR}/ac2-resolved-dark-desktop.png`,
      fullPage: true,
    });
    await ctx4.close();

    writeEvidence("ac2-axe-summary.json", JSON.stringify(summary, null, 2));
  });

  test("AC3 evidence — measured contrast ratios written to contrast-ratios.txt", async ({
    browser,
  }) => {
    const lines: string[] = [
      "AC3 — measured contrast ratios (WCAG relative-luminance, alpha-composited)",
      "Threshold: >= 4.5:1",
      "",
    ];

    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await seed(page, [BIOLOGY.id, LATIN.id]);
      await page.goto("/");
      await expect(page.getByTestId("conflict-prompt")).toBeVisible();

      const promptBody = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] p',
      );
      const promptHeading = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] h3',
      );
      const keepButton = await contrastRatio(
        page,
        '[data-testid="conflict-prompt"] div > button',
      );
      await ctx.close();

      const ctx2 = await browser.newContext({ colorScheme: scheme });
      const resolved = await ctx2.newPage();
      await seed(resolved, RESOLVED_IDS, RESOLUTIONS);
      await resolved.goto("/");
      await expect(
        resolved.getByText("Moved to late testing").first(),
      ).toBeVisible();
      const movedBadge = await contrastRatio(
        resolved,
        'section[aria-label="My schedule"] ol li span:text("Moved to late testing")',
      );
      await expect(
        resolved.getByTestId("late-collision-warning"),
      ).toBeVisible();
      const warning = await contrastRatio(
        resolved,
        '[data-testid="late-collision-warning"] p',
      );
      await ctx2.close();

      const entries: Array<[string, number]> = [
        ["conflict prompt body", promptBody],
        ["conflict prompt heading", promptHeading],
        ["keep-at-regular-time button", keepButton],
        ['"Moved to late testing" badge', movedBadge],
        ["late-collision warning text", warning],
      ];
      lines.push(`[${scheme}]`);
      for (const [what, ratio] of entries) {
        lines.push(`  ${what}: ${ratio.toFixed(2)}:1`);
        expect(ratio, `${what} (${scheme})`).toBeGreaterThanOrEqual(4.5);
      }
      lines.push("");
    }

    writeEvidence("ac3-contrast-ratios.txt", lines.join("\n"));
  });

  test("AC4 evidence — mobile conflict dialog + measured tap targets", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const page = await ctx.newPage();
    await seed(page, [BIOLOGY.id, LATIN.id]);
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
      "mobile conflict dialog must not cause horizontal scroll",
    ).toBe(true);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac4-mobile-conflict-dialog.png`,
    });
    await ctx.close();

    const ctx2 = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const base = await ctx2.newPage();
    await seed(base, ["biology", "seminar", "drawing", "cybersecurity"]);
    await base.goto("/");
    await expect(base.getByTestId("export-ics-button")).toBeEnabled();

    const targets: Array<[string, ReturnType<Page["locator"]>]> = [
      ["search input", base.getByLabel("Search subjects")],
      ["category chip 'All'", base.getByRole("button", { name: "All", exact: true })],
      [
        "details affordance",
        base.getByRole("button", { name: "View exam details for AP Biology" }),
      ],
      ["export button", base.getByTestId("export-ics-button")],
    ];
    const measured: Record<string, { width: number; height: number }> = {};
    for (const [what, loc] of targets) {
      const box = await loc.boundingBox();
      expect(box, `${what} not visible`).not.toBeNull();
      measured[what] = {
        width: Math.round(box!.width),
        height: Math.round(box!.height),
      };
      expect(box!.width, `${what} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(44);
    }
    writeEvidence(
      "ac4-tap-targets.json",
      JSON.stringify({ viewport: "375x667", measured }, null, 2),
    );
    await ctx2.close();
  });

  test("AC5 evidence — info panel with textual 'pending' badge", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "View exam details for AP Cybersecurity" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("pending", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac5-info-panel-pending-desktop.png`,
    });
  });
});
