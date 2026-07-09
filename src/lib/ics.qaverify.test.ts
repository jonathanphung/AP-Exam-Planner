import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import apData from "../data/ap-2026.json";
import type { ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildIcsCalendar, type SessionStartTimes } from "./ics";

/**
 * super-board QA (issue #38, Tester lane) — independent AC re-derivation.
 *
 * `ics.test.ts` proves the generator against synthetic fixtures and `ics.qa.test.ts`
 * asserts fixed expected strings against the shipped dataset. This spec closes two
 * gaps that neither covers directly:
 *  - the DTEND arithmetic is RE-DERIVED from each subject's published `totalMinutes`
 *    rather than compared to a hard-coded stamp, so a dataset edit that changes a
 *    duration can't silently pass a stale assertion; and
 *  - the RFC 5545 folding is verified as an INVARIANT — every physical line ≤75
 *    octets and the whole document CRLF-only — over the real, folded output.
 * It also exercises the real pending-`frqMinutes` path (AP United States History),
 * which `ics.qa.test.ts` does not hit on a kept exam.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;
const SESSION_START: SessionStartTimes = dataset.sessionStartTimes;
const FIXED_NOW = new Date(Date.UTC(2026, 6, 5, 13, 30, 0));

// biology: full breakdown + DTEND (AM 08:00, 180 → 11:30)
// united-states-history: real pending frqMinutes, published total 195
// seminar: no-MCQ (count 0) FRQ-only exam + a portfolio deadline
// latin: collides with biology → exports at its resolved late slot (05-18 PM)
const SELECTED = ["biology", "latin", "seminar", "united-states-history"];
const KEEP_BIOLOGY: SlotResolution = {
  date: "2026-05-04",
  session: "AM",
  keeperId: "biology",
  memberIds: ["biology", "latin"],
};

const ics = buildIcsCalendar(
  SUBJECTS,
  SELECTED,
  [KEEP_BIOLOGY],
  SESSION_START,
  FIXED_NOW,
);

function unfold(s: string): string {
  return s.replace(/\r\n /g, "");
}

/** epoch-ms of a floating YYYYMMDDTHHMMSS stamp, read as UTC fields. */
function floatingToMs(v: string): number {
  const m = v.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

describe("issue #38 QA — real dataset, invariants re-derived", () => {
  it("AC1 — no exam SUMMARY carries an AM/PM session suffix; portfolio SUMMARY kept", () => {
    const u = unfold(ics);
    expect(u).not.toContain("(AM session)");
    expect(u).not.toContain("(PM session)");
    expect(u).toContain("SUMMARY:AP Biology exam");
    expect(u).toContain("SUMMARY:AP Seminar exam");
    expect(u).toContain("SUMMARY:AP Seminar portfolio due");
  });

  it("AC2 — every exam DTEND = DTSTART + published totalMinutes + 30, re-derived from the data", () => {
    const byId = new Map(SUBJECTS.map((s) => [s.id, s]));
    let checked = 0;
    for (const id of SELECTED) {
      const total = byId.get(id)!.format.totalMinutes;
      const startRaw = ics.match(
        new RegExp(`UID:${id}-exam@[^]*?DTSTART:(\\d{8}T\\d{6})`),
      )?.[1];
      const endMatch = ics.match(
        new RegExp(`UID:${id}-exam@[^]*?DTEND:(\\d{8}T\\d{6})`),
      );
      if (total === "pending") {
        expect(endMatch).toBeNull(); // never invent a duration
        continue;
      }
      expect(startRaw).toBeDefined();
      expect(endMatch).not.toBeNull();
      const gotMin =
        (floatingToMs(endMatch![1]) - floatingToMs(startRaw!)) / 60000;
      expect(gotMin).toBe((total as number) + 30);
      expect(startRaw).not.toMatch(/Z$/); // floating, not UTC
      checked++;
    }
    expect(checked).toBe(4); // biology, latin, seminar, us-history all have numeric totals
  });

  it("AC3/AC4 — real pending FRQ prints 'Duration pending'; published Total kept; zero-count MCQ row omitted", () => {
    const u = unfold(ics);
    // AP United States History: frqMinutes pending, totalMinutes 195 published.
    expect(u).toContain("MCQ: 55 Questions | 55 Minutes");
    expect(u).toContain("FRQ: 5 Questions | Duration pending");
    // issue #38 A/B — 195 published → "3 hours and 15 minutes", +30 setup merged.
    expect(u).toContain(
      "Total Length: 3 hours and 15 minutes (+ 30 minutes for exam setup time)",
    );
    // AP Seminar has mcqCount 0 → MCQ row omitted, FRQ shown, never "MCQ: 0".
    expect(u).toContain("FRQ: 4 Questions | 120 Minutes");
    expect(u).not.toContain("MCQ: 0");
    // The setup allowance now lives in each exam's total row (one per exam
    // VEVENT), never as a standalone line.
    expect((u.match(/\+ 30 minutes for exam setup time/g) ?? []).length).toBe(
      4,
    );
    expect(u).not.toContain("Minutes\\n+ 30 minutes for exam setup time");
  });

  it("issue #38 C5 — portfolio-only subjects emit a portfolio deadline but NO exam DESCRIPTION/breakdown", () => {
    // research / 2-d / 3-d / drawing have exam: null and a portfolio deadline:
    // they are not sit-down exams, so no exam VEVENT (and therefore no timing
    // breakdown) may be produced — only their all-day portfolio DATE event.
    const portfolioOnly = ["research", "2-d-art-and-design", "drawing"];
    const pIcs = buildIcsCalendar(
      SUBJECTS,
      portfolioOnly,
      [],
      SESSION_START,
      FIXED_NOW,
    );
    const pu = unfold(pIcs);
    // A portfolio deadline event exists for each…
    expect((pu.match(/portfolio due/g) ?? []).length).toBe(3);
    // …but there is no exam breakdown anywhere: no section rows, no total row,
    // and crucially no "Duration pending" leaking from these 0/0 subjects.
    expect(pu).not.toContain("Total Length:");
    expect(pu).not.toContain("MCQ:");
    expect(pu).not.toContain("FRQ:");
    expect(pu).not.toContain("Duration pending");
    expect(pu).not.toContain("-exam@ap-exam-planner");
  });

  it("AC5 — parses with ical.js; DESCRIPTION rows joined by literal \\n; every physical line ≤75 octets; CRLF-only", () => {
    expect(() => ICAL.parse(ics)).not.toThrow();

    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75); // RFC 5545 §3.1
    }
    // The only LF in the document is the one in each CRLF pair — no bare LF.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    // DESCRIPTION section breaks are the escaped literal "\n", not raw newlines.
    expect(unfold(ics)).toContain(
      "90 Minutes\\nFRQ: 6 Questions | 90 Minutes",
    );
  });
});
