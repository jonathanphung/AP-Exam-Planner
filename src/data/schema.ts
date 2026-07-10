import { z } from "zod";

/**
 * Zod schema for the swappable AP exam dataset (`src/data/ap-2026.json`).
 *
 * The JSON file is the single annual swap point (PRD §8): when College Board
 * publishes the May 2027 calendar, a new JSON file replaces this one and the
 * window constants below are the only schema edits required.
 *
 * Data rule (PRD §7.5/§8/§11): no value is estimated. Anything College Board
 * has not published is the literal string "pending".
 */

/** Published 2026 testing windows (College Board exam-date pages). */
export const REGULAR_WINDOWS: ReadonlyArray<{ start: string; end: string }> = [
  { start: "2026-05-04", end: "2026-05-08" },
  { start: "2026-05-11", end: "2026-05-15" },
];
export const LATE_TESTING_WINDOW = {
  start: "2026-05-18",
  end: "2026-05-22",
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
 * means a count exists but is not yet published. `note` carries the page's
 * calculator/tool rule or other printed descriptor, verbatim.
 */
export const sectionPartSchema = z.strictObject({
  name: z.string().min(1),
  questionCount: questionCount.optional(),
  minutes: minutesValue,
  note: z.string().min(1).optional(),
});

/**
 * One published exam section (issue #44): the single source of truth for the
 * per-section questions | length | weight breakdown. Section names are the
 * ones College Board actually titles ("Section IIB: Free Response: Sight
 * Singing"), never forced into an MCQ/FRQ mold. `parts` is present only when
 * the page publishes a Part A/Part B-style split. Values are populated from
 * the adversarially verified provenance in
 * docs/super-board/research/collegeboard-2026/ — never estimated, never
 * back-computed, never summed into aggregates the page does not print.
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
     * Only present when a listed course has no published May 2026 exam for a
     * sourced reason other than being portfolio-only (the two Career
     * Kickstart courses: first exam administration is May 2027).
     */
    noExamReason: z.string().min(1).optional(),
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
          message: `exam date ${subject.exam.date} is outside the published 2026 regular testing windows (May 4–8 and May 11–15)`,
        });
      }
      if (subject.lateTesting === null) {
        ctx.addIssue({
          code: "custom",
          path: ["lateTesting"],
          message:
            "every subject with a regular 2026 exam has a published late-testing slot",
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
        message: `late-testing date ${subject.lateTesting.date} is outside the published 2026 late-testing window (May 18–22)`,
      });
    }

    if (subject.exam === null && subject.portfolio === null && !subject.noExamReason) {
      ctx.addIssue({
        code: "custom",
        path: ["exam"],
        message:
          "exam may be null only for portfolio-only subjects, or with a sourced noExamReason (Career Kickstart courses whose first exam is May 2027)",
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
    // Every subject that sits a 2026 exam has a published section structure
    // (verified for all 38 in docs/super-board/research/collegeboard-2026/).
    if (subject.exam !== null && subject.format.sections.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["format", "sections"],
        message:
          "subjects with a sit-down exam must carry at least one published section",
      });
    }
  });

export const apDatasetSchema = z
  .strictObject({
    cycle: z.string().regex(/^May \d{4}$/, 'cycle looks like "May 2026"'),
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
