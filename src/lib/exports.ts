import type { ApSubject } from "@/data/schema";
import { resolveSlots, type SlotResolution } from "./conflicts";
import { buildSchedule, formatDateLabel } from "./schedule";
import { ICS_FILE_NAME } from "./ics";

/**
 * Pure builders for the non-calendar export formats (issue #51): the
 * versioned `.json` envelope and the human-readable `.txt` schedule, plus the
 * shared filename convention for all four "Save as ." menu items.
 *
 * The `.ics` export intentionally does NOT live here — it is exactly the
 * pre-#51 `buildIcsCalendar` call in `src/lib/ics.ts`, untouched (that file's
 * internals belong to issue #38). The `.png` export is DOM-bound and lives in
 * `export-png.ts`; only its filename is defined here so the convention has a
 * single home.
 *
 * Filename convention (builder decision, issue #51): every format shares the
 * basename of today's ICS download (`ap-exams-2026`) with only the extension
 * varying — `ap-exams-2026.ics/.png/.json/.txt`. The basename is DERIVED from
 * `ICS_FILE_NAME` rather than duplicated, so a future dataset-cycle rename in
 * ics.ts propagates to all four files automatically.
 */

/** Shared basename for every export format (derived, never duplicated). */
export const EXPORT_BASE_NAME = ICS_FILE_NAME.replace(/\.ics$/, "");

/**
 * Base `.png` name. Retained as the single-file convention (and asserted by
 * the filename unit test), but the `.png` export is now per testing week
 * (issue #56): `ExportButton` names each week's file via {@link weekPngFileName}
 * — `ap-exams-2026-week-1-list.png`, `ap-exams-2026-late-testing-calendar.png`,
 * … — so a dataset-cycle rename still propagates to every emitted file
 * automatically.
 */
export const PNG_FILE_NAME = `${EXPORT_BASE_NAME}.png`;
export const JSON_FILE_NAME = `${EXPORT_BASE_NAME}.json`;
export const TXT_FILE_NAME = `${EXPORT_BASE_NAME}.txt`;

/**
 * The two designed `.png` variants (Jon's pre-merge bounce on issue #56): the
 * decluttered per-week LIST card and the per-week CALENDAR week-grid card.
 */
export type ExportView = "list" | "calendar";

/**
 * Per-week `.png` filename (issue #56 + bounce): the shared basename, a week
 * slug (`week-1` / `week-2` / `late-testing`, from the card's `slug`), AND a
 * view suffix (`list` / `calendar`). The view suffix keeps the two variants
 * from colliding when a user saves both for the same week
 * (`ap-exams-2026-week-1-list.png` vs `ap-exams-2026-week-1-calendar.png`).
 * Derived from `EXPORT_BASE_NAME`, so a future dataset-cycle rename re-names
 * every week file with no edit here.
 */
export function weekPngFileName(slug: string, view: ExportView): string {
  return `${EXPORT_BASE_NAME}-${slug}-${view}.png`;
}

export const JSON_MIME_TYPE = "application/json;charset=utf-8";
export const TXT_MIME_TYPE = "text/plain;charset=utf-8";

/** Envelope discriminator + schema version for the machine-readable export. */
export const JSON_EXPORT_FORMAT = "apx-schedule";
export const JSON_EXPORT_VERSION = 1;

/**
 * Build the versioned machine-readable `.json` export.
 *
 * Envelope: `{ format: "apx-schedule", version: 1, exportedAt: <ISO-8601>,
 * schedule: { name, subjects, resolutions } }`.
 *
 * - `subjects` carries the FULL dataset record of every selected subject,
 *   verbatim, in the user's selection order. The hard data rule (PRD
 *   §7.5/§8/§11) extends to exports: a `"pending"` value in the dataset is
 *   serialized as the literal string `"pending"` — never dropped, never
 *   fabricated into a number. Verbatim serialization of the dataset records
 *   guarantees this by construction (verified by the round-trip unit test).
 * - Selected ids with no dataset record (a stale selection surviving a
 *   dataset swap) are omitted, matching `buildSchedule`'s behavior — the
 *   export never invents a subject it cannot source.
 * - `resolutions` is the active schedule's stored conflict-resolution list,
 *   verbatim (same shape as `apx.resolutions.v1`).
 *
 * Output is pretty-printed (2-space indent) with a trailing newline so the
 * file also reads cleanly in a text editor.
 *
 * @param now injectable clock for `exportedAt`; defaults to generation time.
 */
export function buildJsonExport(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolutions: readonly SlotResolution[],
  scheduleName: string,
  now: Date = new Date(),
): string {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const selectedSubjects = selectedIds
    .map((id) => byId.get(id))
    .filter((subject): subject is ApSubject => subject !== undefined);

  const payload = {
    format: JSON_EXPORT_FORMAT,
    version: JSON_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    schedule: {
      name: scheduleName,
      subjects: selectedSubjects,
      resolutions: resolutions.map((resolution) => ({
        date: resolution.date,
        session: resolution.session,
        keeperId: resolution.keeperId,
        memberIds: [...resolution.memberIds],
      })),
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Windows-friendly EOL for the `.txt` export (see buildTxtExport). */
export const TXT_EOL = "\r\n";

/**
 * Build the human-readable `.txt` export.
 *
 * Format: a schedule-name header line, a blank line, then one line per dated
 * entry sorted chronologically (the same `resolveSlots` → `buildSchedule`
 * pipeline the schedule view and the ICS export use, so a conflict resolution
 * that moved an exam to late testing shows the LATE date, flagged
 * "(moved to late testing)"):
 *
 *     Schedule 1 - AP Exams (May 2026 cycle)
 *
 *     Thursday, April 30, 2026 | Portfolio deadline | AP Seminar
 *     Monday, May 4, 2026 | AM session | AP Biology
 *     Friday, May 22, 2026 | AM session | AP Latin (moved to late testing)
 *
 * Selected subjects with no dated May-2026 entry at all (the Career Kickstart
 * courses) are appended after the dated lines so a selection is never
 * silently dropped: `No <cycle> date | <name> (<sourced reason>)`.
 *
 * Builder decisions (issue #51), documented:
 * - EOL is CRLF (`\r\n`): pre-1809 Windows Notepad renders bare-LF files as
 *   one run-on line, and every other editor/OS treats CRLF fine. The file
 *   ends with a trailing newline (last line is CRLF-terminated too).
 * - The body sticks to ASCII separators (`|`, `-`) so the un-BOMed UTF-8
 *   file cannot mojibake in legacy ANSI-defaulting editors; the only
 *   non-ASCII that can appear is a user-typed schedule name.
 * - Portfolio deadlines get their own lines ("Portfolio deadline" in the
 *   session column): they carry equal weight to exam dates in this app
 *   (PROJECT.md), and the ICS exports them as events too.
 */
export function buildTxtExport(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolutions: readonly SlotResolution[],
  scheduleName: string,
  cycle: string,
): string {
  const resolved = resolveSlots(subjects, selectedIds, resolutions);
  const { groups, undated } = buildSchedule(subjects, selectedIds, resolved);

  const lines: string[] = [`${scheduleName} - AP Exams (${cycle} cycle)`, ""];

  for (const group of groups) {
    for (const entry of group.entries) {
      const when = formatDateLabel(entry.date);
      const slot =
        entry.kind === "portfolio"
          ? "Portfolio deadline"
          : `${entry.session} session`;
      const suffix = entry.movedToLate ? " (moved to late testing)" : "";
      lines.push(`${when} | ${slot} | ${entry.subjectName}${suffix}`);
    }
  }

  for (const subject of undated) {
    const reason = subject.reason ? ` (${subject.reason})` : "";
    lines.push(`No ${cycle} date | ${subject.name}${reason}`);
  }

  // Every line CRLF-terminated, including the last (trailing newline).
  return lines.map((line) => `${line}${TXT_EOL}`).join("");
}
