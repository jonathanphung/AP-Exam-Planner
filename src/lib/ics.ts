import type { ApSubject, ExamFormat, Session } from "../data/schema";
import { SETUP_BUFFER_MINUTES } from "./calendar";
import type { SlotResolution } from "./conflicts";
import { resolveSlots } from "./conflicts";
import { buildSchedule, type ScheduleEntry } from "./schedule";

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

/** Downloaded file name for the calendar export (shared with the UI). */
export const ICS_FILE_NAME = "ap-exams-2026.ics";

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
 * Human-readable timing breakdown for an exam event's DESCRIPTION, e.g.
 *
 *   MCQ: 60 Questions | 80 Minutes
 *   FRQ: 6 Questions | 100 Minutes
 *   Total Length: 3 hours (+ 30 minutes for exam setup time)
 *
 * Rules (issue #38):
 *  - One row per section that HAS questions; a section with a count of 0 (a
 *    subject with no MCQ or no FRQ) is omitted entirely, never printed as "0".
 *  - A section whose published minutes are "pending" prints "Duration pending"
 *    rather than an invented number — section durations are never estimated.
 *  - Section rows keep their raw published minutes; only the total is phrased
 *    as hours-and-minutes (part A).
 *  - "Total Length" is the subject's PUBLISHED `totalMinutes`, not a recomputed
 *    sum of the section minutes (sections may exclude breaks/instructions).
 *  - The 30-minute setup allowance is a parenthetical ON the total row (part B),
 *    phrased so a reader can see the +30 is OUR product allowance, NOT College
 *    Board's stated duration.
 *
 * Returns the raw (unescaped, `\n`-joined) description text; the caller escapes
 * it through {@link escapeText}, which turns the newlines into literal `\n`.
 */
function buildExamDescription(format: ExamFormat): string {
  const rows: string[] = [];

  const sectionRow = (
    label: string,
    count: ExamFormat["mcqCount"],
    minutes: ExamFormat["mcqMinutes"],
  ): void => {
    // A section that does not exist (a literal 0 count) is omitted, never "0".
    if (count === 0) return;
    const duration =
      minutes === "pending" ? "Duration pending" : `${minutes} Minutes`;
    rows.push(`${label}: ${count} Questions | ${duration}`);
  };

  sectionRow("MCQ", format.mcqCount, format.mcqMinutes);
  sectionRow("FRQ", format.frqCount, format.frqMinutes);

  const total =
    typeof format.totalMinutes === "number"
      ? formatDurationHM(format.totalMinutes)
      : "Duration pending";
  // Part B: the setup allowance is merged into the total row as a parenthetical,
  // kept distinct from the published length so it never reads as College Board's.
  rows.push(
    `Total Length: ${total} (+ ${SETUP_BUFFER_MINUTES} minutes for exam setup time)`,
  );

  return rows.join("\n");
}

function examEventLines(
  entry: ScheduleEntry,
  session: Session,
  sessionStartTimes: SessionStartTimes,
  format: ExamFormat,
  dtstamp: string,
): string[] {
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
  lines.push(`DESCRIPTION:${escapeText(buildExamDescription(format))}`);
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
