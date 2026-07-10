import type { ExamSection } from "@/data/schema";

/**
 * Presentation rules for the exam-details section breakdown (issue #44,
 * partless-layout revision from Jon's PR #48 design bounce).
 *
 * Exams WITHOUT published Part A/B splits looked cramped as a 4-column
 * table — thin rows under a column header, numbers right-aligned across wide
 * empty gutters, visibly denser than the airy metadata rows ("Exam length",
 * "Calculator", …) directly below. The InfoPanel therefore branches on
 * *parts*, never on section count:
 *
 *   - ANY section has `parts`  → the questions | length | weight table with
 *     nested part rows, completely unchanged;
 *   - NO section has parts     → no table, no column header: one spacious
 *     two-line block per section (bounce pass 2 — name line + muted
 *     left-aligned stats line that wraps only between `·`-separated stat
 *     phrases), so a 5-section exam like AP African American Studies gets
 *     five blocks, not the table.
 *
 * These are pure functions so the branch rule and the singular/plural label
 * stay unit-testable (src/lib/exam-sections.test.ts).
 */

/** True when any published section carries a Part A/B-style split. */
export function sectionsHavePartRows(
  sections: readonly ExamSection[],
): boolean {
  return sections.some((section) => (section.parts?.length ?? 0) > 0);
}

/**
 * "1 question" / "60 questions" / "55–75 questions".
 *
 * Accepts an exact published count or a published range (ranges render
 * verbatim and are always plural). "pending" never reaches here — the caller
 * renders the pending badge in the slot instead (PRD §7.5 honest
 * degradation).
 */
export function questionCountLabel(count: number | string): string {
  return count === 1 ? "1 question" : `${count} questions`;
}
