import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { withUndatedSubject } from "./test-fixtures";
import { subjectSchema, type ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { ICS_FILE_NAME } from "./ics";
import {
  buildJsonExport,
  buildTxtExport,
  EXPORT_BASE_NAME,
  exportFileName,
  JSON_EXPORT_FORMAT,
  JSON_EXPORT_VERSION,
  MAX_SLUG_LENGTH,
  scheduleExportBaseName,
  scheduleNameSlug,
  TXT_EOL,
  weekPngFileName,
} from "./exports";

/**
 * Builder unit tests (issue #51) — the pure `.json` / `.txt` export builders
 * and the shared filename convention, driven with the REAL shipped dataset
 * (the ics.qa.test.ts fixture-selection precedent):
 *
 *   - AP Physics C: Mechanics (2027-05-03 AM) + AP Human Geography (2027-05-03 AM) share a slot; the
 *     resolution keeps Physics C: Mechanics, so Human Geography exports at its real late-testing
 *     slot (2027-05-17 PM) and must be flagged as moved.
 *   - AP Seminar has BOTH an exam (2027-05-10 PM) and a portfolio deadline
 *     (2027-04-30) → two lines in the txt, chronologically placed.
 *   - A synthetic undated subject (no May 2027 course is undated) → the txt
 *     must surface it rather than silently drop it.
 *   - AP African American Studies carries literal "pending" values → the
 *     hard data rule extends to exports (a "pending" survives round-trip).
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = withUndatedSubject(dataset.subjects);

const SELECTED = [
  "physics-c-mechanics",
  "human-geography",
  "seminar",
  "test-undated-course",
  "african-american-studies",
];

// Keep Physics C: Mechanics at 2027-05-03 AM; Human Geography is bumped to its real late slot.
const KEEP_PHYSICS_C: SlotResolution = {
  date: "2027-05-03",
  session: "AM",
  keeperId: "physics-c-mechanics",
  memberIds: ["physics-c-mechanics", "human-geography"],
};

const FIXED_NOW = new Date(Date.UTC(2026, 6, 5, 13, 30, 0));

describe("filename convention (issue #51, schedule-named since issue #90)", () => {
  it("the cycle stem stays derived from ICS_FILE_NAME (annual swap renames everything)", () => {
    // The stem is DERIVED, and ICS_FILE_NAME itself is untouched by #90 —
    // other consumers (ics.test.ts pins it) still see `ap-exams-<year>.ics`.
    expect(ICS_FILE_NAME).toBe(`${EXPORT_BASE_NAME}.ics`);
    expect(EXPORT_BASE_NAME).toBe("ap-exams-2027");
  });

  it("all four formats share one <schedule-slug>-<stem> basename, per-format extension", () => {
    expect(exportFileName("My Plan", "ics")).toBe(
      `my-plan-${EXPORT_BASE_NAME}.ics`,
    );
    expect(exportFileName("My Plan", "json")).toBe(
      `my-plan-${EXPORT_BASE_NAME}.json`,
    );
    expect(exportFileName("My Plan", "txt")).toBe(
      `my-plan-${EXPORT_BASE_NAME}.txt`,
    );
    expect(weekPngFileName("My Plan", "week-1", "list")).toBe(
      `my-plan-${EXPORT_BASE_NAME}-week-1-list.png`,
    );
  });

  it("saving the same format from two different schedules gives two different filenames", () => {
    for (const ext of ["ics", "json", "txt"] as const) {
      expect(exportFileName("Schedule 1", ext)).not.toBe(
        exportFileName("ambitious draft", ext),
      );
    }
    expect(weekPngFileName("Schedule 1", "week-1", "list")).not.toBe(
      weekPngFileName("ambitious draft", "week-1", "list"),
    );
  });
});

describe("scheduleNameSlug (issue #90)", () => {
  it("kebab-cases an ordinary name", () => {
    expect(scheduleNameSlug("Schedule 1")).toBe("schedule-1");
    expect(scheduleNameSlug("ambitious draft")).toBe("ambitious-draft");
  });

  it("collapses Windows/POSIX-reserved characters into single separators", () => {
    expect(scheduleNameSlug('a\\b/c:d*e?f"g<h>i|j')).toBe(
      "a-b-c-d-e-f-g-h-i-j",
    );
    // A run of several reserved chars is ONE dash, not several.
    expect(scheduleNameSlug('plan: "final"?!')).toBe("plan-final");
  });

  it("strips leading/trailing dots and spaces (the Windows extension-corruptors)", () => {
    expect(scheduleNameSlug(" draft. ")).toBe("draft");
    expect(scheduleNameSlug("...my plan...")).toBe("my-plan");
  });

  it("a name with no sluggable characters slugs to empty and falls back to the bare stem", () => {
    for (const name of ["???", "...", "🎯🎯🎯", "   "]) {
      expect(scheduleNameSlug(name)).toBe("");
      // Fallback: the plain cycle basename — never "-ap-exams-2027.ics",
      // never a leading-dash filename.
      expect(exportFileName(name, "ics")).toBe(`${EXPORT_BASE_NAME}.ics`);
    }
  });

  it("folds Latin diacritics to ASCII and strips what has no ASCII fold", () => {
    expect(scheduleNameSlug("Café Plan")).toBe("cafe-plan");
    expect(scheduleNameSlug("Über-Plan")).toBe("uber-plan");
    // CJK / emoji have no ASCII decomposition: stripped, not transliterated
    // (decision documented on the function; the exact name still lives inside
    // the exported file contents).
    expect(scheduleNameSlug("日本語 plan")).toBe("plan");
    expect(scheduleNameSlug("🎯 target plan")).toBe("target-plan");
  });

  it("a Windows reserved device name can never become the emitted basename", () => {
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    for (const name of ["CON", "prn", "Nul", "COM1", "lpt9"]) {
      // The slug itself is just the lowercased word…
      expect(scheduleNameSlug(name)).toBe(name.toLowerCase());
      // …but the composed basename always carries the stem suffix, so the
      // pre-extension basename never equals a bare device name.
      const base = scheduleExportBaseName(name);
      expect(base).toBe(`${name.toLowerCase()}-${EXPORT_BASE_NAME}`);
      expect(reserved.test(base)).toBe(false);
    }
  });

  it("case-only distinct names map to one slug (Downloads suffixing accepted, documented)", () => {
    // "My Plan" and "my plan" are two legitimately different schedules under
    // the case-sensitive duplicate rule; their exports share a filename and
    // the browser's " (1)" suffix disambiguates. Deliberate — see the
    // decision note on scheduleNameSlug.
    expect(scheduleNameSlug("My Plan")).toBe(scheduleNameSlug("my plan"));
  });

  it("caps a maximum-length name and keeps the longest filename comfortably under limits", () => {
    // 60 code points is the store's name cap (MAX_SCHEDULE_NAME_LENGTH).
    const longName = "x".repeat(60);
    expect(scheduleNameSlug(longName)).toBe(longName);
    expect(scheduleNameSlug(longName).length).toBeLessThanOrEqual(
      MAX_SLUG_LENGTH,
    );
    // NFKD can EXPAND ("ﬃ" → "ffi"): a 60-cp ligature name folds to 180
    // chars — the cap must re-apply to the folded slug.
    const ligatures = "ﬃ".repeat(60);
    expect(scheduleNameSlug(ligatures).length).toBeLessThanOrEqual(
      MAX_SLUG_LENGTH,
    );
    // The cut never exposes a trailing dash.
    const dashAtCut = `${"x".repeat(MAX_SLUG_LENGTH - 1)} tail`;
    expect(scheduleNameSlug(dashAtCut).endsWith("-")).toBe(false);
    // Worst case end-to-end: longest slug + longest suffix stays far below
    // the 255-byte filesystem component limit.
    const longest = weekPngFileName(longName, "late-testing", "calendar");
    expect(longest.length).toBeLessThan(128);
  });
});

describe("weekPngFileName — per-week, per-view suffix (issue #56 + bounce, #90 schedule slug)", () => {
  it("derives schedule basename + week slug + view suffix", () => {
    expect(weekPngFileName("My Plan", "week-1", "list")).toBe(
      "my-plan-ap-exams-2027-week-1-list.png",
    );
    expect(weekPngFileName("My Plan", "week-2", "calendar")).toBe(
      "my-plan-ap-exams-2027-week-2-calendar.png",
    );
    expect(weekPngFileName("My Plan", "late-testing", "list")).toBe(
      "my-plan-ap-exams-2027-late-testing-list.png",
    );
    expect(weekPngFileName("My Plan", "late-testing", "calendar")).toBe(
      "my-plan-ap-exams-2027-late-testing-calendar.png",
    );
  });

  it("the two view variants never collide for the same week", () => {
    for (const slug of ["week-1", "week-2", "late-testing"]) {
      expect(weekPngFileName("My Plan", slug, "list")).not.toBe(
        weekPngFileName("My Plan", slug, "calendar"),
      );
    }
  });

  it("every emitted name contains the shared, dataset-derived stem", () => {
    for (const slug of ["week-1", "week-2", "late-testing"]) {
      for (const view of ["list", "calendar"] as const) {
        expect(
          weekPngFileName("My Plan", slug, view).includes(
            `${EXPORT_BASE_NAME}-`,
          ),
        ).toBe(true);
      }
    }
  });
});

describe("buildJsonExport", () => {
  const parse = () =>
    JSON.parse(
      buildJsonExport(SUBJECTS, SELECTED, [KEEP_PHYSICS_C], "My Plan", FIXED_NOW),
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
    // field survives untouched — and every field the dataset OMITS stays
    // omitted (issue #84: omission is now the only unpublished state).
    const byId = new Map(SUBJECTS.map((subject) => [subject.id, subject]));
    for (const exported of doc.schedule.subjects) {
      expect(exported).toEqual(byId.get(exported.id));
    }
    // …and each still validates against the dataset schema.
    for (const exported of doc.schedule.subjects) {
      expect(() => subjectSchema.parse(exported)).not.toThrow();
    }
  });

  it("hard data rule: an unpublished value stays ABSENT — never back-filled, never 'pending'", () => {
    const doc = parse();
    const aas = doc.schedule.subjects.find(
      (subject) => subject.id === "african-american-studies",
    );
    expect(aas).toBeDefined();
    // The shipped record omits the Individual Student Project's duration
    // (College Board publishes none). The export must neither invent a number
    // for it nor resurrect the "pending" placeholder issue #84 removed.
    const sections = (aas!.format as { sections: Array<Record<string, unknown>> })
      .sections;
    const project = sections.find(
      (section) => section.name === "Individual Student Project",
    );
    expect(project).toBeDefined();
    expect(Object.hasOwn(project!, "minutes")).toBe(false);
    expect(JSON.stringify(aas)).not.toContain("pending");
  });

  it("carries the stored resolutions verbatim", () => {
    const doc = parse();
    expect(doc.schedule.resolutions).toEqual([KEEP_PHYSICS_C]);
  });

  it("skips selected ids with no dataset record instead of inventing one", () => {
    const doc = JSON.parse(
      buildJsonExport(
        SUBJECTS,
        ["physics-c-mechanics", "ghost-subject"],
        [],
        "S",
        FIXED_NOW,
      ),
    ) as { schedule: { subjects: Array<{ id: string }> } };
    expect(doc.schedule.subjects.map((subject) => subject.id)).toEqual([
      "physics-c-mechanics",
    ]);
  });

  it("ends with a trailing newline", () => {
    const raw = buildJsonExport(SUBJECTS, SELECTED, [], "S", FIXED_NOW);
    expect(raw.endsWith("}\n")).toBe(true);
  });
});

describe("buildTxtExport", () => {
  const txt = () =>
    buildTxtExport(SUBJECTS, SELECTED, [KEEP_PHYSICS_C], "My Plan", "May 2027");
  const lines = () => txt().split(TXT_EOL);

  it("uses CRLF EOLs exclusively and ends with a trailing newline (Notepad-safe)", () => {
    const raw = txt();
    expect(raw.endsWith(TXT_EOL)).toBe(true);
    // No bare LF anywhere: stripping CRLFs leaves no newline characters.
    expect(raw.replaceAll(TXT_EOL, "")).not.toMatch(/[\r\n]/);
  });

  it("starts with the schedule-name header and a blank separator line", () => {
    const all = lines();
    expect(all[0]).toBe("My Plan - AP Exams (May 2027 cycle)");
    expect(all[1]).toBe("");
  });

  it("lists one line per dated entry, sorted chronologically", () => {
    const all = lines();
    const body = all.slice(2, -1).filter((line) => line !== "");
    expect(body).toEqual([
      // Seminar's portfolio deadline is the earliest dated entry.
      "Friday, April 30, 2027 | Portfolio deadline | AP Seminar",
      "Monday, May 3, 2027 | AM session | AP Physics C: Mechanics",
      "Thursday, May 6, 2027 | PM session | AP African American Studies",
      "Monday, May 10, 2027 | PM session | AP Seminar",
      // Human Geography was moved by the resolution to its real late slot (May 17 PM).
      "Monday, May 17, 2027 | PM session | AP Human Geography (moved to late testing)",
      // Career Kickstart selection is surfaced, never silently dropped.
      "No May 2027 date | AP Test Undated Course (Test fixture: a listed course whose first exam administration has not been scheduled yet.)",
    ]);
  });

  it("shows the regular slot when no resolution moved the exam", () => {
    const raw = buildTxtExport(
      SUBJECTS,
      ["physics-c-mechanics"],
      [],
      "Solo",
      "May 2027",
    );
    expect(raw).toContain("Monday, May 3, 2027 | AM session | AP Physics C: Mechanics");
    expect(raw).not.toContain("(moved to late testing)");
  });
});
