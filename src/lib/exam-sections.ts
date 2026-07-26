import {
  parsePrintedWeight,
  type ExamSection,
  type ExamSectionPart,
} from "../data/schema";

/**
 * Presentation helpers for the exam-details section breakdown.
 *
 * ## Presentation history — read before re-introducing a second layout
 *
 * There is now exactly ONE presentation: every exam with at least one
 * published section renders the `section | questions | length | weight`
 * table, with part rows nested under their section where parts exist and
 * simply absent where they don't. That is deliberate, and it is the *second*
 * answer this app has given:
 *
 *   1. Issue #44 shipped the table for every exam.
 *   2. Jon's PR #48 design bounce (pass 2, "no table, no column header")
 *      replaced it for partless exams with a spacious two-line block per
 *      section, tuned again in his post-merge "9px matched" spacing
 *      follow-up (2026-07-10). The branch was parts-based, never
 *      count-based, and lived here as `sectionsHavePartRows`.
 *   3. Jon's #73 bounce (2026-07-25) **supersedes #48**: the split meant AP
 *      Human Geography and AP English Language presented nothing like AP
 *      Calculus BC even though every number the table needs is published for
 *      them — which is the exact inconsistency issue #73 exists to remove.
 *      The prose block and its branch rule are gone.
 *
 *   4. Jon's SECOND #73 bounce (2026-07-25) kept the one presentation and
 *      fixed how it allocates width: the shared table now budgets its columns
 *      with a `<colgroup>` under `table-fixed` instead of letting the browser
 *      negotiate them from cell content, because a long `section.note` was
 *      winning that negotiation and crushing Questions / Length / Weight into
 *      a strip at the right edge. See the "Column budget" section of the
 *      `SectionsTable` doc in src/components/InfoPanel.tsx — that is a
 *      presentation decision too, and it is a property of the shared
 *      component, never of one subject's data.
 *
 * The prose block was chosen once, on purpose, and then replaced on purpose.
 * Anyone reinstating a second layout is re-opening a decision Jon has now
 * made twice, not fixing an oversight.
 *
 * Two helpers left with the prose block rather than lingering as tested-but
 * -uncalled code: `sectionsHavePartRows` (the branch rule itself — the branch
 * no longer exists) and `questionCountLabel` ("60 questions" / the singular
 * "1 question" — the table's Questions column is a bare number under its own
 * column header, so the word never appears). Both are recoverable from
 * `git show 741a900:src/lib/exam-sections.ts` if a future layout wants them.
 *
 * What remains is pure so the weight rules stay unit-testable
 * (src/lib/exam-sections.test.ts).
 */

/**
 * What a part row's weight cell should say (issue #73, converted by #83).
 *
 * Both surfaces that render parts — the info-panel table and the .ics
 * DESCRIPTION — resolve the cell through this one function so they can never
 * disagree about what a part is worth:
 *
 *   - `percent`     the part's share OF THE EXAM, ready to be suffixed with
 *                   `%`. `each` marks the value as per-question rather than
 *                   per-row (see below) — callers MUST keep that qualifier
 *                   visible.
 *   - `printed`     the fallback: College Board printed a weight in a form
 *                   this app cannot convert, so the string ships verbatim
 *                   rather than as a guess. Unreachable for the shipped
 *                   dataset — `examSectionSchema` rejects an unparseable form
 *                   and every section carries a published weight to multiply
 *                   by — but the renderers stay total.
 *   - `unpublished` College Board publishes no per-part weight at all (AP Art
 *                   History's six free-response questions); the caller shows
 *                   its not-published affordance.
 *
 * A fourth kind, `pending`, existed until issue #84 for "College Board
 * publishes a weight this capture does not have". No part in the dataset ever
 * reached it once the 33 pending values were re-verified — they were all
 * genuinely unpublished — and the schema no longer has a state that could
 * produce it, so it is gone rather than left as an unreachable branch every
 * renderer has to keep a case for.
 *
 * ## Why this multiplies now, when #73 said never (issue #83, 2026-07-25)
 *
 * #73 shipped `printed` as the normal outcome for the 11 parts College Board
 * weights relatively, on the reasoning that "50% of section score" must not
 * become an exam-denominated 50 — which would tell a student one AP
 * Macroeconomics free-response question is half their grade. That reasoning
 * stands, and the dataset still obeys it: nothing back-computes a stored
 * value, and `weightPercent` still means "College Board printed this against
 * the exam".
 *
 * It was about RELABELLING, though, not about arithmetic. Jon's #83 read of
 * the AP Microeconomics card — where the Weight column spent four wrapped
 * lines saying `50% of section score` / `each worth 25% of section score` —
 * is that the conversion is exactly what a student is trying to do in their
 * head: Section II is 33% of the exam, so the long FRQ is 16.5% of it. So the
 * multiplication happens HERE, once, at the point of display, from the
 * section's own stored weight.
 *
 * Two properties make that safe, and both are pinned by tests:
 *   - the denominator is the section's STORED `weightPercent`, so every part
 *     of a section sums exactly back to that section (16.5 + 8.25 + 8.25 = 33)
 *     — see `src/data/ap-2027.sections.test.ts`;
 *   - `each` survives the conversion, so a 2-question row still says its
 *     8.25% is per question.
 */
export type PartWeight =
  | { kind: "percent"; value: number; each: boolean }
  | { kind: "printed"; text: string }
  | { kind: "unpublished" };

/**
 * Two decimal places (AC2) — `70% of 35%` is 24.5, not 24.499999999999996.
 * Integers first (`70 * 35 / 100`) keeps all 11 shipped values exact anyway;
 * the rounding is the guard for a future non-integer capture.
 */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @param part                  the part row being rendered
 * @param sectionWeightPercent  the STORED weight of the section this part
 *                              hangs under — the denominator a relative weight
 *                              is multiplied by. Never a re-derived figure:
 *                              College Board prints 66/33 for Micro and Macro
 *                              (which sums to 99) and part rows that reconcile
 *                              with their own section beat rows that reconcile
 *                              with a corrected 100.
 */
export function partWeight(
  part: ExamSectionPart,
  sectionWeightPercent: ExamSection["weightPercent"],
): PartWeight {
  if (typeof part.weightPercent === "number") {
    return { kind: "percent", value: part.weightPercent, each: false };
  }
  if (part.weightPrinted !== undefined) {
    const printed = parsePrintedWeight(part.weightPrinted);
    // An exam-denominated string is already the answer; anything else is a
    // share of this section.
    const denominator =
      printed === null
        ? undefined
        : printed.base.of === "exam"
          ? 100
          : sectionWeightPercent;
    if (printed !== null && typeof denominator === "number") {
      return {
        kind: "percent",
        value: roundToCents((printed.percent * denominator) / 100),
        each: printed.each,
      };
    }
    return { kind: "printed", text: part.weightPrinted };
  }
  return { kind: "unpublished" };
}

/**
 * A whole-minute duration split into the groups it may wrap between (Jon's
 * second #73 bounce, 2026-07-25).
 *
 * `["1 h", "30 min"]` for 90, `["3 h"]` for 180, `["50 min"]` for 50 —
 * joined with a single space this is exactly the string the info panel and
 * the calendar popup have always printed ("2 h 45 min" / "3 h" / "50 min").
 * It is split rather than formatted because the Length column now has a
 * width budget: the caller renders each group `whitespace-nowrap`, making the
 * space BETWEEN groups the only place the value can break. Without that, a
 * narrow column breaks a duration wherever it runs out of room ("1 h 30" /
 * "min"), which reads as a different number for a moment.
 *
 * Grouping is a presentation concern, not a data one — nothing here rounds,
 * sums or converts; 90 in the dataset is still 90 on screen.
 */
export function minuteGroups(total: number): string[] {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return [`${minutes} min`];
  if (minutes === 0) return [`${hours} h`];
  return [`${hours} h`, `${minutes} min`];
}
