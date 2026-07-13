"use client";

import { useState } from "react";
import { FeedbackDialog } from "@/components/FeedbackDialog";

/**
 * The support pair (issue #60): "Send us Feedback" + the GitHub mark.
 *
 * Extracted out of `Sidebar.tsx` so the two placements can be rendered from
 * two different trees while staying ONE component:
 *
 *   • Desktop (≥1024px / `lg`): pinned to the bottom edge of the sticky
 *     sidebar column — see `Sidebar.tsx` (`hidden … lg:flex` + `lg:mt-auto`).
 *   • Mobile/tablet (<1024px): inside the site footer — see `Footer.tsx`
 *     (`flex … lg:hidden`), so it reads as page chrome instead of a third
 *     section under MY SCHEDULES / RESOURCES.
 *
 * Both placements are always rendered; **complementary CSS visibility** picks
 * exactly one per viewport. `display: none` removes the other from the
 * accessibility tree entirely, so assistive tech only ever encounters ONE
 * feedback button and ONE GitHub link (same dual-render trick the sidebar
 * already uses for its plain-vs-disclosure headings). The e2e suite asserts
 * this with accessible-role counts at both widths, not just visually.
 *
 * Each instance owns its own `feedbackOpen` state and mounts its own
 * `FeedbackDialog` (mounted only while open, so `useModalDialog`'s focus trap
 * + focus-restore run per open/close and focus returns to the button that
 * opened it). Only the visible instance can be activated, so the two states
 * can never both be true. The dialog portals to <body>, so it overlays the
 * page correctly from the footer just as it did from the sidebar.
 */

const REPO_URL = "https://github.com/jonathanphung/AP-Exam-Planner";

/** GitHub mark (octocat silhouette). */
function GitHubIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SupportLinks({
  testId,
  className,
  collapsed = false,
}: {
  /** `data-testid` for the row wrapper — one per placement. */
  testId: string;
  /** Placement-owned layout: display gate (`hidden lg:flex` / `flex lg:hidden`),
   *  spacing, alignment, dividers. The controls' own styling lives here. */
  className: string;
  /** Desktop collapsed rail only: hide the label, center the lone GitHub mark. */
  collapsed?: boolean;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
            // ≥44px touch target on mobile (min-h-11), relaxed at lg like the
            // other sidebar controls.
            "group inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-slate-700 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:min-h-9 dark:text-slate-300 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400",
            // Collapsed rail (~40px): no room for the label; the GitHub mark
            // stays reachable icon-only (Jon's explicit #41 bounce
            // requirement — do not regress it).
            collapsed ? "lg:hidden" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="underline-offset-2 group-hover:underline group-focus-visible:underline">
            Send us Feedback
          </span>
        </button>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository (opens in a new tab)"
          title="GitHub repository"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:h-9 lg:w-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400"
        >
          <GitHubIcon />
        </a>
      </div>

      {/* In-app feedback dialog (#42) — portals to <body> (position: fixed), so
          it overlays the whole page from either mount point. */}
      {feedbackOpen && (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
      )}
    </>
  );
}
