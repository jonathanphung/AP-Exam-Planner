import type { ExamSectionPart } from "@/data/schema";

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
 * What a part row's weight cell should say (issue #73).
 *
 * College Board prints per-part weights against three different denominators
 * and this app never converts between them (see `sectionPartSchema`). Both
 * surfaces that render parts — the info-panel table and the .ics DESCRIPTION —
 * resolve the cell through this one function so they can never disagree about
 * which denominator won:
 *
 *   - `percent`     the printed denominator is the EXAM score; `value` is the
 *                   published number, ready to be suffixed with `%`.
 *   - `printed`     the printed denominator is anything else ("50% of section
 *                   score", "50% of 20%"); `text` is verbatim and must be
 *                   rendered as-is — never parsed, never multiplied out.
 *   - `pending`     College Board publishes a weight this capture does not
 *                   have; the caller shows its pending affordance.
 *   - `unpublished` College Board publishes no per-part weight at all (AP Art
 *                   History's six free-response questions); the caller shows
 *                   its not-published affordance. NOT the same as `pending`.
 */
export type PartWeight =
  | { kind: "percent"; value: number }
  | { kind: "printed"; text: string }
  | { kind: "pending" }
  | { kind: "unpublished" };

export function partWeight(part: ExamSectionPart): PartWeight {
  if (part.weightPercent === "pending") return { kind: "pending" };
  if (typeof part.weightPercent === "number") {
    return { kind: "percent", value: part.weightPercent };
  }
  if (part.weightPrinted !== undefined) {
    return { kind: "printed", text: part.weightPrinted };
  }
  return { kind: "unpublished" };
}
