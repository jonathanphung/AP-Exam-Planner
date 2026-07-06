"use client";

import { type ReactNode, useId, useRef } from "react";
import type { ApSubject } from "@/data/schema";
import { useModalDialog } from "@/lib/modal";
import { SubjectName } from "@/components/SubjectName";

/**
 * Accessible exam-info modal (issue #6).
 *
 * Answers "what am I walking into on exam day" for one subject: format
 * (MCQ/FRQ counts, length, calculator, delivery), the most recent pass rate,
 * and — for portfolio subjects — the portfolio's weight and deadline.
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
function Row({ label, children }: { label: string; children: ReactNode }) {
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
          <dl>
            <Row label="Multiple choice">
              <CountValue value={format.mcqCount} />
              {format.mcqCount !== "pending" && (
                <span className="text-slate-500 dark:text-slate-400">
                  {" "}
                  questions
                </span>
              )}
            </Row>

            <Row label="Free response">
              <div className="flex flex-col gap-0.5 sm:items-end">
                <span>
                  <CountValue value={format.frqCount} />
                  {format.frqCount !== "pending" && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {" "}
                      questions
                    </span>
                  )}
                </span>
                {format.frqType === "pending" ? (
                  <PendingBadge />
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {format.frqType}
                  </span>
                )}
              </div>
            </Row>

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
        </div>
      </div>
    </div>
  );
}
