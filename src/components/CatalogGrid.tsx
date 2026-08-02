"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import apData from "@/data/ap-2027.json";
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
 *
 * Issue #102 finishes that consolidation: the search field and the `{n}
 * selected` count moved INTO the same sticky bar as the quick-jump pills, so
 * the catalog's whole control surface survives scrolling instead of only the
 * pills. See the bar's own comment below.
 */
export function CatalogGrid() {
  const { isSelected, toggle, selectedCount } = useSelection();
  const [query, setQuery] = useState("");
  const [detailsSubject, setDetailsSubject] = useState<ApSubject | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Grouped in canonical category order with empty categories dropped; the
  // same trimmed case-insensitive name match at every width.
  const groups = useMemo(
    () => groupSubjectsByCategory(SUBJECTS, query),
    [query],
  );

  // Issue #116 guard for issue #102's invariant ("the catalog's whole control
  // surface survives filtering"). The page now has real content below the
  // catalog (the FAQ in this column, the footer's subject index), so when a
  // query collapses the catalog from a deep scroll the document no longer
  // shrinks under the viewport — the browser's scroll clamp used to pull the
  // viewport back to the bar, and now it can leave it stranded below the
  // section with the sticky bar pinned to the section's bottom edge, above
  // the viewport. If a query CHANGE left the bar off the top, scroll the
  // catalog back under it (instant, so no reduced-motion concern).
  //
  // `rescuedFor` gates the effect to real query changes: the mount run must
  // never fire, because a reader who loads the page and scrolls straight to
  // the footer before hydration completes would otherwise be yanked back up
  // to the catalog the moment the effect first runs.
  const rescuedFor = useRef(query);
  useEffect(() => {
    if (rescuedFor.current === query) return;
    rescuedFor.current = query;
    const header = headerRef.current;
    if (!header) return;
    if (header.getBoundingClientRect().top < -1) {
      (header.closest("section") ?? header).scrollIntoView({ block: "start" });
    }
  }, [query]);

  return (
    <section aria-label="Subject catalog" className="flex flex-col gap-6">
      {/* One condensed sticky catalog header (issue #102).
       *
       * Before: two stacked lines — a NON-sticky search + count row, then the
       * sticky quick-jump nav. Scrolling the catalog kept the pills but threw
       * away both the search box and the running count, so narrowing a long
       * list meant scrolling back to the top first.
       *
       * Now the three controls are one pinned unit that owns the chrome the
       * nav used to own alone: `sticky top-0 z-30`, hairline bottom border,
       * translucent backdrop-blur, and the below-`sm` edge bleed (`-mx-6
       * px-6`) for the widths where the catalog column spans the viewport.
       *
       * Layout — at `sm` and up one row: search (fixed width, left), pills
       * (flex-1, horizontally scrollable), count pinned to the right edge.
       * Below `sm` the row wraps INSIDE the same sticky box: full-width search
       * on line 1 (327px at 375px wide is a usable field; a one-row squeeze
       * would leave it ~120px), pills + count on line 2. DOM order is always
       * search → pills → count, which is also the tab order.
       *
       * The bar renders unconditionally — including in the no-matches state,
       * where `groups` is empty and the pills drop out. Keeping it inside the
       * old `groups.length > 0` branch would have hidden the search input the
       * moment a query matched nothing, i.e. exactly when the user needs it to
       * clear the query. */}
      <div
        ref={headerRef}
        data-testid="catalog-header"
        className="sticky top-0 z-30 -mx-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-6 py-2 backdrop-blur-sm sm:mx-0 sm:flex-nowrap sm:px-0 dark:border-slate-800 dark:bg-slate-950/95"
      >
        {/* The label's visible TEXT is what the condensed row drops, not the
            label itself: `sr-only` keeps a real `<label for>` association, so
            the accessible name stays "Search subjects" instead of degrading to
            the placeholder. The placeholder repeats those words for sighted
            users now that no caption sits above the field — which cost the old
            "e.g. bio" hint: at the bar's width the two together truncated
            mid-word, and naming the field beats illustrating it. */}
        <label htmlFor="subject-search" className="sr-only">
          Search subjects
        </label>
        <input
          id="subject-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search subjects"
          autoComplete="off"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:min-h-0 sm:w-48 sm:flex-none 2xl:w-72 dark:border-slate-700 dark:bg-slate-900"
        />

        {/* Quick-jump nav (issues #22 + #24): sections stay always-expanded for
            scannability and this reaches any category without scrolling the
            whole catalog. `min-w-0 flex-1` lets it absorb the free space and
            still shrink below its content width, so the pill list — not the
            page — is what scrolls sideways when the categories outrun the bar.
            It keeps `sticky top-0` of its own: inert while it sits inside the
            already-pinned bar (its offset never engages), but it preserves the
            invariant #22/#24 assert — the quick-jump nav is a sticky box. */}
        {groups.length > 0 && (
          <nav
            aria-label="Jump to category"
            className="sticky top-0 min-w-0 flex-1"
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
        )}

        {/* `ml-auto` is the fallback that pins the count to the bar's right
            edge in the no-matches state, where the flex-1 nav is gone and
            nothing else would push it over. */}
        <p
          aria-live="polite"
          className="ml-auto shrink-0 whitespace-nowrap text-sm font-medium text-slate-700 dark:text-slate-300"
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
