"use client";

import { useMemo, useState } from "react";
import apData from "@/data/ap-2026.json";
import { type ApDataset, type ApSubject, type Category } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import { groupSubjectsByCategory } from "@/lib/catalog-groups";
import { InfoPanel } from "@/components/InfoPanel";
import {
  CategorySection,
  categoryHeadingId,
} from "@/components/CategorySection";

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;

/** Scroll to a category section and move focus to its heading (issue #22). */
function jumpToCategory(category: Category): void {
  const heading = document.getElementById(categoryHeadingId(category));
  if (!heading) return;
  // Reduced-motion bar from issue #8: no smooth scrolling for users who ask
  // for reduced motion.
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  heading.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
  heading.focus({ preventScroll: true });
}

/**
 * The subject catalog — ONE category-grouped layout at every width (issue
 * #24). The sectioned IA that issue #22 introduced on mobile (labeled
 * `CategorySection`s of `SubjectChip`s with progressive disclosure) is now
 * the default everywhere; `CategorySection` widens to a multi-column grid on
 * larger screens via CSS alone, so there is no JS media query, no duplicate
 * hidden catalog for assistive tech, and desktop/mobile are the same DOM.
 *
 * Design decision (issue #24): the standalone category *filter* chips from
 * issue #3 ("All" + one per category) are RETIRED and their role is folded
 * into the sticky quick-jump nav that issue #22 shipped on mobile. With every
 * category always visible as a labeled section, a filter that hides other
 * sections was redundant with scrolling and confusing next to the section
 * headings; the quick-jump keeps the filter's one unique value — reaching a
 * category instantly — with one shared control on both platforms.
 */
export function CatalogGrid() {
  const { isSelected, toggle, selectedCount } = useSelection();
  const [query, setQuery] = useState("");
  const [detailsSubject, setDetailsSubject] = useState<ApSubject | null>(null);

  // Grouped in canonical category order with empty categories dropped; the
  // same trimmed case-insensitive name match at every width.
  const groups = useMemo(
    () => groupSubjectsByCategory(SUBJECTS, query),
    [query],
  );

  return (
    <section aria-label="Subject catalog" className="flex flex-col gap-6">
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

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No subjects match your search.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Sticky quick-jump nav (issues #22 + #24): sections stay
              always-expanded for scannability, and this bar reaches any
              category without scrolling the whole catalog. Bleeds edge-to-edge
              only below `sm`, where the catalog column spans the viewport. */}
          <nav
            aria-label="Jump to category"
            className="sticky top-0 z-30 -mx-6 border-b border-slate-200 bg-white/95 px-6 py-2 backdrop-blur-sm sm:mx-0 sm:px-0 dark:border-slate-800 dark:bg-slate-950/95"
          >
            <ul className="flex gap-2 overflow-x-auto">
              {groups.map((group) => (
                <li key={group.category} className="flex-none">
                  <button
                    type="button"
                    onClick={() => jumpToCategory(group.category)}
                    className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-1 text-sm text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {group.category}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {groups.map((group) => (
            <CategorySection
              key={group.category}
              category={group.category}
              subjects={group.subjects}
              isSelected={isSelected}
              onToggle={toggle}
              onShowDetails={setDetailsSubject}
              sessionStartTimes={dataset.sessionStartTimes}
            />
          ))}
        </div>
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
