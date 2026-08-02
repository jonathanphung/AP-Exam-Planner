"use client";

import { useId, useState } from "react";
import type { ApSubject, Session } from "@/data/schema";
import { SubjectName } from "@/components/SubjectName";

/**
 * Compact subject chip with progressive disclosure (issue #22, mobile IA).
 *
 * Two clearly separated tap targets, each ≥44px (issue #8 bar):
 *   - the chip body — the select toggle (`aria-pressed`), same `useSelection`
 *     semantics as the desktop card;
 *   - a chevron expand button (`aria-expanded` + `aria-controls`) that reveals
 *     Tier 1 — the exam's timing/date (regular slot + published session start
 *     time, late-testing slot, portfolio deadline, or the sourced
 *     `noExamReason` when there is no exam in this cycle).
 *
 * From the expanded panel, a "Full exam details" button (Tier 2) opens the
 * shared InfoPanel dialog — the same component/data the desktop info button
 * uses, which in turn links to the verified official College Board page
 * (Tier 3). Expanding never toggles selection and vice-versa.
 *
 * Expansion is VERTICAL-ONLY (Jon's bounce on issue #24): the card keeps its
 * grid-cell width in both states and the revealed timing block flows below
 * within that same width, growing the card downward — no width jump, no
 * column-spanning, no horizontal reflow of neighbors. The chevron therefore
 * stays pinned to the card's top-right edge in both states, so expand and
 * collapse hit the same target. The expand control's accessible name is
 * stable — state is announced via `aria-expanded`, not a label swap.
 */

interface SubjectChipProps {
  subject: ApSubject;
  selected: boolean;
  onToggle: (id: string) => void;
  onShowDetails: (subject: ApSubject) => void;
  /** Published session start-time labels from the dataset (verbatim). */
  sessionStartTimes: Readonly<Record<Session, string>>;
}

/**
 * Format an ISO calendar date as a *local* date. Dates in the dataset are
 * floating (no timezone) — building the Date from explicit parts avoids the
 * UTC-parse day-shift of `new Date("2027-05-03")` in negative-offset zones.
 */
function formatSlotDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

/** Portfolio deadlines carry the year, matching the InfoPanel's rendering. */
function formatDeadlineDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

/**
 * One label/value line inside the Tier-1 timing block.
 *
 * `note` is a published qualifier ON that slot, rendered as a smaller muted
 * line inside the same `<dd>` (issue #87). Putting it in the value — rather
 * than in a paragraph at the foot of the panel, where AP Networking's
 * qualifier used to sit — is what makes it read as "…and that date is
 * restricted" instead of as a second, unrelated block of prose: it is one
 * value with a caveat, so it is one `<dd>`, and assistive tech reads the
 * caveat as part of the Exam row rather than as loose text after the list.
 */
function TimingRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-slate-600 uppercase dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-900 dark:text-slate-100">
        {value}
        {note && (
          <span
            data-testid="chip-exam-note"
            className="mt-0.5 block text-xs leading-snug break-words text-slate-600 dark:text-slate-400"
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

export function SubjectChip({
  subject,
  selected,
  onToggle,
  onShowDetails,
  sessionStartTimes,
}: SubjectChipProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const slotLabel = (slot: { date: string; session: Session }) =>
    `${formatSlotDate(slot.date)} · ${slot.session} (${sessionStartTimes[slot.session]})`;

  // scroll-mt would clear the sticky catalog header, but native focus-driven
  // scrolling (Tab/Shift+Tab) reads scroll-margin from the FOCUSED element,
  // never from an ancestor — so it has to live on every focusable button in
  // this chip (issue #108), not on the <li> wrapper. Same two heights as
  // CategorySection's heading (`scroll-mt-32 sm:scroll-mt-20`): ~113px below
  // `sm` (the condensed two-row header), ~61px at `sm`+.
  const focusScrollMargin = "scroll-mt-32 sm:scroll-mt-20";

  return (
    <li className="min-w-0 max-w-full">
      <div
        className={[
          "flex flex-col overflow-hidden rounded-xl border transition",
          selected
            ? "border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
            : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900",
        ].join(" ")}
      >
        <div className="flex items-stretch">
          {/* Select toggle — the whole chip body.
              Height reservation (issue #57): the collapsed body reserves TWO
              lines of the `text-sm leading-snug` name so a one-line label (e.g.
              "AP Chemistry") and a two-line label (e.g. "AP Computer Science
              Principles") render at the SAME height within a grid row — the
              section grid is `items-start` (issue #24 bounce: expansion is
              vertical-only), so each collapsed cell otherwise sizes to its own
              content and two-line chips stood taller than their neighbors.
              `min-h-14` = 3.5rem/56px ≥ two lines (2 × 0.875rem × 1.375 ≈ 38.5px)
              + `py-2` (16px) = 54.5px, and `items-center` vertically centers the
              label. It is a MIN-height, not a fixed height: it strictly raises
              the box (56px > the prior ≥44px touch-target floor, issue #8 AC5)
              and still lets a genuinely three-line name grow ITS OWN cell taller
              (never clipped) — `items-start` keeps that growth off its neighbors.
              The chevron cell keeps `min-h-11` and stretches to the body via the
              outer `flex items-stretch` row, so its divider runs full height. */}
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(subject.id)}
            className={[
              focusScrollMargin,
              "flex min-h-14 min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-sm font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
              selected
                ? "text-slate-900 dark:text-slate-50"
                : "text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            {/* More-than-color selected indicator (issue #8 AC5). */}
            <span
              aria-hidden="true"
              className={[
                "flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[10px] leading-none",
                // blue-600: the white ✓ glyph needs ≥4.5:1 (issue #8 AC2).
                selected
                  ? "border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950"
                  : "border-slate-300 text-transparent dark:border-slate-600",
              ].join(" ")}
            >
              ✓
            </span>
            <span className="min-w-0 leading-snug break-words">
              <SubjectName
                id={subject.id}
                name={subject.name}
                category={subject.category}
              />
            </span>
          </button>

          {/* Expand affordance — a separate control from the select toggle. */}
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`Show exam dates for ${subject.name}`}
            onClick={() => setExpanded((open) => !open)}
            className={[
              focusScrollMargin,
              "flex min-h-11 w-11 flex-none items-center justify-center border-l transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
              selected
                ? "border-blue-600/30 text-blue-700 hover:bg-blue-100 dark:border-blue-400/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                : "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
            ].join(" ")}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={[
                "h-5 w-5 transition-transform motion-reduce:transition-none",
                expanded ? "rotate-180" : "",
              ].join(" ")}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Tier 1 — timing/date, programmatically associated via aria-controls
            and next in DOM/focus order after the expand button. */}
        <div
          id={panelId}
          hidden={!expanded}
          className={[
            "border-t px-3 py-3",
            selected
              ? "border-blue-600/30 dark:border-blue-400/30"
              : "border-slate-200 dark:border-slate-700",
          ].join(" ")}
        >
          <dl className="flex flex-col gap-2.5">
            {subject.exam && (
              <TimingRow
                label="Exam"
                value={slotLabel(subject.exam)}
                // A published qualifier on the exam itself (AP Networking's
                // May 2027 date is "2026-27 pilot schools only"). Shown for
                // the same reason `noExamReason` is: a date without its
                // published restriction would read as an exam the student can
                // sit. Issue #87 attached it to the date it qualifies — it
                // was a paragraph below the whole list, which is also where
                // the 297-character version of this note earned its "text
                // dump" reputation. The schema guarantees an `examNote` only
                // ever accompanies a non-null `exam`, so this row is the
                // note's only home and nothing can fall off the card.
                note={subject.examNote}
              />
            )}
            {subject.lateTesting && (
              <TimingRow
                label="Late testing"
                value={slotLabel(subject.lateTesting)}
              />
            )}
            {subject.portfolio && (
              <TimingRow
                label="Portfolio due"
                value={formatDeadlineDate(subject.portfolio.deadline)}
              />
            )}
          </dl>
          {/* No exam in this cycle: show the sourced reason — never an
              invented date/time (PROJECT.md data rule). */}
          {subject.noExamReason && (
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {subject.noExamReason}
            </p>
          )}
          {/* Tier 2 — full exam details via the shared InfoPanel dialog.
              Why the format story is NOT on this card (issue #87): the note
              that used to sit here ended with three sentences explaining why
              the exam's section structure, duration, delivery and calculator
              policy are unpublished — an explanation of a surface this card
              does not show, on the only card in the catalog carrying free
              prose. It moved behind this button, next to the rows it is
              about (`formatNote`, InfoPanel). */}
          <button
            type="button"
            onClick={() => onShowDetails(subject)}
            aria-haspopup="dialog"
            aria-label={`View exam details for ${subject.name}`}
            className={[
              focusScrollMargin,
              "mt-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            Full exam details
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M7.22 14.78a.75.75 0 0 1 0-1.06L10.94 10 7.22 6.28a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}
