import type { ApSubject } from "../data/schema";

/**
 * Pure helpers for the inverted conflict prompt (issue #101).
 *
 * The prompt's red actions read "Move {subject} to late testing" — each click
 * marks THAT subject as moving to its own published late-testing slot. The
 * persisted model stays keeper-based (`SlotResolution.keeperId`, localStorage
 * `apx.resolutions.v1` — see `conflicts.ts`), so the UI's moving-set has to be
 * translated into a keeper: the resolution is recordable exactly when every
 * member but one has been marked as moving, and that last remaining member is
 * the keeper.
 *
 * - Two-member conflict: one "Move A" click leaves exactly B remaining, so a
 *   single click yields `keeperId: B` — the same `SlotResolution` the old
 *   "Keep B" button recorded.
 * - N ≥ 3 members (PRD §7.4 edge case): clicks accumulate one at a time; the
 *   keeper only exists once N-1 members are moving. Until then the translation
 *   returns null and nothing may be persisted.
 *
 * Everything here is pure so the translation is unit-testable without the
 * dialog (`conflict-moves.test.ts`, `pnpm test:unit`).
 *
 * Issue #109 adds the membership guard: an in-progress moving-set belongs to
 * the exact set of members it was built against, so {@link conflictMembersKey}
 * lets the dialog tell "same collision" from "different collision in the same
 * slot" and drop a set that no longer applies.
 */

/**
 * Identity of a conflict's MEMBERSHIP, independent of member order (issue #109).
 *
 * Both hosts key `ConflictDialog` by the slot alone (`slotKey`), so a catalog
 * selection change that adds or removes a member of an already-mounted
 * collision keeps the same component instance — and with it the in-progress
 * N≥3 moving-set. That set was built for a different member list: replaying it
 * against the new one could leave every remaining member marked as moving,
 * i.e. a prompt with zero Move buttons and no recordable keeper (the inline
 * dead-end this helper exists to prevent).
 *
 * The dialog stores this key alongside the moving-set and treats a mismatch as
 * "start over": the set is dropped and every member is offered a Move button
 * again. Sorted, so a pure re-ordering of the same members is NOT a change and
 * does not throw away the student's in-progress clicks. Ids are kebab-case
 * (`schema.ts`) and can never contain the `|` separator, so distinct
 * memberships can never collide on one key.
 */
export function conflictMembersKey(memberIds: readonly string[]): string {
  return [...memberIds].sort().join("|");
}

/**
 * The members of a conflict group that can actually be moved — i.e. have a
 * published late-testing slot to move to. Members without one get no Move
 * button (they can only stay at the regular time while the others move).
 *
 * The shipped dataset cannot produce such a member (the schema requires a
 * late-testing slot for every subject with a regular exam), so this guard
 * exists for `"pending"`-era data only.
 */
export function movableMemberIds(
  memberIds: readonly string[],
  subjectsById: ReadonlyMap<string, Pick<ApSubject, "lateTesting">>,
): string[] {
  return memberIds.filter((id) => subjectsById.get(id)?.lateTesting != null);
}

/**
 * Translate a moving-set into the keeper the persisted model needs.
 *
 * Returns the id of the single member NOT marked as moving when exactly one
 * remains — that member is the `keeperId` to record. Returns null while the
 * selection is still in progress (two or more members remain) or degenerate
 * (every member somehow marked as moving), in which case nothing must be
 * persisted.
 */
export function keeperAfterMoves(
  memberIds: readonly string[],
  movingIds: ReadonlySet<string>,
): string | null {
  const remaining = memberIds.filter((id) => !movingIds.has(id));
  return remaining.length === 1 ? remaining[0] : null;
}
