"use client";

import { useId, useRef, useState } from "react";
import type { ApSubject } from "@/data/schema";
import type { ConflictGroup } from "@/lib/conflicts";
import { formatDateLabel } from "@/lib/schedule";
import { useModalDialog } from "@/lib/modal";
import { SubjectName } from "@/components/SubjectName";

/**
 * Conflict prompt (issue #5) with modal-dialog hardening (issue #8): shown for
 * every same-slot exam collision that has no valid stored resolution yet.
 * Names every involved subject and the shared slot, and asks which ONE exam
 * stays at the regular time — each of the others moves to its own published
 * late-testing slot.
 *
 * Two presentation states share the same prompt body (and the same
 * `data-testid="conflict-prompt"` contract from issue #5's QA suite):
 *
 *   - modal — a true dialog: focus is trapped inside, Escape (or the close
 *     button / backdrop) dismisses it, and focus returns to the invoker.
 *     ScheduleView marks the FIRST unresolved conflict as the modal candidate
 *     so a new collision interrupts accessibly, one dialog at a time.
 *   - inline — the issue-#5 section on the schedule. Dismissing the modal
 *     never discards the choice: the same prompt (with its Keep buttons)
 *     stays available inline until the student resolves it. Conflicts are a
 *     planning aid, not a forced gate (issue #5 AC5: no forced resolution).
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
  /** Called with the id of the subject the student keeps at the regular time. */
  onKeep: (keeperId: string) => void;
  /**
   * True for the first unresolved conflict on the schedule: renders as a
   * modal dialog (focus-trapped, Escape-dismissable) until dismissed.
   */
  modalCandidate: boolean;
}

interface ConflictBodyProps {
  group: ConflictGroup;
  subjectsById: ReadonlyMap<string, ApSubject>;
  onKeep: (keeperId: string) => void;
  headingId: string;
}

/** The shared prompt body — identical markup in modal and inline states. */
function ConflictBody({
  group,
  subjectsById,
  onKeep,
  headingId,
}: ConflictBodyProps) {
  const names = group.subjectIds.map((id) => subjectsById.get(id)?.name ?? id);
  const slotLabel = `${formatDateLabel(group.slot.date)} (${group.slot.session} session)`;

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
        for {slotLabel}. Which exam will you take at the regular time? Each of
        the others moves to its own official late-testing slot:
      </p>

      <ul className="mt-2 list-disc pl-5 text-sm text-red-900 dark:text-red-100">
        {group.subjectIds.map((id) => {
          const subject = subjectsById.get(id);
          const late = subject?.lateTesting;
          return (
            <li key={id}>
              <span className="font-medium">
                <SubjectName
                  id={id}
                  name={subject?.name ?? id}
                  category={subject?.category}
                />
              </span>
              {late
                ? ` — late testing ${formatDateLabel(late.date)} (${late.session} session)`
                : " — no published late-testing slot"}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {group.subjectIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onKeep(id)}
            className="inline-flex min-h-11 items-center rounded-md bg-red-700 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 sm:min-h-0 dark:focus-visible:outline-red-300"
          >
            Keep {subjectsById.get(id)?.name ?? id} at the regular time
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs italic text-red-800 dark:text-red-200">
        {COORDINATOR_NOTE}
      </p>
    </section>
  );
}

export function ConflictDialog({
  group,
  subjectsById,
  onKeep,
  modalCandidate,
}: ConflictDialogProps) {
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);
  const body = (
    <ConflictBody
      group={group}
      subjectsById={subjectsById}
      onKeep={onKeep}
      headingId={headingId}
    />
  );

  if (!modalCandidate || dismissed) return body;
  return (
    <ConflictModal headingId={headingId} onDismiss={() => setDismissed(true)}>
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
