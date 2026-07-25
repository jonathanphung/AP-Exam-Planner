import { expect, type Page } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../src/lib/theme";

/**
 * Hydration-safe activation of the theme toggle (issue #78, fixed under #75).
 *
 * ## The flake
 *
 * `page.goto()` resolves on `load`. Next.js server-renders the whole page, so
 * every button is present, visible and "actionable" to Playwright *before*
 * React hydrates — a click fired right after `goto()` can land on a dead node.
 * The click reports success, nothing happens, and the spec fails several lines
 * later on a state that looks like a product bug.
 *
 * That is what made `issue-41-theme-toggle.spec.ts` "an explicit choice stops
 * following the OS" intermittently red on `main`: the toggle was clicked
 * pre-hydration, the click was swallowed, the label then settled to the
 * hydrated `dark` and the assertion expecting `light` failed. Measured proof
 * that the click never reached React: `localStorage["apx.theme.v1"]` was still
 * `null` afterwards — the store was never called at all. The component itself
 * is sound: `toggleThemePreference()` re-reads live state via
 * `ensureHydrated()`, so any click that DOES reach React produces the right
 * answer even from a stale render.
 *
 * ## Why the obvious gates do not work
 *
 * - Asserting the toggle's label first only gates when the label is *expected
 *   to change* at hydration (an OS-dark machine). On an OS-light machine the
 *   server snapshot and the hydrated one are identical, so the assertion
 *   passes against the dead button.
 * - Waiting for React's `__reactProps$…` marker (with a bound `onClick`) is
 *   NOT sufficient either — measured: the marker was attached and the very
 *   next click was still swallowed, `apx.theme.v1` still `null`. The props are
 *   attached before the root is ready to dispatch into that subtree.
 *
 * ## What this does instead
 *
 * Retry-until-effect, the pattern `support/view-chip.ts` already mandates for
 * this suite — with a post-condition that makes a redundant retry impossible.
 * A toggle is not idempotent, so the post-condition is not "the toggle is in
 * state X" but "the stored preference CHANGED": every successful activation
 * writes a new value (`system`→explicit, then light↔dark), so a retry only
 * ever fires when the previous attempt did nothing at all.
 */
export async function activateThemeToggle(
  page: Page,
  activate: (page: Page) => Promise<void> = (p) =>
    p.getByTestId("theme-toggle").click(),
): Promise<void> {
  const readPreference = () =>
    page.evaluate((k) => window.localStorage.getItem(k), THEME_STORAGE_KEY);

  const before = await readPreference();
  await expect(async () => {
    await activate(page);
    expect(
      await readPreference(),
      "theme toggle activation did not reach React (pre-hydration dead click)",
    ).not.toBe(before);
  }).toPass({ timeout: 10_000 });
}
