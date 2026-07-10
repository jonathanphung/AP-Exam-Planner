"use client";

import { Fragment, type ReactNode, useId, useRef } from "react";
import type { ApSubject, ExamSection } from "@/data/schema";
import { useModalDialog } from "@/lib/modal";
import {
  questionCountLabel,
  sectionsHavePartRows,
} from "@/lib/exam-sections";
import { officialCollegeBoardUrl } from "@/lib/college-board-links";
import { SubjectName } from "@/components/SubjectName";

/**
 * Accessible exam-info modal (issue #6, section breakdown reworked in #44).
 *
 * Answers "what am I walking into on exam day" for one subject: the published
 * per-section breakdown (questions | length | weight, with Part A/B rows
 * nested under their section), overall length, calculator, delivery, the most
 * recent pass rate, and — for portfolio subjects — the portfolio's weight and
 * deadline.
 *
 * Sections render exactly what College Board publishes (issue #44): an exam
 * that lacks a section omits it (AP Seminar shows no multiple-choice row),
 * and a portfolio-only subject renders NO section table at all — its
 * portfolio block carries the story instead. Omission and "not yet
 * published" are different states: only genuinely unpublished values show
 * the "pending" badge.
 *
 * Layout branch (Jon's PR #48 design bounce): the 4-column table renders
 * ONLY when a section has published part rows (Calculus AB, the language
 * exams). An exam with no parts — however many sections it has — renders one
 * spacious two-line block per section instead (bounce pass 2: name line +
 * muted left-aligned stats line, wrapping only between `·`-separated stat
 * phrases), in its own group visually distinct from the metadata rows below
 * ("Exam length", "Calculator", …). See {@link sectionsHavePartRows} and
 * {@link SectionBlock}.
 *
 * A single instance is rendered by {@link CatalogGrid} for the currently open
 * subject (not one per card). The dialog:
 *   - moves focus into itself on open and traps Tab within it,
 *   - closes on Escape or the close button,
 *   - restores focus to the invoking element on close,
 *   - locks background scroll while open.
 *
 * Data rule (PROJECT.md / PRD §7.5): any `"pending"` value renders as a visible
 * muted badge — never blank, never a fabricated number.
 */

interface InfoPanelProps {
  subject: ApSubject;
  onClose: () => void;
}

/** Muted badge for any value College Board has not yet published. */
function PendingBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
      pending
    </span>
  );
}

/** One label/value row inside the format description list. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 dark:border-slate-800">
      <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-sm break-words text-slate-900 sm:text-right dark:text-slate-100">
        {children}
      </dd>
    </div>
  );
}

/** Format a whole-minute duration as e.g. "2 h 45 min" / "3 h" / "50 min". */
function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/**
 * Format an ISO calendar date as a *local* date (floating — no timezone).
 * Building the Date from explicit parts avoids the UTC-parse day-shift of
 * `new Date("2026-04-30")` in negative-offset zones.
 */
function formatDeadline(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

/** A count that may be an exact number, a published range, or "pending". */
function CountValue({ value }: { value: number | string }) {
  return value === "pending" ? <PendingBadge /> : <>{value}</>;
}

/** A duration in whole minutes, a published range (verbatim), or "pending". */
function MinutesValue({ value }: { value: number | string }) {
  if (value === "pending") return <PendingBadge />;
  if (typeof value === "number") return <>{formatMinutes(value)}</>;
  // Published range, e.g. "65–70" — rendered verbatim, never averaged.
  return <>{value} min</>;
}

/**
 * College Board prints no value here (e.g. no question count for a
 * project-style component) — distinct from "pending", which means a value
 * exists but is not yet published.
 */
function NotPublishedDash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">none published</span>
    </>
  );
}

const sectionsTableHeaderCell =
  "py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400";
const sectionsTableNumCell = "py-2.5 pl-2 text-right align-baseline";

/**
 * The per-section questions | length | weight table (issue #44).
 *
 * A real `<table>` so screen readers convey each value's column relationship;
 * every section and part row is a `<th scope="row">`. Part rows are visually
 * subordinate (indented, lighter weight) and programmatically associated with
 * their section via an sr-only "<section> — " prefix in the row header.
 * Design decision (issue #44): parts render as indented sub-rows of the same
 * table rather than a nested sub-table — one header set, simpler AT output.
 */
function SectionsTable({ sections }: { sections: readonly ExamSection[] }) {
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">
        Exam sections: questions, length, and share of score
      </caption>
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <th scope="col" className={`${sectionsTableHeaderCell} pr-2`}>
            Section
          </th>
          <th scope="col" className={`${sectionsTableHeaderCell} pl-2 text-right`}>
            Questions
          </th>
          <th scope="col" className={`${sectionsTableHeaderCell} pl-2 text-right`}>
            Length
          </th>
          <th scope="col" className={`${sectionsTableHeaderCell} pl-2 text-right`}>
            Weight
          </th>
        </tr>
      </thead>
      <tbody>
        {sections.map((section, sectionIndex) => (
          <Fragment key={`${sectionIndex}-${section.name}`}>
            <tr className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
              <th
                scope="row"
                className="py-2.5 pr-2 text-left align-baseline text-sm font-medium break-words text-slate-900 dark:text-slate-100"
              >
                {section.name}
                {section.note && (
                  <span className="block text-xs leading-snug font-normal text-slate-500 dark:text-slate-400">
                    {section.note}
                  </span>
                )}
              </th>
              <td className={`${sectionsTableNumCell} text-sm text-slate-900 dark:text-slate-100`}>
                {section.questionCount === undefined ? (
                  <NotPublishedDash />
                ) : (
                  <CountValue value={section.questionCount} />
                )}
              </td>
              <td className={`${sectionsTableNumCell} text-sm whitespace-nowrap text-slate-900 dark:text-slate-100`}>
                <MinutesValue value={section.minutes} />
              </td>
              <td className={`${sectionsTableNumCell} text-sm whitespace-nowrap text-slate-900 dark:text-slate-100`}>
                {section.weightPercent === "pending" ? (
                  <PendingBadge />
                ) : (
                  `${section.weightPercent}%`
                )}
              </td>
            </tr>
            {section.parts?.map((part, partIndex) => (
              <tr
                key={`${sectionIndex}-${partIndex}-${part.name}`}
                className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
              >
                <th
                  scope="row"
                  className="py-2 pr-2 pl-4 text-left align-baseline text-sm font-normal break-words text-slate-600 dark:text-slate-300"
                >
                  <span className="sr-only">{section.name} — </span>
                  {part.name}
                  {part.note && (
                    <span className="block text-xs leading-snug text-slate-500 dark:text-slate-400">
                      {part.note}
                    </span>
                  )}
                </th>
                <td className={`${sectionsTableNumCell} text-sm text-slate-600 dark:text-slate-300`}>
                  {part.questionCount === undefined ? (
                    <NotPublishedDash />
                  ) : (
                    <CountValue value={part.questionCount} />
                  )}
                </td>
                <td className={`${sectionsTableNumCell} text-sm whitespace-nowrap text-slate-600 dark:text-slate-300`}>
                  <MinutesValue value={part.minutes} />
                </td>
                <td className={`${sectionsTableNumCell} text-sm text-slate-600 dark:text-slate-300`}>
                  <NotPublishedDash />
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Spacious two-line section block for exams with NO published part splits
 * (Jon's PR #48 design bounce, pass 2): no table, no column header — each
 * section renders as a left-aligned block:
 *
 *   Multiple Choice
 *   60 questions · 1 h 30 min · 50% of score
 *
 * Line 1 is the section name — medium weight, never truncated; long College
 * Board names wrap harmlessly because nothing shares the line. Line 2 is the
 * muted stats line: each `·`-separated stat phrase is atomic
 * (whitespace-nowrap, separator kept with the preceding phrase), so the line
 * can only wrap BETWEEN phrases — "50% of / score" mid-phrase breaks are
 * impossible by construction. A published note (FRQ composition etc.) stays
 * as a third muted line. Generous block padding (~1.5× the metadata rows'),
 * and the whole sections group sits above a divider + larger gap so it reads
 * as a distinct zone from the metadata rows below.
 *
 * Value shape: `<count> questions · <length> · <weight>% of score`. Honest
 * degradation is unchanged in meaning:
 *   - a "pending" value renders the pending badge inline in its stat slot —
 *     never a blanked segment, never a dropped row;
 *   - a published range ("55–75") renders verbatim;
 *   - a question count College Board does not print at all (omission — e.g.
 *     the AAS Individual Student Project, which is a project, not a question
 *     set) omits the questions phrase entirely: omission ≠ pending.
 *
 * The dt/dd pairing keeps the section-name → questions/length/weight
 * association programmatic for screen readers.
 */
function SectionBlock({ section }: { section: ExamSection }) {
  const phrases: ReactNode[] = [];
  if (section.questionCount !== undefined) {
    phrases.push(
      section.questionCount === "pending" ? (
        <PendingBadge />
      ) : (
        questionCountLabel(section.questionCount)
      ),
    );
  }
  phrases.push(<MinutesValue value={section.minutes} />);
  phrases.push(
    section.weightPercent === "pending" ? (
      <PendingBadge />
    ) : (
      `${section.weightPercent}% of score`
    ),
  );

  return (
    <div className="py-4 first:pt-1">
      <dt className="text-sm font-medium break-words text-slate-900 dark:text-slate-100">
        {section.name}
      </dt>
      <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {phrases.map((phrase, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            <span data-testid="stat-phrase" className="whitespace-nowrap">
              {phrase}
              {index < phrases.length - 1 && " ·"}
            </span>
          </Fragment>
        ))}
        {section.note && (
          <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">
            {section.note}
          </span>
        )}
      </dd>
    </div>
  );
}

const DELIVERY_LABELS: Record<"digital" | "paper" | "hybrid", string> = {
  digital: "Digital",
  paper: "Paper",
  hybrid: "Hybrid (digital + paper)",
};

export function InfoPanel({ subject, onClose }: InfoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  // Focus trap + Escape-to-close + scroll lock + focus restore (issue #8:
  // shared with the conflict dialog via src/lib/modal.ts).
  useModalDialog(panelRef, onClose, closeButtonRef);

  const { format, portfolio } = subject;

  // Issue #44: an empty sections array means "no sit-down exam" (the four
  // portfolio-only subjects) — the exam-format rows are omitted entirely,
  // never rendered as zeroed or "pending" placeholders.
  const hasSections = format.sections.length > 0;

  // Jon's PR #48 design bounce: the 4-column table earns its keep only when
  // a section has published part rows. The branch is parts-based, never
  // count-based — a 5-section exam with no parts gets 5 spacious rows.
  const showSectionsTable = hasSections && sectionsHavePartRows(format.sections);

  // Tier 3 (issue #22): verified official College Board page — `null` (link
  // omitted) for any subject without an individually verified URL.
  const officialUrl = officialCollegeBoardUrl(subject.id);

  const whenLabel = subject.exam
    ? `Exam ${new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(
        (() => {
          const [y, m, d] = subject.exam.date.split("-").map(Number);
          return new Date(y, m - 1, d);
        })(),
      )} · ${subject.exam.session}`
    : portfolio
      ? "Portfolio-only — no written exam"
      : "No May 2026 exam";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6 dark:border-slate-800">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-semibold break-words text-slate-900 dark:text-slate-50"
            >
              <SubjectName
                id={subject.id}
                name={subject.name}
                category={subject.category}
              />
            </h2>
            <p
              id={descId}
              className="mt-1 text-sm text-slate-500 dark:text-slate-400"
            >
              {subject.category} · {whenLabel}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none sm:h-9 sm:w-9 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
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
        </div>

        <div className="p-5 sm:p-6">
          {/* Issue #44: one row per published section. The table (with parts
              nested beneath their section) renders only when the exam HAS
              published parts; a partless exam renders its sections as
              spacious two-line blocks in their own group instead (PR #48
              bounce, pass 2), separated from the metadata rows below by a
              divider + larger gap so the two zones read as distinct.
              A portfolio-only subject has no sections — no table, no zeroed
              rows; its portfolio block below tells the real story. */}
          {showSectionsTable && <SectionsTable sections={format.sections} />}

          {hasSections && !showSectionsTable && (
            <dl>
              {format.sections.map((section, index) => (
                <SectionBlock
                  key={`${index}-${section.name}`}
                  section={section}
                />
              ))}
            </dl>
          )}

          <dl
            className={
              showSectionsTable
                ? "mt-2"
                : hasSections
                  ? "mt-2 border-t border-slate-200 pt-2 dark:border-slate-700"
                  : undefined
            }
          >
            {hasSections && (
              <>
                <Row label="Exam length">
                  {format.totalMinutes === "pending" ? (
                    <PendingBadge />
                  ) : (
                    formatMinutes(format.totalMinutes)
                  )}
                </Row>

                <Row label="Calculator">
                  {format.calculator === "pending" ? (
                    <PendingBadge />
                  ) : format.calculator ? (
                    "Permitted"
                  ) : (
                    "Not permitted"
                  )}
                </Row>

                <Row label="Delivery">
                  {format.delivery === "pending" ? (
                    <PendingBadge />
                  ) : (
                    DELIVERY_LABELS[format.delivery]
                  )}
                </Row>
              </>
            )}

            <Row label="Pass rate">
              <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
                {subject.passRate === "pending" ? (
                  <PendingBadge />
                ) : (
                  <span className="font-semibold">{subject.passRate}%</span>
                )}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  scored 3 or higher
                </span>
              </span>
            </Row>
          </dl>

          {portfolio && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Portfolio component
              </h3>
              <dl className="mt-2">
                <Row label="Weight">
                  {portfolio.weightPct === "pending" ? (
                    <PendingBadge />
                  ) : (
                    <span className="font-semibold">
                      {portfolio.weightPct}%{" "}
                      <span className="font-normal text-slate-600 dark:text-slate-400">
                        of final score
                      </span>
                    </span>
                  )}
                </Row>
                <Row label="Deadline">{formatDeadline(portfolio.deadline)}</Row>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-amber-800/90 dark:text-amber-200/80">
                {portfolio.note}
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300/70">
                Schools often set earlier internal deadlines — confirm yours with
                your teacher.
              </p>
            </div>
          )}

          {subject.noExamReason && (
            <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
              {subject.noExamReason}
            </p>
          )}

          {/* Tier 3 (issue #22): the subject's official College Board page.
              Opens externally in a new tab; the ↗ glyph is the visible
              affordance and the sr-only text announces it to AT. */}
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-800"
            >
              Official College Board page
              <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
