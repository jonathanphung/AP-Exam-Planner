import { describe, expect, it } from "vitest";
import apData from "../data/ap-2026.json";
import { subjectSchema, type ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { ICS_FILE_NAME } from "./ics";
import {
  buildJsonExport,
  buildTxtExport,
  EXPORT_BASE_NAME,
  JSON_EXPORT_FORMAT,
  JSON_EXPORT_VERSION,
  JSON_FILE_NAME,
  PNG_FILE_NAME,
  TXT_EOL,
  TXT_FILE_NAME,
  weekPngFileName,
} from "./exports";

/**
 * Builder unit tests (issue #51) — the pure `.json` / `.txt` export builders
 * and the shared filename convention, driven with the REAL shipped dataset
 * (the ics.qa.test.ts fixture-selection precedent):
 *
 *   - AP Biology (2026-05-04 AM) + AP Latin (2026-05-04 AM) share a slot; the
 *     resolution keeps Biology, so Latin exports at its real late-testing
 *     slot (2026-05-18 PM) and must be flagged as moved.
 *   - AP Seminar has BOTH an exam (2026-05-11 PM) and a portfolio deadline
 *     (2026-04-30) → two lines in the txt, chronologically placed.
 *   - AP Cybersecurity (Career Kickstart) has no dated 2026 entry → the txt
 *     must surface it rather than silently drop it.
 *   - AP African American Studies carries literal "pending" values → the
 *     hard data rule extends to exports (a "pending" survives round-trip).
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;

const SELECTED = [
  "biology",
  "latin",
  "seminar",
  "cybersecurity",
  "african-american-studies",
];

// Keep Biology at 2026-05-04 AM; Latin is bumped to its real late slot.
const KEEP_BIOLOGY: SlotResolution = {
  date: "2026-05-04",
  session: "AM",
  keeperId: "biology",
  memberIds: ["biology", "latin"],
};

const FIXED_NOW = new Date(Date.UTC(2026, 6, 5, 13, 30, 0));

describe("filename convention (issue #51)", () => {
  it("every format shares the ICS basename, per-format extension", () => {
    expect(ICS_FILE_NAME).toBe(`${EXPORT_BASE_NAME}.ics`);
    expect(PNG_FILE_NAME).toBe(`${EXPORT_BASE_NAME}.png`);
    expect(JSON_FILE_NAME).toBe(`${EXPORT_BASE_NAME}.json`);
    expect(TXT_FILE_NAME).toBe(`${EXPORT_BASE_NAME}.txt`);
    expect(EXPORT_BASE_NAME).toBe("ap-exams-2026");
  });
});

describe("weekPngFileName — per-week, per-view suffix (issue #56 + bounce)", () => {
  it("derives basename + week slug + view suffix", () => {
    expect(weekPngFileName("week-1", "list")).toBe(
      "ap-exams-2026-week-1-list.png",
    );
    expect(weekPngFileName("week-2", "calendar")).toBe(
      "ap-exams-2026-week-2-calendar.png",
    );
    expect(weekPngFileName("late-testing", "list")).toBe(
      "ap-exams-2026-late-testing-list.png",
    );
    expect(weekPngFileName("late-testing", "calendar")).toBe(
      "ap-exams-2026-late-testing-calendar.png",
    );
  });

  it("the two view variants never collide for the same week", () => {
    for (const slug of ["week-1", "week-2", "late-testing"]) {
      expect(weekPngFileName(slug, "list")).not.toBe(
        weekPngFileName(slug, "calendar"),
      );
    }
  });

  it("every emitted name starts with the shared, dataset-derived basename", () => {
    for (const slug of ["week-1", "week-2", "late-testing"]) {
      for (const view of ["list", "calendar"] as const) {
        expect(weekPngFileName(slug, view).startsWith(`${EXPORT_BASE_NAME}-`)).toBe(
          true,
        );
      }
    }
  });
});

describe("buildJsonExport", () => {
  const parse = () =>
    JSON.parse(
      buildJsonExport(SUBJECTS, SELECTED, [KEEP_BIOLOGY], "My Plan", FIXED_NOW),
    ) as {
      format: string;
      version: number;
      exportedAt: string;
      schedule: {
        name: string;
        subjects: Array<Record<string, unknown> & { id: string }>;
        resolutions: SlotResolution[];
      };
    };

  it("wraps the schedule in the versioned apx-schedule envelope", () => {
    const doc = parse();
    expect(doc.format).toBe(JSON_EXPORT_FORMAT);
    expect(doc.version).toBe(JSON_EXPORT_VERSION);
    expect(doc.exportedAt).toBe(FIXED_NOW.toISOString());
    expect(doc.schedule.name).toBe("My Plan");
  });

  it("round-trips: parsed subjects match the selection, verbatim from the dataset", () => {
    const doc = parse();
    // Selection order preserved, nothing added, nothing dropped.
    expect(doc.schedule.subjects.map((subject) => subject.id)).toEqual(
      SELECTED,
    );
    // Each record is the dataset record VERBATIM (deep equality), so every
    // field — including literal "pending" values — survives untouched.
    const byId = new Map(SUBJECTS.map((subject) => [subject.id, subject]));
    for (const exported of doc.schedule.subjects) {
      expect(exported).toEqual(byId.get(exported.id));
    }
    // …and each still validates against the dataset schema.
    for (const exported of doc.schedule.subjects) {
      expect(() => subjectSchema.parse(exported)).not.toThrow();
    }
  });

  it('hard data rule: a "pending" value exports as the literal string "pending"', () => {
    const doc = parse();
    const aas = doc.schedule.subjects.find(
      (subject) => subject.id === "african-american-studies",
    );
    expect(aas).toBeDefined();
    // The shipped record carries at least one literal "pending"; it must
    // appear in the export verbatim — never dropped, never fabricated.
    expect(JSON.stringify(aas)).toContain('"pending"');
  });

  it("carries the stored resolutions verbatim", () => {
    const doc = parse();
    expect(doc.schedule.resolutions).toEqual([KEEP_BIOLOGY]);
  });

  it("skips selected ids with no dataset record instead of inventing one", () => {
    const doc = JSON.parse(
      buildJsonExport(
        SUBJECTS,
        ["biology", "ghost-subject"],
        [],
        "S",
        FIXED_NOW,
      ),
    ) as { schedule: { subjects: Array<{ id: string }> } };
    expect(doc.schedule.subjects.map((subject) => subject.id)).toEqual([
      "biology",
    ]);
  });

  it("ends with a trailing newline", () => {
    const raw = buildJsonExport(SUBJECTS, SELECTED, [], "S", FIXED_NOW);
    expect(raw.endsWith("}\n")).toBe(true);
  });
});

describe("buildTxtExport", () => {
  const txt = () =>
    buildTxtExport(SUBJECTS, SELECTED, [KEEP_BIOLOGY], "My Plan", "May 2026");
  const lines = () => txt().split(TXT_EOL);

  it("uses CRLF EOLs exclusively and ends with a trailing newline (Notepad-safe)", () => {
    const raw = txt();
    expect(raw.endsWith(TXT_EOL)).toBe(true);
    // No bare LF anywhere: stripping CRLFs leaves no newline characters.
    expect(raw.replaceAll(TXT_EOL, "")).not.toMatch(/[\r\n]/);
  });

  it("starts with the schedule-name header and a blank separator line", () => {
    const all = lines();
    expect(all[0]).toBe("My Plan - AP Exams (May 2026 cycle)");
    expect(all[1]).toBe("");
  });

  it("lists one line per dated entry, sorted chronologically", () => {
    const all = lines();
    const body = all.slice(2, -1).filter((line) => line !== "");
    expect(body).toEqual([
      // Seminar's portfolio deadline is the earliest dated entry.
      "Thursday, April 30, 2026 | Portfolio deadline | AP Seminar",
      "Monday, May 4, 2026 | AM session | AP Biology",
      "Thursday, May 7, 2026 | PM session | AP African American Studies",
      "Monday, May 11, 2026 | PM session | AP Seminar",
      // Latin was moved by the resolution to its real late slot (May 18 PM).
      "Monday, May 18, 2026 | PM session | AP Latin (moved to late testing)",
      // Career Kickstart selection is surfaced, never silently dropped.
      "No May 2026 date | AP Cybersecurity (First end-of-course exam administration is May 2027; College Board states the 2027 AP Exam dates will be available in summer 2026. No May 2026 exam exists for this course.)",
    ]);
  });

  it("shows the regular slot when no resolution moved the exam", () => {
    const raw = buildTxtExport(
      SUBJECTS,
      ["biology"],
      [],
      "Solo",
      "May 2026",
    );
    expect(raw).toContain("Monday, May 4, 2026 | AM session | AP Biology");
    expect(raw).not.toContain("(moved to late testing)");
  });
});
