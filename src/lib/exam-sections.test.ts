import { describe, expect, it } from "vitest";
import type { ExamSection, ExamSectionPart } from "@/data/schema";
import {
  partWeight,
  questionCountLabel,
  sectionsHavePartRows,
} from "./exam-sections";

/**
 * Issue #44 (Jon's PR #48 design bounce) — the hasParts branch rule.
 *
 * The InfoPanel renders the 4-column sections table ONLY when a section has
 * published part rows; otherwise every section becomes a spacious
 * metadata-style row. The rule is parts-based, never count-based: a
 * 5-section exam with no parts (AP African American Studies) must NOT get
 * the table.
 */

const section = (overrides: Partial<ExamSection> = {}): ExamSection => ({
  name: "Multiple Choice",
  questionCount: 60,
  minutes: 90,
  weightPercent: 50,
  ...overrides,
});

const parts: ExamSection["parts"] = [
  { name: "Part A", questionCount: 30, minutes: 60, note: "No calculator" },
  { name: "Part B", questionCount: 15, minutes: 45 },
];

describe("sectionsHavePartRows — the table-vs-rows branch rule", () => {
  it("is false for a portfolio-only subject (no sections at all)", () => {
    expect(sectionsHavePartRows([])).toBe(false);
  });

  it("is false for a plain two-section exam with no parts (AP Biology shape)", () => {
    expect(
      sectionsHavePartRows([section(), section({ name: "Free Response" })]),
    ).toBe(false);
  });

  it("is false for a MULTI-section exam with no parts — the rule is parts-based, not count-based (AAS shape, 5 sections)", () => {
    expect(
      sectionsHavePartRows([
        section({ name: "Section I: Multiple Choice" }),
        section({ name: "Section IB: Validation Question" }),
        section({ name: "Section II: Short-Answer Questions" }),
        section({ name: "Section II: Document-Based Question" }),
        section({ name: "Individual Student Project", minutes: "pending" }),
      ]),
    ).toBe(false);
  });

  it("is true when any section has a published part split (Calculus AB shape)", () => {
    expect(sectionsHavePartRows([section({ parts })])).toBe(true);
  });

  it("is true when only a later section has parts (World History: Modern shape)", () => {
    expect(
      sectionsHavePartRows([
        section({ name: "Section IA: Multiple Choice" }),
        section({ name: "Section IB: Short Answer" }),
        section({ name: "Section II: Free Response", parts }),
      ]),
    ).toBe(true);
  });
});

describe("questionCountLabel — singular/plural and verbatim ranges", () => {
  it("uses the singular for exactly one question", () => {
    expect(questionCountLabel(1)).toBe("1 question");
  });

  it("uses the plural for other counts", () => {
    expect(questionCountLabel(3)).toBe("3 questions");
    expect(questionCountLabel(60)).toBe("60 questions");
  });

  it("renders a published range verbatim, plural", () => {
    expect(questionCountLabel("55–75")).toBe("55–75 questions");
  });
});

/**
 * Issue #73 — the part weight cell, one denominator at a time.
 *
 * Before #73 every part row's weight cell was a hardcoded dash. The cell now
 * resolves through {@link partWeight}, and the ONLY thing these cases have to
 * prove is that the printed denominator survives: an exam-denominated number
 * stays a number, and everything else stays the printed string. No case may
 * produce a value the capture does not print.
 */
const part = (overrides: Partial<ExamSectionPart> = {}): ExamSectionPart => ({
  name: "Part A",
  questionCount: 29,
  minutes: 62,
  ...overrides,
});

describe("partWeight — three printed denominators, zero conversions", () => {
  it("keeps an EXAM-denominated weight as a number (Calculus BC Part A: '35% of score')", () => {
    expect(partWeight(part({ weightPercent: 35 }))).toEqual({
      kind: "percent",
      value: 35,
    });
  });

  it("keeps a fractional exam-denominated weight exactly as published (Precalculus '43.75% of exam score')", () => {
    // AP Central prints 43.75%; the AP Students block rounds it to
    // "approximately 44%". The exact figure is the one that ships.
    expect(partWeight(part({ weightPercent: 43.75 }))).toEqual({
      kind: "percent",
      value: 43.75,
    });
  });

  it("keeps a SECTION-denominated weight verbatim — never multiplied into an exam share (Macroeconomics '50% of section score')", () => {
    const macro = part({
      name: "Long free-response question",
      questionCount: 1,
      minutes: undefined,
      weightPrinted: "50% of section score",
    });
    const weight = partWeight(macro);
    expect(weight).toEqual({ kind: "printed", text: "50% of section score" });
    // Section II is 33% of the exam, so 50% of it is ~16.5% — a number this
    // app must never compute, print, or store. The string is the whole datum.
    expect(weight).not.toHaveProperty("value");
    expect(JSON.stringify(weight)).not.toContain("16.5");
  });

  it("keeps a NESTED weight verbatim (Seminar '50% of 20%')", () => {
    const weight = partWeight(
      part({
        name: "Individual research report (1,200 words)",
        questionCount: undefined,
        minutes: undefined,
        weightPrinted: "50% of 20%",
      }),
    );
    expect(weight).toEqual({ kind: "printed", text: "50% of 20%" });
    // 50% of 20% is 10% of the AP Seminar score — again, never multiplied out.
    expect(JSON.stringify(weight)).not.toContain("10%\"");
  });

  it("reports UNPUBLISHED when College Board prints no per-part weight (Art History's six essay questions)", () => {
    expect(
      partWeight(
        part({
          name: "Question 1: Long Essay–Comparison",
          questionCount: 1,
          minutes: undefined,
        }),
      ),
    ).toEqual({ kind: "unpublished" });
  });

  it("reports PENDING separately from unpublished — the two states never collapse", () => {
    expect(partWeight(part({ weightPercent: "pending" }))).toEqual({
      kind: "pending",
    });
  });

  it("prefers the exam-denominated number when a record somehow carries both (schema forbids it; renderers must still be total)", () => {
    expect(
      partWeight(
        part({ weightPercent: 25, weightPrinted: "50% of section score" }),
      ),
    ).toEqual({ kind: "percent", value: 25 });
  });
});
