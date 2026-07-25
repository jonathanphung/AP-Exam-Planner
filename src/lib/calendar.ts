import {
  LATE_TESTING_WINDOW,
  REGULAR_WINDOWS,
  type Category,
  type Session,
} from "../data/schema";
import type { Schedule, ScheduleEntry, UndatedSubject } from "./schedule";

/**
 * Pure layout logic for the calendar grid view (issue #19).
 *
 * Turns the schedule built by `buildSchedule` (which already reads through the
 * conflict-resolution layer, so every exam sits at its *effective* slot) into
 * a week-by-week time-grid layout: dated day columns, an hourly axis, and
 * positioned exam blocks. The view renders ONE week at a time and pages
 * through the weeks with prev/next buttons (per the issue-19 design bounce —
 * no vertical month scrolling); {@link defaultWeekIndex} and
 * {@link weekExamCounts} feed that pager.
 *
 * Block-height design (issue-19 second bounce, item A): each exam block spans
 * its subject's PUBLISHED `format.totalMinutes` from the session start (a
 * 195-minute exam starting 8:00 AM spans 8:00–11:15), plus an explicit
 * {@link SETUP_BUFFER_MINUTES} display allowance for the setup time testing
 * usually needs. The buffer is deliberate product padding, NOT published data:
 * the block's label shows only the true exam span; the visual block extends
 * the extra 30 minutes as a visibly distinct segment, keeping the distinction
 * inspectable rather than silently inflating published durations. Subjects
 * whose `totalMinutes` is `"pending"` (or unusable, e.g. 0) fall back to a
 * fixed {@link NOMINAL_EXAM_MINUTES} block marked `approximate` — never a
 * per-subject invented duration, and no end time is shown for them.
 *
 * Data rule (PRD §7.5): nothing here fabricates a date or time. Start hours
 * are parsed from the dataset's `sessionStartTimes` strings; if a label can't
 * be parsed, or an exam's date falls outside every published window, the entry
 * is returned in `offGrid` to be *listed* next to the grid, never guessed onto
 * it. Portfolio deadlines are calendar dates with no clock time, so they are
 * always off-grid entries.
 */

/**
 * Extra visual allowance appended below every exam block for the setup time
 * testing usually needs (issue-19 second bounce). Display-only product
 * padding — never added to the labeled exam span.
 */
export const SETUP_BUFFER_MINUTES = 30;

/**
 * Documented nominal length used ONLY when a subject's published
 * `format.totalMinutes` is `"pending"` (or unusable): the block renders at
 * this fixed height and is flagged `approximate` so the view can mark it
 * visually. One shared constant — never a per-subject guess (PRD §7.5).
 */
export const NOMINAL_EXAM_MINUTES = 120;

export interface CalendarWeek {
  /** ISO dates of every day in the window, in order (Mon–Fri for 2027). */
  days: string[];
  /** True for the late-testing window (rendered with a distinct header). */
  late: boolean;
}

/** An exam block positioned on the grid. */
export interface CalendarBlock {
  /** Stable React key (`${subjectId}:exam`). */
  key: string;
  subjectId: string;
  subjectName: string;
  /** Subject category (drives the block color); null if the id is unknown. */
  category: Category | null;
  session: Session;
  /** Dataset session-start label, displayed verbatim (e.g. "8 a.m. local time"). */
  startLabel: string;
  /** Parsed start in fractional hours (e.g. 8, 12). Anchor for the block top. */
  startHour: number;
  /**
   * The subject's published exam length in minutes, or `null` when the
   * dataset says `"pending"` / has no usable value (the block then renders at
   * {@link NOMINAL_EXAM_MINUTES} and `approximate` is true).
   */
  examMinutes: number | null;
  /** True when the block height is the nominal fallback, not published data. */
  approximate: boolean;
  /**
   * Exam end in fractional hours: `startHour` + published minutes (or the
   * nominal fallback). Excludes the setup buffer — the buffer is view chrome.
   */
  endHour: number;
  /** Clock label of the real start, e.g. "8:00 AM". */
  startClock: string;
  /**
   * Clock label of the published exam end, e.g. "11:15 AM" — only meaningful
   * when `approximate` is false (an approximate end must not be displayed).
   */
  endClock: string;
  /** True when a conflict resolution moved this exam to its late-testing slot. */
  movedToLate: boolean;
  /**
   * The schedule entry's verbatim `examNote` (issue #71), or null. A block is
   * far too small to print a paragraph, so the views render a short
   * `EXAM_NOTE_LABEL` marker on the block face and carry this full text in the
   * block's accessible name / tooltip (site) or the card's notes strip (PNG) —
   * the qualifier is never dropped and never paraphrased.
   */
  examNote: string | null;
  /** Horizontal lane when several blocks share one day+start (0-based). */
  laneIndex: number;
  /** Total lanes sharing this block's day+start. */
  laneCount: number;
}

/**
 * Per-subject inputs the layout needs beyond the schedule entry: the category
 * (block color) and the PUBLISHED exam length (block height). Kept as a small
 * map instead of the full subject so the layout stays pure and unit-testable.
 */
export interface SubjectCalendarInfo {
  category: Category;
  /** The dataset's `format.totalMinutes` — a published number or "pending". */
  totalMinutes: number | "pending";
}

export interface CalendarDay {
  date: string;
  blocks: CalendarBlock[];
}

export interface CalendarWeekLayout {
  late: boolean;
  days: CalendarDay[];
}

/** A schedule entry that must be listed beside the grid, not positioned on it. */
export interface OffGridEntry {
  entry: ScheduleEntry;
  /** Why it isn't on the grid (shown to the student). */
  reason: "portfolio" | "no-published-time" | "outside-windows";
}

export interface CalendarLayout {
  weeks: CalendarWeekLayout[];
  /** First axis hour (inclusive), e.g. 8 → the "8 AM" line. */
  axisStartHour: number;
  /** Last axis hour (exclusive end of the grid), e.g. 15 → grid ends at 3 PM. */
  axisEndHour: number;
  /** Dated entries that cannot be positioned without inventing data. */
  offGrid: OffGridEntry[];
  /** Selected subjects with no dated entry at all (from `Schedule.undated`). */
  undated: UndatedSubject[];
}

/** Enumerate ISO dates from `start` to `end` inclusive (UTC-safe, no DST drift). */
export function enumerateDates(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Every day of the cycle's published testing windows, week by week:
 * the regular windows (in order) followed by the late-testing window.
 */
export function calendarWeeks(): CalendarWeek[] {
  return [
    ...REGULAR_WINDOWS.map((w) => ({
      days: enumerateDates(w.start, w.end),
      late: false,
    })),
    {
      days: enumerateDates(LATE_TESTING_WINDOW.start, LATE_TESTING_WINDOW.end),
      late: true,
    },
  ];
}

/**
 * Parse the leading clock time of a dataset session label into fractional
 * hours: "8 a.m. local time" → 8, "12 p.m. local time" → 12, "1:30 p.m." →
 * 13.5. Returns `null` when the label doesn't start with a recognizable
 * time — callers must then treat the entry as off-grid, never guess.
 */
export function parseStartHour(label: string): number | null {
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m\.?/i.exec(label);
  if (!match) return null;
  let hour = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minutes > 59) return null;
  if (hour === 12) hour = 0; // 12 a.m. → 0, 12 p.m. → 12 (after meridiem add)
  if (match[3].toLowerCase() === "p") hour += 12;
  return hour + minutes / 60;
}

/**
 * Bottom edge of a block as RENDERED: the exam end plus the setup-buffer
 * display allowance. Used for lane overlap and the axis range so the buffer
 * segment never collides with a neighbor or falls off the grid.
 */
export function blockVisualEndHour(block: Pick<CalendarBlock, "endHour">): number {
  return block.endHour + SETUP_BUFFER_MINUTES / 60;
}

/** "8:00 AM" / "11:15 AM" / "3:45 PM" for a fractional hour. */
export function clockLabel(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const meridiem = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

/**
 * Build the full calendar layout from an already-built {@link Schedule}.
 *
 * `sessionStartTimes` is the dataset's `{ AM, PM }` label pair — start hours
 * are parsed from it here, never hardcoded. `subjectInfoById` maps subject id →
 * category + published exam length (schedule entries carry neither).
 */
export function buildCalendarLayout(
  schedule: Schedule,
  sessionStartTimes: { AM: string; PM: string },
  subjectInfoById: ReadonlyMap<string, SubjectCalendarInfo>,
): CalendarLayout {
  const weeks = calendarWeeks();
  const gridDates = new Set(weeks.flatMap((w) => w.days));
  const startHours: Record<Session, number | null> = {
    AM: parseStartHour(sessionStartTimes.AM),
    PM: parseStartHour(sessionStartTimes.PM),
  };

  const blocksByDate = new Map<string, CalendarBlock[]>();
  const offGrid: OffGridEntry[] = [];

  for (const group of schedule.groups) {
    for (const entry of group.entries) {
      if (entry.kind === "portfolio") {
        // A portfolio deadline is a calendar date with no clock time — listing
        // it beside the grid is the only placement that invents nothing.
        offGrid.push({ entry, reason: "portfolio" });
        continue;
      }
      const session = entry.session ?? "AM";
      const startHour = startHours[session];
      if (startHour === null) {
        offGrid.push({ entry, reason: "no-published-time" });
        continue;
      }
      if (!gridDates.has(entry.date)) {
        offGrid.push({ entry, reason: "outside-windows" });
        continue;
      }
      const info = subjectInfoById.get(entry.subjectId);
      // Only a positive published number is a usable length; "pending" (or a
      // missing/zero value) falls back to the documented nominal block and is
      // flagged approximate — never a per-subject invention (PRD §7.5).
      const examMinutes =
        info && typeof info.totalMinutes === "number" && info.totalMinutes > 0
          ? info.totalMinutes
          : null;
      const endHour = startHour + (examMinutes ?? NOMINAL_EXAM_MINUTES) / 60;
      const block: CalendarBlock = {
        key: entry.key,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        category: info?.category ?? null,
        session,
        startLabel: sessionStartTimes[session],
        startHour,
        examMinutes,
        approximate: examMinutes === null,
        endHour,
        startClock: clockLabel(startHour),
        endClock: clockLabel(endHour),
        movedToLate: entry.movedToLate,
        examNote: entry.examNote,
        laneIndex: 0,
        laneCount: 1,
      };
      const existing = blocksByDate.get(entry.date);
      if (existing) existing.push(block);
      else blocksByDate.set(entry.date, [block]);
    }
  }

  // Assign horizontal lanes: blocks whose RENDERED spans (exam + buffer)
  // overlap on one day split the column side by side. Same-slot conflicts
  // (identical start) always overlap, so an unresolved conflict stays visible
  // as two blocks in one slot, matching the list view's pre-resolution state;
  // duration-proportional heights mean a long AM exam that runs into a PM
  // start also lane-splits instead of hiding the later block.
  for (const blocks of blocksByDate.values()) {
    blocks.sort(
      (a, b) =>
        a.startHour - b.startHour ||
        a.subjectName.localeCompare(b.subjectName),
    );
    // Greedy interval coloring per cluster of transitively-overlapping
    // blocks; every cluster member shares the cluster's lane count so the
    // side-by-side widths line up.
    let cluster: CalendarBlock[] = [];
    let laneEnds: number[] = [];
    let clusterEnd = -Infinity;
    const closeCluster = () => {
      for (const member of cluster) member.laneCount = laneEnds.length;
      cluster = [];
      laneEnds = [];
      clusterEnd = -Infinity;
    };
    for (const block of blocks) {
      if (cluster.length > 0 && block.startHour >= clusterEnd) closeCluster();
      const visualEnd = blockVisualEndHour(block);
      let lane = laneEnds.findIndex((end) => end <= block.startHour);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(visualEnd);
      } else {
        laneEnds[lane] = visualEnd;
      }
      block.laneIndex = lane;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, visualEnd);
    }
    closeCluster();
  }

  // Axis range: starts at the earliest parsed session start; ends at the
  // bottom of the tallest RENDERED block (longest selected exam + setup
  // buffer, bounce item A3), so nothing is ever clipped. With no placed
  // blocks the end falls back to the latest session start plus the nominal
  // block + buffer; the 8-o'clock fallback only applies when NO session label
  // is parseable — in that state every exam is off-grid and the axis is empty
  // chrome, not data.
  const placed = Array.from(blocksByDate.values()).flat();
  const parsed = [startHours.AM, startHours.PM].filter(
    (h): h is number => h !== null,
  );
  const axisStartHour =
    parsed.length > 0 ? Math.floor(Math.min(...parsed)) : 8;
  const fallbackEnd =
    (parsed.length > 0 ? Math.max(...parsed) : 8) +
    (NOMINAL_EXAM_MINUTES + SETUP_BUFFER_MINUTES) / 60;
  const axisEndHour = Math.max(
    Math.ceil(
      placed.length > 0
        ? Math.max(...placed.map(blockVisualEndHour))
        : fallbackEnd,
    ),
    axisStartHour + 1,
  );

  return {
    weeks: weeks.map((week) => ({
      late: week.late,
      days: week.days.map((date) => ({
        date,
        blocks: blocksByDate.get(date) ?? [],
      })),
    })),
    axisStartHour,
    axisEndHour,
    offGrid,
    undated: schedule.undated,
  };
}

/** Number of exam blocks placed in each week of the layout (pager badges). */
export function weekExamCounts(
  weeks: readonly CalendarWeekLayout[],
): number[] {
  return weeks.map((week) =>
    week.days.reduce((count, day) => count + day.blocks.length, 0),
  );
}

/**
 * Default pager page: the first week containing a placed exam block, falling
 * back to the first week when no block is placed anywhere (issue-19 design
 * bounce, item 5). Off-grid/undated entries never influence the default —
 * they have no week position by definition.
 */
export function defaultWeekIndex(
  weeks: readonly CalendarWeekLayout[],
): number {
  const index = weeks.findIndex((week) =>
    week.days.some((day) => day.blocks.length > 0),
  );
  return index === -1 ? 0 : index;
}

/** "MON" — uppercase short weekday for a floating ISO date (local, no TZ shift). */
export function weekdayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" })
    .format(new Date(year, month - 1, day))
    .toUpperCase();
}

/** "May 4" — short month + day for a floating ISO date (local, no TZ shift). */
export function monthDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

/** "May 4 – May 8" — range label for a week's days. */
export function weekRangeLabel(days: readonly string[]): string {
  if (days.length === 0) return "";
  const first = monthDayLabel(days[0]);
  const last = monthDayLabel(days[days.length - 1]);
  return days.length === 1 ? first : `${first} – ${last}`;
}

/** Axis tick label for a fractional hour: 8 → "8 AM", 12 → "12 PM", 15 → "3 PM". */
export function hourLabel(hour: number): string {
  const whole = Math.floor(hour) % 24;
  const meridiem = whole < 12 ? "AM" : "PM";
  const clock = whole % 12 === 0 ? 12 : whole % 12;
  return `${clock} ${meridiem}`;
}
