import { describe, expect, it } from "vitest";
import { parsePrintedWeight, type ExamSectionPart } from "../data/schema";
import { minuteGroups, partWeight } from "./exam-sections";

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
 * Issue #73 → #83 — the part weight cell, now exam-denominated.
 *
 * Before #73 every part row's weight cell was a hardcoded dash. #73 gave it
 * the printed value and these cases pinned the rule that a relative weight
 * ("50% of section score") reached the screen verbatim and was never
 * multiplied out — the fear being that an exam-denominated 50 would tell a
 * student one AP Macroeconomics question is half their grade.
 *
 * Issue #83 replaces the outcome, not the fear. The forbidden move was
 * relabelling the printed 50; multiplying by the section's own 33 gives 16.5,
 * which is true and is the number the student was after. So the cases below
 * assert the arithmetic AND the things that must not change with it: the
 * denominator is the section's STORED weight, `each` survives, and a form the
 * converter cannot read still ships verbatim rather than as a guess.
 */
const part = (overrides: Partial<ExamSectionPart> = {}): ExamSectionPart => ({
  name: "Part A",
  questionCount: 29,
  minutes: 62,
  ...overrides,
});

describe("parsePrintedWeight — the published grammar, and nothing else", () => {
  it("reads a section-denominated weight", () => {
    expect(parsePrintedWeight("50% of section score")).toEqual({
      percent: 50,
      base: { of: "section" },
      each: false,
      text: "50% of section score",
    });
  });

  it("reads the per-question form and flags it", () => {
    expect(parsePrintedWeight("each worth 25% of section score")).toEqual({
      percent: 25,
      base: { of: "section" },
      each: true,
      text: "each worth 25% of section score",
    });
  });

  it("reads a nested weight and keeps the spelled-out denominator", () => {
    expect(parsePrintedWeight("70% of 35%")).toEqual({
      percent: 70,
      base: { of: "nested", percent: 35 },
      each: false,
      text: "70% of 35%",
    });
  });

  it("reads both exam-denominated phrasings (the dataset stores these in weightPercent; the grammar still covers them)", () => {
    expect(parsePrintedWeight("35% of score")?.base).toEqual({ of: "exam" });
    expect(parsePrintedWeight("43.75% of exam score")).toEqual({
      percent: 43.75,
      base: { of: "exam" },
      each: false,
      text: "43.75% of exam score",
    });
  });

  it("returns null for anything else — a fourth form must be taught, not guessed", () => {
    for (const unknown of [
      "half of the section score",
      "50% of Part A",
      "50 % of section score",
      "50% of section",
      "roughly 50% of section score",
      "",
    ]) {
      expect(parsePrintedWeight(unknown), unknown).toBeNull();
    }
  });
});

describe("partWeight — every published denominator, resolved to the exam", () => {
  it("keeps an EXAM-denominated weight as a number (Calculus BC Part A: '35% of score')", () => {
    expect(partWeight(part({ weightPercent: 35 }), 50)).toEqual({
      kind: "percent",
      value: 35,
      each: false,
    });
  });

  it("keeps a fractional exam-denominated weight exactly as published (Precalculus '43.75% of exam score')", () => {
    // AP Central prints 43.75%; the AP Students block rounds it to
    // "approximately 44%". The exact figure is the one that ships.
    expect(partWeight(part({ weightPercent: 43.75 }), 62.5)).toEqual({
      kind: "percent",
      value: 43.75,
      each: false,
    });
  });

  it("multiplies a SECTION-denominated weight by the section's stored share (Macroeconomics '50% of section score' × 33)", () => {
    const macro = part({
      name: "Long free-response question",
      questionCount: 1,
      minutes: undefined,
      weightPrinted: "50% of section score",
    });
    expect(partWeight(macro, 33)).toEqual({
      kind: "percent",
      value: 16.5,
      each: false,
    });
  });

  it("marks a per-question weight as `each` — 8.25% is what ONE of the two short FRQs is worth", () => {
    const shortFrqs = part({
      name: "Short free-response questions",
      questionCount: 2,
      minutes: undefined,
      weightPrinted: "each worth 25% of section score",
    });
    expect(partWeight(shortFrqs, 33)).toEqual({
      kind: "percent",
      value: 8.25,
      each: true,
    });
  });

  it("multiplies a NESTED weight by the STORED section weight, not the spelled-out one (they must agree; the schema enforces it)", () => {
    const report = part({
      name: "Individual research report (1,200 words)",
      questionCount: undefined,
      minutes: undefined,
      weightPrinted: "50% of 20%",
    });
    expect(partWeight(report, 20)).toEqual({
      kind: "percent",
      value: 10,
      each: false,
    });
    // The section's value is the one that wins: feed a different section
    // weight and the answer follows it, which is why the schema refuses a
    // nested string whose denominator disagrees with its section.
    expect(partWeight(report, 40)).toEqual({
      kind: "percent",
      value: 20,
      each: false,
    });
  });

  it("rounds to 2 decimal places and never renders float noise (AC2)", () => {
    // 0.7 * 35 is 24.499999999999996 in IEEE-754 doubles.
    const value = (printed: string, section: number) => {
      const weight = partWeight(part({ weightPrinted: printed }), section);
      return weight.kind === "percent" ? weight.value : weight;
    };
    expect(value("70% of 35%", 35)).toBe(24.5);
    expect(value("20% of 35%", 35)).toBe(7);
    expect(value("10% of 35%", 35)).toBe(3.5);
    expect(value("30% of 45%", 45)).toBe(13.5);
    expect(value("70% of 45%", 45)).toBe(31.5);
    // Rendered as `${value}%`, so a clean number prints without trailing
    // zeros: "10%", never "10.00%".
    expect(`${value("50% of 20%", 20)}%`).toBe("10%");
    expect(`${value("50% of section score", 33)}%`).toBe("16.5%");
  });

  it("leaves an exam-denominated PRINTED string alone — 'of exam score' is already the answer (AC4)", () => {
    expect(
      partWeight(part({ weightPrinted: "43.75% of exam score" }), 62.5),
    ).toEqual({ kind: "percent", value: 43.75, each: false });
  });

  it("falls back to the verbatim string when the section's own weight is unpublished — nothing to multiply by", () => {
    expect(
      partWeight(part({ weightPrinted: "50% of section score" }), "pending"),
    ).toEqual({ kind: "printed", text: "50% of section score" });
  });

  it("falls back to the verbatim string on a form the grammar cannot read (the schema rejects it first; renderers must still be total)", () => {
    expect(partWeight(part({ weightPrinted: "half the section" }), 33)).toEqual(
      { kind: "printed", text: "half the section" },
    );
  });

  it("reports UNPUBLISHED when College Board prints no per-part weight (Art History's six essay questions)", () => {
    expect(
      partWeight(
        part({
          name: "Question 1: Long Essay–Comparison",
          questionCount: 1,
          minutes: undefined,
        }),
        50,
      ),
    ).toEqual({ kind: "unpublished" });
  });

  it("reports PENDING separately from unpublished — the two states never collapse", () => {
    expect(partWeight(part({ weightPercent: "pending" }), 50)).toEqual({
      kind: "pending",
    });
  });

  it("prefers the exam-denominated number when a record somehow carries both (schema forbids it; renderers must still be total)", () => {
    expect(
      partWeight(
        part({ weightPercent: 25, weightPrinted: "50% of section score" }),
        33,
      ),
    ).toEqual({ kind: "percent", value: 25, each: false });
  });
});

/**
 * Jon's second #73 bounce — the Length column is budgeted now, so a duration
 * can wrap. These cases pin the two halves of that: the groups are the only
 * places it may break, and joining them reproduces the exact string this app
 * has printed since issue #6 (nothing here may quietly re-format a duration
 * while making it wrappable).
 */
describe("minuteGroups — a duration breaks between its units, never inside one", () => {
  it("splits hours from minutes (90 -> '1 h' + '30 min')", () => {
    expect(minuteGroups(90)).toEqual(["1 h", "30 min"]);
  });

  it("keeps a whole-hour duration in one group — nothing to break (180)", () => {
    expect(minuteGroups(180)).toEqual(["3 h"]);
  });

  it("keeps a sub-hour duration in one group (50)", () => {
    expect(minuteGroups(50)).toEqual(["50 min"]);
  });

  it("never splits a unit from its number", () => {
    for (const total of [45, 50, 60, 62, 90, 105, 165, 195]) {
      for (const group of minuteGroups(total)) {
        expect(group, `"${group}" must carry its own unit`).toMatch(
          /^\d+ (h|min)$/,
        );
      }
    }
  });

  it("joins back to the string the panel has always printed", () => {
    const printed = (total: number) => minuteGroups(total).join(" ");
    expect(printed(90)).toBe("1 h 30 min");
    expect(printed(165)).toBe("2 h 45 min");
    expect(printed(180)).toBe("3 h");
    expect(printed(50)).toBe("50 min");
    expect(printed(60)).toBe("1 h");
  });
});
