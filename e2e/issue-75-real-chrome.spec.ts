import { test, expect, type Page } from "@playwright/test";
import {
  SHOW_SCROLLBARS,
  SCHEDULES_KEY,
  forceClassicScrollbars,
  probeX,
  seedKey,
} from "./support/scroll-shift";

/**
 * Issue #75 — QA pass: the sticky sidebar AND the centered shell, together,
 * in REAL Chrome under classic (space-taking) scrollbars.
 *
 * ## Why this file exists on top of `issue-75-scroll-lock-sticky.spec.ts`
 *
 * The Builder's regression spec proves the vertical half of the contract (the
 * sidebar does not move when a dialog opens while scrolled) and
 * `issue-49-real-chrome.spec.ts` proves the horizontal half (the centered shell
 * does not shift). Neither proves them at the same instant, and neither proves
 * the vertical half in the one engine where the scroll lock behaves
 * differently:
 *
 * - Playwright's bundled Chromium DROPS the `scrollbar-gutter: stable`
 *   reservation under a lock; real Chrome RETAINS it under `overflow: hidden`.
 *   That divergence is the whole reason `issue-49-real-chrome.spec.ts` exists
 *   (Jon's bounce on #49: the old width-inference fix shifted the shell LEFT in
 *   real Chrome while bundled Chromium stayed green over a live bug).
 * - Issue #75 changes the lock keyword to `overflow: clip`, under which the
 *   root is not a scroll container at all, so the gutter reservation is dropped
 *   *everywhere*. That is a behaviour change specific to real Chrome — the one
 *   engine that used to keep it — and the compensation path that has to absorb
 *   it is #49's position-invariant padding correction.
 * - Bundled Chromium is launched with `--hide-scrollbars`, so the default suite
 *   never sees a scrollbar occupying layout width at all.
 *
 * So: real Chrome, forced classic scrollbars, page scrolled deep, dialog open —
 * assert the sidebar's box AND the shell's left edge are both unchanged. If the
 * #75 fix had traded #49's guarantee away, this is where it would show.
 *
 * Requires Google Chrome on the host. Verified present on this runner
 * (`C:\Program Files\Google\Chrome\Application\chrome.exe`); #78 lists
 * `Chromium distribution 'chrome' is not found` as an environmental failure
 * mode on runners without it, same as `issue-49-real-chrome.spec.ts`.
 */
test.use({ channel: "chrome", ...SHOW_SCROLLBARS });

const SIDEBAR = "[data-testid='resources-sidebar']";
const VIEWPORT = { width: 1440, height: 900 };

type Box = { x: number; y: number; width: number; height: number };

const sidebarBox = async (page: Page): Promise<Box> =>
  (await page.locator(SIDEBAR).boundingBox())!;

function expectSameBox(actual: Box, expected: Box, what: string) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${what}: sidebar ${key} moved (${expected[key]} → ${actual[key]})`,
    ).toBeLessThanOrEqual(1);
  }
}

test("real Chrome + classic scrollbars: a dialog opened while scrolled moves neither the sticky sidebar nor the centered shell", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await seedKey(page, SCHEDULES_KEY, {
    activeId: "sched-1",
    schedules: [
      { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
      { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
    ],
  });
  await page.goto("/");
  await forceClassicScrollbars(page);

  // Precondition 1 — a classic scrollbar really is taking layout width, so the
  // #49 half of this assertion cannot pass vacuously.
  expect(
    await page.evaluate(
      () => window.innerWidth - document.documentElement.clientWidth,
    ),
    "precondition: real Chrome must render a classic (space-taking) scrollbar",
  ).toBeGreaterThan(0);

  const opener = page.getByRole("button", { name: "Delete Schedule 2" });
  await expect(opener).toBeVisible();

  // Precondition 2 — the page really is scrolled, so the sticky panel is
  // pinned rather than resting at its static offset. At scrollY 0 this bug is
  // invisible; that is exactly why it shipped.
  const landedAt = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.min(1200, max)));
    return window.scrollY;
  });
  expect(landedAt, "precondition: the page must be scrolled").toBeGreaterThan(
    200,
  );

  const sidebarBefore = await sidebarBox(page);
  const shellBefore = await probeX(page);
  expect(
    sidebarBefore.y + sidebarBefore.height,
    "precondition: the sticky sidebar must be on screen before the dialog opens",
  ).toBeGreaterThan(0);

  const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();

  // #75 — vertical: the sticky column has not moved.
  expectSameBox(await sidebarBox(page), sidebarBefore, "real Chrome, open");
  await expect(page.locator(SIDEBAR)).toBeVisible();
  // #49 — horizontal: the centered shell has not moved either. Byte-identical,
  // not within-1px: that is the contract the #49 bounce settled on.
  expect(
    await probeX(page),
    "real Chrome: the centered shell shifted while the dialog was open",
  ).toBe(shellBefore);
  // #75 AC3 — opening did not scroll the document.
  expect(await page.evaluate(() => window.scrollY)).toBe(landedAt);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  expectSameBox(await sidebarBox(page), sidebarBefore, "real Chrome, closed");
  expect(
    await probeX(page),
    "real Chrome: the centered shell did not return to its exact position",
  ).toBe(shellBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(landedAt);
});
