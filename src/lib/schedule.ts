import type { ApSubject, Session } from "@/data/schema";
import type { ResolvedSlot } from "./conflicts";

/**
 * Pure schedule-building logic for the "My Schedule" view (issue #4).
 *
 * Kept out of the component (per PROJECT.md: `src/lib/` functions are pure and
 * unit-testable) so the grouping/sorting rules can be verified independently of
 * React. Exam slots come from the conflict-resolution layer (issue #5): pass
 * the map returned by `resolveSlots` and each exam entry renders at its
 * effective date/session — the late-testing slot when a resolution moved it.
 * Without a map (or for subjects missing from it) the dataset's regular slot
 * is used. Portfolio deadlines always come straight from the dataset.
 */

/** A schedule entry is either a sit-down exam or a portfolio submission deadline. */
export type ScheduleEntryKind = "exam" | "portfolio";

/**
 * The label every schedule surface prefixes a verbatim {@link
 * ScheduleEntry.examNote} with (issue #71).
 *
 * It names the CLASS of the text — "what follows is College Board's own note on
 * this exam" — and never paraphrases or shortens the qualifier itself, which is
 * always printed verbatim from the dataset (PROJECT.md data rule). A derived
 * short badge would be editorial: "2026-27 pilot schools only" is College
 * Board's wording for AP Networking today, but nothing guarantees the next
 * cycle's qualifier compresses the same way.
 *
 * Shared by the list view, the calendar block, the ICS DESCRIPTION, the `.txt`
 * export, and both `.png` card variants so the wording cannot drift per surface.
 */
export const EXAM_NOTE_LABEL = "Published note";

export interface ScheduleEntry {
  /** Stable React key: `${subjectId}:${kind}` (a subject can yield both). */
  key: string;
  subjectId: string;
  subjectName: string;
  kind: ScheduleEntryKind;
  /** ISO calendar date: the exam date, or the portfolio deadline. */
  date: string;
  /** Session for exams; `null` for portfolio deadlines (no AM/PM slot). */
  session: Session | null;
  /** Portfolio submission note from the dataset; `null` for exams. */
  note: string | null;
  /**
   * The dataset's verbatim `examNote` — a published qualifier College Board
   * attaches to this subject's exam (AP Networking's May 2027 sitting is
   * "2026-27 pilot schools only"). `null` for portfolio entries and for exams
   * with no qualifier.
   *
   * Carried on the entry rather than looked up per surface so EVERY surface that
   * prints this entry's date can print its restriction too (issue #71): a date
   * without its published restriction reads as an exam any student can sit. See
   * {@link EXAM_NOTE_LABEL}.
   */
  examNote: string | null;
  /** True when a conflict resolution moved this exam to its late-testing slot. */
  movedToLate: boolean;
}

export interface ScheduleDateGroup {
  /** ISO calendar date shared by every entry in `entries`. */
  date: string;
  entries: ScheduleEntry[];
}

export interface UndatedSubject {
  id: string;
  name: string;
  /** Sourced reason there is no dated entry in this cycle (none in May 2027). */
  reason: string | null;
}

export interface Schedule {
  /** Date-grouped exam + portfolio entries, chronological. */
  groups: ScheduleDateGroup[];
  /**
   * Selected subjects that produce no dated entry at all — neither a sit-down
   * exam nor a portfolio deadline (the Career Kickstart courses whose first
   * exam administration is May 2027). Surfaced so a selection is never silently
   * dropped from the schedule.
   */
  undated: UndatedSubject[];
}

/**
 * Within a single day, order entries: AM exams, then PM exams, then portfolio
 * deadlines. Portfolio submissions are evening (ET) cutoffs, so they sort after
 * both sit-down sessions on a shared date.
 */
const WITHIN_DAY_RANK = { AM: 0, PM: 1, portfolio: 2 } as const;

function withinDayRank(entry: ScheduleEntry): number {
  if (entry.kind === "portfolio") return WITHIN_DAY_RANK.portfolio;
  // An exam entry always carries a session (dataset guarantees it).
  return WITHIN_DAY_RANK[entry.session ?? "AM"];
}

/**
 * Build the grouped personal schedule for `selectedIds` from `subjects`.
 *
 * - Dates ascending (ISO strings compare chronologically).
 * - Within a date: AM before PM before portfolio; ties broken by subject name.
 * - A subject with both an exam and a portfolio yields two entries.
 * - Portfolio-only subjects yield a single portfolio entry (never an exam).
 * - `resolvedSlots` (from `resolveSlots` in conflicts.ts) re-points exam
 *   entries to their effective slot; portfolio entries are never affected.
 * - Each exam entry carries the subject's verbatim `examNote` so every
 *   downstream surface (list view, calendar block, ICS/TXT/PNG exports) can
 *   print the published restriction next to the date it prints.
 */
export function buildSchedule(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolvedSlots?: ReadonlyMap<string, ResolvedSlot>,
): Schedule {
  const selected = new Set(selectedIds);
  const entries: ScheduleEntry[] = [];
  const undated: UndatedSubject[] = [];

  for (const subject of subjects) {
    if (!selected.has(subject.id)) continue;

    let dated = false;

    if (subject.exam) {
      dated = true;
      const resolved = resolvedSlots?.get(subject.id);
      entries.push({
        key: `${subject.id}:exam`,
        subjectId: subject.id,
        subjectName: subject.name,
        kind: "exam",
        date: resolved?.date ?? subject.exam.date,
        session: resolved?.session ?? subject.exam.session,
        note: null,
        examNote: subject.examNote ?? null,
        movedToLate: resolved?.movedToLate ?? false,
      });
    }

    if (subject.portfolio) {
      dated = true;
      entries.push({
        key: `${subject.id}:portfolio`,
        subjectId: subject.id,
        subjectName: subject.name,
        kind: "portfolio",
        date: subject.portfolio.deadline,
        session: null,
        note: subject.portfolio.note,
        examNote: null,
        movedToLate: false,
      });
    }

    if (!dated) {
      undated.push({
        id: subject.id,
        name: subject.name,
        reason: subject.noExamReason ?? null,
      });
    }
  }

  const byDate = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const group = byDate.get(entry.date);
    if (group) group.push(entry);
    else byDate.set(entry.date, [entry]);
  }

  const groups = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map<ScheduleDateGroup>(([date, group]) => ({
      date,
      entries: group.sort((x, y) => {
        const rank = withinDayRank(x) - withinDayRank(y);
        if (rank !== 0) return rank;
        return x.subjectName.localeCompare(y.subjectName);
      }),
    }));

  return { groups, undated };
}

/**
 * Format an ISO calendar date as a *local* long date label (shared by the
 * schedule headings and the conflict UI). Dates are floating (no timezone);
 * building the Date from explicit parts avoids the UTC-parse day-shift of
 * `new Date("2027-05-03")` in negative-offset zones.
 */
export function formatDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
