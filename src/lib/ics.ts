import type {
  ApSubject,
  ExamFormat,
  ExamSection,
  ExamSectionPart,
  Session,
} from "../data/schema";
import { CYCLE_YEAR } from "../data/cycle";
import { SETUP_BUFFER_MINUTES } from "./calendar";
import { partWeight } from "./exam-sections";
import type { SlotResolution } from "./conflicts";
import { resolveSlots } from "./conflicts";
import {
  EXAM_NOTE_LABEL,
  buildSchedule,
  type ScheduleEntry,
} from "./schedule";

/**
 * Client-side ICS (iCalendar / RFC 5545) generator for the "Export to Calendar"
 * feature (issue #7).
 *
 * Design: this module owns ONLY the RFC 5545 serialization. WHICH events to emit
 * — one per selected sit-down exam (at its resolved, post-conflict slot) plus one
 * per selected portfolio deadline — is delegated to the already-tested schedule
 * layer (`buildSchedule` + `resolveSlots`). That keeps conflict logic in exactly
 * one place (issue #5's `conflicts.ts`, per the issue's "do not re-derive"
 * constraint) and this file purely about formatting.
 *
 * Everything is pure and synchronous: the caller stringifies to a Blob and
 * triggers a download, so the whole feature runs with zero network requests.
 *
 * Data rule (PROJECT.md): no clock time is invented. Exam start times come from
 * the dataset's `sessionStartTimes` metadata; portfolio deadlines are emitted as
 * all-day DATE events because the app treats dates as floating and the only
 * published time for them is an ET cutoff we must not silently relabel as local.
 */

/** The two official session start times, verbatim from dataset metadata. */
export interface SessionStartTimes {
  AM: string;
  PM: string;
}

/**
 * Downloaded file name for the calendar export (shared with the UI, and the
 * basename every other export format derives from — see `exports.ts`). The
 * year comes from the dataset cycle, so the annual swap renames every emitted
 * file with no edit here.
 */
export const ICS_FILE_NAME = `ap-exams-${CYCLE_YEAR}.ics`;

/** MIME type for the calendar blob. */
export const ICS_MIME_TYPE = "text/calendar;charset=utf-8";

const PRODID = "-//AP Exam Planner//AP Exam Planner v1//EN";
const MAX_OCTETS = 75;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse an official session start time (e.g. "8 a.m. local time",
 * "12 p.m. local time") into 24-hour clock parts. Throws rather than guess if
 * the metadata is in an unexpected shape — we never invent a time.
 */
export function parseSessionStartTime(raw: string): {
  hour: number;
  minute: number;
} {
  const match = raw.match(
    /(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)/i,
  );
  if (!match) {
    throw new Error(`Unrecognized session start time in dataset: "${raw}"`);
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) {
    throw new Error(`Out-of-range session start time in dataset: "${raw}"`);
  }
  const isPm = /p/i.test(match[3]);
  if (isPm) {
    hour = (hour % 12) + 12; // 12 p.m. -> 12, 1 p.m. -> 13
  } else {
    hour = hour % 12; // 12 a.m. -> 0
  }
  return { hour, minute };
}

/** Floating local date-time: `YYYYMMDDTHHMMSS` (no trailing Z, no UTC shift). */
function toFloatingDateTime(isoDate: string, hour: number, minute: number): string {
  const [year, month, day] = isoDate.split("-");
  return `${year}${month}${day}T${pad2(hour)}${pad2(minute)}00`;
}

/**
 * Floating local date-time for (start time + `addMinutes`), as
 * `YYYYMMDDTHHMMSS`. The arithmetic borrows `Date`'s calendar/rollover handling
 * by working in UTC, then formats the UTC fields verbatim — no timezone shift is
 * ever applied, so the result stays floating like {@link toFloatingDateTime}.
 * Used to derive an exam's DTEND from its published length plus the setup buffer.
 */
function toFloatingDateTimePlus(
  isoDate: string,
  hour: number,
  minute: number,
  addMinutes: number,
): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const end = new Date(
    Date.UTC(year, month - 1, day, hour, minute + addMinutes, 0),
  );
  return (
    `${end.getUTCFullYear()}${pad2(end.getUTCMonth() + 1)}${pad2(
      end.getUTCDate(),
    )}` + `T${pad2(end.getUTCHours())}${pad2(end.getUTCMinutes())}00`
  );
}

/** All-day DATE value: `YYYYMMDD`. */
function toDateValue(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** DTSTAMP is defined in UTC by RFC 5545: `YYYYMMDDTHHMMSSZ`. */
function toUtcStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(
      now.getUTCDate(),
    )}` +
    `T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(
      now.getUTCSeconds(),
    )}Z`
  );
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash first, then ; , newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

const encoder = new TextEncoder();

function octetLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Fold a single content line so every physical line is ≤75 octets (RFC 5545
 * §3.1). Continuation lines begin with a single space; folding counts UTF-8
 * octets and never splits a multi-byte code point across the boundary.
 */
export function foldContentLine(line: string): string {
  if (octetLength(line) <= MAX_OCTETS) return line;

  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;
  let first = true;

  for (const ch of Array.from(line)) {
    const chOctets = octetLength(ch);
    // Continuation lines spend one octet on the leading space.
    const cap = first ? MAX_OCTETS : MAX_OCTETS - 1;
    if (currentOctets + chOctets > cap) {
      segments.push(current);
      current = "";
      currentOctets = 0;
      first = false;
    }
    current += ch;
    currentOctets += chOctets;
  }
  segments.push(current);

  return segments
    .map((segment, index) => (index === 0 ? segment : ` ${segment}`))
    .join("\r\n");
}

/**
 * Format a whole-minute duration as human-readable hours and minutes, e.g.
 * `195` → `"3 hours and 15 minutes"`, `180` → `"3 hours"`, `60` → `"1 hour"`,
 * `45` → `"45 minutes"`, `61` → `"1 hour and 1 minute"`.
 *
 * Only the exam's PUBLISHED total is phrased this way (issue #38, part A); the
 * per-section rows keep their raw published minutes (`80 Minutes`). Singular /
 * plural is handled for both units and zero-valued parts are dropped, so no
 * output ever reads "0 hours" or "3 hours and 0 minutes". A total of exactly
 * `0` (never reached for a real exam — portfolio-only subjects emit no exam
 * DESCRIPTION) degrades to `"0 minutes"` rather than an empty string.
 */
export function formatDurationHM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  if (parts.length === 0) return "0 minutes";
  return parts.join(" and ");
}

/**
 * `"1 Question"` / `"60 Questions"` / `"55–75 Questions"` (published ranges
 * render verbatim, always plural) / `"Questions pending"` for a count that
 * exists but is not yet published. An OMITTED count (College Board prints no
 * count — e.g. a project-style component) returns `undefined` so the caller
 * drops the segment entirely: omission and "pending" are different states.
 */
function questionSegment(
  count: ExamSection["questionCount"],
): string | undefined {
  if (count === undefined) return undefined;
  return count === 1 ? "1 Question" : `${count} Questions`;
}

/**
 * `"90 Minutes"` / `"40–45 Minutes"` (published ranges verbatim, never
 * averaged), or nothing at all where College Board publishes no length.
 * Never an invented number (PRD §7.5).
 *
 * Before issue #84 an unpublished length printed `"Duration pending"` here.
 * The plain-text row has no column grid to leave a hole in — unlike the info
 * panel's table, where a missing value has to become a visible dash — so an
 * unpublished segment is simply absent, exactly as an omitted question count
 * already was. AP Seminar's two performance-task rows now read
 * `Performance Task 1: …: 20% of Score` rather than claiming a duration is
 * on its way.
 */
function minutesSegment(
  minutes: ExamSection["minutes"] | undefined,
): string | undefined {
  if (minutes === undefined) return undefined;
  return `${minutes} Minutes`;
}

/**
 * A part row's weight segment (issue #73, converted by #83).
 *
 * Every part now mirrors the section row's `50% of Score` convention, because
 * every weight reaching this function is exam-denominated: #73 emitted
 * College Board's relative phrases verbatim ("50% of section score",
 * "50% of 20%") on the reasoning that the .ics DESCRIPTION is plain text with
 * no room for a footnote, so an unqualified "50% of Score" on AP
 * Macroeconomics' long free-response question would read as half the exam.
 *
 * #83 removes the ambiguity at the source instead of routing around it —
 * {@link partWeight} multiplies the relative weight by its section's stored
 * share, so the row says `16.5% of Score` and means it. The footnote problem
 * is gone with the footnote. A per-question weight keeps its qualifier
 * inline (`8.25% of Score each`), since the plain-text row has no second line
 * to put it on and dropping it would misstate a 2-question row by a factor of
 * two. A part College Board publishes no weight for drops the segment
 * entirely, exactly as an omitted question count does.
 */
function partWeightSegment(
  part: ExamSectionPart,
  sectionWeightPercent: ExamSection["weightPercent"],
): string | undefined {
  const weight = partWeight(part, sectionWeightPercent);
  switch (weight.kind) {
    case "percent":
      return `${weight.value}% of Score${weight.each ? " each" : ""}`;
    case "printed":
      return weight.text;
    case "unpublished":
      return undefined;
  }
}

/**
 * One `Part A: 30 Questions | 60 Minutes | 35% of Score (calculator not
 * permitted)` row — the same `questions | length | weight` shape as the
 * section row above it.
 */
function partRow(
  part: ExamSectionPart,
  sectionWeightPercent: ExamSection["weightPercent"],
): string {
  const segments = [
    questionSegment(part.questionCount),
    minutesSegment(part.minutes),
    partWeightSegment(part, sectionWeightPercent),
  ]
    .filter((s): s is string => s !== undefined)
    .join(" | ");
  const note = part.note ? ` (${part.note})` : "";
  return `- ${part.name}: ${segments}${note}`;
}

/**
 * Human-readable timing breakdown for an exam event's DESCRIPTION, e.g.
 *
 *   Multiple Choice: 60 Questions | 90 Minutes | 50% of Score
 *   Free Response: 6 Questions | 90 Minutes | 50% of Score
 *   Total Length: 3 hours (+ 30 minutes for exam setup time)
 *
 * Rules (issue #38, repointed at `format.sections[]` — the #44 model — as the
 * single source of truth):
 *  - One row per PUBLISHED section, in dataset order, titled exactly as the
 *    dataset (College Board's own section names, never forced into an MCQ/FRQ
 *    mold). An exam that lacks a section simply has no row for it (AP Seminar
 *    prints no multiple-choice row) — omission is structural, never a "0" row.
 *  - Row shape mirrors College Board's printed format (and the #44 info
 *    panel): `questions | minutes | weight`. Any segment College Board
 *    publishes no value for is dropped — never estimated, never a "0" (PRD
 *    §7.5). Until issue #84 an unpublished value could also print
 *    "Questions pending" / "Duration pending" / "Weight pending"; those
 *    strings are gone with the dataset state that produced them.
 *  - Published Part A/B rows nest under their section as `- `-prefixed lines,
 *    carrying the page's note (calculator rule etc.) as a parenthetical.
 *    Design call (issue #38): part notes ARE included (they distinguish the
 *    parts); section-level notes are NOT (the rows stay unadorned, per the
 *    ticket) — and no extra calculator/delivery line is added.
 *  - Section rows keep their raw published minutes; only the total is phrased
 *    as hours-and-minutes (part A of Jon's bounce).
 *  - "Total Length" is the subject's PUBLISHED `totalMinutes`, not a recomputed
 *    sum of the section minutes (sections may exclude breaks/instructions).
 *  - The 30-minute setup allowance is a parenthetical ON the total row (part B),
 *    phrased so a reader can see the +30 is OUR product allowance, NOT College
 *    Board's stated duration.
 *  - A published qualifier on the exam itself (`examNote` — AP Networking's May
 *    2027 sitting is "2026-27 pilot schools only") LEADS the description, above
 *    the section rows (issue #71). It is the one fact that changes whether the
 *    reader can sit this exam at all, and an .ics event carries no other
 *    disclosure surface: dropping it exports a date that reads as bookable.
 *    Verbatim from the dataset, prefixed with {@link EXAM_NOTE_LABEL}.
 *
 * Returns the raw (unescaped, `\n`-joined) description text; the caller escapes
 * it through {@link escapeText}, which turns the newlines into literal `\n`.
 */
function buildExamDescription(
  format: ExamFormat,
  examNote: string | null,
): string {
  const rows: string[] = [];

  if (examNote) rows.push(`${EXAM_NOTE_LABEL}: ${examNote}`, "");

  for (const section of format.sections) {
    const segments = [
      questionSegment(section.questionCount),
      minutesSegment(section.minutes),
      `${section.weightPercent}% of Score`,
    ]
      .filter((s): s is string => s !== undefined)
      .join(" | ");
    rows.push(`${section.name}: ${segments}`);
    for (const part of section.parts ?? []) {
      rows.push(partRow(part, section.weightPercent));
    }
  }

  // Part B: the setup allowance is merged into the total row as a parenthetical,
  // kept distinct from the published length so it never reads as College Board's.
  // A subject College Board publishes no length for (AP Networking, whose exam
  // page does not exist yet) gets NO total row at all — issue #84: there is no
  // published length for the allowance to be added to, and "+ 30 minutes for
  // exam setup time" hanging off a non-value is worse than silence.
  if (typeof format.totalMinutes === "number") {
    rows.push(
      `Total Length: ${formatDurationHM(format.totalMinutes)} (+ ${SETUP_BUFFER_MINUTES} minutes for exam setup time)`,
    );
  }

  return rows.join("\n");
}

function examEventLines(
  entry: ScheduleEntry,
  session: Session,
  sessionStartTimes: SessionStartTimes,
  format: ExamFormat,
  dtstamp: string,
): string[] {
  // The entry (not the subject record) owns the qualifier — same source the
  // list view and the txt/png exports read, so the four cannot drift.

  const { hour, minute } = parseSessionStartTime(sessionStartTimes[session]);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${entry.subjectId}-exam@ap-exam-planner`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toFloatingDateTime(entry.date, hour, minute)}`,
  ];
  // DTEND = start + published length + the setup buffer. A subject whose
  // totalMinutes is "pending" gets NO DTEND — never invent a duration from an
  // estimate (issue #38); the client renders it as a point/default instead.
  if (typeof format.totalMinutes === "number") {
    lines.push(
      `DTEND:${toFloatingDateTimePlus(
        entry.date,
        hour,
        minute,
        format.totalMinutes + SETUP_BUFFER_MINUTES,
      )}`,
    );
  }
  // The AM/PM session is already implicit in DTSTART, so the summary no longer
  // carries the "(AM session)" / "(PM session)" suffix (issue #38).
  lines.push(`SUMMARY:${escapeText(`${entry.subjectName} exam`)}`);
  lines.push(
    `DESCRIPTION:${escapeText(buildExamDescription(format, entry.examNote))}`,
  );
  lines.push("END:VEVENT");
  return lines;
}

function portfolioEventLines(entry: ScheduleEntry, dtstamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${entry.subjectId}-portfolio@ap-exam-planner`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${toDateValue(entry.date)}`,
    `SUMMARY:${escapeText(`${entry.subjectName} portfolio due`)}`,
  ];
  if (entry.note) {
    lines.push(`DESCRIPTION:${escapeText(entry.note)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Build the full ICS document for the current selection.
 *
 * One VEVENT per selected sit-down exam (at its resolved post-conflict slot) and
 * one per selected portfolio deadline, in the same chronological order the
 * schedule view renders. Selections with no dated entry (e.g. Career Kickstart
 * courses whose first exam is May 2027) produce no event.
 *
 * @param now injectable clock for DTSTAMP; defaults to the moment of generation.
 */
export function buildIcsCalendar(
  subjects: readonly ApSubject[],
  selectedIds: readonly string[],
  resolutions: readonly SlotResolution[],
  sessionStartTimes: SessionStartTimes,
  now: Date = new Date(),
): string {
  const resolved = resolveSlots(subjects, selectedIds, resolutions);
  const { groups } = buildSchedule(subjects, selectedIds, resolved);
  const dtstamp = toUtcStamp(now);
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.kind === "exam" && entry.session) {
        const subject = subjectById.get(entry.subjectId);
        if (subject) {
          lines.push(
            ...examEventLines(
              entry,
              entry.session,
              sessionStartTimes,
              subject.format,
              dtstamp,
            ),
          );
        }
      } else if (entry.kind === "portfolio") {
        lines.push(...portfolioEventLines(entry, dtstamp));
      }
    }
  }

  lines.push("END:VCALENDAR");

  // Every content line ends with CRLF, including the last (RFC 5545 §3.1).
  return `${lines.map(foldContentLine).join("\r\n")}\r\n`;
}
