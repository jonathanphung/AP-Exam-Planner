"use client";

import { Fragment, type ReactNode, useId, useRef } from "react";
import type {
  ApSubject,
  ExamSection,
  ExamSectionPart,
} from "@/data/schema";
import { CYCLE } from "@/data/cycle";
import { useModalDialog } from "@/lib/modal";
import { minuteGroups, partWeight } from "@/lib/exam-sections";
import { officialCollegeBoardUrl } from "@/lib/college-board-links";
import { SubjectName } from "@/components/SubjectName";
import { ArrowUpRightIcon } from "@/components/ArrowUpRightIcon";

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
 * portfolio block carries the story instead. Any cell College Board publishes
 * no value for renders {@link NotPublishedDash}.
 *
 * ONE presentation for every exam (Jon's #73 bounce, 2026-07-25). Every
 * subject with at least one published section renders {@link SectionsTable};
 * part rows nest under their section where parts exist and are simply absent
 * where they don't. This **supersedes Jon's PR #48 design bounce**, which had
 * given partless exams a spacious two-line block per section instead of the
 * table (pass 2: "no table, no column header"), tuned again in his "9px
 * matched" spacing follow-up (2026-07-10). Both were deliberate calls; the
 * cost was that AP Human Geography and AP English Language presented nothing
 * like AP Calculus BC even though every number the table needs is published
 * for them — the exact inconsistency issue #73 exists to remove. The prose
 * block and its parts-based branch rule (`sectionsHavePartRows`) are gone;
 * see the presentation history in src/lib/exam-sections.ts before adding a
 * second layout back.
 *
 * A single instance is rendered by {@link CatalogGrid} for the currently open
 * subject (not one per card). The dialog:
 *   - moves focus into itself on open and traps Tab within it,
 *   - closes on Escape or the close button,
 *   - restores focus to the invoking element on close,
 *   - locks background scroll while open.
 *
 * Data rule (PROJECT.md / PRD §7.5): a value College Board does not publish
 * renders as {@link NotPublishedDash} — never blank, never a fabricated
 * number, and never a deleted row.
 *
 * ## Issue #84 (2026-07-25) — one unpublished state, not two
 *
 * This panel used to have a second affordance: a muted `pending` pill, for a
 * value College Board publishes that our capture had missed. The two said
 * genuinely different things — the dash accuses College Board of printing
 * nothing, the pill accused US of missing something — and #73 was right to
 * keep them apart. What changed is the evidence, not the principle: all 33
 * pill-wearing values were re-checked against the live College Board pages on
 * 2026-07-25 and every one of them turned out to be unpublished, so the pill
 * had no members and its component is gone with them. The reasoning is kept
 * here because the NEXT capture will hit the same fork, and the answer is now
 * "verify the page, then either fill the number or dash it" — not "add the
 * badge back".
 */

interface InfoPanelProps {
  subject: ApSubject;
  onClose: () => void;
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
  return minuteGroups(total).join(" ");
}

/**
 * A value rendered so it can only ever break BETWEEN its groups.
 *
 * The Length column has a width budget now (see {@link SectionsTable}), so at
 * the narrowest widths "1 h 30 min" no longer has a whole line to itself.
 * Left to ordinary wrapping it would break wherever it happened to run out of
 * room — "1 h 30" / "min", or "65–70" split from its "min". Each group is
 * `whitespace-nowrap` and the only breakable space is the one between them,
 * so the narrow-width fallback is the readable "1 h" / "30 min".
 *
 * The rendered text is identical to the single-line form — plain spaces
 * between groups, no `&nbsp;` — so `textContent` still reads "1 h 30 min" for
 * assistive tech and for the specs that assert it.
 */
function NoBreakGroups({ groups }: { groups: readonly string[] }) {
  return (
    <>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 ? " " : null}
          <span className="whitespace-nowrap">{group}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Format an ISO calendar date as a *local* date (floating — no timezone).
 * Building the Date from explicit parts avoids the UTC-parse day-shift of
 * `new Date("2027-04-30")` in negative-offset zones.
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

/** A duration in whole minutes, or a published range (verbatim). */
function MinutesValue({ value }: { value: number | string }) {
  if (typeof value === "number")
    return <NoBreakGroups groups={minuteGroups(value)} />;
  // Published range, e.g. "65–70" — rendered verbatim, never averaged. The
  // range itself must never break across lines (a "65–" / "70 min" would read
  // as a different value), so it is its own group.
  return <NoBreakGroups groups={[value, "min"]} />;
}

/**
 * College Board prints no value here — no question count for a project-style
 * component, no per-question duration for the world-language project speaking
 * tasks, no score distribution for a course that has never been administered.
 * Since issue #84 this is the ONLY unpublished affordance in the panel, and
 * every surface reuses this one component so a second dash style cannot drift
 * in. The `sr-only` text travels with the glyph: an em dash alone is silence
 * to a screen reader.
 */
function NotPublishedDash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">none published</span>
    </>
  );
}

/**
 * A part row's share of the score (issue #73, converted by #83).
 *
 * Before #73 this cell was an unconditional dash for every part of every
 * exam — not because College Board publishes nothing, but because the schema
 * had nowhere to put it. #73 then rendered the printed weight, and where
 * College Board's denominator was not the exam it rendered the phrase
 * verbatim: `50% of section score`, `each worth 25% of section score`. The
 * doc here said that phrase must "never [be] converted into an
 * exam-denominated number, which would tell a student one AP Macroeconomics
 * question is half their grade."
 *
 * Issue #83 supersedes that, and the old reasoning is kept above rather than
 * deleted because half of it still holds: the forbidden move was RELABELLING
 * the literal 50 as 50% of the exam. Multiplying is a different operation —
 * Section II is 33% of the exam, so 50% of it is 16.5% of the exam, which is
 * both true and the number the student was trying to work out. Jon raised it
 * from the AP Microeconomics card, where this cell was spending four wrapped
 * lines to avoid saying "16.5%". The conversion itself lives in
 * {@link partWeight}; this component only decides how the result reads:
 *
 *   - a converted or exam-denominated weight → `16.5%` / `35%`, the same
 *     shape as the section row's `50%` — and short enough that the Weight
 *     column's budget (see {@link SectionsTable}) stops being contested;
 *   - a PER-QUESTION weight ("each worth 25% of section score" on a row whose
 *     Questions cell reads 2) → the number plus a visible `each`. A bare
 *     `8.25%` on that row would read as the row's total, which is wrong by a
 *     factor of two, so the qualifier is on screen and not merely in the
 *     accessible name;
 *   - a form the converter cannot read → the printed string verbatim, wrapped.
 *     Unreachable for the shipped dataset (the schema rejects it) and kept as
 *     the honest fallback: a phrase nobody can parse still beats a number
 *     nobody can trust;
 *   - unpublished → the dash, which means what it says.
 */
function PartWeightValue({
  part,
  sectionWeightPercent,
}: {
  part: ExamSectionPart;
  sectionWeightPercent: ExamSection["weightPercent"];
}) {
  const weight = partWeight(part, sectionWeightPercent);
  switch (weight.kind) {
    case "percent":
      return (
        <>
          {weight.value}%
          {weight.each && (
            // Its own line: the Weight column is budgeted at 5rem and
            // "8.25% each" does not fit on one. `block` puts the break where
            // this component chooses it rather than wherever the column runs
            // out, and the sr-only word makes the AT reading of the cell
            // "8.25% each question" instead of the ambiguous "8.25% each".
            <span className="block text-xs leading-snug font-normal text-slate-500 dark:text-slate-400">
              each<span className="sr-only"> question</span>
            </span>
          )}
        </>
      );
    case "printed":
      // `inline-block` + `break-words`: the phrase wraps INSIDE the Weight
      // column's budget instead of asking for a wider column — the same rule
      // the section note follows in the Section column (Jon's second #73
      // bounce). Right-aligned like every other value in the column.
      return (
        <span className="inline-block text-xs leading-snug break-words">
          {weight.text}
        </span>
      );
    case "unpublished":
      return <NotPublishedDash />;
  }
}

const sectionsTableHeaderCell =
  "py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400";
/**
 * The gutter between the numeric columns: 12px, dropping to 8px below 400px
 * where those 4px are the difference between the "Questions" header fitting
 * its budgeted column and overflowing it. Same step on the Section column's
 * `pr`, so the four gutters always match.
 */
const sectionsTableGutter = "pl-2 min-[400px]:pl-3";
const sectionsTableNumCell = `py-2.5 ${sectionsTableGutter} text-right align-baseline`;

/**
 * The per-section questions | length | weight table (issue #44) — since Jon's
 * #73 bounce, the ONLY presentation any exam gets.
 *
 * A real `<table>` so screen readers convey each value's column relationship;
 * every section and part row is a `<th scope="row">`, under the sr-only
 * caption. Part rows are visually subordinate (indented, lighter weight) and
 * programmatically associated with their section via an sr-only
 * "<section> — " prefix in the row header. Design decision (issue #44): parts
 * render as indented sub-rows of the same table rather than a nested
 * sub-table — one header set, simpler AT output.
 *
 * A section with no published parts is exactly one row and nothing else — no
 * empty part row, no placeholder. `section.parts?.map` covers both the
 * omitted and the empty array; the 18 subjects that render no part rows at
 * all (AP Human Geography, AP Music Theory, …) reach this table with the
 * same markup the 20 part-carrying subjects already used.
 *
 * Honest degradation (PRD §7.5) is per CELL, and the states stay distinct in
 * every column:
 *   - a published number → as printed.
 *   - a published range ("55–75", "65–70") → verbatim, never averaged.
 *   - a value College Board does not print at all → {@link NotPublishedDash}.
 *     Never a blank cell, never a dropped row.
 *
 * There were THREE states until issue #84. `"pending"` was the third —
 * "College Board publishes a number this capture does not have", as opposed to
 * `undefined`, "the concept does not apply (the AAS Individual Student Project
 * is a project, not a question set)". That distinction was deliberate (#73)
 * and it was the right shape for a capture that might be incomplete; it is
 * recorded here rather than deleted because it is the reasoning a future
 * capture will need. What retired it was evidence: re-verified against the
 * live pages on 2026-07-25, all 33 `"pending"` cells were things College Board
 * does not publish, so they are now `undefined` and read as the dash. What
 * College Board DOES print about those rows (an untimed 3-week project, "3
 * minutes to prepare; 3 minutes to present", "Questions 3 & 4 combined 30
 * minutes") is in the row's note, one column to the left — the dash is
 * specifically about the Length figure, and no published fact was dropped
 * to produce it.
 *
 * ## Column budget (Jon's second #73 bounce, 2026-07-25)
 *
 * The columns are budgeted by `<colgroup>` under `table-fixed`, NOT sized
 * from their content. Under the default auto layout a column's width is
 * negotiated from what is in it, and the Section cell holds `section.note` —
 * free prose up to 108 characters ("4 free-response questions (concept
 * application, quantitative analysis, comparative analysis, argument
 * essay)"). A long note won that negotiation and squeezed Questions / Length
 * / Weight into a cramped strip at the right edge: AP Comparative Government
 * collapsed to `4 · 1 h 30 min · 50%` jammed together. `break-words` did not
 * help — it governs how a cell wraps once the column is narrow, not how wide
 * the column asks to be.
 *
 * So the three numeric columns take a guaranteed share and Section takes the
 * remainder. The share is a percentage below 400px and a fixed rem at and
 * above it. Two steps because the two ends want opposite things: below 400px
 * every pixel is contested and the numeric columns must scale down with the
 * dialog to leave the section names anything at all; from 400px up they stop
 * growing, because a wider dialog does not make "1 h 30 min" any longer — the
 * slack belongs to the section names, the only cells whose content grows.
 * Above `sm` the dialog itself stops growing (`max-w-lg`), so every desktop
 * gets the same 464px table: Section 224px, then 72 / 88 / 80.
 *
 * The obvious single expression, `width: min(5.5rem, 27%)`, does NOT work:
 * Chrome ignores a math function containing a percentage on a table column
 * (and on a header cell) and silently falls back to equal division — measured,
 * all four columns came out 115.5px. Plain lengths and plain percentages are
 * honored, hence the breakpoint.
 *
 * The floors are measured, not guessed: "Questions" is the widest thing its
 * own column ever holds (54px at `text-xs`), the pending pill was 61px and
 * could not wrap, and "43.75%" is 45px.
 *
 * Issue #84 removed that pill, and the budget is deliberately UNCHANGED. The
 * Length column's widest remaining content is a published range ("65–70 min"),
 * which still wants the room; narrowing a column is an overflow change, and
 * overflow on this table has already been re-cut twice on measured evidence
 * (#74, #80). Re-tuning it belongs in a card that captures that evidence, not
 * in the one that deleted a badge.
 *
 * This is a property of the shared table, so it holds for every subject that
 * has sections — no per-subject width, no special case for the observed one.
 * Two column contents can still exceed their budget, and both wrap inside it
 * rather than widening it: a published length ({@link NoBreakGroups}) and a
 * part's weight ({@link PartWeightValue} — since issue #83 that is at most a
 * short percentage plus a per-question `each` on its own line, where before it
 * was the full "each worth 25% of section score" phrase; the budget did not
 * change, the pressure on it dropped). The Length column is the widest share
 * because it was the only one that could hold the pending pill (AAS's
 * Individual Student Project), a fixed ~61px element that could not wrap; with
 * the pill gone its widest content is a published range plus its unit.
 */
function SectionsTable({ sections }: { sections: readonly ExamSection[] }) {
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">
        Exam sections: questions, length, and share of score
      </caption>
      <colgroup>
        {/* Section: whatever the three budgeted columns leave — 28% of a
            320px dialog, 224px of the 464px every desktop gets. */}
        <col />
        {/* A count, a published range ("55–75"), or a dash. Its widest
            content is the "Questions" column header itself (54px). */}
        <col className="w-[24%] min-[400px]:w-[4.5rem]" />
        {/* "1 h 30 min", "65–70 min", or a dash. Budgeted around the 61px
            pending badge issue #84 removed; see the doc above for why the
            width is deliberately left alone. */}
        <col className="w-[27%] min-[400px]:w-[5.5rem]" />
        {/* "43.75%", a dash, or a printed phrase that wraps. */}
        <col className="w-[21%] min-[400px]:w-[5rem]" />
      </colgroup>
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <th
            scope="col"
            className={`${sectionsTableHeaderCell} pr-2 min-[400px]:pr-3`}
          >
            Section
          </th>
          <th
            scope="col"
            className={`${sectionsTableHeaderCell} ${sectionsTableGutter} text-right`}
          >
            Questions
          </th>
          <th
            scope="col"
            className={`${sectionsTableHeaderCell} ${sectionsTableGutter} text-right`}
          >
            Length
          </th>
          <th
            scope="col"
            className={`${sectionsTableHeaderCell} ${sectionsTableGutter} text-right`}
          >
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
                className="py-2.5 pr-2 text-left align-baseline text-sm font-medium break-words text-slate-900 min-[400px]:pr-3 dark:text-slate-100"
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
                  section.questionCount
                )}
              </td>
              <td className={`${sectionsTableNumCell} text-sm text-slate-900 dark:text-slate-100`}>
                {section.minutes === undefined ? (
                  <NotPublishedDash />
                ) : (
                  <MinutesValue value={section.minutes} />
                )}
              </td>
              <td className={`${sectionsTableNumCell} text-sm whitespace-nowrap text-slate-900 dark:text-slate-100`}>
                {section.weightPercent}%
              </td>
            </tr>
            {section.parts?.map((part, partIndex) => (
              <tr
                key={`${sectionIndex}-${partIndex}-${part.name}`}
                className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
              >
                <th
                  scope="row"
                  className="py-2 pr-2 pl-4 text-left align-baseline text-sm font-normal break-words text-slate-600 min-[400px]:pr-3 dark:text-slate-300"
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
                    part.questionCount
                  )}
                </td>
                <td className={`${sectionsTableNumCell} text-sm text-slate-600 dark:text-slate-300`}>
                  {part.minutes === undefined ? (
                    <NotPublishedDash />
                  ) : (
                    <MinutesValue value={part.minutes} />
                  )}
                </td>
                <td className={`${sectionsTableNumCell} text-sm text-slate-600 dark:text-slate-300`}>
                  <PartWeightValue
                    part={part}
                    sectionWeightPercent={section.weightPercent}
                  />
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
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
  // never rendered as zeroed or placeholder rows.
  const hasSections = format.sections.length > 0;

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
      : `No ${CYCLE} exam`;

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
          {/* One row per published section, parts nested beneath their own
              section — the single presentation every exam now gets (Jon's #73
              bounce, superseding the PR #48 partless prose blocks; see the
              module doc above).
              A portfolio-only subject has no sections — no table, no zeroed
              rows; its portfolio block below tells the real story. */}
          {hasSections && <SectionsTable sections={format.sections} />}

          <dl className={hasSections ? "mt-2" : undefined}>
            {hasSections && (
              <>
                <Row label="Exam length">
                  {format.totalMinutes === undefined ? (
                    <NotPublishedDash />
                  ) : (
                    formatMinutes(format.totalMinutes)
                  )}
                </Row>

                <Row label="Calculator">
                  {format.calculator === undefined ? (
                    <NotPublishedDash />
                  ) : format.calculator ? (
                    "Permitted"
                  ) : (
                    "Not permitted"
                  )}
                </Row>

                <Row label="Delivery">
                  {format.delivery === undefined ? (
                    <NotPublishedDash />
                  ) : (
                    DELIVERY_LABELS[format.delivery]
                  )}
                </Row>
              </>
            )}

            {/* The row is never deleted to make an unpublished figure go away
                (PRD §7.5, and issue #84's explicit call): it stays, the cell
                says what is true, and — for the three AP Career Kickstart
                courses that have never been administered — `passRateNote`
                says why College Board has published nothing yet, so the dash
                does not read as a bug in this app. */}
            <Row label="Pass rate">
              <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
                {subject.passRate === undefined ? (
                  <NotPublishedDash />
                ) : (
                  <span className="font-semibold">{subject.passRate}%</span>
                )}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  scored 3 or higher
                </span>
                {subject.passRateNote && (
                  <span className="block w-full text-xs leading-snug text-slate-500 sm:text-right dark:text-slate-400">
                    {subject.passRateNote}
                  </span>
                )}
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
                  {portfolio.weightPct === undefined ? (
                    <NotPublishedDash />
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

          {/* A published qualifier on the exam itself (AP Networking's May
              2027 date is "2026-27 pilot schools only"). Same reason as the
              chip's disclosure renders it (SubjectChip.tsx): the header above
              prints a bare `Exam May 7 · PM`, which without its published
              restriction reads as an exam any student can sit. Sibling of
              `noExamReason` — mutually exclusive in this cycle's data, but the
              schema does not require that, so both branches stand alone. */}
          {subject.examNote && (
            <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
              {subject.examNote}
            </p>
          )}

          {subject.noExamReason && (
            <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
              {subject.noExamReason}
            </p>
          )}

          {/* Tier 3 (issue #22): the subject's official College Board page.
              Opens externally in a new tab; the inline SVG arrow (issue #50)
              is the visible affordance and the sr-only text announces it to
              AT. */}
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-800"
            >
              Official College Board page
              <ArrowUpRightIcon />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
