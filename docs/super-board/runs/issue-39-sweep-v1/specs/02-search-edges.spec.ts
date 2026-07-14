import { test, expect } from "@playwright/test";
import {
  watchConsole,
  record,
  searchInput,
  catalog,
  evidencePath,
} from "./helpers";

/**
 * Sweep 02 — search adversarial inputs: empty, no-match, whitespace-only,
 * very long, special characters / regex metachars, rapid typing.
 */

test("search edge inputs never break the catalog", async ({ page }) => {
  const con = watchConsole(page, "search");
  await page.goto("/");
  const input = searchInput(page);
  const chips = catalog(page).locator("button[aria-pressed]");
  const total = await chips.count();
  expect(total).toBeGreaterThan(40);

  // no-match
  await input.fill("zzzzqqqq-no-such-subject");
  await expect(chips.first()).toBeHidden().catch(() => {});
  const noMatchCount = await chips.count();
  const bodyText = await catalog(page).innerText();
  const hasEmptyMessage = /no|match|found|try/i.test(bodyText);
  if (noMatchCount === 0 && !hasEmptyMessage) {
    record({
      kind: "suggestion",
      area: "search",
      summary:
        "no-match search shows no empty-state message — catalog silently empties",
      detail: { query: "zzzzqqqq-no-such-subject" },
    });
  }
  await page.screenshot({ path: evidencePath("02-search-no-match.png") });

  // whitespace-only should behave like empty (show all), not like no-match
  await input.fill("   ");
  const wsCount = await chips.count();
  record({
    kind: wsCount === total ? "clean" : "bug",
    area: "search",
    summary:
      wsCount === total
        ? "whitespace-only query treated as empty (all subjects shown)"
        : `whitespace-only query filters to ${wsCount}/${total} subjects`,
  });

  // very long query
  await input.fill("a".repeat(5000));
  await expect(catalog(page)).toBeVisible();

  // special characters / regex metachars — must not throw
  for (const q of ["(", "[", "\\", "*", ".*", "<script>", "ap&b", "ap+", "%"]) {
    await input.fill(q);
    await expect(catalog(page)).toBeVisible();
  }

  // Matching still works after the abuse
  await input.fill("bio");
  await expect(
    chips.filter({ hasText: "AP Biology" }).first(),
  ).toBeVisible();

  // rapid typing
  await input.fill("");
  await input.pressSequentially("chemistry", { delay: 10 });
  await expect(
    chips.filter({ hasText: "AP Chemistry" }).first(),
  ).toBeVisible();

  con.assertClean("search edge inputs");
  record({
    kind: "clean",
    area: "search",
    summary:
      "search survived: no-match, whitespace, 5000-char, regex metachars, <script>, rapid typing",
  });
});

test("category quick-nav jumps to each category", async ({ page }) => {
  const con = watchConsole(page, "quick-nav");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Jump to category" });
  await expect(nav).toBeVisible();
  const items = nav.locator("button");
  const n = await items.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) {
    await items.nth(i).click();
    await page.waitForTimeout(50);
  }
  con.assertClean("category quick-nav");
});
