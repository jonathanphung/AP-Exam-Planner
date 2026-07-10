import { describe, expect, it } from "vitest";
import { scrollLockCompensationPx } from "./modal";

/**
 * Issue #49 — pure core of the scroll-lock width compensation.
 *
 * The DOM shell (body overflow/padding mutation, restore-on-unmount, the
 * `scrollbar-gutter: stable` CSS primary path) is exercised end-to-end by the
 * Playwright suite `e2e/issue-49-scrollbar-gutter.spec.ts`, matching how the
 * other lib stores split pure core vs browser shell.
 */
describe("scrollLockCompensationPx", () => {
  it("returns 0 when scrollbar-gutter: stable is supported (CSS owns the width)", () => {
    // Classic scrollbar present (17px) but the gutter reservation handles it.
    expect(scrollLockCompensationPx(1920, 1903, true)).toBe(0);
  });

  it("returns the classic scrollbar width when the gutter is unsupported", () => {
    // Safari < 18.2 with our ::-webkit-scrollbar styling forcing classic mode.
    expect(scrollLockCompensationPx(1920, 1903, false)).toBe(17);
    expect(scrollLockCompensationPx(375, 365, false)).toBe(10);
  });

  it("returns 0 for overlay scrollbars (widths match — nothing to compensate)", () => {
    expect(scrollLockCompensationPx(1920, 1920, false)).toBe(0);
  });

  it("never returns a negative compensation", () => {
    // Defensive: zoom/rounding artifacts must not produce negative padding.
    expect(scrollLockCompensationPx(1919, 1920, false)).toBe(0);
  });
});
