import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apDatasetSchema,
  parseApDataset,
  type ApDataset,
} from "./schema";

const raw: unknown = JSON.parse(
  readFileSync(join(__dirname, "ap-2027.json"), "utf-8"),
);

function clone(): ApDataset {
  return structuredClone(raw) as ApDataset;
}

describe("ap-2027.json dataset", () => {
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

  it("covers the full College Board course list (43 subjects) with unique ids", () => {
    // 42 in May 2026 + AP Networking, whose first (pilot-schools-only) exam
    // appears on the published May 2027 schedule. No 2026 course was removed
    // or renamed on College Board's 2027 course list.
    expect(dataset.subjects.length).toBe(43);
    expect(new Set(dataset.subjects.map((s) => s.id)).size).toBe(43);
  });

  it("carries May 2027 cycle metadata with published session start times", () => {
    expect(dataset.cycle).toBe("May 2027");
    expect(dataset.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.sessionStartTimes.AM).toBe("8 a.m. local time");
    expect(dataset.sessionStartTimes.PM).toBe("12 p.m. local time");
  });

  // Anchor checks from docs/PRD.md §8.
  it("anchor: AP Seminar, AP Research, and AP CSP portfolio deadline is 2027-04-30", () => {
    for (const id of ["seminar", "research", "computer-science-principles"]) {
      expect(byId.get(id)?.portfolio?.deadline, id).toBe("2027-04-30");
    }
  });

  // New for 2027: the six world-language courses that publish a Personalized
  // Project Reference deadline on their own AP Central exam page. AP Latin and
  // AP Spanish Literature publish none — they must NOT be given one by analogy.
  it("anchor: the six world-language PPR deadlines are 2027-04-30, and no others", () => {
    const PPR = [
      "chinese-language-and-culture",
      "french-language-and-culture",
      "german-language-and-culture",
      "italian-language-and-culture",
      "japanese-language-and-culture",
      "spanish-language-and-culture",
    ];
    for (const id of PPR) {
      expect(byId.get(id)?.portfolio?.deadline, id).toBe("2027-04-30");
      expect(byId.get(id)?.portfolio?.weightPct, id).toBe("pending");
      expect(byId.get(id)?.portfolio?.note, id).toMatch(
        /Personalized Project Reference/,
      );
    }
    for (const id of ["latin", "spanish-literature-and-culture"]) {
      expect(byId.get(id)?.portfolio, id).toBeNull();
    }
  });

  it("anchor: the three AP Art & Design portfolio deadlines are 2027-05-07", () => {
    for (const id of ["2-d-art-and-design", "3-d-art-and-design", "drawing"]) {
      const subject = byId.get(id);
      expect(subject?.portfolio?.deadline, id).toBe("2027-05-07");
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

  it("exam is null only for portfolio-only subjects (both Career Kickstart courses now sit a 2027 exam)", () => {
    const noExam = dataset.subjects.filter((s) => s.exam === null);
    expect(noExam.map((s) => s.id).sort()).toEqual([
      "2-d-art-and-design",
      "3-d-art-and-design",
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
    // AP Central "2027 AP Exam Dates" — Session 1 → AM, Session 2 → PM.
    expect(byId.get("biology")?.exam).toEqual({
      date: "2027-05-03",
      session: "PM",
    });
    expect(byId.get("computer-science-a")?.exam).toEqual({
      date: "2027-05-12",
      session: "PM",
    });
    expect(byId.get("world-history-modern")?.lateTesting).toEqual({
      date: "2027-05-18",
      session: "PM",
    });
    expect(byId.get("psychology")?.lateTesting).toEqual({
      date: "2027-05-21",
      session: "AM",
    });
  });

  it("both Career Kickstart 2026 no-exam courses now carry a published 2027 exam and drop noExamReason", () => {
    for (const id of ["business-with-personal-finance", "cybersecurity"]) {
      const subject = byId.get(id);
      expect(subject?.exam, id).not.toBeNull();
      expect(subject?.lateTesting, id).not.toBeNull();
      expect(subject?.noExamReason, id).toBeUndefined();
    }
    expect(byId.get("business-with-personal-finance")?.exam).toEqual({
      date: "2027-05-04",
      session: "AM",
    });
    expect(byId.get("cybersecurity")?.exam).toEqual({
      date: "2027-05-05",
      session: "AM",
    });
  });

  it("AP Networking carries its published pilot-only qualifier and an entirely pending format", () => {
    const networking = byId.get("networking");
    expect(networking?.exam).toEqual({ date: "2027-05-07", session: "PM" });
    expect(networking?.lateTesting).toEqual({
      date: "2027-05-17",
      session: "AM",
    });
    expect(networking?.examNote).toMatch(/pilot schools only/i);
    expect(networking?.format.sections).toEqual([]);
    expect(networking?.format.totalMinutes).toBe("pending");
    expect(networking?.passRate).toBe("pending");
  });

  it("no subject anywhere still carries a 2026 date", () => {
    for (const subject of dataset.subjects) {
      for (const [where, value] of [
        ["exam", subject.exam?.date],
        ["lateTesting", subject.lateTesting?.date],
        ["portfolio", subject.portfolio?.deadline],
      ] as const) {
        if (value !== undefined && value !== null) {
          expect(value.startsWith("2027-"), `${subject.id} ${where}`).toBe(true);
        }
      }
    }
  });
});

describe("ap-2027.json — 2026 digital-redesign question-count corrections (issue #45, ported to sections[] by #44)", () => {
  const dataset = parseApDataset(raw);
  const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

  const sectionByName = (id: string, pattern: RegExp) =>
    byId.get(id)?.format.sections.find((s) => pattern.test(s.name));
  const MC = /multiple.?choice/i;
  const FR = /free.?response/i;

  // Pins the seven re-sourced counts (docs/super-board/research/collegeboard-2027/)
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

  it("no section or part stores its question count as a range string (all 2027 counts are published as fixed numbers)", () => {
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

  it("pins the 2027 re-sourced maths/physics durations and counts", () => {
    // Verified 2026-07-24 against each course's AP Central exam page and the
    // AP Students "Exam Duration" — these are 2027 changes, not corrections.
    expect(byId.get("calculus-ab")?.format.totalMinutes).toBe(190);
    expect(byId.get("calculus-bc")?.format.totalMinutes).toBe(190);
    expect(byId.get("precalculus")?.format.totalMinutes).toBe(175);
    for (const id of [
      "physics-1",
      "physics-2",
      "physics-c-mechanics",
      "physics-c-electricity-and-magnetism",
    ]) {
      const sections = byId.get(id)?.format.sections ?? [];
      expect(sections.map((s) => [s.questionCount, s.minutes]), id).toEqual([
        [42, 85],
        [4, 95],
      ]);
      expect(byId.get(id)?.format.totalMinutes, id).toBe(180);
    }
  });

  it("pins the six language-exam durations to their published AP Students totals", () => {
    for (const [id, minutes] of Object.entries(PUBLISHED_LANGUAGE_TOTALS)) {
      expect(byId.get(id)?.format.totalMinutes, `${id} totalMinutes`).toBe(
        minutes,
      );
    }
  });

  // Portfolio-only subjects have no sit-down exam and store 0. EVERY other
  // subject publishes an "Exam Duration" (verified against
  // docs/super-board/research/collegeboard-2027/ after commit 171cb15), so its
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
      } else if (subject.id === "networking") {
        // No AP Central exam page exists for the 2026-27 pilot — "pending" is
        // the honest value, and the sections test pins that the whole format
        // block is pending rather than partially guessed.
        expect(total, "networking totalMinutes").toBe("pending");
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

describe("ap-2027.json negative cases (validation must fail on broken data)", () => {
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
    biology!.exam!.date = "May 3, 2027";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an exam date outside the published 2027 regular windows", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam!.date = "2027-05-08"; // Saturday between the two weeks
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a late-testing date outside the published 2027 late window", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.lateTesting!.date = "2027-05-24";
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
