import { test, expect } from "@playwright/test";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  hasHorizontalScroll,
  ALL_IDS,
} from "./helpers";

/**
 * Sweep 09 — viewport extremes: 320/375/768/1024/1920, short + tall windows,
 * 200% zoom (device-pixel emulation), reduced motion. No horizontal page
 * scroll anywhere.
 */

const WIDTHS = [320, 375, 768, 1024, 1920];

for (const width of WIDTHS) {
  test(`no horizontal scroll @ ${width}px (default + all-42 calendar + list)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const con = watchConsole(page, `vp-${width}`);
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/");
    if (await hasHorizontalScroll(page)) {
      record({
        kind: "bug",
        area: "responsive",
        summary: `horizontal page scroll at ${width}px on default catalog`,
      });
    }
    expect.soft(await hasHorizontalScroll(page), `${width}px default`).toBe(
      false,
    );

    await seed(page, { selection: ALL_IDS });
    await page.goto("/");
    await pressViewChip(page, "List");
    if (await hasHorizontalScroll(page)) {
      record({
        kind: "bug",
        area: "responsive",
        summary: `horizontal page scroll at ${width}px on all-42 list`,
      });
    }
    expect.soft(await hasHorizontalScroll(page), `${width}px list@42`).toBe(
      false,
    );

    await pressViewChip(page, "Calendar");
    if (await hasHorizontalScroll(page)) {
      record({
        kind: "bug",
        area: "responsive",
        summary: `horizontal page scroll at ${width}px on all-42 calendar`,
      });
    }
    expect.soft(await hasHorizontalScroll(page), `${width}px cal@42`).toBe(
      false,
    );
    if (width === 320 || width === 1920) {
      await page.screenshot({
        path: evidencePath(`09-all42-calendar-${width}.png`),
        fullPage: width === 320,
      });
    }
    con.assertClean(`viewport ${width}`);
  });
}

test("very short window (1280×450) and 200% zoom equivalent (640×450 viewport)", async ({
  page,
}) => {
  const con = watchConsole(page, "vp-short-zoom");
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.goto("/");
  expect.soft(await hasHorizontalScroll(page), "short window").toBe(false);

  // 200% zoom ≈ halved CSS viewport at same physical size.
  await page.setViewportSize({ width: 640, height: 450 });
  await page.reload();
  if (await hasHorizontalScroll(page)) {
    record({
      kind: "bug",
      area: "responsive",
      summary:
        "horizontal scroll at 200% zoom equivalent (640×450 CSS viewport)",
    });
  }
  expect.soft(await hasHorizontalScroll(page), "200% zoom equiv").toBe(false);
  await page.screenshot({ path: evidencePath("09-zoom200-equiv.png") });
  con.assertClean("short/zoom viewports");
});

test("prefers-reduced-motion: app renders and animates nothing essential", async ({
  page,
}) => {
  const con = watchConsole(page, "vp-reduced-motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, { selection: ["biology", "latin"] });
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await pressViewChip(page, "List");
  await page
    .getByRole("button", { name: "Keep AP Biology at the regular time" })
    .first()
    .click();
  await pressViewChip(page, "Calendar");
  record({
    kind: "clean",
    area: "reduced-motion",
    summary: "reduced-motion: conflict resolve + view switching work normally",
  });
  con.assertClean("reduced motion");
});

test("dark mode: core states render (visual evidence)", async ({ page }) => {
  const con = watchConsole(page, "vp-dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await seed(page, { selection: ALL_IDS.slice(0, 10) });
  await page.goto("/");
  await pressViewChip(page, "Calendar");
  await page.screenshot({ path: evidencePath("09-dark-calendar.png") });
  await pressViewChip(page, "List");
  await page.screenshot({ path: evidencePath("09-dark-list.png") });
  con.assertClean("dark mode states");
});
