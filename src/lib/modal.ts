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
 * applies once overflow is `hidden`: Firefox holds the gutter; Chromium
 * (measured live in this build via the issue-49 e2e spec) drops it even when
 * the lock is on the root element itself, and Safari < 18.2 has no
 * `scrollbar-gutter` at all. Feature-detecting `CSS.supports` therefore LIES
 * here — Chromium supports the property but not the semantics we need.
 *
 * So the ONE-place compensation is behavior-measured instead: the caller
 * samples `documentElement.clientWidth` before and after applying the lock
 * and passes both. If the viewport got wider, the gutter was dropped and the
 * difference is exactly the padding the body needs; if the gutter held (or
 * scrollbars are overlay), the delta is 0 and CSS alone carries the fix.
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
    // body-only locking is exactly what caused the Windows layout shift. With
    // the root locked, the reserved gutter keeps the viewport width constant
    // while the scrollbar is hidden. The body is locked too so the pre-#49
    // observable contract (body.style.overflow === "hidden" while open,
    // asserted by issue-6/a11y specs) still holds. For browsers without
    // `scrollbar-gutter` support, compensate in this ONE place with body
    // padding equal to the measured classic-scrollbar width — measured
    // BEFORE hiding overflow, afterwards the scrollbar is already gone.
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const compensation = scrollLockCompensationPx(
      window.innerWidth,
      root.clientWidth,
      supportsStableScrollbarGutter(),
    );
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (compensation > 0) {
      const basePadding =
        Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${basePadding + compensation}px`;
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
