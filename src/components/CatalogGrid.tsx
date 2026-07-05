"use client";

import { useMemo, useState } from "react";
import apData from "@/data/ap-2026.json";
import {
  CATEGORIES,
  type ApDataset,
  type ApSubject,
  type Category,
} from "@/data/schema";
import { useSelection } from "@/lib/selection";

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;

type CategoryFilter = "All" | Category;
const CATEGORY_FILTERS: readonly CategoryFilter[] = ["All", ...CATEGORIES];

/**
 * Format an ISO calendar date as a *local* date. Dates in the dataset are
 * floating (no timezone) — building the Date from explicit parts avoids the
 * UTC-parse day-shift of `new Date("2026-05-04")` in negative-offset zones.
 */
function formatCalendarDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

type MetaTone = "exam" | "portfolio" | "none";

function subjectMeta(subject: ApSubject): { label: string; tone: MetaTone } {
  if (subject.exam) {
    return {
      label: `${formatCalendarDate(subject.exam.date)} · ${subject.exam.session}`,
      tone: "exam",
    };
  }
  if (subject.portfolio) {
    return {
      label: `Portfolio due ${formatCalendarDate(subject.portfolio.deadline)}`,
      tone: "portfolio",
    };
  }
  // Career Kickstart courses have no May 2026 exam and no portfolio; the full
  // sourced reason lives in the info panel (issue #6), not this compact card.
  return { label: "No May 2026 exam", tone: "none" };
}

interface SubjectCardProps {
  subject: ApSubject;
  selected: boolean;
  onToggle: (id: string) => void;
}

function SubjectCard({ subject, selected, onToggle }: SubjectCardProps) {
  const meta = subjectMeta(subject);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(subject.id)}
      className={[
        "flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
        selected
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
      ].join(" ")}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug break-words">
          {subject.name}
        </span>
        <span
          aria-hidden="true"
          className={[
            "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-xs leading-none",
            selected
              ? "border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
              : "border-slate-300 text-transparent dark:border-slate-600",
          ].join(" ")}
        >
          ✓
        </span>
      </span>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {subject.category}
      </span>
      <span
        className={[
          "mt-auto text-sm break-words",
          meta.tone === "portfolio"
            ? "text-amber-700 dark:text-amber-400"
            : meta.tone === "none"
              ? "text-slate-400 dark:text-slate-500"
              : "text-slate-600 dark:text-slate-300",
        ].join(" ")}
      >
        {meta.label}
      </span>
    </button>
  );
}

export function CatalogGrid() {
  const { isSelected, toggle, selectedCount } = useSelection();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");

  const normalizedQuery = query.trim().toLowerCase();

  const visibleSubjects = useMemo(
    () =>
      SUBJECTS.filter((subject) => {
        const matchesQuery =
          normalizedQuery === "" ||
          subject.name.toLowerCase().includes(normalizedQuery);
        const matchesCategory =
          category === "All" || subject.category === category;
        return matchesQuery && matchesCategory;
      }),
    [normalizedQuery, category],
  );

  return (
    <section aria-label="Subject catalog" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="subject-search"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Search subjects
            </label>
            <input
              id="subject-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. bio"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 sm:w-72"
            />
          </div>
          <p
            aria-live="polite"
            className="text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            {selectedCount} selected
          </p>
        </div>

        <div
          role="group"
          aria-label="Filter by category"
          className="flex flex-wrap gap-2"
        >
          {CATEGORY_FILTERS.map((option) => {
            const active = category === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(option)}
                className={[
                  "rounded-full border px-3 py-1 text-sm transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
                  active
                    ? "border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      {visibleSubjects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No subjects match your search.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleSubjects.map((subject) => (
            <li key={subject.id} className="min-w-0">
              <SubjectCard
                subject={subject}
                selected={isSelected(subject.id)}
                onToggle={toggle}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
