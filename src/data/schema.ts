import { z } from "zod";

/**
 * Zod schema for the swappable AP exam dataset (`src/data/ap-2027.json`).
 *
 * The JSON file is the single annual swap point (PRD §8): when College Board
 * publishes the next May calendar, a new JSON file replaces this one and the
 * window constants below are the only schema edits normally required.
 *
 * Data rule (PRD §7.5/§8/§11): no value is estimated. Anything College Board
 * has not published is the literal string "pending".
 */

/**
 * Published 2027 testing windows (AP Central "2027 AP Exam Dates":
 * "The 2027 AP Exams will be administered in schools over two weeks in May:
 * May 3–7 and May 10–14.").
 */
export const REGULAR_WINDOWS: ReadonlyArray<{ start: string; end: string }> = [
  { start: "2027-05-03", end: "2027-05-07" },
  { start: "2027-05-10", end: "2027-05-14" },
];
/**
 * Published 2027 late-testing window (AP Central "2027 AP Exam Late-Testing
 * Dates": Monday, May 17 – Friday, May 21, 2027).
 */
export const LATE_TESTING_WINDOW = {
  start: "2027-05-17",
  end: "2027-05-21",
} as const;

export const CATEGORIES = [
  "STEM",
  "Humanities",
  "Languages",
  "Arts",
  "Career Kickstart",
] as const;

const pending = z.literal("pending");

/** Calendar date as an ISO-8601 string; compared lexicographically. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO-8601 calendar date (YYYY-MM-DD)")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), {
    message: "must be a real calendar date",
  });

const sessionSchema = z.enum(["AM", "PM"]);

const examSlotSchema = z.strictObject({
  date: isoDate,
  session: sessionSchema,
});

/**
 * Question counts: an exact published number, a published range (College
 * Board publishes e.g. "55–75" for AP Chinese MCQs), or "pending".
 */
const questionCount = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+–\d+$/, 'ranges use an en dash, e.g. "55–75"'),
  pending,
]);

/**
 * Published durations: exact minutes, a published range (College Board prints
 * "65–70 Minutes" for the language exams' free-response sections), or
 * "pending" when the page prints no duration for a section that has one.
 */
const minutesValue = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+–\d+$/, 'ranges use an en dash, e.g. "65–70"'),
  pending,
]);

/**
 * A published sub-part of an exam section (issue #44) — e.g. Calculus AB's
 * no-calculator vs. graphing-calculator halves, or the language exams'
 * Listening vs. Reading parts.
 *
 * `questionCount` is OMITTED (not "pending") when College Board prints no
 * count for the part — omission means the concept does not apply; "pending"
 * means a count exists but is not yet published. `minutes` follows the same
 * three-state rule (issue #73): omitted where the page prints no length for
 * the part at all (AP Art History's six free-response questions, AP Seminar's
 * research report), "pending" where a length exists but the capture does not
 * print it (AP Psychology's AAQ/EBQ halves of a 70-minute section). `note`
 * carries the page's calculator/tool rule or other printed descriptor,
 * verbatim.
 *
 * PER-PART WEIGHTS (issue #73) — the printed denominator is part of the datum.
 * College Board prints per-part weights against THREE different denominators
 * and the app must never convert between them:
 *
 *   1. % of the EXAM score   "Part A: … (35% of score)"          calculus-bc
 *   2. % of the SECTION      "1 long free-response question       macroeconomics
 *                             (50% of section score)."
 *   3. % of another %        "50% of 20%"                         seminar
 *
 * AP Macroeconomics' long free-response question is 50% *of Section II*, and
 * Section II is 33% of the exam. Writing `50` into an exam-denominated field
 * would tell a student one question is half their grade. Multiplying to
 * "16.5% of exam score" is the back-computation this file forbids below.
 * Therefore:
 *
 *   - `weightPercent` — a number ONLY when the printed denominator is the exam
 *     score (form 1). Rendered as `N%`.
 *   - `weightPrinted` — the printed weight VERBATIM for every other form
 *     ("50% of section score", "each worth 25% of section score",
 *     "50% of 20%"). Rendered as-is, never parsed into arithmetic.
 *   - Both omitted — College Board publishes no weight for this part; the
 *     surfaces render the not-published dash. This is the honest state for
 *     21 of the 38 sit-down subjects (AP Art History prints no per-question
 *     weight anywhere, and its Section II 50% is NEVER divided by six).
 *
 * The two fields are mutually exclusive: a part carries at most one, so no
 * caller ever has to decide which denominator won.
 */
export const sectionPartSchema = z
  .strictObject({
    name: z.string().min(1),
    questionCount: questionCount.optional(),
    minutes: minutesValue.optional(),
    weightPercent: z.union([z.number().min(0).max(100), pending]).optional(),
    weightPrinted: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .superRefine((part, ctx) => {
    if (part.weightPercent !== undefined && part.weightPrinted !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["weightPrinted"],
        message:
          "a part carries at most one weight field: weightPercent (exam-denominated) OR weightPrinted (verbatim, any other denominator)",
      });
    }
  });

/**
 * One published exam section (issue #44): the single source of truth for the
 * per-section questions | length | weight breakdown. Section names are the
 * ones College Board actually titles ("Section IIB: Free Response: Sight
 * Singing"), never forced into an MCQ/FRQ mold — and they carry College
 * Board's printed `Section <roman>:` prefix verbatim (issue #73, decision D2:
 * AP Central's Roman numbering wins over the AP Students block's Arabic
 * "Section 1:", because AP Central is this repo's structure source; see
 * sources.md). `parts` is present only when the page publishes a Part A/Part
 * B-style split or a printed per-question breakdown. Values are populated from
 * the adversarially verified provenance for the SHIPPED cycle —
 * docs/super-board/research/collegeboard-2027/ — never estimated, never
 * back-computed, never summed into aggregates the page does not print, and
 * (issue #73) never converted from one printed weight denominator to another —
 * see {@link sectionPartSchema}. Where the dataset would otherwise have had to
 * sum two published questions into one merged row, the questions are kept as
 * the separate rows College Board prints instead (AP Japanese Questions 3 and
 * 4 are 7.5% each; the joint "30 minutes to complete both writing tasks" lives
 * in each row's note, and neither the weights nor the minutes are combined).
 * (The sibling collegeboard-2026/ folder is the superseded prior cycle, kept only
 * as the audit trail for how May 2026 values were sourced; seven subjects'
 * sections changed in the 2027 swap, so a 2027 value must be verified against
 * the 2027 folder.)
 */
export const examSectionSchema = z.strictObject({
  name: z.string().min(1),
  questionCount: questionCount.optional(),
  minutes: minutesValue,
  weightPercent: z.union([z.number().min(0).max(100), pending]),
  note: z.string().min(1).optional(),
  parts: z.array(sectionPartSchema).min(2).optional(),
});

export const formatSchema = z.strictObject({
  /**
   * Ordered, published exam sections (issue #44). Replaces the flat
   * mcqCount/frqCount/frqType fields: an exam that lacks a section simply
   * omits it (AP Seminar has no multiple-choice entry), and a portfolio-only
   * subject (AP Drawing, 2-D/3-D Art and Design, AP Research) has NO
   * sections at all — an empty array, never zeroed rows.
   */
  sections: z.array(examSectionSchema),
  totalMinutes: z.union([z.number().int().min(0), pending]),
  calculator: z.union([z.boolean(), pending]),
  delivery: z.union([z.enum(["digital", "paper", "hybrid"]), pending]),
});

export const portfolioSchema = z.strictObject({
  deadline: isoDate,
  weightPct: z.union([z.number().min(0).max(100), pending]),
  note: z.string().min(1),
});

export const subjectSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
    name: z.string().min(1),
    category: z.enum(CATEGORIES),
    exam: examSlotSchema.nullable(),
    lateTesting: examSlotSchema.nullable(),
    format: formatSchema,
    passRate: z.union([z.number().min(0).max(100), pending]),
    portfolio: portfolioSchema.nullable(),
    /**
     * Only present when a listed course has no published exam in this cycle
     * for a sourced reason other than being portfolio-only. Empty for May
     * 2027 — both Career Kickstart courses that were exam-less in 2026 now
     * sit a May 2027 exam.
     */
    noExamReason: z.string().min(1).optional(),
    /**
     * A published qualifier College Board attaches to this subject's exam
     * that has no other home in the schema — e.g. AP Networking's May 2027
     * exam, which the published schedule restricts to "2026-27 pilot schools
     * only". Verbatim-sourced, never editorial.
     */
    examNote: z.string().min(1).optional(),
  })
  .superRefine((subject, ctx) => {
    const inWindow = (
      date: string,
      windows: ReadonlyArray<{ start: string; end: string }>,
    ) => windows.some((w) => date >= w.start && date <= w.end);

    if (subject.exam !== null) {
      if (!inWindow(subject.exam.date, REGULAR_WINDOWS)) {
        ctx.addIssue({
          code: "custom",
          path: ["exam", "date"],
          message: `exam date ${subject.exam.date} is outside the published 2027 regular testing windows (May 3–7 and May 10–14)`,
        });
      }
      if (subject.lateTesting === null) {
        ctx.addIssue({
          code: "custom",
          path: ["lateTesting"],
          message:
            "every subject with a regular 2027 exam has a published late-testing slot",
        });
      }
    }

    if (
      subject.lateTesting !== null &&
      !inWindow(subject.lateTesting.date, [LATE_TESTING_WINDOW])
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["lateTesting", "date"],
        message: `late-testing date ${subject.lateTesting.date} is outside the published 2027 late-testing window (May 17–21)`,
      });
    }

    if (subject.exam === null && subject.portfolio === null && !subject.noExamReason) {
      ctx.addIssue({
        code: "custom",
        path: ["exam"],
        message:
          "exam may be null only for portfolio-only subjects, or with a sourced noExamReason",
      });
    }

    // Issue #44: omission and "not yet published" are different states.
    // A portfolio-only subject has no sit-down exam, so it has no sections —
    // never an empty/zeroed section table, and never "pending" rows.
    const portfolioOnly = subject.exam === null && subject.portfolio !== null;
    if (portfolioOnly && subject.format.sections.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["format", "sections"],
        message:
          "portfolio-only subjects (no sit-down exam) must have no sections",
      });
    }
    // A subject that sits an exam carries its published section structure —
    // UNLESS College Board publishes no exam format for it at all. That state
    // is self-describing rather than a new flag: every other format field is
    // "pending" too (AP Networking's May 2027 pilot administration, whose
    // course page does not exist yet). A partially-filled format can never
    // reach the empty-sections branch, so "we have some data but no rows"
    // stays an error.
    const noPublishedFormat =
      subject.format.totalMinutes === "pending" &&
      subject.format.delivery === "pending" &&
      subject.format.calculator === "pending";
    if (
      subject.exam !== null &&
      subject.format.sections.length === 0 &&
      !noPublishedFormat
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["format", "sections"],
        message:
          "subjects with a sit-down exam must carry at least one published section, unless College Board publishes no exam format at all (then every format field is \"pending\")",
      });
    }
  });

export const apDatasetSchema = z
  .strictObject({
    cycle: z.string().regex(/^May \d{4}$/, 'cycle looks like "May 2027"'),
    lastVerified: isoDate,
    sessionStartTimes: z.strictObject({
      AM: z.string().min(1),
      PM: z.string().min(1),
    }),
    subjects: z.array(subjectSchema).min(1),
  })
  .superRefine((dataset, ctx) => {
    const seen = new Map<string, number>();
    dataset.subjects.forEach((subject, index) => {
      const firstIndex = seen.get(subject.id);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["subjects", index, "id"],
          message: `duplicate subject id "${subject.id}" (first seen at index ${firstIndex})`,
        });
      } else {
        seen.set(subject.id, index);
      }
    });
  });

export type ApDataset = z.infer<typeof apDatasetSchema>;
export type ApSubject = z.infer<typeof subjectSchema>;
export type ExamSlot = z.infer<typeof examSlotSchema>;
export type ExamFormat = z.infer<typeof formatSchema>;
export type ExamSection = z.infer<typeof examSectionSchema>;
export type ExamSectionPart = z.infer<typeof sectionPartSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Category = (typeof CATEGORIES)[number];
export type Session = z.infer<typeof sessionSchema>;

/** Parse unknown JSON into a validated dataset (throws on invalid data). */
export function parseApDataset(data: unknown): ApDataset {
  return apDatasetSchema.parse(data);
}
