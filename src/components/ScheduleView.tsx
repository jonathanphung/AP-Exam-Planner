"use client";

import { useEffect, useMemo } from "react";
import apData from "@/data/ap-2027.json";
import { CYCLE } from "@/data/cycle";
import type { ApDataset, ApSubject } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import {
  EXAM_NOTE_LABEL,
  buildSchedule,
  formatDateLabel,
  type ScheduleEntry,
} from "@/lib/schedule";
import {
  findLateLateCollisions,
  findSameSlotConflicts,
  pruneResolutions,
  resolveSlots,
  slotKey,
  unresolvedConflicts,
} from "@/lib/conflicts";
import {
  replaceResolutions,
  setResolution,
  useResolutions,
} from "@/lib/resolutions";
import {
  COORDINATOR_NOTE,
  ConflictDialog,
  nameList,
} from "@/components/ConflictDialog";
import { SubjectName } from "@/components/SubjectName";

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
const SUBJECTS_BY_ID: ReadonlyMap<string, ApSubject> = new Map(
  SUBJECTS.map((subject) => [subject.id, subject]),
);
// The cycle banner moved up into ScheduleViews (issue #19 second bounce,
// item B) so it is shared by the list and calendar views.

/**
 * One schedule entry.
 *
 * ## Portfolio rows are ordinary cards (Jon's bounce of #91, 2026-07-27)
 *
 * A portfolio row used to be a visually separate object: amber card chrome,
 * the verbatim College Board submission note (168–310 chars), and a standing
 * "schools set earlier internal deadlines" advisory. Three stacked blocks of
 * prose against an exam row's single line — the same swamping this ticket
 * removed from the exported `.png`, on the on-screen list.
 *
 * Jon's call, verbatim: *"in list view the portfolio card shouldnt even have
 * the block of text either. it should look like another ordinary ap exam card
 * but say 'Portfolio due' instead of 'PM/AM' as the pill."* So:
 *
 * - the card takes the same neutral treatment an exam row gets;
 * - `entry.note` is NOT rendered here (it stays on the model — the `.ics`
 *   DESCRIPTION and the week-card row model both still read it, and the
 *   details dialog still prints it in full);
 * - the internal-deadline advisory is gone from this row. It is not gone from
 *   the product: `InfoPanel` carries an equivalent line in the subject's
 *   details dialog.
 *
 * The pill keeps its amber palette on purpose — Jon's "but say 'Portfolio
 * due' … as the pill" carves the pill out as the one place the kind is still
 * signalled, so the colour cue lives there and nowhere else.
 *
 * Accepted consequence: the deadline's 11:59 p.m. ET time reached this list
 * only inside `entry.note`, so the list now shows the deadline's date but not
 * its time. The time remains in the details dialog and in the `.ics`.
 */
function ScheduleRow({ entry }: { entry: ScheduleEntry }) {
  const isPortfolio = entry.kind === "portfolio";
  const category = SUBJECTS_BY_ID.get(entry.subjectId)?.category;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-words">
          <SubjectName
            id={entry.subjectId}
            name={entry.subjectName}
            category={category}
          />
        </span>
        {isPortfolio ? (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/30 dark:text-amber-200">
            Portfolio due
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {entry.session}
          </span>
        )}
        {entry.movedToLate && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-500/30 dark:text-violet-200">
            Moved to late testing
          </span>
        )}
      </div>

      {entry.movedToLate && (
        <p className="text-xs italic break-words text-slate-600 dark:text-slate-400">
          {COORDINATOR_NOTE}
        </p>
      )}

      {/* A published qualifier on the exam itself (AP Networking's May 2027 date
          is "2026-27 pilot schools only"). Issue #71: the catalog chip and the
          details dialog already disclosed it, but this row printed a bare
          "May 7 · PM" — a published date without its published restriction
          reads as an exam any student can sit. Verbatim from the dataset,
          never editorialised (PROJECT.md data rule); the label only names what
          the text IS. */}
      {entry.examNote && (
        <p
          data-testid="schedule-exam-note"
          className="text-xs leading-relaxed break-words text-slate-600 dark:text-slate-300"
        >
          <span className="font-semibold">{EXAM_NOTE_LABEL}:</span>{" "}
          {entry.examNote}
        </p>
      )}
    </li>
  );
}

export function ScheduleView() {
  const { selectedIds, selectedCount } = useSelection();
  const storedResolutions = useResolutions();

  const conflicts = useMemo(
    () => findSameSlotConflicts(SUBJECTS, selectedIds),
    [selectedIds],
  );

  // Only resolutions matching a live conflict group are honored; the rest are
  // stale (a member was deselected, or a new subject joined the slot).
  const validResolutions = useMemo(
    () => pruneResolutions(storedResolutions, conflicts),
    [storedResolutions, conflicts],
  );

  // Persist the pruning: a cleared resolution must not silently re-apply if
  // the same collision is re-created later — the prompt has to come back.
  useEffect(() => {
    if (validResolutions.length !== storedResolutions.length) {
      replaceResolutions(validResolutions);
    }
  }, [validResolutions, storedResolutions]);

  const unresolved = useMemo(
    () => unresolvedConflicts(conflicts, validResolutions),
    [conflicts, validResolutions],
  );

  const resolvedSlots = useMemo(
    () => resolveSlots(SUBJECTS, selectedIds, validResolutions),
    [selectedIds, validResolutions],
  );

  const lateCollisions = useMemo(
    () => findLateLateCollisions(resolvedSlots),
    [resolvedSlots],
  );

  const { groups, undated } = useMemo(
    () => buildSchedule(SUBJECTS, selectedIds, resolvedSlots),
    [selectedIds, resolvedSlots],
  );

  return (
    <section aria-label="My schedule" className="flex flex-col gap-4">
      {/* The "My Schedule" heading, cycle banner, and Export button moved to
          the shared ScheduleViews header (issue-19 second bounce, item B) so
          they are present on both the list and calendar views. */}
      {unresolved.map((group, index) => (
        <ConflictDialog
          // Keyed by slot: a re-created collision mounts a fresh dialog (and
          // therefore re-prompts modally) — see ConflictDialog's doc comment.
          key={slotKey(group.slot)}
          group={group}
          subjectsById={SUBJECTS_BY_ID}
          modalCandidate={index === 0}
          onKeep={(keeperId) =>
            setResolution({
              date: group.slot.date,
              session: group.slot.session,
              keeperId,
              memberIds: [...group.subjectIds],
            })
          }
        />
      ))}

      {lateCollisions.length > 0 && (
        <div
          role="alert"
          data-testid="late-collision-warning"
          className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-500/50 dark:bg-red-950/40"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-red-900 dark:text-red-100">
            <span aria-hidden="true">⚠️ </span>
            Late-testing slots overlap
          </p>
          {lateCollisions.map((collision) => (
            <p
              key={slotKey(collision.slot)}
              className="mt-2 text-sm text-red-900 dark:text-red-100"
            >
              {nameList(
                collision.subjectIds.map(
                  (id) => SUBJECTS_BY_ID.get(id)?.name ?? id,
                ),
              )}{" "}
              now share the late-testing slot{" "}
              {`${formatDateLabel(collision.slot.date)} (${collision.slot.session} session)`}.
              Late testing can&rsquo;t separate these exams any further — ask
              your school&rsquo;s AP coordinator about your options.
            </p>
          ))}
        </div>
      )}

      {selectedCount === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Select subjects above to build your schedule — exam dates and portfolio
          deadlines will appear here, grouped by day.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.length > 0 && (
            <ol className="flex flex-col gap-6">
              {groups.map((group) => (
                <li key={group.date} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {formatDateLabel(group.date)}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.entries.map((entry) => (
                      <ScheduleRow key={entry.key} entry={entry} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}

          {undated.length > 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <p className="font-medium text-slate-600 dark:text-slate-300">
                {`No ${CYCLE} exam date`}
              </p>
              <ul className="mt-1 list-disc break-words pl-5">
                {undated.map((subject) => (
                  <li key={subject.id}>
                    <SubjectName
                      id={subject.id}
                      name={subject.name}
                      category={SUBJECTS_BY_ID.get(subject.id)?.category}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
