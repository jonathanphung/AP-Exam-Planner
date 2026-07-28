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
 * - Portfolio deadlines dated BEFORE the first testing day are collected onto a
 *   "Week 0" card that precedes every testing week (see below). It is NOT a
 *   `calendarWeeks()` window, so it does not participate in the position-derived
 *   count: Week 1 stays Week 1.
 *
 * Edge-case decisions (documented per issue #56; the portfolio half rewritten
 * by issue #97 and then AMENDED by Jon's bounce on that build, 2026-07-27):
 * - A PORTFOLIO deadline dated STRICTLY BEFORE the first day of the earliest
 *   published testing window leaves the exam weeks: those rows are collected
 *   onto ONE card, "Week 0" (`week-0`), emitted FIRST when it has any row.
 *   Issue #56 assigned them to the nearest week window; issue #97 supersedes
 *   that for this case, on Jon's call (2026-07-27): "things I submit before
 *   exams start" and "days I sit in a room" are different mental buckets, and a
 *   shared Week 1 export interleaved them. The never-silently-dropped invariant
 *   is unchanged — Week 0 IS the not-dropped mechanism for these rows now.
 * - A portfolio deadline dated ON OR AFTER that first testing day does NOT
 *   move. It keeps the issue-#56 nearest-week assignment and renders on the
 *   week it actually occurs in. #97's first build routed every deadline to
 *   Week 0 by row KIND; Jon bounced exactly that (2026-07-27): "keep portfolios
 *   due on ap exam week (ap 2-d art and design, ap drawing, etc.) on the actual
 *   week that they occur for both list and calendar view. essentially revert
 *   the change for these subjects." The dataset's Art & Design trio (due
 *   2027-05-07, the Friday INSIDE Week 1's window) is that case and rides
 *   Week 1, deadline row and all.
 *   So the predicate is a DATE CUTOFF, never the row kind — see
 *   {@link belongsOnWeekZero}. The cutoff is derived from `calendarWeeks()`,
 *   never hardcoded, so an annual dataset swap re-pages it with no edit, and
 *   the comparison is strict: a deadline dated ON the first testing day is not
 *   "before exam week" and rides that week.
 * - Week 0 therefore leads the export by identity AND by chronology — every row
 *   it holds is dated before Week 1's first day, so the two agree.
 * - Non-portfolio off-grid dated entries (the rare exam whose session time is
 *   unpublished, or whose date falls outside every window — none in the May
 *   2027 dataset) KEEP the issue-#56 rule unconditionally: they are assigned to
 *   the NEAREST week window by date and rendered as their own row on that card,
 *   so they are never dropped and never spawn a blank card of their own. Only
 *   `portfolio` rows are eligible for Week 0 at all.
 * - Undated selections (Career Kickstart courses, no May date) have no week to
 *   sit in; they are returned in `undated` so the renderer can surface them as
 *   a footnote (never dropped), mirroring the txt/json exports. They are NOT
 *   deadlines and never become Week 0 rows. When EVERY selection is undated
 *   there are zero qualifying weeks and `cards` is empty — the caller shows the
 *   empty-state instead of downloading a misleading file. A portfolio-only
 *   selection is NOT that case: it emits Week 0, an exam week, or both,
 *   depending on which side of the cutoff its deadlines fall.
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
  /**
   * The block height is this app's nominal fallback, not a published length.
   *
   * Deliberately NOT renamed by issue #84, which retired the dataset's
   * `"pending"` state: this flag is about OUR block being approximate, not
   * about a dataset cell awaiting a College Board figure. The user-facing
   * "Length pending" marker it drives is pinned by e2e specs and committed
   * evidence (#71, #74); re-wording it is a copy decision that needs its own
   * screenshots, not a side effect of a data change.
   */
  lengthPending: boolean;
  /** True when a conflict resolution moved this exam to its late-testing slot. */
  movedToLate: boolean;
  /**
   * Portfolio submission note (verbatim); null for exams. Carried by the model
   * as a faithful projection of the schedule entry, but the exported list card
   * deliberately does NOT print it anywhere (Jon's product call on the #91
   * bounce, 2026-07-27): the dated deadline row is schedule content, the
   * submission-process prose is not. The text still lives in the dataset, the
   * details dialog, the `.json` export, and the `.ics` DESCRIPTION (not the
   * `.txt` export — `buildTxtExport` appends `examNote` only).
   */
  note: string | null;
  /**
   * The exam's published qualifier (verbatim `examNote`), or null (issue #71).
   * A `.png` has no popup and no tooltip, so this text is PRINTED on the card —
   * the card is the whole disclosure surface. Issue #91 moved *where*: the row
   * carries a short marker and the verbatim text moves to the card's notes
   * strip (see {@link weekCardNotes}), so the text is never lost and never
   * printed once per subject.
   */
  examNote: string | null;
}

export interface WeekCard {
  /** 0-based index into `calendarWeeks()`; {@link WEEK_ZERO_INDEX} for Week 0. */
  weekIndex: number;
  /** True for the late-testing window (rendered with a distinct header). */
  late: boolean;
  /** True for the Week 0 deadlines card — no window, no grid, no exam rows. */
  deadlines: boolean;
  /** "Week 0" / "Week 1" / "Late Testing" — derived from position + `late`. */
  label: string;
  /** Filename suffix: "week-0" / "week-1" / "late-testing". */
  slug: string;
  /** "May 3 – 7, 2027" — range label incl. year. */
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

/**
 * One de-duplicated published exam qualifier for a week card's notes strip:
 * the verbatim text once, plus every subject on this card that carries it.
 */
export interface WeekCardNote {
  /** The dataset `examNote` text, VERBATIM — never truncated, never summarised. */
  text: string;
  /** Subject names carrying this exact text, in row order, de-duplicated. */
  subjectNames: string[];
  /**
   * The shared category when every subject in the group has the same one,
   * else null — the strip tints its bullet with it and must not imply a
   * category the group does not actually share.
   */
  category: Category | null;
}

/**
 * The card's published exam qualifiers, de-duplicated by verbatim text —
 * issue #91, amended by Jon's bounce (2026-07-27).
 *
 * Two-stage history, both recorded because each half is a deliberate call:
 *
 * 1. The original #91 fix grouped BOTH long verbatim strings — `row.note` (the
 *    portfolio submission notes) and `row.examNote` — by (kind, text), so the
 *    renderer painted "one note, many subjects" instead of six copies of the
 *    byte-identical 310-character PPR paragraph.
 * 2. Jon then bounced the card with the call that the portfolio submission
 *    note should not be on the exported list card AT ALL — not inline, not in
 *    the strip, not as a row marker. The dated deadline row is schedule
 *    content; the submission-process prose is not. So `row.note` is now
 *    deliberately IGNORED here, and only `examNote` reaches the strip. The
 *    portfolio text still lives in the dataset, the details dialog, the
 *    `.json` export, and the `.ics` DESCRIPTION — this is a list-`.png`
 *    presentation decision, not a data change.
 *
 * The `examNote` treatment is unchanged from the approved #91 build: #71's
 * requirement (a `.png` has no popup or tooltip, so the qualifier must be
 * printed on the card) still holds, and grouping keeps it printed once per
 * distinct text however many subjects carry it.
 *
 * Order is first appearance in row order (rows are already chronological), so
 * the strip reads in the same sequence as the rows above it.
 */
export function weekCardNotes(
  rows: readonly WeekCardRow[],
): WeekCardNote[] {
  const byText = new Map<string, WeekCardNote>();
  // Tracks whether a group is still category-unanimous; a group that has seen
  // two categories is pinned to null and never re-tinted.
  const unanimous = new Map<string, boolean>();

  for (const row of rows) {
    const text = row.examNote;
    if (!text) continue;
    const existing = byText.get(text);
    if (!existing) {
      byText.set(text, {
        text,
        subjectNames: [row.subjectName],
        category: row.category,
      });
      unanimous.set(text, true);
      continue;
    }
    if (!existing.subjectNames.includes(row.subjectName)) {
      existing.subjectNames.push(row.subjectName);
    }
    if (unanimous.get(text) && existing.category !== row.category) {
      unanimous.set(text, false);
      existing.category = null;
    }
  }
  return [...byText.values()];
}

/** Position-derived identity for one testing week (label, slug, range). */
export interface WeekMeta {
  /** 0-based index into `calendarWeeks()`; {@link WEEK_ZERO_INDEX} for Week 0. */
  weekIndex: number;
  /** True for the late-testing window. */
  late: boolean;
  /** True for the Week 0 deadlines card — no window, no grid, no exam rows. */
  deadlines: boolean;
  /** "Week 0" / "Week 1" / "Late Testing" — derived from position + `late`. */
  label: string;
  /** Filename slug: "week-0" / "week-1" / "late-testing". */
  slug: string;
  /** "May 3 – 7, 2027" — range label incl. year. */
  rangeLabel: string;
}

/**
 * `weekIndex` for the Week 0 deadlines card. Negative on purpose: Week 0 is NOT
 * a `calendarWeeks()` window, so there is no index it could honestly hold, and
 * a negative value can never collide with a real one.
 */
export const WEEK_ZERO_INDEX = -1;
/** Header label for the deadlines card (issue #97). */
export const WEEK_ZERO_LABEL = "Week 0";
/** Filename slug for the deadlines card — `…-week-0-list.png`. */
export const WEEK_ZERO_SLUG = "week-0";

/**
 * Position-derived metadata for EVERY testing week, in order. The label/slug
 * count only the REGULAR weeks (so "Week 2" stays "Week 2" even when Week 1
 * emits no card), and the late-testing window is always "Late Testing". Shared
 * by both designed export variants (list + calendar) so their week identities
 * are guaranteed identical — never hardcoded, always derived from
 * `calendarWeeks()`.
 *
 * Week 0 is derived separately by {@link weekZeroMeta} and deliberately does
 * NOT enter this count: it is not a testing window, so counting it would shift
 * every real week's number by one (issue #97).
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
      deadlines: false,
      label: week.late ? "Late Testing" : `Week ${regularCount}`,
      slug: week.late ? "late-testing" : `week-${regularCount}`,
      rangeLabel: year
        ? `${weekRangeLabel(week.days)}, ${year}`
        : weekRangeLabel(week.days),
    });
  });
  return meta;
}

/**
 * Identity for the Week 0 deadlines card (issue #97) — the sibling derivation
 * to {@link weekCardMeta}, kept here so both export variants read their week
 * identities from ONE module and can never disagree about the label or slug.
 *
 * `rangeLabel` describes the rows the card actually holds, not a window: the
 * span of the deadline dates passed in, collapsing to a single date when they
 * all share one ("Apr 30, 2027" for the shipped 2027 cycle, whose pre-window
 * deadlines are all April 30). Week 0 has no published window, so inventing a
 * range for it would be fabricating data — the same reason the exam weeks quote
 * their real `calendarWeeks()` days. The span form is kept because a future
 * cycle can publish more than one pre-window deadline date.
 *
 * @param dates ISO dates of the deadlines on the card (order irrelevant).
 */
export function weekZeroMeta(dates: readonly string[]): WeekMeta {
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = first === last ? [first] : [first, last];
  const year = first?.slice(0, 4) ?? "";
  const range = weekRangeLabel(span.filter((d): d is string => Boolean(d)));
  return {
    weekIndex: WEEK_ZERO_INDEX,
    late: false,
    deadlines: true,
    label: WEEK_ZERO_LABEL,
    slug: WEEK_ZERO_SLUG,
    rangeLabel: year && range ? `${range}, ${year}` : range,
  };
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
 * First day of the EARLIEST published testing window — the Week 0 cutoff.
 *
 * Reduced over every window rather than read off `weeks[0]`: `calendarWeeks()`
 * happens to emit the regular windows before the late one today, but nothing in
 * its contract promises that order, and an annual dataset swap must re-page
 * this with no edit here. Returns null when the dataset publishes no window at
 * all — an unreachable state with the shipped data, and deliberately NOT given
 * a fabricated fallback date (see {@link belongsOnWeekZero}).
 */
export function firstWindowStart(weeks: readonly CalendarWeek[]): string | null {
  let earliest: string | null = null;
  for (const week of weeks) {
    const first = week.days[0];
    if (!first) continue;
    if (earliest === null || first < earliest) earliest = first;
  }
  return earliest;
}

/**
 * Does this dated entry belong on the Week 0 deadlines card?
 *
 * The ONE definition of that rule, shared by both designed export variants
 * (`buildWeekCards` + `buildCalendarCards`) so the list and calendar `.png`s
 * can never disagree about where a deadline lands — the cross-variant drift
 * issue #73's one-presentation principle exists to prevent.
 *
 * True iff the row is a `portfolio` deadline AND its date is strictly before
 * the first day of the earliest published testing window (Jon's bounce on
 * issue #97, 2026-07-27). Everything else — an exam of any kind, and any
 * deadline dated on or after that day — falls through to
 * {@link nearestWeekIndex} and renders on the week it actually occurs in.
 *
 * Deliberate details:
 * - **Strict `<`.** A deadline dated ON the first testing day is not "before
 *   exam week"; it rides that week, exactly like the Art & Design trio's
 *   in-window 2027-05-07 deadlines.
 * - **Lexicographic ISO comparison, no `Date` objects.** `schema.ts` documents
 *   these dates as lexicographically comparable, and `schedule.ts` /
 *   `calendar.ts` deliberately avoid a `Date` parse that would shift by a
 *   timezone.
 * - **No windows → no Week 0.** With nothing published there is no honest
 *   cutoff, so no row qualifies and every deadline keeps its nearest-week
 *   assignment; nothing is invented and nothing is dropped.
 */
export function belongsOnWeekZero(
  weeks: readonly CalendarWeek[],
  kind: WeekCardRowKind,
  date: string,
): boolean {
  if (kind !== "portfolio") return false;
  const start = firstWindowStart(weeks);
  return start !== null && date < start;
}

/**
 * The week a dated entry belongs to: the window that CONTAINS its date, else
 * the window nearest to it (ties → earliest week). This keeps an off-grid dated
 * entry on a real card instead of dropping it, without ever inventing a date.
 *
 * Applies to every off-grid entry that {@link belongsOnWeekZero} does not
 * claim: non-portfolio entries (an exam with no published session time, or one
 * dated outside every window) unconditionally, AND portfolio deadlines dated on
 * or after the first testing day — the Art & Design trio reaches this function
 * and lands on Week 1 by window containment (Jon's bounce on issue #97). Only
 * deadlines dated before the first testing day are routed away, to Week 0.
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
    examNote: block.examNote,
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
    examNote: entry.examNote,
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

  // 2. Off-grid dated entries split by the SHARED Week 0 cutoff (issue #97 as
  //    amended by Jon's bounce, 2026-07-27):
  //    - a portfolio deadline dated BEFORE the first testing day → Week 0;
  //    - everything else — an in-window / later deadline, or an exam with no
  //      published session time — → the nearest week, the issue-#56 rule.
  //    Either way nothing is silently dropped. The predicate lives in
  //    `belongsOnWeekZero` and `calendar-cards.ts` calls the same one, so the
  //    two `.png` variants cannot page a deadline differently.
  const deadlineRows: WeekCardRow[] = [];
  for (const off of layout.offGrid) {
    const row = offGridRow(off, infoById);
    if (belongsOnWeekZero(weeks, row.kind, row.date)) {
      deadlineRows.push(row);
      continue;
    }
    rowsByWeek[nearestWeekIndex(weeks, off.entry.date)].push(row);
  }

  // 3. Emit Week 0 first (only when it has rows), then only the non-empty
  //    testing weeks, chronological, with position-derived labels (the SAME
  //    `weekCardMeta` the calendar variant uses, so the two exports' week
  //    identities always match).
  const meta = weekCardMeta(weeks);
  const cards: WeekCard[] = [];
  if (deadlineRows.length > 0) {
    deadlineRows.sort(compareRows);
    cards.push({
      ...weekZeroMeta(deadlineRows.map((row) => row.date)),
      rows: deadlineRows,
    });
  }
  weeks.forEach((_week, i) => {
    const rows = rowsByWeek[i];
    if (rows.length === 0) return;
    rows.sort(compareRows);
    cards.push({ ...meta[i], rows });
  });

  return { cards, undated: schedule.undated };
}
