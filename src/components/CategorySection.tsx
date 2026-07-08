"use client";

import type { ApSubject, Category, Session } from "@/data/schema";
import { SubjectChip } from "@/components/SubjectChip";

/**
 * One labeled category card in the sectioned catalog (issue #22).
 *
 * A real `<section>` landmark with a real heading, so assistive tech can
 * navigate by headings/regions, and the sticky quick-jump nav can move focus
 * here (`tabIndex={-1}` on the heading; `scroll-mt` clears the sticky bar).
 *
 * Issue #24 makes this section the desktop layout too: the chip list is one
 * responsive CSS grid of uniform-width cards at every width — full-width
 * cards on mobile, 2 columns at `sm`, 3 at `xl` — so the markup (and
 * therefore search, selection, and disclosure behavior) is identical across
 * viewports. Per Jon's bounce on #24, expansion is vertical-only: the grid is
 * `items-start` so an expanded card grows downward inside its own cell
 * (pushing rows below) without stretching or reflowing the cards beside it,
 * and a card's width never changes with disclosure state — which also keeps
 * each card's expand chevron in the exact same spot in both states.
 */

/** DOM id for a category's section heading (quick-jump scroll/focus target). */
export function categoryHeadingId(category: Category): string {
  return `catalog-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

interface CategorySectionProps {
  category: Category;
  subjects: readonly ApSubject[];
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onShowDetails: (subject: ApSubject) => void;
  sessionStartTimes: Readonly<Record<Session, string>>;
}

export function CategorySection({
  category,
  subjects,
  isSelected,
  onToggle,
  onShowDetails,
  sessionStartTimes,
}: CategorySectionProps) {
  const headingId = categoryHeadingId(category);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <h2
        id={headingId}
        tabIndex={-1}
        className="scroll-mt-20 text-sm font-semibold tracking-wide text-slate-700 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300"
      >
        {category}
        {/* slate-600: ≥4.5:1 on the slate-50 card background (issue #8 AC2). */}
        <span className="ml-2 font-normal text-slate-600 normal-case dark:text-slate-400">
          {subjects.length} {subjects.length === 1 ? "subject" : "subjects"}
        </span>
      </h2>
      <ul className="mt-3 grid grid-cols-1 items-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => (
          <SubjectChip
            key={subject.id}
            subject={subject}
            selected={isSelected(subject.id)}
            onToggle={onToggle}
            onShowDetails={onShowDetails}
            sessionStartTimes={sessionStartTimes}
          />
        ))}
      </ul>
    </section>
  );
}
