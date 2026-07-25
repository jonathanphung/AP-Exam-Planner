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
