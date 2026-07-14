import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  ALL_IDS,
  THEME_KEY,
} from "./helpers";

/**
 * Sweep 07 — automated axe scans across major states, light AND dark.
 * Reports every violation (all impacts), fails soft on serious/critical.
 */

type StateName =
  | "catalog-default"
  | "list-selected"
  | "calendar-selected"
  | "conflict-prompt"
  | "exam-details-dialog"
  | "sidebar-collapsed";

async function reachState(page: Page, state: StateName) {
  switch (state) {
    case "catalog-default":
      await page.goto("/");
      break;
    case "list-selected":
      await seed(page, { selection: ["biology", "seminar", "drawing"] });
      await page.goto("/");
      await pressViewChip(page, "List");
      break;
    case "calendar-selected":
      await seed(page, { selection: ALL_IDS.slice(0, 12) });
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      break;
    case "conflict-prompt":
      await seed(page, { selection: ["biology", "latin"] });
      await page.goto("/");
      await pressViewChip(page, "List");
      await expect(page.getByTestId("conflict-prompt").first()).toBeVisible();
      break;
    case "exam-details-dialog":
      await page.goto("/");
      await page
        .getByRole("button", { name: /Show exam dates for AP Biology/ })
        .click();
      await page
        .getByRole("button", { name: /View exam details for AP Biology/ })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      break;
    case "sidebar-collapsed": {
      await page.goto("/");
      const collapse = page.getByRole("button", { name: /Collapse sidebar/ });
      if (await collapse.isVisible().catch(() => false)) await collapse.click();
      break;
    }
  }
}

const STATES: StateName[] = [
  "catalog-default",
  "list-selected",
  "calendar-selected",
  "conflict-prompt",
  "exam-details-dialog",
  "sidebar-collapsed",
];

for (const theme of ["light", "dark"] as const) {
  for (const state of STATES) {
    test(`axe ${state} (${theme})`, async ({ page }) => {
      const con = watchConsole(page, `axe-${state}-${theme}`);
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "dark" : "light",
      });
      await page.addInitScript(
        ([k, v]) => localStorage.setItem(k, v),
        [THEME_KEY, theme],
      );
      await reachState(page, state);
      await page.waitForTimeout(250);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 4).map((n) => ({
          target: n.target,
          html: n.html.slice(0, 200),
          failureSummary: n.failureSummary?.slice(0, 300),
        })),
        nodeCount: v.nodes.length,
      }));

      fs.writeFileSync(
        evidencePath(`axe-${state}-${theme}.json`),
        JSON.stringify(violations, null, 2),
      );

      if (violations.length) {
        record({
          kind: "a11y",
          area: `axe/${state}/${theme}`,
          summary: `axe: ${violations.map((v) => `${v.id}(${v.impact}×${v.nodeCount})`).join(", ")}`,
          detail: violations,
        });
      } else {
        record({
          kind: "clean",
          area: `axe/${state}/${theme}`,
          summary: "axe: zero WCAG A/AA violations",
        });
      }
      const serious = violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect
        .soft(serious, `${state} (${theme}): no serious/critical axe`)
        .toEqual([]);
      con.assertClean(`axe ${state} ${theme}`);
    });
  }
}
