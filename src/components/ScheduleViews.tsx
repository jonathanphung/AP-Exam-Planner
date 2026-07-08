"use client";

import { useState } from "react";
import apData from "@/data/ap-2026.json";
import type { ApDataset } from "@/data/schema";
import { ScheduleView } from "@/components/ScheduleView";
import { CalendarView } from "@/components/CalendarView";
import { ExportButton } from "@/components/ExportButton";

/**
 * "My Schedule" section shell: the shared header + view switcher over the
 * list (issue #4) and the week-paged calendar grid (issue #19).
 *
 * Layout per the issue-19 second design bounce (item B) + issue #31 toolbar
 * alignment:
 * - The "My Schedule" heading and the (informational) cycle banner form the
 *   header. The banner is not a control, so it never shares the control row.
 * - ONE toolbar row sits BELOW that header on every viewport and on BOTH
 *   views: the List/Calendar segmented switcher leads (view navigation, left)
 *   and Export to Calendar trails (primary action, right) — standard mobile
 *   toolbar convention (issue #31 design decision). The switcher-below-header
 *   rule from #19's bounce is preserved; Export stays visible on the
 *   calendar, not just the list, and never jumps between views.
 * - The CALENDAR is the default view on load.
 *
 * The switcher is a segmented control: native buttons (keyboard-operable via
 * Tab + Enter/Space), `aria-pressed` state, and the same high-contrast active
 * style as the catalog chips (blue-600 on white, ≥4.5:1). All toolbar
 * controls share the same slim 32px visible pill height at every width so the
 * row reads as one coherent toolbar (issue #31 pill-slimming bounce). On touch
 * viewports a transparent, centered ::before hit-area preserves the ≥44px tap
 * target behind each slimmer pill.
 */

// The banner reads the cycle from dataset metadata — never hardcoded, so a
// dataset swap (May 2027) re-labels the section automatically.
const CYCLE = (apData as unknown as ApDataset).cycle;

type ViewMode = "list" | "calendar";

const VIEWS: ReadonlyArray<{ mode: ViewMode; label: string }> = [
  { mode: "list", label: "List" },
  { mode: "calendar", label: "Calendar" },
];

export function ScheduleViews() {
  const [view, setView] = useState<ViewMode>("calendar");

  return (
    <section aria-label="My exams" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">My Schedule</h2>
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-200">
          <span aria-hidden="true">📅</span>
          Dates reflect the {CYCLE} AP exam cycle.
        </p>
      </div>

      {/* Toolbar (issue #31): switcher + Export on ONE row at every width.
          `justify-between` pins the primary action to the row's end; gap-2
          guarantees ≥8px between adjacent controls when the row is tight. */}
      <div className="flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Schedule view"
          className="inline-flex w-fit"
        >
          {VIEWS.map(({ mode, label }) => {
            const active = view === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => setView(mode)}
                className={[
                  // Segmented control: the two buttons share edges (-ml-px
                  // collapses the middle border). Slim 32px visible pill
                  // (issue #31 pill-slimming bounce) at EVERY width, matching
                  // Export. On touch viewports (< sm) a transparent, centered
                  // ::before hit-area restores the ≥44px tap target behind the
                  // slimmer pill; it extends only vertically, so the segmented
                  // seam and the switcher↔Export gap are untouched. On sm:+
                  // pointer viewports the slim height alone is the target.
                  "relative inline-flex h-8 items-center whitespace-nowrap border px-3 text-sm transition",
                  "max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:top-1/2 max-sm:before:h-11 max-sm:before:-translate-y-1/2 max-sm:before:content-['']",
                  mode === "list" ? "rounded-l-full" : "-ml-px rounded-r-full",
                  "focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
                  active
                    ? "z-10 border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
        <ExportButton />
      </div>

      {view === "list" ? <ScheduleView /> : <CalendarView />}
    </section>
  );
}
