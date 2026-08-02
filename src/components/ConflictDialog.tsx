"use client";

import { useId, useRef, useState } from "react";
import type { ApSubject } from "@/data/schema";
import type { ConflictGroup } from "@/lib/conflicts";
import { conflictMembersKey, keeperAfterMoves } from "@/lib/conflict-moves";
import { conflictActionRows } from "@/lib/conflict-rows";
import { formatDateLabel } from "@/lib/schedule";
import { useModalDialog } from "@/lib/modal";
import { SubjectName } from "@/components/SubjectName";

/**
 * Conflict prompt (issue #5) with modal-dialog hardening (issue #8), the
 * inverted red actions (issue #101) and the merged action stack (issue #111):
 * shown for every same-slot exam collision that has no valid stored resolution
 * yet. Names every involved subject and the shared slot, and asks which
 * exam(s) the student will MOVE to late testing.
 *
 * Every member of the collision renders exactly ONE element in a single stack
 * (issue #111 replaced the separate destination bullet list): a two-line red
 * button whose primary line reads "Move {subject} to late testing" and whose
 * second line names that subject's own published late-testing slot, so the
 * destination is ON the action instead of previewed above it and no slot is
 * stated twice. The remaining exam stays at the regular time. Row kinds and
 * the destination copy come from the pure `conflictActionRows`
 * (`src/lib/conflict-rows.ts`) — including the inert "no published
 * late-testing slot" row, which the shipped dataset cannot produce.
 *
 * The persisted model is unchanged and keeper-based (issue #101 decision:
 * translate INSIDE the dialog): the `onKeep` callback still receives the id
 * of the ONE subject that stays at the regular time, so both hosts keep
 * recording the exact same `SlotResolution` (`apx.resolutions.v1`) as before.
 * The dialog derives that keeper from the Move clicks via the pure
 * `keeperAfterMoves` helper (`src/lib/conflict-moves.ts`):
 *
 *   - two members — one click fully resolves: "Move A" leaves exactly B, so
 *     `onKeep(B)` fires immediately.
 *   - N ≥ 3 members (PRD §7.4 edge case) — one click cannot resolve the whole
 *     group, so subjects move one at a time: each clicked subject's button is
 *     replaced by a "Moving … to late testing" indicator (which keeps the same
 *     destination line, so the row never loses its slot info) and the prompt
 *     stays open. When exactly one subject remains it becomes the keeper and
 *     `onKeep` fires through the same pathway. The in-progress moving-set is
 *     component state only — dismissing the modal midway discards it (nothing
 *     is persisted) and the conflict stays unresolved.
 *
 * The moving-set is scoped to the MEMBERSHIP it was built against (issue
 * #109). Both hosts key this component by `slotKey` alone, so a catalog
 * selection change that adds or drops a member of an already-mounted collision
 * re-renders the SAME instance with a different `group.subjectIds`. Replaying
 * a stale set against the new membership could mark every remaining member as
 * moving, leaving the inline prompt with zero Move buttons and no recordable
 * keeper — a dead end (nothing was ever persisted, but the student had no way
 * to finish). So the set is stored with a `conflictMembersKey` and is used
 * only while that key still matches: a membership change restarts the flow
 * with every Move button offered again. Deriving it (rather than remounting on
 * a membership-aware key) keeps `dismissed` intact, so shrinking a collision
 * never re-raises a modal the student already dismissed.
 *
 * Two presentation states share the same prompt body (and the same
 * `data-testid="conflict-prompt"` contract from issue #5's QA suite):
 *
 *   - modal — a true dialog: focus is trapped inside, Escape (or the close
 *     button / backdrop) dismisses it, and focus returns to the invoker.
 *     ScheduleView marks the FIRST unresolved conflict as the modal candidate
 *     so a new collision interrupts accessibly, one dialog at a time.
 *   - inline — the issue-#5 section on the schedule. Dismissing the modal
 *     never discards a RECORDED choice: the same prompt (with its Move
 *     buttons, any partial moving-set reset) stays available inline until the
 *     student resolves it. Conflicts are a planning aid, not a forced gate
 *     (issue #5 AC5: no forced resolution).
 *
 * Dismissal is component state keyed by the conflict's slot (ScheduleView
 * keys instances by `slotKey`): when a conflict disappears its dialog
 * unmounts, so re-creating the same collision later mounts fresh and prompts
 * again — mirroring the resolution-pruning rule (issue #5 AC3).
 */

export const COORDINATOR_NOTE =
  "This is a planning choice — the actual late-testing swap is arranged through your school's AP coordinator.";

/** "A and B" / "A, B, and C" */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export interface ConflictDialogProps {
  /** The unresolved same-slot conflict to prompt for. */
  group: ConflictGroup;
  /** Subject lookup for names + late-testing slots. */
  subjectsById: ReadonlyMap<string, ApSubject>;
  /**
   * Called with the id of the ONE subject that stays at the regular time,
   * once every other member has been marked to move (issue #101: the dialog
   * translates "Move {subject} to late testing" clicks into this keeper-based
   * callback, so hosts record the same `SlotResolution` as always).
   */
  onKeep: (keeperId: string) => void;
  /**
   * True for the first unresolved conflict on the schedule: renders as a
   * modal dialog (focus-trapped, Escape-dismissable) until dismissed.
   */
  modalCandidate: boolean;
  /**
   * Notified when the modal presentation is dismissed (Escape / close /
   * backdrop). Hosts that mount the dialog on demand (the calendar view's
   * click-a-conflicted-event flow, issue #19) unmount it here instead of
   * leaving the inline fallback behind; ScheduleView omits it and keeps the
   * issue-#5 inline behavior unchanged.
   */
  onDismiss?: () => void;
}

interface ConflictBodyProps {
  group: ConflictGroup;
  subjectsById: ReadonlyMap<string, ApSubject>;
  /** Subjects marked as moving in the in-progress N≥3 flow (issue #101). */
  movingIds: ReadonlySet<string>;
  /** Marks one subject as moving to its published late-testing slot. */
  onMove: (movedId: string) => void;
  headingId: string;
}

/** The shared prompt body — identical markup in modal and inline states. */
function ConflictBody({
  group,
  subjectsById,
  movingIds,
  onMove,
  headingId,
}: ConflictBodyProps) {
  const names = group.subjectIds.map((id) => subjectsById.get(id)?.name ?? id);
  const slotLabel = `${formatDateLabel(group.slot.date)} (${group.slot.session} session)`;
  // One row per member, each carrying its own late-testing destination
  // (issue #111). A member with no published late-testing slot comes back as
  // an inert `no-late-slot` row instead of a Move button.
  const rows = conflictActionRows(group.subjectIds, subjectsById, movingIds);

  return (
    <section
      role="group"
      aria-labelledby={headingId}
      data-testid="conflict-prompt"
      className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-500/50 dark:bg-red-950/40"
    >
      <h3
        id={headingId}
        className="pr-10 text-sm font-bold uppercase tracking-wide text-red-900 sm:pr-8 dark:text-red-100"
      >
        <span aria-hidden="true">⚠️ </span>
        Exam time conflict
      </h3>

      <p className="mt-2 text-sm text-red-900 dark:text-red-100">
        {nameList(names)} are {names.length > 2 ? "all" : "both"} scheduled
        for {slotLabel}. Which exam{names.length > 2 ? "s" : ""} will you move
        to late testing? The remaining exam stays at the regular time.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => {
          const subjectName = (
            <SubjectName
              id={row.subjectId}
              name={row.name}
              category={row.category}
            />
          );

          // Defensive ("pending"-era data): no published late-testing slot to
          // move to, so this member gets an inert row instead of an action.
          if (row.kind === "no-late-slot") {
            return (
              <div
                key={row.subjectId}
                data-testid="conflict-no-late-slot"
                className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md border-2 border-dashed border-red-400 px-3 py-2 text-left dark:border-red-500/60"
              >
                <span className="text-sm font-semibold text-red-900 dark:text-red-100">
                  {subjectName}
                </span>
                <span className="text-xs font-medium text-red-800 dark:text-red-200">
                  No published late-testing slot — this exam can only stay at
                  the regular time.
                </span>
              </div>
            );
          }

          // N≥3 one-at-a-time flow: already marked as moving — the button is
          // replaced by an indicator that keeps the same destination line.
          if (row.kind === "moving") {
            return (
              <span
                key={row.subjectId}
                data-testid="conflict-moving-indicator"
                className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md border-2 border-dashed border-red-700 px-3 py-2 text-left dark:border-red-300"
              >
                <span className="text-sm font-semibold text-red-800 dark:text-red-200">
                  <span aria-hidden="true">✓&nbsp;</span>
                  Moving {subjectName} to late testing
                </span>
                <span className="text-xs font-medium text-red-800 dark:text-red-200">
                  <span aria-hidden="true">→&nbsp;</span>
                  {row.destination}
                </span>
              </span>
            );
          }

          return (
            <button
              key={row.subjectId}
              type="button"
              onClick={() => onMove(row.subjectId)}
              className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md bg-red-700 px-3 py-2 text-left text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:focus-visible:outline-red-300"
            >
              <span className="text-sm font-semibold">
                Move {subjectName} to late testing
              </span>
              {/* Destination line — red-100 on red-700 measures 5.3:1 (AA);
                  red-200 would land at 4.5:1, too close to the floor. */}
              <span className="text-xs font-medium text-red-100">
                <span aria-hidden="true">→&nbsp;</span>
                {row.destination}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs italic text-red-800 dark:text-red-200">
        {COORDINATOR_NOTE}
      </p>
    </section>
  );
}

const NO_MOVES: ReadonlySet<string> = new Set();

/**
 * In-progress moving-set, tagged with the membership it was built against
 * (issue #109) so a mid-flow selection change can invalidate it.
 */
interface MoveState {
  membersKey: string;
  movingIds: ReadonlySet<string>;
}

export function ConflictDialog({
  group,
  subjectsById,
  onKeep,
  modalCandidate,
  onDismiss,
}: ConflictDialogProps) {
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);
  // In-progress moving-set for the N≥3 one-at-a-time flow (issue #101).
  // Component state only — never persisted until it implies a keeper.
  const membersKey = conflictMembersKey(group.subjectIds);
  const [moves, setMoves] = useState<MoveState>(() => ({
    membersKey,
    movingIds: NO_MOVES,
  }));

  // Issue #109: the stored set applies only to the membership it was built
  // for. A catalog change that adds or drops a member of this same slot keeps
  // the component mounted, so the set is dropped here instead — derived, not
  // an effect, so there is no extra render and nothing is ever persisted on
  // the student's behalf. The flow simply restarts with every Move button.
  const movingIds =
    moves.membersKey === membersKey ? moves.movingIds : NO_MOVES;

  const handleMove = (movedId: string) => {
    const next = new Set(movingIds).add(movedId);
    const keeperId = keeperAfterMoves(group.subjectIds, next);
    if (keeperId !== null) {
      // Exactly one subject remains at the regular time: record the same
      // keeper-based SlotResolution the old "Keep" button produced.
      onKeep(keeperId);
      return;
    }
    setMoves({ membersKey, movingIds: next });
  };

  const body = (
    <ConflictBody
      group={group}
      subjectsById={subjectsById}
      movingIds={movingIds}
      onMove={handleMove}
      headingId={headingId}
    />
  );

  if (!modalCandidate || dismissed) return body;
  return (
    <ConflictModal
      headingId={headingId}
      onDismiss={() => {
        // Dismissing midway discards any partial moving-set: the conflict
        // stays unresolved and the inline prompt re-offers every Move button.
        setDismissed(true);
        setMoves({ membersKey, movingIds: NO_MOVES });
        onDismiss?.();
      }}
    >
      {body}
    </ConflictModal>
  );
}

interface ConflictModalProps {
  headingId: string;
  onDismiss: () => void;
  children: React.ReactNode;
}

/**
 * Modal chrome around the prompt body. Mounted only while `open`, so the
 * shared modal behavior (focus trap, Escape, scroll lock, focus restore)
 * starts on open and cleans up on close — mirroring the InfoPanel.
 */
function ConflictModal({ headingId, onDismiss, children }: ConflictModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDialog(panelRef, onDismiss);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onDismiss}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-950"
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="absolute top-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full text-red-800 transition hover:bg-red-100 hover:text-red-950 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none sm:h-9 sm:w-9 dark:text-red-200 dark:hover:bg-red-900/40 dark:hover:text-red-50"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
