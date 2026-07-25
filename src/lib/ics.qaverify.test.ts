import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import apData from "../data/ap-2027.json";
import type { ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildIcsCalendar, type SessionStartTimes } from "./ics";

/**
 * super-board QA (issue #38, Tester lane) — independent AC re-derivation.
 * Repointed at the `format.sections[]` model after #44 merged (the flat
 * mcqMinutes/frqMinutes fields this spec originally exercised no longer exist).
 *
 * `ics.test.ts` proves the generator against synthetic fixtures and `ics.qa.test.ts`
 * asserts fixed expected strings against the shipped dataset. This spec closes two
 * gaps that neither covers directly:
 *  - the DTEND arithmetic is RE-DERIVED from each subject's published `totalMinutes`
 *    rather than compared to a hard-coded stamp, so a dataset edit that changes a
 *    duration can't silently pass a stale assertion; and
 *  - the RFC 5545 folding is verified as an INVARIANT — every physical line ≤75
 *    octets and the whole document CRLF-only — over the real, folded output.
 * It also exercises the real pending-duration path (AP African American Studies'
 * Individual Student Project section) and a real parts-based section (AP United
 * States History's Section II DBQ / Long Essay rows).
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;
const SESSION_START: SessionStartTimes = dataset.sessionStartTimes;
const FIXED_NOW = new Date(Date.UTC(2026, 6, 5, 13, 30, 0));

// biology: full two-section breakdown + DTEND (AM 08:00, 180 → 11:30)
// african-american-studies: REAL pending section duration (Individual Student
//   Project) alongside four published section rows and a published total
// united-states-history: three published sections; Section II carries real
//   published part rows (DBQ + Long Essay)
// seminar: no multiple-choice section at all (structural omission) + portfolio
// latin: collides with biology → exports at its resolved late slot (05-18 PM)
const SELECTED = [
  "biology",
  "latin",
  "seminar",
  "united-states-history",
  "african-american-studies",
];
const KEEP_PHYSICS_C: SlotResolution = {
  date: "2027-05-03",
  session: "AM",
  keeperId: "biology",
  memberIds: ["biology", "latin"],
};

const ics = buildIcsCalendar(
  SUBJECTS,
  SELECTED,
  [KEEP_PHYSICS_C],
  SESSION_START,
  FIXED_NOW,
);

function unfold(s: string): string {
  return s.replace(/\r\n /g, "");
}

function examDescription(id: string): string {
  const vcal = new ICAL.Component(ICAL.parse(ics));
  const event = vcal
    .getAllSubcomponents("vevent")
    .find((v) => v.getFirstPropertyValue("uid") === `${id}-exam@ap-exam-planner`);
  expect(event, `missing exam VEVENT for ${id}`).toBeDefined();
  return String(event?.getFirstPropertyValue("description"));
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
    expect(checked).toBe(5); // all five selected subjects publish numeric totals
  });

  it("AC3 — section rows are re-derived from format.sections[] (names, questions, minutes, weights, in order)", () => {
    // For every selected subject, EVERY published section must appear in its
    // event's DESCRIPTION exactly as the dataset states it — re-derived, not
    // hard-coded, so a dataset correction can't silently pass a stale string.
    const byId = new Map(SUBJECTS.map((s) => [s.id, s]));
    for (const id of SELECTED) {
      const subject = byId.get(id)!;
      const description = examDescription(id);
      let lastIndex = -1;
      for (const section of subject.format.sections) {
        const question =
          section.questionCount === undefined
            ? undefined
            : section.questionCount === "pending"
              ? "Questions pending"
              : section.questionCount === 1
                ? "1 Question"
                : `${section.questionCount} Questions`;
        const minutes =
          section.minutes === "pending"
            ? "Duration pending"
            : `${section.minutes} Minutes`;
        const weight =
          section.weightPercent === "pending"
            ? "Weight pending"
            : `${section.weightPercent}% of Score`;
        const row = `${section.name}: ${[question, minutes, weight]
          .filter((s) => s !== undefined)
          .join(" | ")}`;
        const index = description.indexOf(row);
        expect(index, `row not found for ${id}: "${row}"`).toBeGreaterThan(-1);
        expect(index, `rows out of dataset order for ${id}`).toBeGreaterThan(
          lastIndex,
        );
        lastIndex = index;
      }
    }
  });

  it("AC3/AC4 — real pending duration prints 'Duration pending'; published Total kept; parts nest; setup merged into the total row", () => {
    // AP African American Studies: the Individual Student Project's duration
    // is genuinely unpublished — the row stays honest while the published
    // 165-minute total still renders as hours-and-minutes.
    const aas = examDescription("african-american-studies");
    expect(aas).toContain("Individual Student Project: Duration pending");
    expect(aas).toContain(
      "Total Length: 2 hours and 45 minutes (+ 30 minutes for exam setup time)",
    );
    // AP United States History: 195 published → "3 hours and 15 minutes", and
    // Section II's published DBQ / Long Essay parts nest as "- " rows.
    const ush = examDescription("united-states-history");
    expect(ush).toContain(
      "Total Length: 3 hours and 15 minutes (+ 30 minutes for exam setup time)",
    );
    expect(ush).toContain("- Document-Based Question (DBQ): 1 Question | 60 Minutes");
    expect(ush).toContain("- Long Essay: 1 Question | 40 Minutes");
    // AP Seminar has no multiple-choice section → no such row, never a "0" row.
    const seminar = examDescription("seminar");
    expect(seminar).not.toContain("Multiple Choice");
    expect(seminar).not.toContain(": 0 Questions");
    // The setup allowance lives in each exam's total row (one per exam VEVENT),
    // never as a standalone line.
    const u = unfold(ics);
    expect((u.match(/\+ 30 minutes for exam setup time/g) ?? []).length).toBe(5);
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
    // and crucially no "Duration pending" leaking from these no-exam subjects.
    expect(pu).not.toContain("Total Length:");
    expect(pu).not.toContain("Duration pending");
    expect(pu).not.toContain("-exam@ap-exam-planner");
  });

  it("QA v2 sweep — EVERY exam subject's DESCRIPTION re-derives from sections[] (all section AND part rows) and DTEND from totalMinutes", () => {
    // The five-subject fixtures above prove the shapes; this sweep closes the
    // remaining gap by re-deriving every row for ALL dataset subjects, one
    // selection at a time (no conflict resolutions needed for singletons). It
    // is the regression guard for this run's recurring defect class — a false
    // "pending" (or an invented number) anywhere in the 42 subjects, including
    // part-level rows (psychology's AAQ/EBQ, the language exams' Q1–Q4) that
    // the fixtures don't individually enumerate.
    const derivedQuestion = (
      count: number | string | undefined,
    ): string | undefined =>
      count === undefined
        ? undefined
        : count === "pending"
          ? "Questions pending"
          : count === 1
            ? "1 Question"
            : `${count} Questions`;
    const derivedMinutes = (minutes: number | string): string =>
      minutes === "pending" ? "Duration pending" : `${minutes} Minutes`;

    let examSubjects = 0;
    for (const subject of SUBJECTS) {
      const single = buildIcsCalendar(
        SUBJECTS,
        [subject.id],
        [],
        SESSION_START,
        FIXED_NOW,
      );
      const vcal = new ICAL.Component(ICAL.parse(single));
      const event = vcal
        .getAllSubcomponents("vevent")
        .find(
          (v) =>
            v.getFirstPropertyValue("uid") ===
            `${subject.id}-exam@ap-exam-planner`,
        );

      if (subject.exam === null) {
        // Portfolio-only / no-exam subjects must never emit an exam VEVENT —
        // and therefore never a timing breakdown (issue #38 C5).
        expect(event, `${subject.id} must emit no exam VEVENT`).toBeUndefined();
        expect(single).not.toContain("Total Length:");
        continue;
      }
      if (!event) continue; // dated-entry-less (first exam in 2027)
      examSubjects++;

      // DTEND strictly re-derived: published total + 30, or absent if pending.
      const block = single
        .replace(/\r\n /g, "")
        .match(
          new RegExp(`UID:${subject.id}-exam@ap-exam-planner[^]*?END:VEVENT`),
        )![0];
      const start = block.match(/DTSTART:(\d{8}T\d{6})/)?.[1];
      const end = block.match(/DTEND:(\d{8}T\d{6})/)?.[1];
      expect(start, `${subject.id} missing DTSTART`).toBeDefined();
      if (typeof subject.format.totalMinutes === "number") {
        expect(end, `${subject.id} must carry DTEND`).toBeDefined();
        expect(
          (floatingToMs(end!) - floatingToMs(start!)) / 60000,
          `${subject.id} DTEND ≠ start + totalMinutes + 30`,
        ).toBe(subject.format.totalMinutes + 30);
      } else {
        expect(end, `${subject.id}: pending total must emit NO DTEND`).toBeUndefined();
      }

      // Every section row and every nested part row, in dataset order.
      const description = String(event.getFirstPropertyValue("description"));
      const lines = description.split("\n");
      let cursor = 0;
      const expectRow = (row: string) => {
        const index = lines.indexOf(row, cursor);
        expect(
          index,
          `${subject.id}: missing/mis-ordered row "${row}"`,
        ).toBeGreaterThanOrEqual(cursor);
        cursor = index + 1;
      };
      for (const section of subject.format.sections) {
        const weight =
          section.weightPercent === "pending"
            ? "Weight pending"
            : `${section.weightPercent}% of Score`;
        expectRow(
          `${section.name}: ${[
            derivedQuestion(section.questionCount),
            derivedMinutes(section.minutes),
            weight,
          ]
            .filter((s) => s !== undefined)
            .join(" | ")}`,
        );
        for (const part of section.parts ?? []) {
          expectRow(
            `- ${part.name}: ${[
              derivedQuestion(part.questionCount),
              derivedMinutes(part.minutes),
            ]
              .filter((s) => s !== undefined)
              .join(" | ")}${part.note ? ` (${part.note})` : ""}`,
          );
        }
      }
      // The final line is always the total row with the merged setup
      // parenthetical — and never a zero-part phrasing or a "0 Questions" row.
      expect(lines[lines.length - 1], `${subject.id} total row`).toMatch(
        /^Total Length: .+ \(\+ 30 minutes for exam setup time\)$/,
      );
      expect(description).not.toMatch(/0 hours|and 0 minutes/);
      expect(description).not.toContain(": 0 Questions");
    }
    expect(examSubjects).toBeGreaterThan(30); // 39 sit-down exams in May 2027
  });

  it("AC5 — parses with ical.js; DESCRIPTION rows joined by literal \\n; every physical line ≤75 octets; CRLF-only", () => {
    expect(() => ICAL.parse(ics)).not.toThrow();

    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75); // RFC 5545 §3.1
    }
    // The only LF in the document is the one in each CRLF pair — no bare LF.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    // DESCRIPTION section breaks are the escaped literal "\n", not raw newlines
    // (biology's two section rows are adjacent in the wire format).
    expect(unfold(ics)).toContain(
      "50% of Score\\nFree Response: 6 Questions | 90 Minutes",
    );
  });
});
