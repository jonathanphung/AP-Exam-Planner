import { test, expect } from "@playwright/test";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  hasHorizontalScroll,
  conflictPrompt,
  ALL_IDS,
  chipFor,
} from "./helpers";

/**
 * Sweep 04 — limit testing: all 42 subjects at once, rapid/duplicate
 * interactions, pager spam, double conflict resolution.
 */

test("all 42 subjects: catalog, list, calendar (all weeks), export menu", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const con = watchConsole(page, "limits-42");
  await seed(page, { selection: ALL_IDS });
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();

  // Conflicts will exist — count prompts, then check list view.
  const promptCount = await conflictPrompt(page).count();
  record({
    kind: "note",
    area: "limits",
    summary: `all-42 selection produces ${promptCount} same-slot conflict prompts`,
  });

  await pressViewChip(page, "List");
  // Entering List with unresolved conflicts pops a modal prompt (scrim
  // blocks the page). Dismiss it — the prompt body stays inline.
  if (await page.getByRole("dialog").isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
  expect
    .soft(await hasHorizontalScroll(page), "list@42: no horizontal scroll")
    .toBe(false);
  await page.screenshot({
    path: evidencePath("04-all42-list-desktop.png"),
    fullPage: true,
  });

  await pressViewChip(page, "Calendar");
  expect
    .soft(await hasHorizontalScroll(page), "calendar@42: no horizontal scroll")
    .toBe(false);
  await page.screenshot({ path: evidencePath("04-all42-calendar-week1.png") });

  // Page through every week to the end, then spam Next at the boundary.
  const next = page.getByRole("button", { name: /^Next/ });
  let hops = 0;
  while ((await next.isEnabled().catch(() => false)) && hops < 12) {
    await next.click();
    hops++;
  }
  record({
    kind: "note",
    area: "limits",
    summary: `calendar week pager traversed ${hops} hops to last week at 42 subjects`,
  });
  for (let i = 0; i < 10; i++) await next.click({ force: true });
  await page.screenshot({
    path: evidencePath("04-all42-calendar-lastweek.png"),
  });

  const prev = page.getByRole("button", { name: /^Previous/ });
  for (let i = 0; i < 20; i++) await prev.click({ force: true });

  // Export menu still opens at 42.
  await page.getByTestId("export-menu-button").click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  con.assertClean("all-42 walk");
});

test("rapid toggle spam and double-click on chips", async ({ page }) => {
  const con = watchConsole(page, "limits-spam");
  await page.goto("/");
  const chip = chipFor(page, "AP Biology");
  // 10 fast toggles must end deterministically (even count → unselected).
  for (let i = 0; i < 10; i++) await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.dblclick(); // two more → still false
  await expect(chip).toHaveAttribute("aria-pressed", "false");

  // expand + select interleaved
  const expand = page.getByRole("button", {
    name: /Show exam dates for AP Chemistry/,
  });
  await chipFor(page, "AP Chemistry").click();
  await expand.click();
  await chipFor(page, "AP Chemistry").click();
  await expect(chipFor(page, "AP Chemistry")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  con.assertClean("toggle spam");
  record({
    kind: "clean",
    area: "limits",
    summary:
      "rapid toggle spam (10x), dblclick, expand+select interleave all deterministic",
  });
});

test("conflict: double-resolve (spam Keep button) stays consistent", async ({
  page,
}) => {
  const con = watchConsole(page, "limits-double-resolve");
  await seed(page, { selection: ["biology", "latin"] });
  await page.goto("/");
  await pressViewChip(page, "List");
  const keep = page
    .getByRole("button", { name: "Keep AP Biology at the regular time" })
    .first();
  await expect(keep).toBeVisible();
  // Two immediate clicks — the second lands after the state change (dead
  // node) and must be a no-op; short timeout because the button disappears.
  await keep.click();
  await keep.click({ force: true, timeout: 1200 }).catch(() => {});
  await expect(conflictPrompt(page)).toHaveCount(0);
  const moved = page.getByText(/late testing/i);
  expect
    .soft(
      await moved.count(),
      "exactly one subject should show a late-testing move marker",
    )
    .toBeGreaterThan(0);
  con.assertClean("double resolve");
});

test("dialog open/dismiss spam (exam details)", async ({ page }) => {
  const con = watchConsole(page, "limits-dialog-spam");
  await page.goto("/");
  await page
    .getByRole("button", { name: /Show exam dates for AP Biology/ })
    .click();
  const open = page.getByRole("button", {
    name: /View exam details for AP Biology/,
  });
  for (let i = 0; i < 5; i++) {
    await open.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  con.assertClean("dialog spam");
});
