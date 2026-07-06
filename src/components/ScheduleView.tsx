"use client";

import { useEffect, useMemo } from "react";
import apData from "@/data/ap-2026.json";
import type { ApDataset, ApSubject } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import {
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
import { ExportButton } from "@/components/ExportButton";
import { SubjectName } from "@/components/SubjectName";

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
const SUBJECTS_BY_ID: ReadonlyMap<string, ApSubject> = new Map(
  SUBJECTS.map((subject) => [subject.id, subject]),
);
// The banner reads the cycle from dataset metadata — never hardcoded, so a
// dataset swap (May 2027) re-labels the schedule automatically.
const CYCLE = dataset.cycle;

function ScheduleRow({ entry }: { entry: ScheduleEntry }) {
  const isPortfolio = entry.kind === "portfolio";
  const category = SUBJECTS_BY_ID.get(entry.subjectId)?.category;

  return (
    <li
      className={[
        "flex flex-col gap-1.5 rounded-lg border p-3",
        isPortfolio
          ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
      ].join(" ")}
    >
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

      {isPortfolio && (
        <>
          {entry.note && (
            <p className="text-sm break-words text-amber-800 dark:text-amber-200/90">
              {entry.note}
            </p>
          )}
          <p className="text-xs italic break-words text-amber-700 dark:text-amber-300/80">
            Heads up: schools and teachers often set an earlier internal deadline
            than College Board&rsquo;s official one — confirm the date your class
            has to meet.
          </p>
        </>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">My Schedule</h2>
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-200">
            <span aria-hidden="true">📅</span>
            Dates reflect the {CYCLE} AP exam cycle.
          </p>
          <ExportButton />
        </div>
      </div>

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
                No May 2026 exam date
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
