"use client";

import { useState } from "react";
import {
  RESOURCE_GROUPS,
  headingId,
  resolveLabel,
  type ResourceLink,
} from "@/data/resources";
import { MySchedules } from "@/components/MySchedules";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { ArrowUpRightIcon } from "@/components/ArrowUpRightIcon";
import { toggleSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar";

/**
 * App sidebar (issue #29) — grown from the Resources sidebar (#23/#25) into a
 * branded app panel modeled on the UT Registration Plus reference:
 *
 *   1. Branding row — the app mark + "AP Exam Planner" (the page's single h1)
 *      with a right control cluster: the theme toggle (issue #41; every
 *      presentation) and, on desktop, the collapse/expand toggle.
 *   2. MY SCHEDULES — the multi-schedule switcher (see MySchedules.tsx).
 *   3. Divider.
 *   4. RESOURCES — the #23/#25 curated official links, content unchanged
 *      (links-only per the earlier bounce), with #29's presentation polish:
 *      every label fits on one line, and hovering underlines the text but
 *      never the trailing icon (issue #50: an inline SVG, not a text glyph).
 *   5. Footer row (post-approval bounce, Jon 2026-07-08) — "Send us
 *      Feedback" on the left, GitHub icon on the right, pinned below the
 *      content. Issue #42: "Send us Feedback" is now a real `<button>` that
 *      opens the in-app FeedbackDialog (a modal form) instead of navigating —
 *      most AP students have no GitHub account, so the old new-issue link
 *      effectively blocked them. Submission is routed through the
 *      `submitFeedback` seam (src/lib/feedback.ts); the GitHub mark beside it
 *      is unchanged and still links to the repo.
 *
 * Presentation:
 *   • Desktop (≥1024px / `lg`): a persistent left column (20rem when
 *     expanded, sized so the longest resource label fits on one line),
 *     **sticky** (post-approval bounce): it pins at the container's top
 *     offset while the main content scrolls, capped at the viewport height
 *     with its own internal scroll, so the panel stays fully usable at any
 *     scroll depth. The collapse toggle (`aria-expanded`, keyboard-operable,
 *     panel-collapse glyph per the reference) shrinks it to a slim rail so
 *     the main content widens; the choice is remembered client-side in
 *     `apx.sidebar.v1`. Builder's documented call: the toggle exists only
 *     where the persistent column exists (desktop) — tablet (<1024px) uses
 *     the mobile presentation, which has nothing to collapse.
 *   • Mobile/tablet (<1024px): no persistent left column (the #22/#23
 *     pattern). Branding renders at the top of the panel card, and MY
 *     SCHEDULES and RESOURCES are separate native disclosures, collapsed by
 *     default to keep the planner above the fold. The footer row renders at
 *     the bottom of the card in this presentation too (always visible —
 *     builder's documented call: hiding feedback behind a disclosure would
 *     bury the only contact channel).
 *
 * The schedule list and the link list are each rendered ONCE from their
 * single source of truth; CSS decides which heading presentation (plain vs.
 * disclosure trigger) is visible per viewport, so assistive tech only ever
 * encounters one copy.
 */

function ExternalResourceLink({ link }: { link: ResourceLink }) {
  const label = resolveLabel(link.label);
  return (
    <li className="leading-snug">
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex max-w-full items-baseline gap-1 rounded-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:text-blue-200 dark:focus-visible:outline-blue-400"
      >
        {/* Underline lives on the label span only, so the trailing icon never
            underlines on hover (issue #29 link polish). `truncate` guards the
            one-label-one-line rule; labels are sized to fit un-truncated. */}
        <span className="truncate underline-offset-2 group-hover:underline group-focus-visible:underline">
          {label}
        </span>
        <ArrowUpRightIcon />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </li>
  );
}

function ResourceGroups() {
  return (
    <div className="flex flex-col gap-5">
      {RESOURCE_GROUPS.map((group) => {
        const id = headingId(group.heading);
        return (
          <section key={group.heading} aria-labelledby={id}>
            <h3
              id={id}
              className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100"
            >
              {group.heading}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {group.links.map((link) => (
                <ExternalResourceLink key={link.href} link={link} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Panel-collapse glyph (post-approval bounce): the standard sidebar-panel
 * icon from the UT Registration Plus reference — a rectangle with a left
 * column. The column is filled while the sidebar is expanded and outlined
 * while collapsed; the accessible state lives on the button
 * (`aria-expanded` + label), the glyph is decorative.
 */
function PanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-4 w-4"
    >
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <path d="M8 3.75v12.5" />
      {!collapsed && (
        <path
          d="M8 3.75H4.75a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2H8Z"
          fill="currentColor"
          stroke="none"
        />
      )}
    </svg>
  );
}

/** GitHub mark (octocat silhouette) for the sidebar footer row. */
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

/**
 * Footer row: "Send us Feedback" (left) and the GitHub mark (right). One row,
 * pinned below the content in both presentations. ≥44px touch targets on
 * mobile (h-11, relaxed at `lg` like the other sidebar controls).
 *
 * Issue #42: "Send us Feedback" is a `<button>` (`aria-haspopup="dialog"`) that
 * opens the in-app FeedbackDialog — it no longer navigates. It keeps the
 * footer's text-with-hover-underline look so the row is visually unchanged; the
 * trailing arrow icon / "opens in a new tab" affordances are gone because it
 * opens a dialog, not a tab. The GitHub mark is untouched.
 *
 * The theme toggle used to live here beside the GitHub mark; the #41 bounce
 * (Jon, 2026-07-09) moved it up into the branding row, so the footer is once
 * again just Feedback + GitHub.
 *
 * Collapsed desktop rail: no room for the feedback label, so it hides and the
 * lone GitHub mark centers — it stays reachable in the rail (Jon's explicit
 * bounce requirement). NB: before #41 the whole footer was `lg:hidden` when
 * collapsed, so the GitHub mark was NOT reachable in the rail pre-#41 (verified
 * against e40450e); the bounce's parenthetical "it was, before #41" is
 * inaccurate, but its instruction — keep GitHub reachable — is what this
 * implements. Mobile ignores these `lg:` overrides and keeps the full row.
 */
function SidebarFooter({
  collapsed,
  onOpenFeedback,
}: {
  collapsed: boolean;
  onOpenFeedback: () => void;
}) {
  return (
    <div
      data-testid="sidebar-footer"
      className={[
        "mt-5 flex items-center justify-between gap-2 border-t border-slate-200 pt-3 lg:mt-4 lg:shrink-0 dark:border-slate-800",
        // Collapsed rail: the feedback label hides (below); center the lone
        // GitHub mark so it stays reachable icon-only.
        collapsed ? "lg:justify-center" : "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onOpenFeedback}
        aria-haspopup="dialog"
        className={[
          "group inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-slate-700 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:min-h-9 dark:text-slate-300 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400",
          // No room for the text label in the collapsed rail; the GitHub mark
          // stays reachable.
          collapsed ? "lg:hidden" : "",
        ].join(" ")}
      >
        <span className="underline-offset-2 group-hover:underline group-focus-visible:underline">
          Send us Feedback
        </span>
      </button>
      <a
        href="https://github.com/jonathanphung/AP-Exam-Planner"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub repository (opens in a new tab)"
        title="GitHub repository"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:h-9 lg:w-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400"
      >
        <GitHubIcon />
      </a>
    </div>
  );
}

/** Shared styling for the mobile disclosure trigger buttons. */
const DISCLOSURE_BUTTON_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-sm text-xs font-semibold uppercase tracking-wider text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-300 dark:focus-visible:outline-blue-400";

/** Shared styling for the always-visible desktop section headings. */
const DESKTOP_HEADING_CLASS =
  "hidden text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 lg:block";

export function Sidebar() {
  // Desktop collapse — remembered client-side (src/lib/sidebar.ts): expanded
  // on the server and the first client render, the stored choice right after
  // mount.
  const collapsed = useSidebarCollapsed();
  // Mobile disclosures — collapsed by default (#23 behavior, kept for #29).
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  // In-app feedback dialog (#42). Mounted only while open so useModalDialog's
  // focus trap + focus-restore run per open/close; closing returns focus to
  // the "Send us Feedback" button that opened it.
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <aside
      aria-label="App panel"
      data-testid="resources-sidebar"
      className={[
        "w-full rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40",
        "lg:shrink-0 lg:self-start lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:dark:bg-transparent",
        // Sticky (post-approval bounce): pin at the page container's top
        // padding (top-10 matches the layout's lg:py-10, so there is no jump
        // when it engages), cap at the viewport minus matching top+bottom
        // gaps, and let the sections scroll internally (flex-col below) so
        // the panel is fully usable at any scroll depth.
        "lg:sticky lg:top-10 lg:flex lg:max-h-[calc(100vh-5rem)] lg:flex-col",
        // w-80 expanded: sized so the longest resource label (with its
        // trailing icon) fits on ONE line at desktop widths (issue #29 link
        // polish; icon is an inline SVG as of #50).
        collapsed ? "lg:w-10" : "lg:w-80",
      ].join(" ")}
    >
      {/* 1 — Branding row: app mark + name (the page's single h1) + a right
          control cluster [theme toggle][collapse toggle] (issue #41 bounce:
          the theme toggle moved out of the footer to sit immediately left of
          the collapse control). When collapsed on desktop the mark+name are
          sr-only, so the document keeps its h1 and the rail shows only the
          control cluster — centered and stacked vertically, because the two
          h-8 controls cannot sit side-by-side in the ~40px (w-10) rail. */}
      <div
        data-testid="sidebar-branding"
        className={[
          "flex items-center justify-between gap-2",
          collapsed ? "lg:justify-center" : "",
        ].join(" ")}
      >
        <div
          className={`flex min-w-0 items-center gap-2.5 ${collapsed ? "lg:sr-only" : ""}`}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-600 text-sm font-bold tracking-tight text-white dark:bg-blue-500 dark:text-slate-950"
          >
            AP
          </span>
          <h1 className="min-w-0 truncate text-base font-semibold leading-tight tracking-tight">
            AP Exam Planner
          </h1>
        </div>
        <div
          className={[
            "flex shrink-0 items-center gap-1.5",
            // Collapsed rail: stack the two icon controls vertically and
            // centered (they don't fit side-by-side at ~40px).
            collapsed ? "lg:flex-col" : "",
          ].join(" ")}
        >
          {/* Theme toggle (present in every presentation; 44px on mobile,
              matches the collapse control's h-8 w-8 box at lg). */}
          <ThemeToggle />
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-expanded={!collapsed}
            aria-controls="sidebar-sections"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400"
          >
            <PanelToggleIcon collapsed={collapsed} />
          </button>
        </div>
      </div>

      <div
        id="sidebar-sections"
        className={[
          "mt-5",
          // Internal scroll when the sticky panel is taller than the
          // viewport; the footer row stays pinned below. The 1px negative
          // margin + padding keeps focus outlines from being clipped by the
          // scroll container.
          "lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1",
          collapsed ? "lg:hidden" : "",
        ].join(" ")}
      >
        {/* 2 — MY SCHEDULES */}
        <section aria-labelledby="my-schedules-heading">
          <h2 id="my-schedules-heading" className={DESKTOP_HEADING_CLASS}>
            My schedules
          </h2>
          <h2 className="m-0 lg:hidden">
            <button
              type="button"
              aria-expanded={schedulesOpen}
              aria-controls="my-schedules-panel"
              onClick={() => setSchedulesOpen((open) => !open)}
              className={DISCLOSURE_BUTTON_CLASS}
            >
              <span>My schedules</span>
              <DisclosureChevron open={schedulesOpen} />
            </button>
          </h2>
          <div
            id="my-schedules-panel"
            className={`${schedulesOpen ? "block" : "hidden"} mt-2 lg:mt-3 lg:block`}
          >
            <MySchedules />
          </div>
        </section>

        {/* 3 — Divider */}
        <hr className="my-5 border-slate-200 dark:border-slate-800" />

        {/* 4 — RESOURCES (#23/#25 content unchanged; #29 polish on links) */}
        <h2 className={DESKTOP_HEADING_CLASS}>Resources</h2>
        <p className="mt-1 hidden text-xs text-slate-600 dark:text-slate-400 lg:block">
          Official College Board pages. Each opens in a new tab.
        </p>
        <h2 className="m-0 lg:hidden">
          <button
            type="button"
            aria-expanded={resourcesOpen}
            aria-controls="resources-panel"
            onClick={() => setResourcesOpen((open) => !open)}
            className={DISCLOSURE_BUTTON_CLASS}
          >
            <span>Resources</span>
            <DisclosureChevron open={resourcesOpen} />
          </button>
        </h2>
        <div
          id="resources-panel"
          className={`${resourcesOpen ? "block" : "hidden"} mt-2 lg:mt-4 lg:block`}
        >
          <ResourceGroups />
        </div>
      </div>

      {/* 5 — Footer row (both presentations). */}
      <SidebarFooter
        collapsed={collapsed}
        onOpenFeedback={() => setFeedbackOpen(true)}
      />

      {/* In-app feedback dialog (#42) — overlays the page (position: fixed), so
          it escapes the sticky sidebar's own scroll container. */}
      {feedbackOpen && (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
      )}
    </aside>
  );
}
