import { describe, expect, it } from "vitest";
import type { ExamSectionPart } from "@/data/schema";
import { partWeight } from "./exam-sections";

/**
 * Two describe blocks that used to live here left with the layout they
 * described (Jon's #73 bounce — one presentation for every exam):
 *
 *   - "sectionsHavePartRows — the table-vs-rows branch rule" asserted that a
 *     partless exam must NOT get the table (issue #44 / Jon's PR #48 design
 *     bounce). Every exam gets the table now, so the rule it pinned no longer
 *     exists — keeping the block would have kept a helper alive purely to be
 *     tested. The runtime replacement is an e2e contract, not a unit one:
 *     `e2e/issue-73-one-presentation.spec.ts` walks all 38 sit-down subjects
 *     and fails if any renders something other than the table.
 *   - "questionCountLabel — singular/plural and verbatim ranges" pinned the
 *     prose block's "1 question" / "55–75 questions" phrasing; the table's
 *     Questions column is a bare number under its own column header.
 *
 * Both are in `git show 741a900:src/lib/exam-sections.test.ts` if a future
 * layout brings the helpers back.
 */

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
