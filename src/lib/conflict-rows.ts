import type { ApSubject, Category, ExamSlot } from "../data/schema";
import { movableMemberIds } from "./conflict-moves";
import { formatDateLabel } from "./schedule";

/**
 * The conflict prompt's action stack, as pure data (issue #111).
 *
 * Issue #101 gave every member of a same-slot collision a red "Move {subject}
 * to late testing" button, and previewed where each button would send its
 * exam in a bullet list above them. Issue #111 folds the two together: the
 * bullet list is gone and every member renders exactly ONE element in a single
 * stack, carrying its own destination on a second line. Three kinds:
 *
 *   - `move`        — the actionable red button (subject has a late slot and
 *                     has not been clicked yet).
 *   - `moving`      — the N≥3 one-at-a-time indicator that replaces the button
 *                     after it is clicked. Keeps the destination line so a row
 *                     does not lose its slot info the moment it is chosen.
 *   - `no-late-slot`— the inert, non-button row for a member with no published
 *                     late-testing slot: it can only stay at the regular time.
 *                     Defensive only — the shipped dataset's schema requires a
 *                     late-testing slot for every subject with a regular exam
 *                     (see `movableMemberIds`), so this row is unreachable in
 *                     the app and is pinned by unit tests instead.
 *
 * Kept out of `ConflictDialog.tsx` (PROJECT.md: `src/lib/` is pure and
 * unit-testable, components stay dumb) so the row kinds and the destination
 * copy can be verified without a browser — including the `no-late-slot` case,
 * which no browser fixture can reach. The moving-set → keeper translation
 * stays where it was, in `conflict-moves.ts`; nothing here is persisted.
 */

/** Shared fields every row carries, enough to render `<SubjectName />`. */
interface ConflictRowBase {
  subjectId: string;
  /** Visible subject name (dataset name, or the id if the lookup misses). */
  name: string;
  /** Only used for `SubjectName`'s fallback emoji when the id is unmapped. */
  category?: Category;
}

export type ConflictActionRow =
  | (ConflictRowBase & {
      kind: "move" | "moving";
      /** "Friday, May 21, 2027 · AM session" — where this exam lands. */
      destination: string;
    })
  | (ConflictRowBase & { kind: "no-late-slot" });

/**
 * The destination line for a member's Move button / moving indicator.
 *
 * Always derived from the subject's own `lateTesting` slot and formatted with
 * the shared {@link formatDateLabel}, so the prompt can never drift from the
 * date the schedule, calendar and ICS export show (issue #111 AC3: no
 * hand-written date or session text anywhere in the conflict UI).
 */
export function lateTestingDestination(late: ExamSlot): string {
  return `${formatDateLabel(late.date)} · ${late.session} session`;
}

/**
 * Build one row per conflict member, in the group's own member order.
 *
 * `movingIds` is the in-progress N≥3 moving-set held by the dialog; a member
 * in it renders as `moving` instead of `move`. Membership of the movable set
 * is delegated to `movableMemberIds` so "has somewhere to move to" is decided
 * in exactly one place.
 */
export function conflictActionRows(
  memberIds: readonly string[],
  subjectsById: ReadonlyMap<
    string,
    Pick<ApSubject, "name" | "category" | "lateTesting">
  >,
  movingIds: ReadonlySet<string>,
): ConflictActionRow[] {
  const movable = new Set(movableMemberIds(memberIds, subjectsById));

  return memberIds.map((id) => {
    const subject = subjectsById.get(id);
    const base: ConflictRowBase = {
      subjectId: id,
      name: subject?.name ?? id,
      category: subject?.category,
    };
    const late = subject?.lateTesting;
    if (!movable.has(id) || !late) return { ...base, kind: "no-late-slot" };
    return {
      ...base,
      kind: movingIds.has(id) ? "moving" : "move",
      destination: lateTestingDestination(late),
    };
  });
}
