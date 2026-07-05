import type { ApSubject, Session } from "@/data/schema";

/**
 * Pure schedule-building logic for the "My Schedule" view (issue #4).
 *
 * Kept out of the component (per PROJECT.md: `src/lib/` functions are pure and
 * unit-testable) so the grouping/sorting rules can be verified independently of
 * React. Reads exam slots + portfolio deadlines straight from the dataset for a
 * given selection; conflict-resolved dates arrive in a later card (#5) and will
 * re-point this builder without changing its shape.
 */

/** A schedule entry is either a sit-down exam or a portfolio submission deadline. */
export type ScheduleEntryKind = "exam" | "portfolio";

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
}

export interface ScheduleDateGroup {
  /** ISO calendar date shared by every entry in `entries`. */
  date: string;
  entries: ScheduleEntry[];
}

export interface UndatedSubject {
  id: string;
  name: string;
  /** Sourced reason there is no May 2026 date (e.g. Career Kickstart courses). */
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
 */
export function buildSchedule(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
): Schedule {
  const selected = new Set(selectedIds);
  const entries: ScheduleEntry[] = [];
  const undated: UndatedSubject[] = [];

  for (const subject of subjects) {
    if (!selected.has(subject.id)) continue;

    let dated = false;

    if (subject.exam) {
      dated = true;
      entries.push({
        key: `${subject.id}:exam`,
        subjectId: subject.id,
        subjectName: subject.name,
        kind: "exam",
        date: subject.exam.date,
        session: subject.exam.session,
        note: null,
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
