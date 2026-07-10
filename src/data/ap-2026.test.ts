import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apDatasetSchema,
  parseApDataset,
  type ApDataset,
} from "./schema";

const raw: unknown = JSON.parse(
  readFileSync(join(__dirname, "ap-2026.json"), "utf-8"),
);

function clone(): ApDataset {
  return structuredClone(raw) as ApDataset;
}

describe("ap-2026.json dataset", () => {
  it("validates against the zod schema", () => {
    const result = apDatasetSchema.safeParse(raw);
    if (!result.success) {
      // Surface every issue in the failure output, not just "false".
      throw new Error(
        `dataset invalid:\n${result.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
      );
    }
    expect(result.success).toBe(true);
  });

  const dataset = parseApDataset(raw);
  const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

  it("covers the full College Board course list (42 subjects) with unique ids", () => {
    expect(dataset.subjects.length).toBe(42);
    expect(new Set(dataset.subjects.map((s) => s.id)).size).toBe(42);
  });

  it("carries May 2026 cycle metadata with published session start times", () => {
    expect(dataset.cycle).toBe("May 2026");
    expect(dataset.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.sessionStartTimes.AM).toBe("8 a.m. local time");
    expect(dataset.sessionStartTimes.PM).toBe("12 p.m. local time");
  });

  // Anchor checks from docs/PRD.md §8.
  it("anchor: AP Seminar, AP Research, and AP CSP portfolio deadline is 2026-04-30", () => {
    for (const id of ["seminar", "research", "computer-science-principles"]) {
      expect(byId.get(id)?.portfolio?.deadline, id).toBe("2026-04-30");
    }
  });

  it("anchor: the three AP Art & Design portfolio deadlines are 2026-05-08", () => {
    for (const id of ["2-d-art-and-design", "3-d-art-and-design", "drawing"]) {
      const subject = byId.get(id);
      expect(subject?.portfolio?.deadline, id).toBe("2026-05-08");
      // Portfolio-only: no timed exam, no late-testing slot.
      expect(subject?.exam, id).toBeNull();
      expect(subject?.lateTesting, id).toBeNull();
    }
  });

  it("every subject with a regular exam also has a late-testing slot", () => {
    for (const subject of dataset.subjects) {
      if (subject.exam !== null) {
        expect(subject.lateTesting, subject.id).not.toBeNull();
      }
    }
  });

  it("exam is null only for portfolio-only subjects or sourced no-2026-exam courses", () => {
    const noExam = dataset.subjects.filter((s) => s.exam === null);
    expect(noExam.map((s) => s.id).sort()).toEqual([
      "2-d-art-and-design",
      "3-d-art-and-design",
      "business-with-personal-finance",
      "cybersecurity",
      "drawing",
      "research",
    ]);
    for (const subject of noExam) {
      const portfolioOnly = subject.portfolio !== null;
      const sourcedReason =
        subject.category === "Career Kickstart" &&
        typeof subject.noExamReason === "string";
      expect(portfolioOnly || sourcedReason, subject.id).toBe(true);
    }
  });

  it("spot-checks sourced calendar facts", () => {
    expect(byId.get("biology")?.exam).toEqual({
      date: "2026-05-04",
      session: "AM",
    });
    expect(byId.get("computer-science-a")?.exam).toEqual({
      date: "2026-05-15",
      session: "PM",
    });
    expect(byId.get("world-history-modern")?.lateTesting).toEqual({
      date: "2026-05-18",
      session: "AM",
    });
    expect(byId.get("psychology")?.lateTesting).toEqual({
      date: "2026-05-22",
      session: "PM",
    });
  });
});

describe("ap-2026.json — 2026 digital-redesign question-count corrections (issue #45, ported to sections[] by #44)", () => {
  const dataset = parseApDataset(raw);
  const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

  const sectionByName = (id: string, pattern: RegExp) =>
    byId.get(id)?.format.sections.find((s) => pattern.test(s.name));
  const MC = /multiple.?choice/i;
  const FR = /free.?response/i;

  // Pins the seven re-sourced counts (docs/super-board/research/collegeboard-2026/)
  // so a future re-source cannot silently regress them to the pre-redesign values.
  const CORRECTED: Record<string, { mcqCount: number; frqCount: number }> = {
    statistics: { mcqCount: 42, frqCount: 4 },
    "french-language-and-culture": { mcqCount: 55, frqCount: 3 },
    "german-language-and-culture": { mcqCount: 55, frqCount: 3 },
    "italian-language-and-culture": { mcqCount: 55, frqCount: 3 },
    "spanish-language-and-culture": { mcqCount: 55, frqCount: 3 },
    "chinese-language-and-culture": { mcqCount: 55, frqCount: 4 },
    "japanese-language-and-culture": { mcqCount: 55, frqCount: 4 },
  };

  it("pins the seven corrected MC/FR section counts as exact published integers", () => {
    for (const [id, counts] of Object.entries(CORRECTED)) {
      expect(
        sectionByName(id, MC)?.questionCount,
        `${id} multiple-choice section count`,
      ).toBe(counts.mcqCount);
      expect(
        sectionByName(id, FR)?.questionCount,
        `${id} free-response section count`,
      ).toBe(counts.frqCount);
    }
  });

  // Statistics' Section II composition IS published on both CB pages (AP Central
  // "Question 3: Inference (Hypothesis Test or Confidence Interval)" + three
  // multi-focus questions; AP Students the same as "multi-part" questions). It
  // was twice regressed to "pending"; pin it to a sourced composition so a
  // future re-source cannot re-introduce the false pending. (#44 carried the
  // flat frqType over as the free-response section's note.)
  it("pins statistics' free-response note to the sourced Section-II composition (never 'pending')", () => {
    const note = sectionByName("statistics", FR)?.note;
    expect(note).not.toBe("pending");
    expect(note).toMatch(/inference/i);
    expect(note).toMatch(/multi-part/i);
    // The redesigned exam dropped the investigative task — it must not reappear.
    expect(note).not.toMatch(/investigative/i);
  });

  it("no section or part stores its question count as a range string (all 2026 counts are published as fixed numbers)", () => {
    for (const subject of dataset.subjects) {
      for (const section of subject.format.sections) {
        const values: Array<[string, unknown]> = [
          [`section "${section.name}"`, section.questionCount],
          ...(section.parts ?? []).map(
            (p): [string, unknown] => [`part "${p.name}"`, p.questionCount],
          ),
        ];
        for (const [where, value] of values) {
          const isRange = typeof value === "string" && /–/.test(value);
          expect(isRange, `${subject.id} ${where} = ${String(value)}`).toBe(
            false,
          );
        }
      }
    }
  });

  // The six language exams' overall duration IS published — on the AP Students
  // assessment page's "Exam Duration" (AP Central omits the total; the two pages
  // are complementary). The first build wrongly wrote "pending" over four of
  // these; pin the published integers so the regression cannot recur.
  const PUBLISHED_LANGUAGE_TOTALS: Record<string, number> = {
    "french-language-and-culture": 150, // "Approximately 2hrs 30mins"
    "german-language-and-culture": 150, // "Approximately 2hrs 30mins"
    "italian-language-and-culture": 150, // "Approximately 2hrs 30mins"
    "spanish-language-and-culture": 150, // "Approximately 2hrs 30mins"
    "chinese-language-and-culture": 120, // "Approximately 2hrs"
    "japanese-language-and-culture": 120, // "Approximately 2hrs"
  };

  it("pins the six language-exam durations to their published AP Students totals", () => {
    for (const [id, minutes] of Object.entries(PUBLISHED_LANGUAGE_TOTALS)) {
      expect(byId.get(id)?.format.totalMinutes, `${id} totalMinutes`).toBe(
        minutes,
      );
    }
  });

  // Portfolio-only subjects have no sit-down exam and store 0. EVERY other
  // subject publishes an "Exam Duration" (verified against
  // docs/super-board/research/collegeboard-2026/ after commit 171cb15), so its
  // totalMinutes must be a positive number — never "pending", which would drop
  // the calendar block length (calendar.ts) and suppress the ICS DTEND (ics.ts).
  const PORTFOLIO_ONLY = new Set([
    "research",
    "drawing",
    "2-d-art-and-design",
    "3-d-art-and-design",
  ]);

  it("every sit-down subject stores a numeric published totalMinutes (none pending); portfolio subjects store 0", () => {
    for (const subject of dataset.subjects) {
      const total = subject.format.totalMinutes;
      if (PORTFOLIO_ONLY.has(subject.id)) {
        expect(total, `${subject.id} (portfolio-only)`).toBe(0);
      } else {
        expect(typeof total, `${subject.id} totalMinutes type`).toBe("number");
        expect(
          total as number,
          `${subject.id} totalMinutes`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("ap-2026.json negative cases (validation must fail on broken data)", () => {
  it("rejects a duplicate subject id", () => {
    const broken = clone();
    broken.subjects.push(structuredClone(broken.subjects[0]));
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const broken = clone();
    // @ts-expect-error deliberately breaking the entry
    delete broken.subjects[0].passRate;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a malformed exam date", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam!.date = "May 4, 2026";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an exam date outside the published 2026 regular windows", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam!.date = "2026-05-09"; // Saturday between the two weeks
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a late-testing date outside the published 2026 late window", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.lateTesting!.date = "2026-05-25";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an estimated-looking value where only pending is allowed", () => {
    const broken = clone();
    const cyber = broken.subjects.find((s) => s.id === "cybersecurity");
    // @ts-expect-error deliberately breaking the entry
    cyber!.passRate = "unknown";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a null exam without portfolio or sourced reason", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam = null;
    biology!.lateTesting = null;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown extra field (strict schema)", () => {
    const broken = clone();
    // @ts-expect-error deliberately breaking the entry
    broken.subjects[0].examFee = 99;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });
});
