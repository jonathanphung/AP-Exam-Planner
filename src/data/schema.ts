import { z } from "zod";

/**
 * Zod schema for the swappable AP exam dataset (`src/data/ap-2027.json`).
 *
 * The JSON file is the single annual swap point (PRD §8): when College Board
 * publishes the next May calendar, a new JSON file replaces this one and the
 * window constants below are the only schema edits normally required.
 *
 * Data rule (PRD §7.5/§8/§11): no value is estimated. Anything College Board
 * has not published is OMITTED, and the surfaces render it as the
 * not-published dash.
 *
 * ## Issue #84 (2026-07-25) — "pending" is gone, and the old reasoning is
 * kept here because it explains what replaced it
 *
 * Until this issue the schema had a third state: the literal string
 * `"pending"`, meaning "College Board publishes a number this capture does not
 * have". It was a real distinction — an accusation against OUR capture, not
 * against College Board — and #73 was explicit that it must not be conflated
 * with omission ("`undefined` means the concept does not apply, `"pending"`
 * means CB publishes a number this capture does not have").
 *
 * The distinction was sound; the 33 values wearing the badge were not. Each of
 * them was re-verified against the live College Board page on 2026-07-25 (the
 * per-value citations are in `src/data/sources.md` §"Issue #84"), and every
 * single one turned out to be something College Board does not publish at all:
 * no per-question duration for the world-language project speaking tasks, no
 * PPR score weight, no time allocation for AP Seminar's through-course
 * performance tasks or the AAS Individual Student Project, no AP Networking
 * exam page, no score distribution for three courses that have never been
 * administered. Nothing was a capture gap. So the state had no members left,
 * and an unreachable state is a trap for the next capture.
 *
 * What this means for a future annual swap: there is now ONE unpublished
 * state. If College Board prints a figure, it goes in the field with its
 * provenance; if it prints nothing, the field is omitted and the surfaces say
 * so. A capture that genuinely cannot reach a page must not invent a third
 * state to hide in — it must fail loudly (see the empty-format branch below,
 * which is self-describing rather than flag-driven) or block the swap.
 * `ap-2027.test.ts` asserts the shipped JSON contains no `"pending"` anywhere,
 * so re-introducing one is a red test, not a silent regression.
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
 * Question counts: an exact published number, or a published range (College
 * Board publishes e.g. "55–75" for AP Chinese MCQs). Omitted where the page
 * prints no count.
 */
const questionCount = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+–\d+$/, 'ranges use an en dash, e.g. "55–75"'),
]);

/**
 * Published durations: exact minutes, or a published range (College Board
 * prints "65–70 Minutes" for the language exams' free-response sections).
 * Omitted where the page prints no duration — see the issue #84 note above.
 */
const minutesValue = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+–\d+$/, 'ranges use an en dash, e.g. "65–70"'),
]);

/**
 * A published sub-part of an exam section (issue #44) — e.g. Calculus AB's
 * no-calculator vs. graphing-calculator halves, or the language exams'
 * Listening vs. Reading parts.
 *
 * `questionCount` is OMITTED when College Board prints no count for the part,
 * and `minutes` is omitted when it prints no length for the part. #73 had a
 * third state here — `"pending"` — for "a length exists but this capture does
 * not have it" (it named AP Psychology's AAQ/EBQ halves as the example);
 * issue #84 re-verified every such value against the live page, found none of
 * them published anywhere, and removed the state. AP Psychology prints only
 * Section II's 70 minutes and never divides it; that is omission, and it now
 * says so. `note` carries the page's calculator/tool rule or other printed
 * descriptor, verbatim — including the timings College Board prints as prose
 * rather than as a duration ("3 minutes to prepare; 3 minutes to present"),
 * which is why dashing the Length cell loses no published fact.
 *
 * PER-PART WEIGHTS (issue #73, storage rule unchanged) — the printed
 * denominator is part of the datum. College Board prints per-part weights
 * against THREE different denominators and the STORED value never converts
 * between them:
 *
 *   1. % of the EXAM score   "Part A: … (35% of score)"          calculus-bc
 *   2. % of the SECTION      "1 long free-response question       macroeconomics
 *                             (50% of section score)."
 *   3. % of another %        "50% of 20%"                         seminar
 *
 *   - `weightPercent` — a number ONLY when the printed denominator is the exam
 *     score (form 1). Rendered as `N%`.
 *   - `weightPrinted` — the printed weight VERBATIM for every other form
 *     ("50% of section score", "each worth 25% of section score",
 *     "50% of 20%").
 *   - Both omitted — College Board publishes no weight for this part; the
 *     surfaces render the not-published dash. This is the honest state for
 *     21 of the 38 sit-down subjects (AP Art History prints no per-question
 *     weight anywhere, and its Section II 50% is NEVER divided by six).
 *
 * The two fields are mutually exclusive: a part carries at most one, so no
 * caller ever has to decide which denominator won. Issue #83 kept that rule
 * rather than relaxing it — see below.
 *
 * ## Issue #83 (2026-07-25) — the RENDERED value is now exam-denominated
 *
 * #73's doc said a relative weight must reach the screen verbatim and be
 * "never converted into an exam-denominated number, which would tell a student
 * one AP Macroeconomics question is half their grade." That reasoning is kept
 * here on purpose, because it is still true of the thing it was about:
 * RELABELLING. Writing the literal `50` into `weightPercent` would claim one
 * FRQ is half the exam, and that is still forbidden — form 2 and form 3 still
 * may not be stored as a bare number.
 *
 * It never applied to MULTIPLYING. `50% of section score` where the section is
 * 33% of the exam genuinely IS 16.5% of the exam, and 16.5% is the number a
 * student wants. So the surfaces now do that arithmetic at render time
 * ({@link parsePrintedWeight} here for the grammar, `partWeight()` in
 * src/lib/exam-sections.ts for the multiplication).
 *
 * Doing it in the presentation layer — rather than rewriting the 11 affected
 * parts into `weightPercent` and relaxing the mutual-exclusion rule above — is
 * what preserves #73's audit trail: the verbatim College Board string stays
 * the stored datum, so `ap-2027.sections.test.ts` can still round-trip all 63
 * traced weights against the committed provenance, and the dataset JSON did
 * not change by a single byte for this issue.
 *
 * The exam denominator ALWAYS comes from the section's own stored
 * `weightPercent` (33 for the Macro/Micro FRQ section, 20/35/45 for Seminar's
 * three), never from a re-derived "true" figure: College Board prints 66/33
 * for Micro and Macro, which sums to 99, and part rows that sum to their own
 * section beat part rows that sum to a corrected 100.
 */
/**
 * What a `weightPrinted` string is denominated in (issue #83).
 *
 *   - `section` — "50% of section score": the denominator is the section this
 *     part hangs under, whatever that section's stored `weightPercent` says.
 *   - `nested`  — "50% of 20%": College Board spells the denominator out. The
 *     spelled-out figure and the section's stored weight must agree, which the
 *     section schema below enforces; the renderer still multiplies by the
 *     STORED one so there is exactly one source of truth.
 *   - `exam`    — "35% of score" / "43.75% of exam score": already
 *     exam-denominated, so the conversion is the identity. The dataset stores
 *     this form in `weightPercent` instead (`ap-2027.sections.test.ts` refuses
 *     it in `weightPrinted`), but the grammar covers it so the converter is
 *     total over everything College Board prints.
 */
export type PrintedWeightBase =
  | { of: "section" }
  | { of: "nested"; percent: number }
  | { of: "exam" };

/** A parsed {@link sectionPartSchema} `weightPrinted` string (issue #83). */
export interface PrintedWeight {
  /** The numerator College Board prints — 50 in "50% of section score". */
  percent: number;
  /** What that numerator is a percentage OF. */
  base: PrintedWeightBase;
  /**
   * True for "each worth 25% of section score" — the weight belongs to ONE
   * question of a multi-question row, not to the row. Callers must keep the
   * per-question qualifier visible: a bare number on a row whose Questions
   * cell reads 2 reads as the row total and is wrong.
   */
  each: boolean;
  /** The original string, verbatim — the provenance never leaves the datum. */
  text: string;
}

/**
 * The whole grammar of printed per-part weights, in one regex (issue #83).
 *
 * Deliberately strict: it matches the three forms College Board actually
 * prints and nothing else, so a future capture that introduces a fourth
 * ("half the section score", "50% of Part A") fails the section schema loudly
 * instead of being silently multiplied out into a wrong number.
 *
 * Positional groups, not named ones — this file compiles at the repo's ES2017
 * target, where named capture groups are a syntax error:
 *   [1] the optional "each worth " prefix   [2] the printed numerator
 *   [3] a spelled-out denominator ("of 20%")   [4] a worded denominator
 */
const PRINTED_WEIGHT_PATTERN =
  /^(each worth )?(\d+(?:\.\d+)?)% of (?:(\d+(?:\.\d+)?)%|(section score|exam score|score))$/;

/**
 * Parse a printed weight into its numerator + denominator, or `null` when the
 * string is not one of the published forms. Pure and total — never throws, so
 * a renderer can fall back to printing the string verbatim.
 */
export function parsePrintedWeight(printed: string): PrintedWeight | null {
  const match = PRINTED_WEIGHT_PATTERN.exec(printed.trim());
  if (!match) return null;
  const [, each, percent, nested, worded] = match;
  const base: PrintedWeightBase =
    nested !== undefined
      ? { of: "nested", percent: Number(nested) }
      : worded === "section score"
        ? { of: "section" }
        : { of: "exam" };
  return {
    percent: Number(percent),
    base,
    each: each !== undefined,
    text: printed,
  };
}

export const sectionPartSchema = z
  .strictObject({
    name: z.string().min(1),
    questionCount: questionCount.optional(),
    minutes: minutesValue.optional(),
    weightPercent: z.number().min(0).max(100).optional(),
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
export const examSectionSchema = z
  .strictObject({
    name: z.string().min(1),
    questionCount: questionCount.optional(),
    /**
     * Omitted where College Board prints no length for the section at all —
     * AP Seminar's two through-course performance tasks and the AP African
     * American Studies Individual Student Project, none of which has an
     * exam-day time allocation (issue #84).
     */
    minutes: minutesValue.optional(),
    weightPercent: z.number().min(0).max(100),
    note: z.string().min(1).optional(),
    parts: z.array(sectionPartSchema).min(2).optional(),
  })
  // Issue #83 — a printed part weight is only shippable if the renderer can
  // convert it. The three checks below are the "fail loudly" half of that
  // change: the surfaces multiply a relative weight by this section's stored
  // `weightPercent`, so anything the grammar cannot read, or that disagrees
  // with the section it hangs under, has to stop at the schema rather than
  // reach a student as a confidently wrong percentage.
  .superRefine((section, ctx) => {
    section.parts?.forEach((part, index) => {
      if (part.weightPrinted === undefined) return;
      const parsed = parsePrintedWeight(part.weightPrinted);
      if (parsed === null) {
        ctx.addIssue({
          code: "custom",
          path: ["parts", index, "weightPrinted"],
          message: `unrecognised printed weight ${JSON.stringify(part.weightPrinted)} — the published forms are "X% of section score", "X% of Y%" and "X% of exam score", optionally prefixed "each worth ". Teach parsePrintedWeight the new form before shipping it.`,
        });
        return;
      }
      if (
        parsed.base.of === "nested" &&
        parsed.base.percent !== section.weightPercent
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["parts", index, "weightPrinted"],
          message: `"${part.weightPrinted}" is denominated in ${parsed.base.percent}% but its section carries weightPercent ${section.weightPercent} — one of the two is a mis-capture, and the renderer multiplies by the section's value`,
        });
      }
      if (parsed.each && typeof part.questionCount !== "number") {
        ctx.addIssue({
          code: "custom",
          path: ["parts", index, "questionCount"],
          message: `"${part.weightPrinted}" is a per-question weight, so the row needs a published question count to multiply against`,
        });
      }
    });
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
  /**
   * All three are omitted together, and only when College Board publishes no
   * exam format for the subject at all — the AP Networking case below. There
   * is no partial state: a subject either has a published format or has none.
   */
  totalMinutes: z.number().int().min(0).optional(),
  calculator: z.boolean().optional(),
  delivery: z.enum(["digital", "paper", "hybrid"]).optional(),
});

/**
 * The THIRD format state (issue #87): a real exam whose format College Board
 * has not published at all.
 *
 * `format.sections.length === 0` was read as one thing until this issue —
 * "no sit-down exam", i.e. the four portfolio-only subjects — because those
 * four were the only members of the set when issue #44 wrote the rule. The
 * 2027 swap added AP Networking, which has a published May 7 date and an
 * empty `sections` for the opposite reason: `/courses/ap-networking/exam`
 * 404s, so there is nothing to publish yet. One boolean over `sections` cannot
 * tell those apart, and reading it as "portfolio-only" made the details dialog
 * drop the Exam length / Calculator / Delivery rows for a subject that has no
 * portfolio block to tell the story instead — three unpublished values
 * rendering as nothing at all, which is exactly what PRD §7.5 forbids.
 *
 * The discriminator is the data, not the id: this is the same condition the
 * superRefine below already enforced as the ONLY legal shape for an empty
 * `sections` under a non-null `exam`, lifted out so the schema rule and every
 * renderer read it from one place. A Networking-shaped `subject.id === "…"`
 * special case would have to be re-cut for each Career Kickstart course that
 * arrives in this state (the third pilot ends in 2026-27), and would silently
 * do the wrong thing for the one after that.
 *
 * Deliberately NOT `portfolio === null`: that reads the absence of one thing
 * as the presence of another. A subject can be exam-less and portfolio-less
 * (a listed course with a sourced `noExamReason`), and that subject has no
 * format rows to render either — `exam !== null` is what says "there is an
 * exam day to describe, and we cannot describe it".
 */
/**
 * The shape {@link hasUnpublishedFormat} reads, spelled out structurally
 * rather than as `Pick<ApSubject, "exam" | "format">`: `ApSubject` is inferred
 * FROM `subjectSchema`, whose own `superRefine` calls this function, so naming
 * it here would make the type circular.
 */
interface UnpublishedFormatProbe {
  exam: unknown;
  format: {
    sections: readonly unknown[];
    totalMinutes?: unknown;
    calculator?: unknown;
    delivery?: unknown;
  };
}
export function hasUnpublishedFormat(subject: UnpublishedFormatProbe): boolean {
  const { format } = subject;
  return (
    subject.exam !== null &&
    format.sections.length === 0 &&
    format.totalMinutes === undefined &&
    format.calculator === undefined &&
    format.delivery === undefined
  );
}

export const portfolioSchema = z.strictObject({
  deadline: isoDate,
  /**
   * Omitted where College Board publishes no separate score weight for the
   * portfolio component. True of all six world-language Personalized Project
   * Reference deadlines (issue #84): the PPR is the reference students use
   * for the two project speaking questions, which are scored inside the exam,
   * and no page prints a weight for the reference itself. `note` says so.
   */
  weightPct: z.number().min(0).max(100).optional(),
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
    /**
     * Percent scoring 3 or higher in the most recent published administration.
     * Omitted where College Board publishes no score distribution for the
     * subject.
     */
    passRate: z.number().min(0).max(100).optional(),
    /**
     * Why no score distribution is published (issue #84, AC4).
     *
     * The Pass rate ROW stays for every subject — deleting it to make a gap
     * disappear is what PRD §7.5's honest degradation forbids — and its cell
     * shows the not-published dash. On a course nobody has ever sat, though, a
     * bare dash reads as a bug in this app rather than as a fact about College
     * Board, so the three AP Career Kickstart courses carry the published
     * reason with them. Sourced from the AP Career Kickstart timeline
     * (docs/super-board/research/collegeboard-2027/pages/ap-career-kickstart.txt),
     * never editorial, and only ever allowed WITH an absent `passRate` — the
     * superRefine below refuses it next to a published number, so it can never
     * become a place to editorialize about a real figure.
     */
    passRateNote: z.string().min(1).optional(),
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
     *
     * Scope narrowed by issue #87: this field qualifies the DATE and nothing
     * else. It used to carry two more sentences explaining why AP Networking's
     * exam FORMAT is unpublished, which made the one note in the whole dataset
     * a 297-character paragraph on a catalog card — and put the explanation of
     * the details dialog's empty rows on a surface that shows no format at
     * all. That half moved to {@link subjectSchema.shape.formatNote}; the
     * superRefine below keeps this one tied to a real exam, because every
     * surface renders it against a printed date (the chip's Exam row, the
     * schedule row, the calendar block, the `.ics` DESCRIPTION).
     */
    examNote: z.string().min(1).optional(),
    /**
     * Why College Board publishes no exam format for this subject at all
     * (issue #87) — the sourced counterpart to {@link hasUnpublishedFormat}.
     *
     * Only meaningful in that state, and REQUIRED in it: the details dialog
     * renders this line where the section table would be, so without it the
     * dialog would present a bare "Exam format not published yet" heading over
     * three dashes and leave the reader to guess whether that is a fact about
     * College Board or a bug in this app. Same contract as `passRateNote` one
     * field up, and the superRefine below enforces both directions.
     */
    formatNote: z.string().min(1).optional(),
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

    if (subject.passRateNote !== undefined && subject.passRate !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["passRateNote"],
        message:
          "passRateNote explains an ABSENT pass rate; a subject with a published passRate must not carry one",
      });
    }

    // Issue #44: omission and "not yet published" are different states.
    // A portfolio-only subject has no sit-down exam, so it has no sections —
    // never an empty/zeroed section table.
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
    // absent too (AP Networking's May 2027 pilot administration, whose course
    // page does not exist yet — /courses/ap-networking/exam still 404s, live
    // re-checked 2026-07-25 for issue #84). A partially-filled format can
    // never reach the empty-sections branch, so "we have some data but no
    // rows" stays an error. Issue #87 lifted the condition itself into
    // {@link hasUnpublishedFormat} so the surfaces branch on the same rule
    // this check enforces, instead of re-deriving it from `sections` alone.
    const formatUnpublished = hasUnpublishedFormat(subject);
    if (
      subject.exam !== null &&
      subject.format.sections.length === 0 &&
      !formatUnpublished
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["format", "sections"],
        message:
          "subjects with a sit-down exam must carry at least one published section, unless College Board publishes no exam format at all (then every format field is omitted)",
      });
    }

    // Issue #87 — the unpublished-format state must say why, and only it may.
    if (formatUnpublished && subject.formatNote === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["formatNote"],
        message:
          "a subject whose exam format is entirely unpublished must carry a sourced formatNote — the details dialog renders it where the section table would be, and without it the dialog shows three dashes and no reason",
      });
    }
    if (subject.formatNote !== undefined && !formatUnpublished) {
      ctx.addIssue({
        code: "custom",
        path: ["formatNote"],
        message:
          "formatNote explains an ENTIRELY unpublished exam format; a subject with published sections or format fields must not carry one",
      });
    }

    // Issue #87 — examNote qualifies a printed exam date. Every surface that
    // renders it (chip Exam row, schedule row, calendar block, .ics) hangs it
    // off that date, so a note on an exam-less subject would silently vanish;
    // that subject explains itself with noExamReason instead.
    if (subject.examNote !== undefined && subject.exam === null) {
      ctx.addIssue({
        code: "custom",
        path: ["examNote"],
        message:
          "examNote qualifies a published exam date; a subject with no exam in this cycle uses noExamReason",
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
