import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  examSectionSchema,
  parseApDataset,
  type ExamSection,
  type ExamSectionPart,
} from "./schema";
import { partWeight } from "../lib/exam-sections";

/**
 * Issue #83 — the part-weight cell, converted to an exam share.
 *
 * #73 gave every part row the weight College Board prints and, where the
 * printed denominator was not the exam, printed the phrase verbatim: the AP
 * Microeconomics card spent four wrapped lines saying `50% of section score` /
 * `each worth 25% of section score`. #83 does the arithmetic instead — 50% of
 * a section worth 33% of the exam is 16.5% of the exam.
 *
 * The conversion happens at RENDER time (`partWeight()`), not in the dataset:
 * `ap-2027.json` is byte-identical across this change, so `sources.md` and
 * `ap-2027.sections.test.ts` still trace all 63 published weights back to the
 * committed captures. This suite is the other half of that bargain — it proves
 * what the change did and, more importantly, what it did NOT do:
 *
 *   - exactly 11 part rows change, and each changes to the value the ticket
 *     specifies (the diff table below IS issue #83's scope table);
 *   - the other 65 part rows — 52 already exam-denominated plus 13 with no
 *     published weight — render the same bytes they rendered before;
 *   - every converted section's parts sum back to that section's own weight;
 *   - a printed form the converter cannot read is a schema error, never a
 *     silently wrong number.
 */

const dataset = parseApDataset(
  JSON.parse(readFileSync(join(__dirname, "ap-2027.json"), "utf-8")),
);

interface PartRow {
  subject: string;
  section: string;
  part: string;
  sectionWeight: ExamSection["weightPercent"];
  record: ExamSectionPart;
}

const PART_ROWS: PartRow[] = dataset.subjects.flatMap((subject) =>
  subject.format.sections.flatMap((section) =>
    (section.parts ?? []).map((record) => ({
      subject: subject.id,
      section: section.name,
      part: record.name,
      sectionWeight: section.weightPercent,
      record,
    })),
  ),
);

/**
 * The Weight cell as #73 rendered it — the rule this issue supersedes,
 * re-implemented here so "unchanged" can be checked rather than asserted.
 * `PartWeightValue`'s branches, flattened to text: `35%`, the verbatim
 * printed phrase, the not-published dash. (#73 had a fourth, the pending
 * badge; issue #84 retired it — no part row in the dataset ever reached it.)
 */
function cellBefore(part: ExamSectionPart): string {
  if (typeof part.weightPercent === "number") return `${part.weightPercent}%`;
  if (part.weightPrinted !== undefined) return part.weightPrinted;
  return "—";
}

/** The same cell as #83 renders it, through the shipped helper. */
function cellAfter(
  part: ExamSectionPart,
  sectionWeight: ExamSection["weightPercent"],
): string {
  const weight = partWeight(part, sectionWeight);
  switch (weight.kind) {
    case "percent":
      return `${weight.value}%${weight.each ? " each" : ""}`;
    case "printed":
      return weight.text;
    case "unpublished":
      return "—";
  }
}

describe("issue #83 — which part rows change, and to what", () => {
  const changed = PART_ROWS.filter(
    (row) =>
      cellBefore(row.record) !== cellAfter(row.record, row.sectionWeight),
  );

  it("changes exactly the 11 rows the ticket scopes, to exactly the ticket's values", () => {
    expect(
      changed.map((row) => [
        row.subject,
        row.part,
        cellBefore(row.record),
        cellAfter(row.record, row.sectionWeight),
      ]),
    ).toEqual([
      // subject | part | before | after
      [
        "macroeconomics",
        "Long free-response question",
        "50% of section score",
        "16.5%",
      ],
      [
        "macroeconomics",
        "Short free-response questions",
        "each worth 25% of section score",
        "8.25% each",
      ],
      [
        "microeconomics",
        "Long free-response question",
        "50% of section score",
        "16.5%",
      ],
      [
        "microeconomics",
        "Short free-response questions",
        "each worth 25% of section score",
        "8.25% each",
      ],
      ["seminar", "Individual research report (1,200 words)", "50% of 20%", "10%"],
      [
        "seminar",
        "Team multimedia presentation and defense (8–10 minutes, plus defense questions)",
        "50% of 20%",
        "10%",
      ],
      [
        "seminar",
        "Individual written argument (2,000 words)",
        "70% of 35%",
        "24.5%",
      ],
      [
        "seminar",
        "Individual multimedia presentation (6–8 minutes)",
        "20% of 35%",
        "7%",
      ],
      [
        "seminar",
        "Oral defense (2 questions from the teacher)",
        "10% of 35%",
        "3.5%",
      ],
      [
        "seminar",
        "Understanding and analyzing an argument (3 short-answer questions)",
        "30% of 45%",
        "13.5%",
      ],
      [
        "seminar",
        "Evidence-Based argument essay (1 long essay)",
        "70% of 45%",
        "31.5%",
      ],
    ]);
  });

  it("touches exactly three subjects", () => {
    expect([...new Set(changed.map((row) => row.subject))]).toEqual([
      "macroeconomics",
      "microeconomics",
      "seminar",
    ]);
  });

  it("AC6 — every other part row is byte-identical, checked cell by cell", () => {
    const unchanged = PART_ROWS.filter((row) => !changed.includes(row));
    // 52 already exam-denominated + 13 with no published weight. Pinned so a
    // future capture cannot quietly shrink the population this proof covers.
    expect(unchanged).toHaveLength(65);
    expect(
      unchanged
        .filter(
          (row) =>
            cellBefore(row.record) !== cellAfter(row.record, row.sectionWeight),
        )
        .map((row) => `${row.subject} · ${row.part}`),
    ).toEqual([]);
  });

  it("AC6 — none of the 52 exam-denominated weights is re-scaled by its section", () => {
    const examDenominated = PART_ROWS.filter(
      (row) => typeof row.record.weightPercent === "number",
    );
    expect(examDenominated).toHaveLength(52);
    for (const row of examDenominated) {
      expect(
        partWeight(row.record, row.sectionWeight),
        `${row.subject} · ${row.part}`,
      ).toEqual({ kind: "percent", value: row.record.weightPercent, each: false });
    }
  });

  it("no cell renders float noise or a trailing zero (AC2)", () => {
    for (const row of PART_ROWS) {
      const cell = cellAfter(row.record, row.sectionWeight);
      expect(cell, `${row.subject} · ${row.part}`).not.toMatch(
        /\d\.\d{3,}|\.\d*0(?!\d)%/,
      );
    }
  });
});

/**
 * AC8 — the reconciliation that makes the conversion safe to look at.
 *
 * Each converted section's part rows must add back up to that section's own
 * published weight: Macro/Micro Section II is 16.5 + 8.25 + 8.25 = 33, AP
 * Seminar's three components are 10 + 10 = 20, 24.5 + 7 + 3.5 = 35 and
 * 13.5 + 31.5 = 45. This is why the denominator is the section's STORED
 * weight and never a re-derived "true" figure — College Board prints 66/33
 * for Micro and Macro, which sums to 99, and a "corrected" 33.33 would leave
 * every part row failing to reconcile with the section printed above it.
 */
describe("AC8 — converted parts sum to their section's published weight", () => {
  const converted = dataset.subjects.flatMap((subject) =>
    subject.format.sections
      .filter(
        (section) =>
          section.parts !== undefined &&
          section.parts.every((part) => part.weightPrinted !== undefined),
      )
      .map((section) => ({ subject: subject.id, section })),
  );

  it("finds the five converted sections (the test cannot pass vacuously)", () => {
    expect(converted.map((c) => `${c.subject} · ${c.section.name}`)).toEqual([
      "macroeconomics · Section II: Free Response",
      "microeconomics · Section II: Free Response",
      "seminar · Performance Task 1: Team Project and Presentation",
      "seminar · Performance Task 2: Individual Research-Based Essay and Presentation",
      "seminar · End-of-Course Exam",
    ]);
  });

  it.each(converted.map((c) => [`${c.subject} · ${c.section.name}`, c.section]))(
    "%s",
    (_label, section: ExamSection) => {
      const total = (section.parts ?? []).reduce((sum, part) => {
        const weight = partWeight(part, section.weightPercent);
        expect(
          weight.kind,
          `${part.name} must convert to an exam share`,
        ).toBe("percent");
        if (weight.kind !== "percent") return sum;
        // A per-question weight is worth its value ONCE PER QUESTION — the
        // whole reason the rendered cell keeps saying "each".
        const questions =
          weight.each && typeof part.questionCount === "number"
            ? part.questionCount
            : 1;
        return sum + weight.value * questions;
      }, 0);
      expect(Math.round(total * 100) / 100).toBe(section.weightPercent);
    },
  );
});

/**
 * AC4 — the loud-failure half. The converter multiplies by a section weight,
 * so a printed form it cannot read, or one that disagrees with the section it
 * hangs under, has to stop at the schema rather than reach a student as a
 * confidently wrong percentage.
 */
describe("AC4 — a printed weight the converter cannot trust is a schema error", () => {
  const section = (parts: unknown[], weightPercent: unknown = 33) => ({
    name: "Section II: Free Response",
    minutes: 60,
    weightPercent,
    parts,
  });

  it("accepts the three published forms", () => {
    expect(
      examSectionSchema.safeParse(
        section([
          { name: "Long free-response question", questionCount: 1, weightPrinted: "50% of section score" },
          { name: "Short free-response questions", questionCount: 2, weightPrinted: "each worth 25% of section score" },
        ]),
      ).success,
    ).toBe(true);
    expect(
      examSectionSchema.safeParse(
        section(
          [
            { name: "Individual research report", weightPrinted: "50% of 20%" },
            { name: "Team presentation", weightPrinted: "50% of 20%" },
          ],
          20,
        ),
      ).success,
    ).toBe(true);
  });

  it("rejects a form the grammar does not know", () => {
    const result = examSectionSchema.safeParse(
      section([
        { name: "A", weightPrinted: "half of the section score" },
        { name: "B", weightPrinted: "50% of section score" },
      ]),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "unrecognised printed weight",
    );
  });

  it("rejects a nested weight whose denominator disagrees with its section", () => {
    // "50% of 20%" under a section the dataset says is worth 35%: one of the
    // two is a mis-capture and the renderer would silently pick the section.
    const result = examSectionSchema.safeParse(
      section(
        [
          { name: "A", weightPrinted: "50% of 20%" },
          { name: "B", weightPrinted: "50% of 20%" },
        ],
        35,
      ),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "but its section carries weightPercent 35",
    );
  });

  it("rejects a per-question weight on a row with no published question count", () => {
    const result = examSectionSchema.safeParse(
      section([
        { name: "A", weightPrinted: "each worth 25% of section score" },
        { name: "B", weightPrinted: "50% of section score" },
      ]),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "needs a published question count",
    );
  });
});
