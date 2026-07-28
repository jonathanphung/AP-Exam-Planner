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
import {
  belongsOnWeekZero,
  nearestWeekIndex,
  weekCardMeta,
  weekZeroMeta,
} from "./week-cards";

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
 *   fallback, flagged `approximate`, when no length is published); nothing is
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
 * variants fan out the SAME set of weeks. Off-grid dated entries that are not
 * routed to Week 0 (an exam whose session time is unpublished / falls outside
 * every window, and any deadline dated on or after the first testing day) are
 * assigned to the nearest week and listed in a "Not placed on the grid" strip —
 * never positioned at a guessed time, never silently dropped
 * (`buildCalendarLayout`'s `offGrid`, exactly as the website surfaces it).
 * Undated selections (no May date at all) are returned in `undated` for the
 * renderer to footnote, mirroring the list card + the txt/json exports.
 *
 * Week 0 (issue #97, as amended by Jon's bounce on it, 2026-07-27): a portfolio
 * deadline dated STRICTLY BEFORE the first day of the earliest published
 * testing window leaves the exam weeks here too — the two variants have to tell
 * the same story (#73's one-presentation principle), so this file calls the
 * SAME `belongsOnWeekZero` predicate the list variant does rather than
 * re-deriving the cutoff. Those rows are collected onto a leading Week 0 card
 * that has NO grid: a deadline has no session and no clock, so it is always
 * off-grid (`calendar.ts` routes it to `offGrid` by kind), and a grid whose
 * every cell is empty would be chrome pretending to be data. The card is
 * therefore strip-only — `week` is null — and the renderer prints the deadline
 * list alone.
 *
 * A deadline dated on or after that first testing day stays exactly where it
 * was pre-#97: the Art & Design trio's 2027-05-07 deadlines ride Week 1's own
 * "Not placed on the grid" strip, beside the grid holding that week's exams.
 * Jon's ruling, verbatim: "keep portfolios due on ap exam week … on the actual
 * week that they occur for both list and calendar view."
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
  /** 0-based index into `calendarWeeks()`; `WEEK_ZERO_INDEX` for Week 0. */
  weekIndex: number;
  /** True for the late-testing window (rendered with a distinct header). */
  late: boolean;
  /** True for the Week 0 deadlines card — no window, hence no grid. */
  deadlines: boolean;
  /** "Week 0" / "Week 1" / "Late Testing" — from the shared week meta. */
  label: string;
  /** Filename slug: "week-0" / "week-1" / "late-testing". */
  slug: string;
  /** "May 3 – 7, 2027" — range label incl. year. */
  rangeLabel: string;
  /**
   * This week's grid: dated day columns + positioned exam blocks (effective).
   * `null` on the Week 0 deadlines card, which has no window and therefore no
   * grid to draw (issue #97) — the renderer prints its strip alone.
   */
  week: CalendarWeekLayout | null;
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

  // Off-grid dated entries split by the SHARED Week 0 cutoff, exactly as the
  // list variant splits them (issue #97 + Jon's bounce): a deadline dated
  // before the first testing day is collected for the Week 0 card; an
  // in-window/later deadline and an unplaceable EXAM both join the nearest week
  // (issue #56's rule). Either way nothing is dropped. Calling the list
  // variant's `belongsOnWeekZero` rather than restating the rule is what keeps
  // AP Drawing from landing on Week 1 in one `.png` and Week 0 in the other.
  const offGridByWeek: CalendarOffGridRow[][] = weeks.map(() => []);
  const deadlines: { date: string; row: CalendarOffGridRow }[] = [];
  for (const off of layout.offGrid) {
    const row: CalendarOffGridRow = {
      key: off.entry.key,
      subjectId: off.entry.subjectId,
      subjectName: off.entry.subjectName,
      category: infoById.get(off.entry.subjectId)?.category ?? null,
      reason: off.reason,
      label: offGridLabel(off.entry.date, off.reason),
    };
    if (belongsOnWeekZero(weeks, off.entry.kind, off.entry.date)) {
      deadlines.push({ date: off.entry.date, row });
      continue;
    }
    offGridByWeek[nearestWeekIndex(weeks, off.entry.date)].push(row);
  }

  // Emit Week 0 first when it has any deadline (strip-only: no window, no
  // grid), then only the non-empty weeks (a placed block OR an assigned
  // off-grid entry) — so the calendar variant fans out the SAME cards the list
  // variant does. Rows are chronological then alphabetical, the same ordering
  // the list card's `compareRows` gives its deadline rows.
  const cards: CalendarCard[] = [];
  if (deadlines.length > 0) {
    deadlines.sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a.row.subjectName.localeCompare(b.row.subjectName),
    );
    cards.push({
      ...weekZeroMeta(deadlines.map((d) => d.date)),
      week: null,
      axisStartHour: layout.axisStartHour,
      axisEndHour: layout.axisEndHour,
      offGrid: deadlines.map((d) => d.row),
    });
  }
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
