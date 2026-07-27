import type { ApSubject } from "@/data/schema";
import { resolveSlots, type SlotResolution } from "./conflicts";
import { EXAM_NOTE_LABEL, buildSchedule, formatDateLabel } from "./schedule";
import { ICS_FILE_NAME } from "./ics";

/**
 * Pure builders for the non-calendar export formats (issue #51): the
 * versioned `.json` envelope and the human-readable `.txt` schedule, plus the
 * shared filename convention for all four "Save as ." menu items.
 *
 * The `.ics` export intentionally does NOT live here — it is the pre-#51
 * `buildIcsCalendar` call in `src/lib/ics.ts`, untouched (that file's
 * internals belong to issue #38); only its download FILENAME follows this
 * module's convention. The `.png` export is DOM-bound and lives in
 * `export-png.ts`; only its filename is defined here so the convention has a
 * single home.
 *
 * Filename convention (issue #51, revised by issue #90): every format shares
 * one basename — the ACTIVE SCHEDULE's slug, a dash, then the cycle stem —
 * varying only by extension:
 *
 *     ambitious-draft-ap-exams-2027.ics/.json/.txt
 *     ambitious-draft-ap-exams-2027-week-1-list.png
 *
 * The schedule slug comes from {@link scheduleNameSlug}; when a name has no
 * sluggable characters at all the basename falls back to the bare cycle stem
 * (`ap-exams-2027.ics`), never a leading-dash filename. The cycle stem is
 * DERIVED from `ICS_FILE_NAME`, which itself reads the year off the dataset
 * cycle, so the annual dataset swap still renames every emitted file with no
 * edit here.
 */

/**
 * Cycle stem shared by every export format (derived, never duplicated), and
 * the fallback basename when a schedule name slugs to nothing. Since issue
 * #90 the emitted basename is normally `<schedule-slug>-<this stem>` — see
 * {@link scheduleExportBaseName}.
 */
export const EXPORT_BASE_NAME = ICS_FILE_NAME.replace(/\.ics$/, "");

/**
 * Cap for the schedule-slug segment of a filename. Schedule names are already
 * ≤ 60 code points (`MAX_SCHEDULE_NAME_LENGTH`, `src/lib/schedules.ts`), but
 * NFKD folding can EXPAND a string ("ﬃ" → "ffi"), so the cap is re-applied to
 * the slug itself. 60 slug chars + the longest fixed suffix
 * (`-ap-exams-2027-late-testing-calendar.png`, 41 chars) stays comfortably
 * under every mainstream filesystem's 255-byte component limit.
 */
export const MAX_SLUG_LENGTH = 60;

/**
 * Slugify a user-typed schedule name into a filename-safe segment
 * (issue #90). Pure, deterministic, no dependencies.
 *
 * Schedule names are constrained only by `validateScheduleName`
 * (non-blank after trim, ≤ 60 code points, no exact duplicate) — everything
 * else, including Windows-reserved characters, is possible. Decisions:
 *
 * - Output alphabet is `[a-z0-9]` with single `-` separators: every run of
 *   anything else becomes one dash, then leading/trailing dashes are trimmed.
 *   This kills the Windows-reserved set (`\ / : * ? " < > |`), path
 *   separators, and the trailing dots/spaces Windows silently strips.
 * - Unicode is NFKD-folded and combining marks dropped, so Latin diacritics
 *   transliterate for free ("Café" → "cafe"). Characters with no ASCII
 *   decomposition (CJK, emoji, symbols) are STRIPPED, not transliterated —
 *   a transliteration table is a dependency and a maintenance burden, and the
 *   exact user-typed name is already carried INSIDE the exports (the `.json`
 *   envelope's `schedule.name`, the `.txt` header, both `.png` card headers),
 *   so losing it from the filename is cosmetic. A name that strips to nothing
 *   returns `""` and the caller falls back to the bare cycle stem.
 * - Lowercasing means case-only distinct names ("My Plan" vs "my plan" — both
 *   legal, the duplicate rule is case-sensitive) map to ONE slug. That is a
 *   deliberate trade: the browser's `(1)` suffix disambiguates in Downloads,
 *   which beats shipping mixed-case filenames that differ only on
 *   case-sensitive filesystems.
 * - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`9`,
 *   `LPT1`–`9`) need no special casing HERE because the composed basename is
 *   always `<slug>-ap-exams-<year>` (see {@link scheduleExportBaseName}) —
 *   Windows reserves only the exact pre-extension basename, and ours never
 *   equals a bare device name. Asserted by the unit tests.
 * - Length is capped at {@link MAX_SLUG_LENGTH} (slice is safe: the slug is
 *   pure ASCII by then), re-trimming any dash the cut exposes.
 */
export function scheduleNameSlug(name: string): string {
  const folded = name
    .normalize("NFKD")
    // Drop combining marks left by NFKD (é → e + U+0301 → e).
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

/**
 * The shared basename for every file exported from a given schedule
 * (issue #90): `<schedule-slug>-<cycle stem>`, falling back to the bare
 * cycle stem when the name slugs to empty — never `-ap-exams-2027` and never
 * a Windows device name (the stem suffix guarantees the basename can't equal
 * `CON`/`NUL`/… even when the schedule is literally named that).
 */
export function scheduleExportBaseName(scheduleName: string): string {
  const slug = scheduleNameSlug(scheduleName);
  return slug ? `${slug}-${EXPORT_BASE_NAME}` : EXPORT_BASE_NAME;
}

/** The single-file export formats named via {@link exportFileName}. */
export type ExportExtension = "ics" | "json" | "txt";

/**
 * Downloaded filename for a single-file export format (issue #90):
 * `my-plan-ap-exams-2027.ics` / `.json` / `.txt`. The per-week `.png` files
 * are named by {@link weekPngFileName} instead (they carry week + view
 * segments).
 */
export function exportFileName(
  scheduleName: string,
  extension: ExportExtension,
): string {
  return `${scheduleExportBaseName(scheduleName)}.${extension}`;
}

/**
 * The two designed `.png` variants (Jon's pre-merge bounce on issue #56): the
 * decluttered per-week LIST card and the per-week CALENDAR week-grid card.
 */
export type ExportView = "list" | "calendar";

/**
 * Per-week `.png` filename (issue #56 + bounce, schedule-named since issue
 * #90): the shared schedule basename, a week slug (`week-0` / `week-1` /
 * `week-2` / `late-testing`, from the card's `slug` — `week-0` is issue #97's
 * card for the deadlines due before exam week), AND a view suffix (`list` /
 * `calendar`). The view suffix keeps the two variants from colliding when a
 * user saves both for the same week (`my-plan-ap-exams-2027-week-1-list.png`
 * vs `my-plan-ap-exams-2027-week-1-calendar.png`). Derived from
 * {@link scheduleExportBaseName}, so a future dataset-cycle rename re-names
 * every week file with no edit here.
 */
export function weekPngFileName(
  scheduleName: string,
  slug: string,
  view: ExportView,
): string {
  return `${scheduleExportBaseName(scheduleName)}-${slug}-${view}.png`;
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
 *   §7.5/§8/§11) extends to exports: an unpublished value is ABSENT from the
 *   dataset (issue #84 retired the literal `"pending"`) and stays absent in
 *   the export — never back-filled with a zero, never
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
 *     Schedule 1 - AP Exams (May 2027 cycle)
 *
 *     Friday, April 30, 2027 | Portfolio deadline | AP Seminar
 *     Monday, May 3, 2027 | PM session | AP Biology
 *     Thursday, May 20, 2027 | AM session | AP Latin (moved to late testing)
 *
 * Selected subjects with no dated entry in the cycle at all (none in the May
 * 2027 dataset — every listed course is scheduled) are appended after the
 * dated lines so a selection is never silently dropped:
 * `No <cycle> date | <name> (<sourced reason>)`.
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
 * - An exam carrying a published qualifier (`examNote`) gets it appended as a
 *   final `| Published note: <verbatim>` column (issue #71):
 *
 *       Friday, May 7, 2027 | PM session | AP Networking | Published note: College Board schedules this exam for 2026-27 pilot schools only. ...
 *
 *   Same reason the `(<sourced reason>)` suffix exists on the undated lines —
 *   a date without its published restriction reads as an exam any student can
 *   sit. The `|` keeps the ASCII-separator rule above; the text is verbatim.
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
      const note = entry.examNote
        ? ` | ${EXAM_NOTE_LABEL}: ${entry.examNote}`
        : "";
      lines.push(`${when} | ${slot} | ${entry.subjectName}${suffix}${note}`);
    }
  }

  for (const subject of undated) {
    const reason = subject.reason ? ` (${subject.reason})` : "";
    lines.push(`No ${cycle} date | ${subject.name}${reason}`);
  }

  // Every line CRLF-terminated, including the last (trailing newline).
  return lines.map((line) => `${line}${TXT_EOL}`).join("");
}
