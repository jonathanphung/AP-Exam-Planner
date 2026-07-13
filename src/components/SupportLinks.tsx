"use client";

import { useState } from "react";
import { FeedbackDialog } from "@/components/FeedbackDialog";

/**
 * The support pair (issue #60): "Send us Feedback" + the GitHub mark.
 *
 * Extracted out of `Sidebar.tsx` so the two placements can be rendered from
 * two different trees while staying ONE component:
 *
 *   • Desktop (≥1024px / `lg`) — `variant="sidebar"`: a bordered row pinned to
 *     the bottom edge of the sticky sidebar column (`hidden … lg:flex` +
 *     `lg:mt-auto`), text label left, icon-only GitHub mark right.
 *   • Mobile/tablet (<1024px) — `variant="footer"`: the **quiet meta row** in
 *     the site footer (`flex … lg:hidden`), BELOW the attribution copy. One
 *     small muted centered line — `Send us Feedback · ⌂ GitHub` — in the
 *     footer's own `text-xs` / slate-600 type, with no divider rule, so it
 *     recedes into the page chrome instead of reading as a button bar or a
 *     third section under MY SCHEDULES / RESOURCES (Jon bounce, pass 1).
 *
 * The two variants differ ONLY in presentation. Both placements are always
 * rendered; **complementary CSS visibility** picks exactly one per viewport.
 * `display: none` removes the other from the accessibility tree entirely, so
 * assistive tech only ever encounters ONE feedback button and ONE GitHub link
 * (the same dual-render trick the sidebar already uses for its
 * plain-vs-disclosure headings). The e2e suite asserts this with
 * accessible-role counts at every width — and across a live resize — rather
 * than visually.
 *
 * Touch targets stay ≥44px in BOTH variants. That is the tension in the meta
 * row: the type is deliberately small (`text-xs`), so the hit area is grown
 * with padding (`min-h-11` + `px-2`), never by shrinking the target.
 *
 * Each instance owns its own `feedbackOpen` state and mounts its own
 * `FeedbackDialog` (mounted only while open, so `useModalDialog`'s focus trap
 * + focus-restore run per open/close and focus returns to the button that
 * opened it). Only the visible instance can be activated, so the two states
 * can never both be true. The dialog is `position: fixed`, so it overlays the
 * page correctly from the footer just as it did from the sidebar.
 */

const REPO_URL = "https://github.com/jonathanphung/AP-Exam-Planner";

/**
 * The GitHub link's accessible name — the SINGLE name for the control in both
 * variants. In the meta row the word "GitHub" is *visible* beside the mark, but
 * `aria-label` overrides an element's contents in the accessible-name
 * computation, so the name stays exactly this string; the visible word never
 * doubles it ("GitHub GitHub repository…") nor replaces it.
 */
const GITHUB_LABEL = "GitHub repository (opens in a new tab)";

/** Shared focus ring — identical in both variants. */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";

/** Underline-on-hover/focus affordance for a text label inside a `group`. */
const LABEL_UNDERLINE =
  "underline-offset-2 group-hover:underline group-focus-visible:underline";

/**
 * Meta-row control: the footer's own small muted type (`text-xs`,
 * `text-slate-600` / `dark:text-slate-400`), grown to a ≥44px hit area with
 * padding. No background, no border, no rounded chip — it must read as one
 * line of footer meta, not as a button.
 */
const META_CONTROL = `group inline-flex min-h-11 items-center rounded-sm px-2 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ${FOCUS_RING}`;

/** GitHub mark (octocat silhouette). */
function GitHubIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SupportLinks({
  testId,
  className,
  collapsed = false,
  variant = "sidebar",
}: {
  /** `data-testid` for the row wrapper — one per placement. */
  testId: string;
  /** Placement-owned layout: display gate (`hidden lg:flex` / `flex lg:hidden`),
   *  spacing, alignment. */
  className: string;
  /** Desktop collapsed rail only: hide the label, center the lone GitHub mark. */
  collapsed?: boolean;
  /** Presentation. `sidebar` = the pinned desktop row; `footer` = the quiet
   *  meta row. */
  variant?: "sidebar" | "footer";
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const isMeta = variant === "footer";

  return (
    <>
      <div
        data-testid={testId}
        className={[className, collapsed ? "lg:justify-center" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          aria-haspopup="dialog"
          className={[
            isMeta
              ? META_CONTROL
              : // Desktop: ≥44px touch target below lg is moot (this row is
                // `hidden` there), relaxed to min-h-9 at lg like the other
                // sidebar controls.
                `group inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-slate-700 hover:text-slate-900 lg:min-h-9 dark:text-slate-300 dark:hover:text-slate-100 ${FOCUS_RING}`,
            // Collapsed rail (~40px): no room for the label; the GitHub mark
            // stays reachable icon-only (Jon's explicit #41 bounce
            // requirement — do not regress it).
            collapsed ? "lg:hidden" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={LABEL_UNDERLINE}>Send us Feedback</span>
        </button>

        {/* Meta row only: a thin middot tying the two items into ONE line.
            Decorative — `aria-hidden` keeps it out of the a11y tree so the row
            never announces as "Send us Feedback · GitHub repository". */}
        {isMeta && (
          <span
            aria-hidden="true"
            className="select-none text-slate-400 dark:text-slate-600"
          >
            ·
          </span>
        )}

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={GITHUB_LABEL}
          title="GitHub repository"
          className={
            isMeta
              ? // Meta row: the mark + the word "GitHub", styled identically to
                // the feedback link so the row reads as one line of meta. Its
                // 44px hit area comes from `min-h-11` + `px-2`, not from a
                // 44×44 icon button (which would look like a control).
                `${META_CONTROL} gap-1.5`
              : // Desktop: icon-only 44×44 (relaxed to 36×36 at lg) mark — the
                // presentation Jon approved; do not restyle.
                `flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:h-9 lg:w-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${FOCUS_RING}`
          }
        >
          <GitHubIcon className={isMeta ? "h-3.5 w-3.5" : "h-5 w-5"} />
          {isMeta && (
            /* Visible label. `aria-hidden` is NOT needed — and would be wrong:
               the link's `aria-label` already overrides its contents, so this
               word is presentational to AT either way, and hiding it would
               make the link look empty to some legacy AT. */
            <span className={LABEL_UNDERLINE}>GitHub</span>
          )}
        </a>
      </div>

      {/* In-app feedback dialog (#42) — `position: fixed`, so it overlays the
          whole page from either mount point. */}
      {feedbackOpen && (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
      )}
    </>
  );
}
