"use client";

import apData from "@/data/ap-2026.json";
import type { ApDataset, ApSubject } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import { useResolutions } from "@/lib/resolutions";
import {
  buildIcsCalendar,
  ICS_FILE_NAME,
  ICS_MIME_TYPE,
  type SessionStartTimes,
} from "@/lib/ics";

/**
 * "Export to Calendar" button (issue #7).
 *
 * Builds the ICS entirely client-side from the shared selection + conflict
 * resolutions and triggers a download via an in-memory Blob — zero network
 * requests. Disabled until at least one subject is selected.
 *
 * Sizing (issue #31): the button lives in the My Schedule toolbar row next to
 * the List/Calendar switcher, so it shares the toolbar control heights —
 * ≥44px tap target on touch viewports, 36px at sm:+. Below 360px CSS width
 * the visible label shortens to "Export" (icon retained) so the whole toolbar
 * still fits on one row at ~320px; the accessible name stays
 * "Export to Calendar" via aria-label at every width (WCAG 2.5.3 label-in-
 * name holds for both the full and the shortened visible label).
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
const SESSION_START_TIMES: SessionStartTimes = dataset.sessionStartTimes;

export function ExportButton() {
  const { selectedIds, selectedCount } = useSelection();
  const resolutions = useResolutions();
  const disabled = selectedCount === 0;

  const handleExport = () => {
    if (disabled) return;

    const ics = buildIcsCalendar(
      SUBJECTS,
      selectedIds,
      resolutions,
      SESSION_START_TIMES,
    );

    const blob = new Blob([ics], { type: ICS_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ICS_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled}
      data-testid="export-ics-button"
      aria-label="Export to Calendar"
      title="Export selected exams to a calendar (.ics) file"
      className={[
        // ≥44px tall tap target at phone widths (issue #8 AC4); sm:+ matches
        // the switcher's 36px control height (issue #31 toolbar coherence).
        "inline-flex min-h-11 w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1 text-xs font-semibold transition-colors sm:min-h-9 sm:px-3",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        disabled
          ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600"
          : // Dark uses a light blue fill + near-black text: white-on-blue-500
            // was 3.68:1, under the 4.5:1 AA bar (issue #8 AC2).
            "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950 dark:hover:bg-blue-300",
      ].join(" ")}
    >
      <span aria-hidden="true">📆</span>
      <span>
        Export
        <span className="hidden min-[360px]:inline">{" to Calendar"}</span>
      </span>
    </button>
  );
}
