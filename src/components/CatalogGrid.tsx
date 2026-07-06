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
import { InfoPanel } from "@/components/InfoPanel";
import { SubjectName } from "@/components/SubjectName";

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
  onShowDetails: (subject: ApSubject) => void;
}

function SubjectCard({
  subject,
  selected,
  onToggle,
  onShowDetails,
}: SubjectCardProps) {
  const meta = subjectMeta(subject);

  return (
    <div className="relative h-full">
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
        <span className="flex items-start gap-2 pr-12 sm:pr-9">
          <span
            aria-hidden="true"
            className={[
              "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-xs leading-none",
              // blue-600: the white ✓ glyph needs ≥4.5:1 (blue-500 was 3.68:1).
              selected
                ? "border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
                : "border-slate-300 text-transparent dark:border-slate-600",
            ].join(" ")}
          >
            ✓
          </span>
          <span className="font-medium leading-snug break-words">
            <SubjectName
              id={subject.id}
              name={subject.name}
              category={subject.category}
            />
          </span>
        </span>
        {/* slate-600: slate-500 lands under 4.5:1 on the selected card's blue-50 bg (issue #8 AC3/AC2). */}
        <span className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {subject.category}
        </span>
        <span
          className={[
            "mt-auto text-sm break-words",
            meta.tone === "portfolio"
              ? "text-amber-700 dark:text-amber-400"
              : meta.tone === "none"
                ? // Still muted relative to the name, but ≥4.5:1 on every card
                  // background (slate-400-on-white was 3.0:1 — issue #8 AC2).
                  "text-slate-600 dark:text-slate-400"
                : "text-slate-600 dark:text-slate-300",
          ].join(" ")}
        >
          {meta.label}
        </span>
      </button>

      {/* Details affordance — a separate control from the select toggle. */}
      <button
        type="button"
        onClick={() => onShowDetails(subject)}
        aria-label={`View exam details for ${subject.name}`}
        aria-haspopup="dialog"
        className="absolute top-0.5 right-0.5 z-10 flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none sm:top-2 sm:right-2 sm:h-7 sm:w-7 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2.25 2.5a.75.75 0 0 0 0 1.5h.5v2.25h-.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-.75V10.25A.75.75 0 0 0 9.75 9.5h-1Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}

export function CatalogGrid() {
  const { isSelected, toggle, selectedCount } = useSelection();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [detailsSubject, setDetailsSubject] = useState<ApSubject | null>(null);

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
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:min-h-0 sm:w-72 dark:border-slate-700 dark:bg-slate-900"
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
                  // ≥44px tall tap target at phone widths (issue #8 AC4);
                  // desktop keeps the original compact chip.
                  "inline-flex min-h-11 items-center rounded-full border px-4 py-1 text-sm transition sm:min-h-0 sm:px-3",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
                  // blue-600: white chip text needs ≥4.5:1 (blue-500 was 3.68:1).
                  active
                    ? "border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
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
                onShowDetails={setDetailsSubject}
              />
            </li>
          ))}
        </ul>
      )}

      {detailsSubject && (
        <InfoPanel
          subject={detailsSubject}
          onClose={() => setDetailsSubject(null)}
        />
      )}
    </section>
  );
}
