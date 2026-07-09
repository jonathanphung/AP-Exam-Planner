"use client";

import { useState } from "react";
import { useTheme, type ResolvedTheme } from "@/lib/theme";

/**
 * Theme toggle (issue #41 — revised per Jon's 2026-07-09 bounce).
 *
 * A two-state light ↔ dark button that lives in the sidebar **branding row**,
 * immediately to the left of the collapse/expand control, sized and boxed to
 * match it so the two read as one control cluster.
 *
 * Icon semantics (bounce §2): the glyph is a pure function of the *resolved*
 * theme — a sun while the app is currently light, a moon while it is currently
 * dark. There is deliberately no monitor / "system" glyph anywhere: `system`
 * survives only as the silent first-visit preference (bounce §3), so the button
 * never has to depict it.
 *
 * Behavior (bounce §3): a brand-new visitor's stored preference is `system`,
 * so the app follows `prefers-color-scheme` until the first click. The first
 * click writes an *explicit* preference — the opposite of whatever is currently
 * resolved — and from then on this is a plain two-state light ↔ dark toggle
 * that no longer follows the OS. There is intentionally **no route back to
 * `system` from the UI** (the store still keeps `system` as the default and a
 * malformed stored value still degrades to it — see theme.ts).
 *
 * Accessibility (bounce §4, the #8 bar): a real <button>; the glyph is
 * decorative (aria-hidden), so the accessible NAME carries the current state
 * AND the action — "Theme: light. Switch to dark theme." — and updates on
 * activation, with the new state also read by the polite live region. ≥44×44px
 * touch target on mobile (h-11 w-11), relaxed to the collapse control's h-8 w-8
 * at `lg`; visible focus ring; AA contrast in both themes (same color classes
 * as the collapse control it sits beside). No theme-transition animation is
 * added, so `prefers-reduced-motion` is honored by construction.
 */

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <circle cx="10" cy="10" r="3.25" />
      <path d="M10 2.25v1.5M10 16.25v1.5M2.25 10h1.5M16.25 10h1.5M4.6 4.6l1.05 1.05M14.35 14.35l1.05 1.05M15.4 4.6l-1.05 1.05M5.65 14.35l-1.05 1.05" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path d="M15.5 12.4a6 6 0 0 1-7.9-7.9.75.75 0 0 0-.98-.98A7.5 7.5 0 1 0 16.5 13.4a.75.75 0 0 0-.98-.98Z" />
    </svg>
  );
}

/** The theme a click switches *to* — the opposite of what is resolved now. */
const OTHER: Record<ResolvedTheme, ResolvedTheme> = { light: "dark", dark: "light" };

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  // Empty until the user acts, so nothing is read on load; each activation
  // updates it and the polite live region announces the new state.
  const [announcement, setAnnouncement] = useState("");

  const other = OTHER[resolved];

  return (
    <>
      <button
        type="button"
        data-testid="theme-toggle"
        onClick={() => {
          const next = toggle();
          setAnnouncement(`Theme: ${next}.`);
        }}
        // Name conveys current state AND action (icon is decorative). The
        // resolved theme is the state the sun/moon glyph depicts.
        aria-label={`Theme: ${resolved}. Switch to ${other} theme.`}
        title={`Theme: ${resolved}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:h-8 lg:w-8 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400"
      >
        {resolved === "dark" ? <MoonIcon /> : <SunIcon />}
      </button>
      {/* Announce the new state on activation (issue #41 a11y AC). Visually
          hidden; polite so it doesn't interrupt. */}
      <span aria-live="polite" className="sr-only" data-testid="theme-announcement">
        {announcement}
      </span>
    </>
  );
}
