import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import apData from "../data/ap-2026.json";
import type { ApSubject, ExamFormat, ExamSlot, Portfolio } from "../data/schema";
import { parseApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import {
  buildIcsCalendar,
  foldContentLine,
  parseSessionStartTime,
  ICS_FILE_NAME,
  type SessionStartTimes,
} from "./ics";
import { CATEGORY_EMOJI, SUBJECT_EMOJI } from "./subject-emoji";

/**
 * Unit tests for the ICS generator (issue #7).
 *
 * AC4 (RFC 5545 basics: CRLF, VCALENDAR wrapper, VERSION/PRODID, one DTSTAMP +
 * unique UID per event, ≤75-octet folding) and AC5 (parse with ical.js, zero
 * errors, expected event count for a selection with a resolved conflict + a
 * portfolio subject) are both covered here. Fixtures are synthetic — matching
 * the style of `conflicts.test.ts` — so every shape is exercised independent of
 * the real dataset's contents.
 */

const SESSION_START: SessionStartTimes = {
  AM: "8 a.m. local time",
  PM: "12 p.m. local time",
};

// Fixed UTC clock so DTSTAMP is deterministic: 2026-07-05T13:30:00Z.
const FIXED_NOW = new Date(Date.UTC(2026, 6, 5, 13, 30, 0));
const EXPECTED_DTSTAMP = "20260705T133000Z";

// Issue #44: fixture format uses the sections[] model (flat MCQ/FRQ fields
// were replaced by the ordered per-section breakdown).
const FORMAT: ExamFormat = {
  sections: [
    { name: "Multiple Choice", questionCount: 1, minutes: 30, weightPercent: 50 },
    { name: "Free Response", questionCount: 1, minutes: 30, weightPercent: 50 },
  ],
  totalMinutes: 60,
  calculator: false,
  delivery: "digital",
};

function subject(
  id: string,
  name: string,
  exam: ExamSlot | null,
  lateTesting: ExamSlot | null,
  portfolio: Portfolio | null = null,
): ApSubject {
  return {
    id,
    name,
    category: "STEM",
    exam,
    lateTesting,
    format: { ...FORMAT },
    passRate: "pending",
    portfolio,
    ...(exam === null && portfolio === null
      ? { noExamReason: "fixture: no May 2026 exam" }
      : {}),
  } as ApSubject;
}

const MAY11AM: ExamSlot = { date: "2026-05-11", session: "AM" };

// bio & chem share May 11 AM → a same-slot conflict.
const bio = subject("bio", "AP Biology", MAY11AM, {
  date: "2026-05-18",
  session: "AM",
});
const chem = subject("chem", "AP Chemistry", MAY11AM, {
  date: "2026-05-19",
  session: "AM",
});
// A PM exam, to prove the PM session start time (12 p.m.) is used.
const calc = subject(
  "calc",
  "AP Calculus BC",
  { date: "2026-05-12", session: "PM" },
  { date: "2026-05-20", session: "PM" },
);
// Portfolio-only subject with a note carrying commas + a semicolon (escaping)
// long enough to force line folding.
const PORTFOLIO_NOTE =
  "Two performance tasks, submitted as final in the AP Digital Portfolio by 11:59 p.m. ET: Team Project and Presentation (20%); Individual Research-Based Essay and Presentation (35%).";
const seminar = subject("seminar", "AP Seminar", null, null, {
  deadline: "2026-04-30",
  weightPct: "pending",
  note: PORTFOLIO_NOTE,
} as Portfolio);
// Career-Kickstart-style: no exam, no portfolio → contributes no event.
const cyber = subject("cyber", "AP Cybersecurity", null, null);

/** Keep bio at the regular slot; chem moves to its own late slot. */
const KEEP_BIO: SlotResolution = {
  date: "2026-05-11",
  session: "AM",
  keeperId: "bio",
  memberIds: ["bio", "chem"],
};

function physicalLines(ics: string): string[] {
  // Content lines are CRLF-separated; the doc ends with a trailing CRLF.
  const lines = ics.split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

describe("parseSessionStartTime", () => {
  it("parses AM/PM dataset strings into 24-hour parts", () => {
    expect(parseSessionStartTime("8 a.m. local time")).toEqual({
      hour: 8,
      minute: 0,
    });
    expect(parseSessionStartTime("12 p.m. local time")).toEqual({
      hour: 12,
      minute: 0,
    });
    expect(parseSessionStartTime("12 a.m.")).toEqual({ hour: 0, minute: 0 });
    expect(parseSessionStartTime("9:30 a.m.")).toEqual({ hour: 9, minute: 30 });
  });

  it("throws rather than invent a time for unrecognized metadata", () => {
    expect(() => parseSessionStartTime("sometime in the morning")).toThrow();
  });
});

describe("foldContentLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldContentLine("VERSION:2.0")).toBe("VERSION:2.0");
  });

  it("folds long lines to ≤75 octets with unfoldable continuations", () => {
    const long = `DESCRIPTION:${"x".repeat(400)}`;
    const folded = foldContentLine(long);
    const enc = new TextEncoder();
    for (const line of folded.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop CRLF + the single leading space) restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("never splits a multi-byte code point across the fold boundary", () => {
    const long = `SUMMARY:${"café — ".repeat(20)}`; // en dash + accented chars
    const folded = foldContentLine(long);
    // A broken UTF-8 boundary would surface as U+FFFD after a decode round-trip.
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(folded).not.toContain("�");
  });
});

describe("buildIcsCalendar — RFC 5545 basics (AC4)", () => {
  const ics = buildIcsCalendar(
    [bio, chem, calc, seminar, cyber],
    ["bio", "chem", "calc", "seminar", "cyber"],
    [KEEP_BIO],
    SESSION_START,
    FIXED_NOW,
  );

  it("uses CRLF line endings everywhere, including the final line", () => {
    expect(ics).toContain("\r\n");
    // Every \n is preceded by \r (no bare LF).
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("wraps events in a VCALENDAR with VERSION 2.0 and a PRODID", () => {
    const lines = physicalLines(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toMatch(/\r\nPRODID:.+\r\n/);
  });

  it("emits exactly one DTSTAMP per VEVENT", () => {
    const events = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const dtstamps = (ics.match(/\r\nDTSTAMP:/g) ?? []).length;
    expect(events).toBeGreaterThan(0);
    expect(dtstamps).toBe(events);
    expect(ics).toContain(`DTSTAMP:${EXPECTED_DTSTAMP}`);
  });

  it("gives every VEVENT a unique UID", () => {
    const uids = [...ics.matchAll(/\r\nUID:(.+)\r\n/g)].map((m) => m[1]);
    const events = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(uids.length).toBe(events);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("folds every physical content line at ≤75 octets", () => {
    const enc = new TextEncoder();
    for (const line of physicalLines(ics)) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
    // The long portfolio note must have actually triggered a fold (leading space).
    expect(ics).toMatch(/\r\n /);
  });

  it("escapes TEXT special characters (comma, semicolon) in values", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("\\,"); // commas in the note are escaped
    expect(unfolded).toContain("\\;"); // the semicolon in the note is escaped
  });
});

describe("buildIcsCalendar — exam VEVENTs (AC2)", () => {
  const ics = buildIcsCalendar(
    [bio, chem, calc],
    ["bio", "chem", "calc"],
    [KEEP_BIO],
    SESSION_START,
    FIXED_NOW,
  );
  const unfolded = ics.replace(/\r\n /g, "");

  it("uses the RESOLVED slot: the moved exam exports at its late date", () => {
    // chem was moved to late testing (2026-05-19 AM) by KEEP_BIO.
    expect(unfolded).toContain("DTSTART:20260519T080000");
    // bio stays at the regular slot (2026-05-11 AM).
    expect(unfolded).toContain("DTSTART:20260511T080000");
  });

  it("combines the date with the AM/PM session start time as floating local time", () => {
    // PM session start (12 p.m.) → 120000, no trailing Z.
    expect(unfolded).toContain("DTSTART:20260512T120000");
    expect(unfolded).not.toMatch(/DTSTART:\d{8}T\d{6}Z/); // no UTC-marked starts
  });

  it('formats SUMMARY as "AP <Subject> exam (<AM|PM> session)"', () => {
    expect(unfolded).toContain("SUMMARY:AP Biology exam (AM session)");
    expect(unfolded).toContain("SUMMARY:AP Calculus BC exam (PM session)");
  });
});

describe("buildIcsCalendar — portfolio VEVENTs (AC3)", () => {
  const ics = buildIcsCalendar([seminar], ["seminar"], [], SESSION_START, FIXED_NOW);
  const unfolded = ics.replace(/\r\n /g, "");

  it("emits an all-day DATE event on the deadline date", () => {
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20260430");
  });

  it('formats SUMMARY as "AP <Subject> portfolio due"', () => {
    expect(unfolded).toContain("SUMMARY:AP Seminar portfolio due");
  });
});

describe("buildIcsCalendar — subjects without dated entries", () => {
  it("emits no VEVENT for a selection that has neither exam nor portfolio", () => {
    const ics = buildIcsCalendar([cyber], ["cyber"], [], SESSION_START, FIXED_NOW);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("buildIcsCalendar — parses with ical.js (AC5)", () => {
  // Selection with a resolved conflict (bio kept, chem moved late) + a
  // portfolio subject + a subject that yields no event.
  const ics = buildIcsCalendar(
    [bio, chem, seminar, cyber],
    ["bio", "chem", "seminar", "cyber"],
    [KEEP_BIO],
    SESSION_START,
    FIXED_NOW,
  );

  it("parses without errors", () => {
    expect(() => ICAL.parse(ics)).not.toThrow();
  });

  it("contains exactly the expected event count", () => {
    const vcalendar = new ICAL.Component(ICAL.parse(ics));
    const vevents = vcalendar.getAllSubcomponents("vevent");
    // bio exam + chem exam (moved) + seminar portfolio = 3; cyber contributes 0.
    expect(vevents.length).toBe(3);
  });

  it("round-trips the moved exam's resolved date through the parser", () => {
    const vcalendar = new ICAL.Component(ICAL.parse(ics));
    const chemEvent = vcalendar
      .getAllSubcomponents("vevent")
      .find(
        (v) => v.getFirstPropertyValue("uid") === "chem-exam@ap-exam-planner",
      );
    expect(chemEvent).toBeDefined();
    expect(String(chemEvent?.getFirstPropertyValue("dtstart"))).toContain(
      "2026-05-19",
    );
  });
});

describe("buildIcsCalendar — export stays emoji-free (issue #20 AC4)", () => {
  // Decorative subject emoji (issue #20) live only in the UI render layer, never
  // in the sourced dataset or the calendar export. This pins the deliberate
  // choice of emoji-free SUMMARY text for maximum calendar-client
  // compatibility: even with every real subject selected, no emoji glyph
  // appears anywhere in the ICS output. If a future change ever routes an emoji
  // into an event summary, this fails instead of silently shipping.
  const dataset = parseApDataset(apData);
  const allIds = dataset.subjects.map((s) => s.id);
  const ics = buildIcsCalendar(
    dataset.subjects,
    allIds,
    [],
    dataset.sessionStartTimes,
    FIXED_NOW,
  );
  const emojiGlyphs = [
    ...Object.values(SUBJECT_EMOJI),
    ...Object.values(CATEGORY_EMOJI),
  ];

  it("builds a non-empty calendar with SUMMARY text (sanity check)", () => {
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toMatch(/\r\nSUMMARY:/);
  });

  it("contains none of the decorative subject or category emoji", () => {
    for (const glyph of emojiGlyphs) {
      expect(
        ics.includes(glyph),
        `emoji "${glyph}" leaked into ICS export`,
      ).toBe(false);
    }
  });
});

describe("export constants", () => {
  it("names the downloaded file ap-exams-2026.ics", () => {
    expect(ICS_FILE_NAME).toBe("ap-exams-2026.ics");
  });
});
