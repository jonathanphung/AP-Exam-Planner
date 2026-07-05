"use client";

import { useMemo } from "react";
import apData from "@/data/ap-2026.json";
import type { ApDataset, ApSubject } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import { buildSchedule, type ScheduleEntry } from "@/lib/schedule";

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
// The banner reads the cycle from dataset metadata — never hardcoded, so a
// dataset swap (May 2027) re-labels the schedule automatically.
const CYCLE = dataset.cycle;

/**
 * Format an ISO calendar date as a *local* date heading. Dates are floating
 * (no timezone); building the Date from explicit parts avoids the UTC-parse
 * day-shift of `new Date("2026-05-04")` in negative-offset zones.
 */
function formatDateHeading(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function ScheduleRow({ entry }: { entry: ScheduleEntry }) {
  const isPortfolio = entry.kind === "portfolio";

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
        <span className="font-medium break-words">{entry.subjectName}</span>
        {isPortfolio ? (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/30 dark:text-amber-200">
            Portfolio due
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {entry.session}
          </span>
        )}
      </div>

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

  const { groups, undated } = useMemo(
    () => buildSchedule(SUBJECTS, selectedIds),
    [selectedIds],
  );

  return (
    <section aria-label="My schedule" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">My Schedule</h2>
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-200">
          <span aria-hidden="true">📅</span>
          Dates reflect the {CYCLE} AP exam cycle.
        </p>
      </div>

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
                    {formatDateHeading(group.date)}
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
                  <li key={subject.id}>{subject.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
