import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  SHOW_SCROLLBARS,
  forceClassicScrollbars,
  openExamDetailsOpener,
  registerDialogShiftTests,
} from "./support/scroll-shift";

/**
 * Issue #49 — REAL CHROME channel (`channel: "chrome"`), the Jon bounce pass 1.
 *
 * Why a second spec: real Chrome RETAINS the reserved gutter under
 * `overflow: hidden`, whereas Playwright's bundled Chromium drops it. The
 * original fix inferred the compensation from `documentElement.clientWidth` —
 * which in real Chrome reported the gutter as dropped even though the final
 * paint kept it — so it padded the body by a spurious ~scrollbar width and the
 * centered shell drifted LEFT (Jon measured −5 to −7px at 1920×935). Bundled
 * Chromium alone could never catch this: it genuinely drops the gutter, so the
 * old fix was correct there and the suite stayed green over a live bug.
 *
 * The position-invariant fix (src/lib/modal.ts) measures the shell's real box
 * and pins it, so `rect.left` is byte-identical closed → open → closed in BOTH
 * channels. This file re-runs the same five dialog assertions under real Chrome
 * and adds the logged measurement table the bounce asked for.
 *
 * Requires Google Chrome installed on the host (it is, on this machine); real
 * Chrome is the only channel that reproduces the retained-gutter semantics.
 */
test.use({ channel: "chrome", ...SHOW_SCROLLBARS });

registerDialogShiftTests();

test("real Chrome: logged measurement table — shell rect.left steady closed → open → close", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 935 });
  await page.goto("/");
  await forceClassicScrollbars(page);
  const opener = await openExamDetailsOpener(page);
  const dialog = page.getByRole("dialog");

  const scrollbarWidth = await page.evaluate(
    () => window.innerWidth - document.documentElement.clientWidth,
  );
  expect(
    scrollbarWidth,
    "precondition: real Chrome must render a classic (space-taking) scrollbar",
  ).toBeGreaterThan(0);

  const read = () =>
    page.evaluate(() => {
      const shell = document.querySelector("[data-scroll-lock-anchor]");
      return {
        clientWidth: document.documentElement.clientWidth,
        bodyPaddingRight: getComputedStyle(document.body).paddingRight,
        shellLeft: shell ? shell.getBoundingClientRect().left : Number.NaN,
      };
    });

  const closed = await read();
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const open = await read();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const reclosed = await read();

  const table = [
    "Issue #49 — real Chrome (channel: chrome) scroll-lock measurements",
    "InfoPanel (exam details) dialog · 1920x935 · forced classic scrollbar",
    `forced scrollbar width: ${scrollbarWidth}px`,
    "",
    "                             closed     open      reclosed",
    `documentElement.clientWidth  ${closed.clientWidth}       ${open.clientWidth}      ${reclosed.clientWidth}`,
    `body padding-right           ${closed.bodyPaddingRight || "0px"}        ${open.bodyPaddingRight || "0px"}        ${reclosed.bodyPaddingRight || "0px"}`,
    `shell rect.left              ${closed.shellLeft}      ${open.shellLeft}     ${reclosed.shellLeft}`,
    "",
    `shell drift open - closed:      ${open.shellLeft - closed.shellLeft}px  (must be 0 — no shift)`,
    `shell drift reclosed - closed:  ${reclosed.shellLeft - closed.shellLeft}px  (must be 0 — restored)`,
  ].join("\n");
  const dir = "docs/super-board/runs/issue-49-build-v2";
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/real-chrome-measurements.txt`, `${table}\n`);
  await testInfo.attach("real-chrome-measurements", {
    body: table,
    contentType: "text/plain",
  });

  expect(
    open.shellLeft,
    "shell drifted while the dialog was open (real Chrome)",
  ).toBe(closed.shellLeft);
  expect(
    reclosed.shellLeft,
    "shell did not return to its exact position after close (real Chrome)",
  ).toBe(closed.shellLeft);
});
