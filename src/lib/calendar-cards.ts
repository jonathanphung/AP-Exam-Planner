import type { ApSubject, Category } from "../data/schema";
import { resolveSlots, type SlotResolution } from "./conflicts";
import { buildSchedule, formatDateLabel, type UndatedSubject } from "./schedule";
import {
  buildCalendarLayout,
  calendarWeeks,
  type CalendarWeekLayout,
  type OffGridEntry,
  type SubjectCalendarInfo,
} from "./calendar";
import { nearestWeekIndex, weekCardMeta } from "./week-cards";

/**
 * Pure model for the per-week CALENDAR-view PNG cards (Jon's pre-merge bounce
 * on issue #56).
 *
 * The second designed PNG variant. Where `week-cards.ts` produces clean LIST
 * rows per week, this produces a per-week WEEK-GRID model that mirrors the
 * site's Calendar view (issue #19): day columns, an hourly axis, and
 * category-colored exam blocks positioned at their start hour spanning their
 * duration. The DOM/pixel rendering lives in `export-png-calendar.ts`; the
 * download orchestration in `ExportButton.tsx`.
 *
 * Reuse, don't reinvent (the bounce mandate):
 * - The grid math + timing model come from the SAME `buildCalendarLayout()` /
 *   `CalendarWeekLayout` the on-site calendar view uses — there is no second
 *   grid or timing implementation. Blocks anchor at parsed session-start hours
 *   and span the PUBLISHED `format.totalMinutes` (or the documented nominal
 *   fallback, flagged `approximate`, when a length is `"pending"`); nothing is
 *   guessed onto the grid (hard data rule, PRD §7.5/§8/§11).
 * - Weeks are partitioned by the SAME `calendarWeeks()` window model as the
 *   list variant, and their identity (`Week 1` / `Late Testing` / range) comes
 *   from the SHARED `weekCardMeta()`, so the two exports' week sets are
 *   guaranteed identical — no newly hardcoded May dates.
 * - The effective slots come from the SAME `resolveSlots` → `buildSchedule`
 *   pipeline, so a moved-to-late exam sits on the Late Testing grid exactly as
 *   it does on the site.
 *
 * Which weeks emit (matches the list variant): a card is emitted for every week
 * with ≥1 placed block OR ≥1 off-grid dated entry assigned to it, so the two
 * variants fan out the SAME set of weeks. Off-grid dated entries (portfolio
 * deadlines, or an exam whose session time is unpublished / falls outside every
 * window) are assigned to the nearest week and listed in a "Not placed on the
 * grid" strip — never positioned at a guessed time, never silently dropped
 * (`buildCalendarLayout`'s `offGrid`, exactly as the website surfaces it).
 * Undated selections (no May date at all) are returned in `undated` for the
 * renderer to footnote, mirroring the list card + the txt/json exports.
 */

/** One row in a calendar card's "Not placed on the grid" strip. */
export interface CalendarOffGridRow {
  /** Stable key (the schedule entry key). */
  key: string;
  subjectId: string;
  subjectName: string;
  /** Category (drives the leading dot); null if the id is unknown. */
  category: Category | null;
  reason: OffGridEntry["reason"];
  /** Display label, mirroring CalendarView's off-grid wording verbatim. */
  label: string;
}

export interface CalendarCard {
  /** 0-based index into `calendarWeeks()`. */
  weekIndex: number;
  /** True for the late-testing window (rendered with a distinct header). */
  late: boolean;
  /** "Week 1" / "Week 2" / "Late Testing" — from the shared `weekCardMeta`. */
  label: string;
  /** Filename slug: "week-1" / "week-2" / "late-testing". */
  slug: string;
  /** "May 4 – 8, 2026" — range label incl. year. */
  rangeLabel: string;
  /** This week's grid: dated day columns + positioned exam blocks (effective). */
  week: CalendarWeekLayout;
  /** First axis hour (inclusive) — shared across every emitted card. */
  axisStartHour: number;
  /** Last axis hour (exclusive) — shared across every emitted card. */
  axisEndHour: number;
  /** Off-grid dated entries assigned to THIS week, never dropped. */
  offGrid: CalendarOffGridRow[];
}

export interface CalendarCardsResult {
  /** Cards for every non-empty testing week, in chronological week order. */
  cards: CalendarCard[];
  /** Selected subjects with no dated entry at all (never silently dropped). */
  undated: UndatedSubject[];
}

/** Off-grid strip wording — mirrors `CalendarView`'s `offGridLabel` verbatim. */
function offGridLabel(date: string, reason: OffGridEntry["reason"]): string {
  switch (reason) {
    case "portfolio":
      return `Portfolio due ${formatDateLabel(date)}`;
    case "no-published-time":
      return `${formatDateLabel(date)} — session start time not published`;
    case "outside-windows":
      return `${formatDateLabel(date)} — outside the published testing windows`;
  }
}

/**
 * Partition the active selection into designed per-week CALENDAR cards.
 *
 * @param subjects          full dataset subject list
 * @param selectedIds       currently selected subject ids
 * @param resolutions       stored conflict resolutions (active schedule)
 * @param sessionStartTimes dataset AM/PM start labels (parsed for start hours)
 */
export function buildCalendarCards(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolutions: readonly SlotResolution[],
  sessionStartTimes: { AM: string; PM: string },
): CalendarCardsResult {
  const resolved = resolveSlots(subjects, selectedIds, resolutions);
  const schedule = buildSchedule(subjects, selectedIds, resolved);

  const infoById = new Map<string, SubjectCalendarInfo>();
  for (const subject of subjects) {
    infoById.set(subject.id, {
      category: subject.category,
      totalMinutes: subject.format.totalMinutes,
    });
  }

  const layout = buildCalendarLayout(schedule, sessionStartTimes, infoById);
  const weeks = calendarWeeks();
  const meta = weekCardMeta(weeks);

  // Off-grid dated entries join the nearest week by date (same rule as the list
  // variant), so a deadline / unplaceable exam is never dropped.
  const offGridByWeek: CalendarOffGridRow[][] = weeks.map(() => []);
  for (const off of layout.offGrid) {
    offGridByWeek[nearestWeekIndex(weeks, off.entry.date)].push({
      key: off.entry.key,
      subjectId: off.entry.subjectId,
      subjectName: off.entry.subjectName,
      category: infoById.get(off.entry.subjectId)?.category ?? null,
      reason: off.reason,
      label: offGridLabel(off.entry.date, off.reason),
    });
  }

  // Emit only non-empty weeks (a placed block OR an assigned off-grid entry),
  // so the calendar variant fans out the SAME weeks the list variant does.
  const cards: CalendarCard[] = [];
  layout.weeks.forEach((weekLayout, i) => {
    const blockCount = weekLayout.days.reduce(
      (n, day) => n + day.blocks.length,
      0,
    );
    const offGrid = offGridByWeek[i];
    if (blockCount === 0 && offGrid.length === 0) return;
    cards.push({
      ...meta[i],
      week: weekLayout,
      axisStartHour: layout.axisStartHour,
      axisEndHour: layout.axisEndHour,
      offGrid,
    });
  });

  return { cards, undated: schedule.undated };
}
