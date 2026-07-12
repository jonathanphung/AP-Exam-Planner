import type { ApSubject, Category, Session } from "../data/schema";
import { resolveSlots, type SlotResolution } from "./conflicts";
import { buildSchedule, type UndatedSubject } from "./schedule";
import {
  buildCalendarLayout,
  calendarWeeks,
  monthDayLabel,
  weekRangeLabel,
  type CalendarBlock,
  type CalendarWeek,
  type OffGridEntry,
  type SubjectCalendarInfo,
} from "./calendar";

/**
 * Pure model for the per-week PNG schedule cards (issue #56).
 *
 * The `.png` export used to be a raw `html-to-image` screenshot of whatever
 * view happened to be on screen (issue #51's `captureSchedulePng`). It is now
 * a *designed* card, split **by AP testing week** — one card per week in which
 * the student actually has a placed entry. This module is the pure, testable
 * core: it decides which weeks emit a card and what each card's rows are. The
 * DOM/pixel rendering lives in `export-png.ts`; the download orchestration in
 * `ExportButton.tsx`.
 *
 * Reuse, don't reinvent (issue #56 mandate):
 * - Week boundaries come from the SAME `calendarWeeks()` model the week-paged
 *   calendar view (issue #19) uses, so an annual dataset swap re-pages the
 *   export automatically and the PNG weeks match what the user sees when
 *   paging the calendar. Nothing here hardcodes a May date.
 * - The effective slots come from the SAME `resolveSlots` → `buildSchedule`
 *   pipeline the list/txt/ics/calendar paths use, so conflict-resolved and
 *   moved-to-late exams are already effective before we page them.
 * - Per-exam clocks, category, and the "length pending" handling come from the
 *   SAME `buildCalendarLayout` the calendar grid uses — so the hard data rule
 *   (PRD §7.5/§8/§11: never invent an exam length) holds by construction. A
 *   subject whose `format.totalMinutes` is `"pending"` yields `approximate`
 *   blocks, which we surface as `lengthPending` with NO end clock — never a
 *   fabricated end time.
 *
 * Week → file mapping:
 * - A card is emitted only for weeks with ≥1 assigned entry. Empty weeks are
 *   skipped entirely (no blank cards). One qualifying week → one card; two →
 *   two; three → three. The count is data-driven, never fixed at 3.
 * - Week labels/slugs are derived from each week's POSITION + `late` flag
 *   ("Week 1" / "Week 2" / "Late Testing"), never hardcoded — so Week 2 stays
 *   "Week 2" even when Week 1 emits no card.
 *
 * Edge-case decisions (documented per issue #56):
 * - Portfolio deadlines and any off-grid dated entry are assigned to the
 *   NEAREST week window by date and rendered as their own row on that card, so
 *   a selection is never silently dropped (matches the txt export's "never
 *   drop a selection" precedent). May 8 falls inside Week 1's window and joins
 *   Week 1; the April 30 deadlines fall before every window and join the
 *   nearest one (Week 1). An out-of-window entry never spawns a blank card of
 *   its own — it rides the nearest emitted week.
 * - Undated selections (Career Kickstart courses, no May date) have no week to
 *   sit in; they are returned in `undated` so the renderer can surface them as
 *   a footnote (never dropped), mirroring the txt/json exports. When EVERY
 *   selection is undated there are zero qualifying weeks and `cards` is empty —
 *   the caller shows the empty-state instead of downloading a misleading file.
 */

export type WeekCardRowKind = "exam" | "portfolio";

/** One printed line on a week card: an exam sitting or a portfolio deadline. */
export interface WeekCardRow {
  /** Stable key (the schedule entry key). */
  key: string;
  subjectId: string;
  subjectName: string;
  kind: WeekCardRowKind;
  /** Subject category (drives the row's accent color); null if id is unknown. */
  category: Category | null;
  /** Effective ISO date (conflict-resolved / late slot already applied). */
  date: string;
  /** "Mon" — short weekday for `date`. */
  weekday: string;
  /** "May 4" — short month + day for `date`. */
  monthDay: string;
  /** AM/PM for exams; null for portfolio deadlines. */
  session: Session | null;
  /** "8:00 AM" when a published session start exists; null otherwise. */
  startClock: string | null;
  /**
   * "11:00 AM" — the published exam end. Null whenever the length is not a
   * published number (pending / off-grid); an end time is NEVER guessed.
   */
  endClock: string | null;
  /** True when the exam length is `"pending"` — the row shows start, no end. */
  lengthPending: boolean;
  /** True when a conflict resolution moved this exam to its late-testing slot. */
  movedToLate: boolean;
  /** Portfolio submission note (verbatim); null for exams. */
  note: string | null;
}

export interface WeekCard {
  /** 0-based index into `calendarWeeks()`. */
  weekIndex: number;
  /** True for the late-testing window (rendered with a distinct header). */
  late: boolean;
  /** "Week 1" / "Week 2" / "Late Testing" — derived from position + `late`. */
  label: string;
  /** Filename suffix: "week-1" / "week-2" / "late-testing". */
  slug: string;
  /** "May 4 – 8, 2026" — range label incl. year. */
  rangeLabel: string;
  /** Exam + portfolio rows for this week, chronological. */
  rows: WeekCardRow[];
}

export interface WeekCardsResult {
  /** Cards for every non-empty testing week, in chronological week order. */
  cards: WeekCard[];
  /** Selected subjects with no dated entry at all (never silently dropped). */
  undated: UndatedSubject[];
}

/** Position-derived identity for one testing week (label, slug, range). */
export interface WeekMeta {
  /** 0-based index into `calendarWeeks()`. */
  weekIndex: number;
  /** True for the late-testing window. */
  late: boolean;
  /** "Week 1" / "Week 2" / "Late Testing" — derived from position + `late`. */
  label: string;
  /** Filename slug: "week-1" / "week-2" / "late-testing". */
  slug: string;
  /** "May 4 – 8, 2026" — range label incl. year. */
  rangeLabel: string;
}

/**
 * Position-derived metadata for EVERY testing week, in order. The label/slug
 * count only the REGULAR weeks (so "Week 2" stays "Week 2" even when Week 1
 * emits no card), and the late-testing window is always "Late Testing". Shared
 * by both designed export variants (list + calendar) so their week identities
 * are guaranteed identical — never hardcoded, always derived from
 * `calendarWeeks()`.
 */
export function weekCardMeta(weeks: readonly CalendarWeek[]): WeekMeta[] {
  const meta: WeekMeta[] = [];
  let regularCount = 0;
  weeks.forEach((week, i) => {
    if (!week.late) regularCount += 1;
    const year = week.days[0]?.slice(0, 4) ?? "";
    meta.push({
      weekIndex: i,
      late: week.late,
      label: week.late ? "Late Testing" : `Week ${regularCount}`,
      slug: week.late ? "late-testing" : `week-${regularCount}`,
      rangeLabel: year
        ? `${weekRangeLabel(week.days)}, ${year}`
        : weekRangeLabel(week.days),
    });
  });
  return meta;
}

/** ISO date → "Mon" (local, no timezone shift). */
function shortWeekday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    new Date(year, month - 1, day),
  );
}

/** Whole-day distance between two ISO dates (UTC-safe, DST-immune). */
function dayDistance(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000;
}

/**
 * The week a dated entry belongs to: the window that CONTAINS its date, else
 * the window nearest to it (ties → earliest week). This keeps portfolio
 * deadlines and any off-grid dated entry on a real card instead of dropping
 * them, without ever inventing a date.
 */
export function nearestWeekIndex(
  weeks: readonly CalendarWeek[],
  date: string,
): number {
  for (let i = 0; i < weeks.length; i += 1) {
    if (weeks[i].days.includes(date)) return i;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < weeks.length; i += 1) {
    const days = weeks[i].days;
    const first = days[0];
    const last = days[days.length - 1];
    const dist =
      date < first
        ? dayDistance(date, first)
        : date > last
          ? dayDistance(date, last)
          : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Build an exam row from a placed calendar block (clocks already computed). */
function examRow(block: CalendarBlock, date: string): WeekCardRow {
  return {
    key: block.key,
    subjectId: block.subjectId,
    subjectName: block.subjectName,
    kind: "exam",
    category: block.category,
    date,
    weekday: shortWeekday(date),
    monthDay: monthDayLabel(date),
    session: block.session,
    startClock: block.startClock,
    // `approximate` means the length was "pending"/unusable and the block used
    // the nominal fallback for HEIGHT only — its end clock is not published
    // data, so it must never be shown (hard data rule).
    endClock: block.approximate ? null : block.endClock,
    lengthPending: block.approximate,
    movedToLate: block.movedToLate,
    note: null,
  };
}

/**
 * Build a row for an off-grid dated entry (a portfolio deadline, or the rare
 * exam that could not be positioned because its session time is unpublished /
 * its date sits outside every window). No clock is shown — off-grid means we
 * have no published time to place it at, and we never guess one.
 */
function offGridRow(
  off: OffGridEntry,
  infoById: ReadonlyMap<string, SubjectCalendarInfo>,
): WeekCardRow {
  const { entry } = off;
  return {
    key: entry.key,
    subjectId: entry.subjectId,
    subjectName: entry.subjectName,
    kind: entry.kind,
    category: infoById.get(entry.subjectId)?.category ?? null,
    date: entry.date,
    weekday: shortWeekday(entry.date),
    monthDay: monthDayLabel(entry.date),
    session: entry.session,
    startClock: null,
    endClock: null,
    lengthPending: false,
    movedToLate: entry.movedToLate,
    note: entry.note,
  };
}

/** Within-day ordering: AM exams, then PM exams, then portfolio deadlines. */
function rowRank(row: WeekCardRow): number {
  if (row.kind === "portfolio") return 2;
  return row.session === "PM" ? 1 : 0;
}

function compareRows(a: WeekCardRow, b: WeekCardRow): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const rank = rowRank(a) - rowRank(b);
  if (rank !== 0) return rank;
  return a.subjectName.localeCompare(b.subjectName);
}

/**
 * Partition the active selection into designed per-week cards.
 *
 * @param subjects          full dataset subject list
 * @param selectedIds       currently selected subject ids
 * @param resolutions       stored conflict resolutions (active schedule)
 * @param sessionStartTimes dataset AM/PM start labels (parsed for clocks)
 */
export function buildWeekCards(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolutions: readonly SlotResolution[],
  sessionStartTimes: { AM: string; PM: string },
): WeekCardsResult {
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
  const rowsByWeek: WeekCardRow[][] = weeks.map(() => []);

  // 1. Exam blocks are already partitioned into weeks by buildCalendarLayout.
  layout.weeks.forEach((weekLayout, i) => {
    for (const day of weekLayout.days) {
      for (const block of day.blocks) {
        rowsByWeek[i].push(examRow(block, day.date));
      }
    }
  });

  // 2. Off-grid dated entries (portfolio deadlines + edge-case exams) join the
  //    nearest week by date, so nothing is silently dropped.
  for (const off of layout.offGrid) {
    rowsByWeek[nearestWeekIndex(weeks, off.entry.date)].push(
      offGridRow(off, infoById),
    );
  }

  // 3. Emit only non-empty weeks, chronological, with position-derived labels
  //    (the SAME `weekCardMeta` the calendar variant uses, so the two exports'
  //    week identities always match).
  const meta = weekCardMeta(weeks);
  const cards: WeekCard[] = [];
  weeks.forEach((_week, i) => {
    const rows = rowsByWeek[i];
    if (rows.length === 0) return;
    rows.sort(compareRows);
    cards.push({ ...meta[i], rows });
  });

  return { cards, undated: schedule.undated };
}
