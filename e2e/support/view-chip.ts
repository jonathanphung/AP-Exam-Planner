import { expect, type Page } from "@playwright/test";

/**
 * Hydration-safe view-switcher chip press.
 *
 * The List/Calendar chips are server-rendered before React hydration attaches
 * their click handlers. A `chip.click()` fired immediately after `goto()` /
 * `reload()` can therefore land on a dead button: the click "succeeds" but the
 * view never switches, and the spec times out waiting for the target section
 * (seen once on the Reviewer's merge-gate rerun of PR #27 — issue #5 AC3,
 * `openList` at issue-5-conflict-resolution.spec.ts).
 *
 * Fix: retry-click until the chip itself reports the pressed state. The
 * `aria-pressed` flip is the app's own signal that the handler ran, so the
 * loop converges exactly when hydration has caught up — no fixed sleeps.
 * Clicking an already-pressed chip is a state no-op, so callers may use this
 * unconditionally (e.g. for the calendar chip, which is pressed by default).
 *
 * Every e2e spec that switches views MUST use this helper instead of a raw
 * `chip.click()` — this suite is the pipeline's merge gate, and a 1-in-N
 * hydration flake here bounces unrelated cards later.
 */
export async function pressViewChip(
  page: Page,
  name: "List" | "Calendar",
): Promise<void> {
  const chip = page
    .getByRole("group", { name: "Schedule view" })
    .getByRole("button", { name });
  await expect(async () => {
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true", {
      timeout: 1000,
    });
  }).toPass();
}
