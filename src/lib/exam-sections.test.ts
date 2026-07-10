import { describe, expect, it } from "vitest";
import type { ExamSection } from "@/data/schema";
import { questionCountLabel, sectionsHavePartRows } from "./exam-sections";

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
