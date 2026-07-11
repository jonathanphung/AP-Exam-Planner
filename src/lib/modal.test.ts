import { describe, expect, it } from "vitest";
import {
  scrollLockCompensationPx,
  scrollLockPaddingCorrection,
} from "./modal";

/**
 * Issue #49 — pure core of the scroll-lock width compensation.
 *
 * The hook samples `documentElement.clientWidth` before and after applying
 * `overflow: hidden` and passes both here; the return value is the
 * padding-right the body needs while scroll is locked. The DOM shell (root +
 * body overflow mutation, restore-on-unmount, the `scrollbar-gutter: stable`
 * CSS primary path) is exercised end-to-end by the Playwright suite
 * `e2e/issue-49-scrollbar-gutter.spec.ts`, matching how the other lib stores
 * split pure core vs browser shell.
 */
describe("scrollLockCompensationPx", () => {
  it("returns 0 when the reserved gutter held the width (CSS owns the fix)", () => {
    // Classic scrollbar present, but `scrollbar-gutter: stable` kept the
    // viewport at the same client width after `overflow: hidden`.
    expect(scrollLockCompensationPx(1903, 1903)).toBe(0);
  });

  it("returns the freed scrollbar width when the lock widened the viewport", () => {
    // Browser without a working `scrollbar-gutter` under the lock (Chromium,
    // Safari < 18.2) with our ::-webkit-scrollbar styling forcing classic
    // mode: hiding overflow removes the scrollbar and the viewport gains its
    // width back.
    expect(scrollLockCompensationPx(1903, 1920)).toBe(17);
    expect(scrollLockCompensationPx(365, 375)).toBe(10);
  });

  it("returns 0 for overlay scrollbars (widths match — nothing to compensate)", () => {
    expect(scrollLockCompensationPx(1920, 1920)).toBe(0);
  });

  it("never returns a negative compensation", () => {
    // Defensive: zoom/rounding artifacts must not produce negative padding.
    expect(scrollLockCompensationPx(1920, 1919)).toBe(0);
  });
});

/**
 * Issue #49 (Jon bounce pass 1) — position-invariant correction core.
 *
 * The page shell is centered with auto side margins, so `padding-right` of P px
 * on <body> moves the shell's left edge left by exactly P / 2. Given the
 * shell's pre-lock left edge and its left edge now, this returns the extra
 * padding that pins it back — reaching the fixed point in ONE step from any
 * starting padding. The DOM shell (measure → lock → converge → restore) is
 * exercised end-to-end, in bundled Chromium AND real Chrome, by
 * `e2e/issue-49-scrollbar-gutter.spec.ts`.
 */
describe("scrollLockPaddingCorrection", () => {
  it("adds twice the right-drift when a dropped gutter widened the layout", () => {
    // Dropped gutter (bundled Chromium / Windows): a 16px scrollbar freed the
    // width, the centered shell moved right by 8px. From zero padding, the fix
    // is 16px — which then moves the shell back left by 8px, onto its origin.
    expect(scrollLockPaddingCorrection(0, 100, 108)).toBe(16);
  });

  it("removes an over-shooting first guess when the gutter was actually retained", () => {
    // Real Chrome (the Jon bounce): the width guess wrongly applied 16px, so
    // the retained-gutter shell drifted LEFT by 8px (108 → 100 → 92). The
    // correction backs the padding out to 0 — no shift, no over-compensation.
    expect(scrollLockPaddingCorrection(16, 100, 92)).toBe(0);
  });

  it("leaves padding untouched once the shell is already pinned (drift 0)", () => {
    expect(scrollLockPaddingCorrection(10, 250.5, 250.5)).toBe(10);
  });

  it("reaches the fixed point in one step regardless of the starting padding", () => {
    // Same true origin (leftBefore=100, dropped 16px => target extra 16px).
    // Starting from any padding, extra' = extra + 2·(leftNow - leftBefore),
    // and leftNow = 108 - extra/2, so extra' == 16 every time.
    expect(scrollLockPaddingCorrection(0, 100, 108)).toBe(16); // leftNow 108
    expect(scrollLockPaddingCorrection(8, 100, 104)).toBe(16); // leftNow 104
    expect(scrollLockPaddingCorrection(24, 100, 96)).toBe(16); // leftNow 96
  });

  it("never returns a negative padding (clamped for anti-shift-only)", () => {
    // A browser that ADDS width on lock (shell drifts left with no padding)
    // cannot be corrected by negative padding — clamp to 0.
    expect(scrollLockPaddingCorrection(0, 100, 96)).toBe(0);
  });
});
