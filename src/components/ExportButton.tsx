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
 * Sizing (issue #31 + pill-slimming bounce): the button lives in the My
 * Schedule toolbar row next to the List/Calendar switcher and shares its slim
 * 32px visible pill height at every width. On touch viewports (< sm) a
 * transparent, centered ::before hit-area keeps the effective tap target
 * ≥44px (issue #8 AC4) even though the visible pill is slimmer; on sm:+
 * pointer viewports the 32px height alone is the target. Below 360px CSS width
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
        // Slim 32px visible pill (issue #31 pill-slimming bounce), equal to the
        // List/Calendar switcher so the toolbar row reads as one control set.
        // The ≥44px touch tap target (issue #8 AC4) is preserved behind the
        // slimmer pill by a transparent, centered ::before hit-area on touch
        // viewports (< sm); on sm:+ pointer viewports the slim height is fine.
        "relative inline-flex h-8 w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors",
        "max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:top-1/2 max-sm:before:h-11 max-sm:before:-translate-y-1/2 max-sm:before:content-['']",
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
