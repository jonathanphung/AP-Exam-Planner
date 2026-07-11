"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared modal-dialog accessibility behavior (issue #8).
 *
 * Extracted from the InfoPanel (issue #6) so the conflict dialog can reuse the
 * exact same, already-QA'd machinery. While the host component is mounted it:
 *
 *   - moves focus into the dialog (an explicit `initialFocusRef` when given,
 *     otherwise the first focusable element inside the panel),
 *   - traps Tab / Shift+Tab within the panel,
 *   - calls `onClose` on Escape (stopping propagation so nothing behind the
 *     dialog also reacts),
 *   - locks background scroll while open,
 *   - restores focus to the previously focused element on unmount.
 *
 * Mount the host component only while the dialog is open — the effect is
 * intentionally mount-scoped. The latest `onClose` is read through a ref so a
 * re-render with a new callback identity does not re-run the mount effect
 * (which would spuriously steal focus back to the initial element).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Scroll-lock width compensation (issue #49) — pure core, unit-tested in
 * `modal.test.ts`.
 *
 * Locking background scroll (`overflow: hidden`) removes the document
 * scrollbar. With classic (non-overlay) scrollbars that frees ~15–17px of
 * layout width and the centered page shifts right — the Windows dialog-open
 * bug. `html { scrollbar-gutter: stable }` (globals.css) is supposed to keep
 * that gutter reserved, but browsers disagree about whether `stable` still
 * applies once overflow is `hidden`: Firefox holds the gutter; some Chromium
 * builds drop it (clientWidth jumps under the lock) while others RETAIN it,
 * and Safari < 18.2 has no `scrollbar-gutter` at all. Feature-detecting
 * `CSS.supports` therefore LIES here — Chromium supports the property but
 * not consistently the semantics we need.
 *
 * This value is only a FIRST GUESS: the caller samples
 * `documentElement.clientWidth` before and after applying the lock. If the
 * viewport got wider, the gutter was probably dropped and the difference is
 * roughly the padding the body needs. But `clientWidth` proved unreliable in
 * real Chrome (it reported the gutter dropped while the final paint retained
 * it, so this guess double-compensated and the page drifted LEFT — the Jon
 * bounce on issue #49). The authoritative correction is position-based and
 * lives in `scrollLockPaddingCorrection`; this guess just gets the common
 * case close in one shot.
 *
 * @param unlockedClientWidth `documentElement.clientWidth` before the lock
 * @param lockedClientWidth   `documentElement.clientWidth` after `overflow: hidden`
 * @returns pixels to add to the body's padding-right while scroll is locked
 */
export function scrollLockCompensationPx(
  unlockedClientWidth: number,
  lockedClientWidth: number,
): number {
  return Math.max(0, lockedClientWidth - unlockedClientWidth);
}

/**
 * Position-invariant scroll-lock correction (issue #49, Jon bounce pass 1) —
 * pure core, unit-tested in `modal.test.ts`.
 *
 * The thing that must not move is the layout, so measure the layout instead of
 * inferring it from `clientWidth`. The page shell (`[data-scroll-lock-anchor]`,
 * `src/app/page.tsx`) is centered with auto side margins, so adding P px of
 * `padding-right` to `<body>` narrows its content box by P and moves the
 * shell's left edge LEFT by exactly P / 2. Given the shell's left edge before
 * the lock and its left edge now (after the lock plus whatever padding is
 * currently applied), the padding that pins it back is:
 *
 *     extra' = extra + 2 · (leftNow − leftBefore)
 *
 * Because the half-padding relationship is exact, this reaches the fixed point
 * (leftNow === leftBefore) in a SINGLE step from any starting `extra` — the
 * caller iterates only to absorb sub-pixel rounding. It is self-correcting
 * across browsers: a retained gutter (real Chrome) makes the width guess
 * over-shoot, drift goes negative, and the padding is removed; a dropped
 * gutter (bundled Chromium, Windows) keeps it; anything in between converges.
 * Clamped at 0 — negative padding is never the fix for this right-shift bug.
 *
 * @param currentExtraPaddingPx  padding-right already added beyond the body's base
 * @param landmarkLeftUnlocked   shell `getBoundingClientRect().left` before locking
 * @param landmarkLeftLocked     shell `getBoundingClientRect().left` after locking + current padding
 * @returns the extra padding-right (beyond base) that pins the shell back
 */
export function scrollLockPaddingCorrection(
  currentExtraPaddingPx: number,
  landmarkLeftUnlocked: number,
  landmarkLeftLocked: number,
): number {
  const drift = landmarkLeftLocked - landmarkLeftUnlocked;
  return Math.max(0, currentExtraPaddingPx + 2 * drift);
}

export function useModalDialog(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const initial =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    initial?.focus();

    // Lock background scroll while the dialog is open (issue #49). The lock
    // must land on the ROOT element, not only the body: `scrollbar-gutter:
    // stable` (globals.css) is only honored by the scroll container it is set
    // on, and overflow propagated body → viewport drops the reservation —
    // body-only locking is exactly what caused the Windows layout shift. The
    // body is locked too so the pre-#49 observable contract
    // (body.style.overflow === "hidden" while open, asserted by issue-6/a11y
    // specs) still holds.
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;

    // Position-invariant compensation (issue #49, Jon bounce pass 1). Sample
    // the centered page shell's left edge BEFORE locking; whatever the lock
    // does to the scrollbar gutter, the shell will be pinned back to this exact
    // pixel afterward. This replaces the earlier width-inference-only approach,
    // which double-compensated in real Chrome (gutter retained but clientWidth
    // reported it dropped) and drifted the layout LEFT.
    const landmark = document.querySelector<HTMLElement>(
      "[data-scroll-lock-anchor]",
    );
    const landmarkLeftUnlocked =
      landmark?.getBoundingClientRect().left ?? null;
    const basePaddingRight =
      Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;

    const unlockedClientWidth = root.clientWidth;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    // First guess from the width delta (right in browsers that drop the gutter
    // under the lock; a no-op when it held or scrollbars are overlay).
    let extraPadding = scrollLockCompensationPx(
      unlockedClientWidth,
      root.clientWidth,
    );
    if (extraPadding > 0) {
      body.style.paddingRight = `${basePaddingRight + extraPadding}px`;
    }

    // Authoritative correction: measure the shell's real box and converge the
    // padding until its left edge matches the pre-lock pixel. Each
    // getBoundingClientRect forces a synchronous layout so every read reflects
    // the real painted box; all of this runs inside the mount effect before the
    // browser paints, so the convergence is invisible (no flicker). One step
    // suffices mathematically; the cap of 3 only absorbs sub-pixel rounding.
    if (landmark && landmarkLeftUnlocked !== null) {
      for (let i = 0; i < 3; i += 1) {
        const landmarkLeftLocked = landmark.getBoundingClientRect().left;
        if (Math.abs(landmarkLeftLocked - landmarkLeftUnlocked) <= 0.5) break;
        extraPadding = scrollLockPaddingCorrection(
          extraPadding,
          landmarkLeftUnlocked,
          landmarkLeftLocked,
        );
        body.style.paddingRight = `${basePaddingRight + extraPadding}px`;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables =
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousPaddingRight;
      // Return focus to the element that opened the dialog (no-op if it has
      // since left the document).
      previouslyFocused?.focus();
    };
    // Mount-scoped by design — see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
