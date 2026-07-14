import { test, expect } from "@playwright/test";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  chipFor,
  searchInput,
  conflictPrompt,
} from "./helpers";

/**
 * Sweep 01 — exercise the primary flows end to end while watching for
 * console errors / unhandled page errors. Zero-console-error bar (#39).
 */

test("full happy-path walk stays console-clean", async ({ page }) => {
  const con = watchConsole(page, "flows");
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();

  // Search then clear.
  await searchInput(page).fill("bio");
  await expect(chipFor(page, "AP Biology")).toBeVisible();
  await searchInput(page).fill("");

  // Select via UI.
  await chipFor(page, "AP Biology").click();
  await expect(chipFor(page, "AP Biology")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Disclosure tier 1: show exam dates.
  await page
    .getByRole("button", { name: /Show exam dates for AP Biology/ })
    .click();
  // Tier 2: exam details dialog.
  await page
    .getByRole("button", { name: /View exam details for AP Biology/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Schedule views.
  await pressViewChip(page, "List");
  await pressViewChip(page, "Calendar");

  // Export menu open/close.
  await page.getByTestId("export-menu-button").click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  // Theme toggle cycle.
  const theme = page.getByRole("button", { name: /^Theme:/ });
  await theme.click();
  await theme.click();
  await theme.click();

  // Feedback dialog.
  await page.getByRole("button", { name: /Send us Feedback/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  // Sidebar collapse/expand (desktop).
  const collapse = page.getByRole("button", {
    name: /^(Collapse|Expand) sidebar$/,
  });
  if (await collapse.isVisible()) {
    await collapse.click();
    await collapse.click();
  }

  await page.screenshot({
    path: evidencePath("01-happy-path-final-desktop.png"),
    fullPage: false,
  });
  con.assertClean("happy-path walk");
});

test("conflict flow + resolution stays console-clean", async ({ page }) => {
  const con = watchConsole(page, "flows-conflict");
  await seed(page, { selection: ["biology", "latin"] });
  await page.goto("/");
  await pressViewChip(page, "List");
  await expect(conflictPrompt(page).first()).toBeVisible();
  await page.screenshot({
    path: evidencePath("01-conflict-prompt-desktop.png"),
  });
  await page
    .getByRole("button", { name: "Keep AP Biology at the regular time" })
    .first()
    .click();
  await expect(conflictPrompt(page)).toHaveCount(0);
  con.assertClean("conflict resolve");
});

test("slow-network / offline after load produces no unhandled rejections", async ({
  page,
  context,
}) => {
  const con = watchConsole(page, "offline");
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await context.setOffline(true);
  // Interact while offline — app is client-side, must keep working.
  await chipFor(page, "AP Chemistry").click();
  await pressViewChip(page, "List");
  await pressViewChip(page, "Calendar");
  await page.getByTestId("export-menu-button").click();
  await page.keyboard.press("Escape");
  await context.setOffline(false);
  con.assertClean("offline interaction after load");
  record({
    kind: "clean",
    area: "network",
    summary:
      "offline-after-load: selection, view switch, export menu all work with no console/page errors",
  });
});
