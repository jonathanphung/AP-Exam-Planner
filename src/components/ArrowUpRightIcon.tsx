/**
 * Shared external-link affordance icon (issue #50).
 *
 * Replaces the bare U+2197 (NORTH EAST ARROW) character previously used
 * after external-link labels. On Windows, that codepoint renders with emoji
 * presentation (Segoe UI Emoji) in the browsers most users run, so it showed
 * up as a colored emoji glyph instead of a clean text arrow — this component
 * makes the affordance render identically on every platform.
 *
 * Follows the repo's existing inline-icon pattern (`GitHubIcon` /
 * `PanelToggleIcon` in `Sidebar.tsx`, `SunIcon` / `MoonIcon` in
 * `ThemeToggle.tsx`): `aria-hidden`, `stroke="currentColor"` so it inherits
 * the surrounding link/button color in both themes, no hardcoded fill.
 *
 * Sized at `1em` (not a fixed pixel size like the other sidebar icons)
 * because, unlike those, this one sits inline after running text at two
 * different call sites — it needs to track whatever font size it's dropped
 * into rather than assume one. Both current call sites render at `text-sm`
 * (14px), so it optically matches the cap-height of the text it follows,
 * same as the character glyph it replaces.
 *
 * Shared here (not inlined per call site like `GitHubIcon`) because two
 * files consume it: `Sidebar.tsx` (resource links) and `InfoPanel.tsx` (the
 * College Board button). Builder's documented call (issue #50): no other
 * external link exists yet — `MySchedules.tsx` and `FeedbackDialog.tsx` have
 * none — but any future one should import this component rather than
 * re-adding that character or a duplicate inline SVG.
 */
export function ArrowUpRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1em] w-[1em] shrink-0"
    >
      <path d="M6 6h8v8" />
      <path d="M6 14 14 6" />
    </svg>
  );
}
