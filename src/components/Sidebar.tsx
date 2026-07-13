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
import { SupportLinks } from "@/components/SupportLinks";
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
 *   5. Support pair — "Send us Feedback" + the GitHub mark (SupportLinks.tsx).
 *      Issue #60 moved it OUT of the sidebar's content flow: on desktop it is
 *      pinned to the BOTTOM EDGE of the sticky column (see below); below `lg`
 *      it is not in this card at all — it renders inside the site footer
 *      (Footer.tsx), so it reads as page chrome rather than a third section
 *      under MY SCHEDULES / RESOURCES. Both placements always render;
 *      complementary CSS visibility exposes exactly one to assistive tech.
 *
 * Presentation:
 *   • Desktop (≥1024px / `lg`): a persistent left column (20rem when
 *     expanded, sized so the longest resource label fits on one line),
 *     **sticky** (post-approval bounce): it pins at the container's top
 *     offset while the main content scrolls, sized to the viewport height
 *     with its own internal scroll, so the panel stays fully usable at any
 *     scroll depth. Issue #60: the column takes an explicit `lg:h-` (was a
 *     `lg:max-h-`, which let it shrink to its content and floated the support
 *     row up under the last resource link) — with a real height, the `flex-1`
 *     sections region absorbs the slack and the support row lands on the
 *     bottom edge of the screen. The collapse toggle (`aria-expanded`, keyboard-operable,
 *     panel-collapse glyph per the reference) shrinks it to a slim rail so
 *     the main content widens; the choice is remembered client-side in
 *     `apx.sidebar.v1`. Builder's documented call: the toggle exists only
 *     where the persistent column exists (desktop) — tablet (<1024px) uses
 *     the mobile presentation, which has nothing to collapse.
 *   • Mobile/tablet (<1024px): no persistent left column (the #22/#23
 *     pattern). Branding renders at the top of the panel card, and MY
 *     SCHEDULES and RESOURCES are separate native disclosures, collapsed by
 *     default to keep the planner above the fold. The card now ENDS after
 *     RESOURCES (issue #60): the support pair moved into the site footer, so
 *     it no longer reads as a third section. It is still always visible
 *     without opening a disclosure — the earlier builder call (never bury the
 *     only contact channel) still holds, it just holds from the footer.
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

  return (
    <aside
      aria-label="App panel"
      data-testid="resources-sidebar"
      className={[
        "w-full rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40",
        "lg:shrink-0 lg:self-start lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:dark:bg-transparent",
        // Sticky (post-approval bounce): pin at the page container's top
        // padding (top-10 matches the layout's lg:py-10, so there is no jump
        // when it engages), size to the viewport minus matching top+bottom
        // gaps, and let the sections scroll internally (flex-col below) so
        // the panel is fully usable at any scroll depth.
        //
        // Issue #60: `h-`, not `max-h-`. A max-height caps the column without
        // giving it one, so with short content the box shrank to fit and the
        // support row floated up under the last RESOURCES link. With a real
        // height the `lg:flex-1` sections region absorbs the slack and the
        // support row (lg:mt-auto below) lands on the bottom edge. Same
        // 5rem = top-10 (2.5rem) + a matching 2.5rem bottom gap, so nothing
        // jumps when sticky engages.
        "lg:sticky lg:top-10 lg:flex lg:h-[calc(100vh-5rem)] lg:flex-col",
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

      {/* 5 — Support pair, DESKTOP placement (issue #60).
          `hidden lg:flex`: below lg this row is not in the card at all (and
          not in the a11y tree) — the site footer renders the mobile copy.
          `lg:mt-auto` pins it to the bottom edge of the now-full-height
          column; it also carries the collapsed rail, where #sidebar-sections
          is `lg:hidden` and there is no flex-1 child to push it down. */}
      <SupportLinks
        testId="sidebar-footer"
        collapsed={collapsed}
        className="mt-auto hidden shrink-0 items-center justify-between gap-2 border-t border-slate-200 pt-3 lg:flex dark:border-slate-800"
      />
    </aside>
  );
}
