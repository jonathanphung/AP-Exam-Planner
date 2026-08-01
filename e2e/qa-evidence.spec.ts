import { test, expect } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #1) — evidence spec.
 *
 * One observable assertion per acceptance-criterion clause that is visible in
 * the browser, plus screenshot capture at the three standard super-board
 * viewports (desktop 1920x1080, tablet 1024x768, mobile 375x667). Screenshots
 * are written to the run evidence folder and committed to the issue branch so
 * they render inline on the issue / PR.
 *
 * Issue #82: `page.screenshot()` defaults to `caret: "hide"`, which mutates
 * EVERY `<input>`'s `style` attribute (`caret-color: transparent !important`)
 * for the capture's duration, then resets it — even on inputs that were never
 * focused. Under cold full-suite compile load, React hydration is still
 * pending when that screenshot fires; hydration then diffs against a DOM
 * carrying a `style` attribute the server never rendered and logs a
 * hydration-mismatch console error, which the zero-console-errors assertion
 * below (correctly) fails. Two changes close the race without touching
 * product code:
 *   1. `caret: "initial"` stops the mutation outright — nothing on this page
 *      is focused at capture time, so the evidence PNGs are pixel-identical.
 *   2. A post-screenshot interactivity probe (fill → filtered → clear →
 *      restored) forces hydration to complete before the console-error
 *      assertions run, so the check is deterministic w.r.t. hydration timing
 *      instead of "no errors yet, if we happened to look early".
 */

const EVIDENCE_DIR = evidenceDir("issue-1-qa-v1");

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC2 — / renders header + populated main with no console errors (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    // Document title
    await expect(page).toHaveTitle("AP Exam Planner");

    // Visible h1 header
    const h1 = page.getByRole("heading", { level: 1, name: "AP Exam Planner" });
    await expect(h1).toBeVisible();

    // Main region is present. Issue #1's original AC asserted an *empty* main;
    // issue #3 deliberately mounts the subject catalog into it, so the region
    // is now populated (the search input is the stable anchor).
    const main = page.getByRole("main");
    await expect(main).toBeAttached();
    await expect(main).not.toBeEmpty();
    await expect(main.getByLabel("Search subjects")).toBeVisible();

    // caret: "initial" (issue #82) — the default "hide" mutates every
    // input's style attribute for the capture, which races React hydration
    // under cold-boot load and produces a false-positive hydration-mismatch
    // console error below. Nothing here is focused at capture time, so the
    // evidence PNGs are unaffected either way.
    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
      caret: "initial",
    });

    // Interactivity probe (issue #82): prove the page is hydrated and
    // actually wired up before checking for console errors, so the check
    // below is deterministic instead of a race against hydration timing.
    // "bio" is the narrowest useful query in the dataset — exactly one match
    // — so the filter's effect is unambiguous. (It used to be quoted from the
    // input's placeholder; issue #102 shortened that to "Search subjects" when
    // the field moved into the condensed sticky header.)
    const searchInput = main.getByLabel("Search subjects");
    await searchInput.fill("bio");
    await expect(
      main.getByRole("button", { name: "AP Biology", exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: "AP Calculus AB", exact: true }),
    ).not.toBeVisible();
    await searchInput.fill("");
    await expect(
      main.getByRole("button", { name: "AP Calculus AB", exact: true }),
    ).toBeVisible();

    // Zero browser console errors (favicon noise ignored — none expected here).
    const meaningfulErrors = consoleErrors.filter((t) => !/favicon/i.test(t));
    expect(
      pageErrors,
      `Unexpected page errors: ${pageErrors.join(", ")}`,
    ).toEqual([]);
    expect(
      meaningfulErrors,
      `Unexpected console errors: ${meaningfulErrors.join(", ")}`,
    ).toEqual([]);
  });
}
