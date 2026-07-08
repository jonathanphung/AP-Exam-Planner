"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import apData from "@/data/ap-2026.json";
import {
  CATEGORIES,
  type ApDataset,
  type ApSubject,
  type Category,
} from "@/data/schema";
import { useSelection } from "@/lib/selection";
import {
  replaceResolutions,
  setResolution,
  useResolutions,
} from "@/lib/resolutions";
import {
  findSameSlotConflicts,
  pruneResolutions,
  resolveSlots,
  slotKey,
  unresolvedConflicts,
  type SlotResolution,
} from "@/lib/conflicts";
import { buildSchedule, formatDateLabel } from "@/lib/schedule";
import {
  buildCalendarLayout,
  defaultWeekIndex,
  hourLabel,
  monthDayLabel,
  weekdayLabel,
  weekExamCounts,
  weekRangeLabel,
  SETUP_BUFFER_MINUTES,
  type CalendarBlock,
  type CalendarWeekLayout,
  type OffGridEntry,
  type SubjectCalendarInfo,
} from "@/lib/calendar";
import {
  COORDINATOR_NOTE,
  ConflictDialog,
  nameList,
} from "@/components/ConflictDialog";
import { InfoPanel } from "@/components/InfoPanel";
import { useModalDialog } from "@/lib/modal";

/**
 * Week-paged calendar grid view of the selected exams (issue #19).
 *
 * A UT-Registration-Plus-style time grid, except the columns are REAL May
 * 2026 dates (the published testing windows from the dataset schema). The
 * view shows EXACTLY ONE testing week at a time — matching the single-week
 * look of the reference — and pages through the cycle's weeks with visible
 * Previous/Next buttons instead of vertical month scrolling (issue-19 design
 * bounce). The pages are derived from `REGULAR_WINDOWS` + `LATE_TESTING_WINDOW`
 * via `calendarWeeks()`, never hardcoded, so an annual dataset swap re-pages
 * automatically.
 *
 * Pager design decisions (documented per the bounce spec):
 * - Ends DISABLE the buttons (no wrap-around) — predictable for keyboard and
 *   screen-reader users; the position indicator makes the ends legible.
 * - Default page = first week containing a placed exam (falls back to week 1;
 *   with zero selections the empty-state hint replaces the grid + pager). The
 *   default keeps following the selection as it changes until the student
 *   pages manually — after that, their chosen position wins.
 * - Instead of dot/tab quick-jump, the Prev/Next buttons carry exam-count
 *   badges when other weeks hold exams (the bounce's nice-to-have), so "there
 *   is more" is visible right on the pager.
 * - Week changes are announced to assistive tech via the `aria-live="polite"`
 *   position indicator.
 *
 * Exams read through the same conflict-resolution layer as the list view
 * (`resolveSlots` → `buildSchedule`), so a moved exam renders at its
 * late-testing slot here exactly as it does there. Blocks anchor at the
 * dataset's published session START times and span the subject's PUBLISHED
 * `format.totalMinutes`, plus a visually distinct {@link SETUP_BUFFER_MINUTES}
 * setup-buffer segment (second design bounce; see `src/lib/calendar.ts` for
 * the documented height rules, including the marked-approximate fallback for
 * "pending" lengths). Portfolio deadlines and undated subjects are LISTED
 * beside the grid — never positioned at an invented time (PRD §7.5).
 *
 * Blocks are interactive (second bounce, item C):
 * - activating a block opens the same exam-details popup as the catalog's
 *   info button (the shared {@link InfoPanel});
 * - a block still in an UNRESOLVED time conflict first surfaces the issue-#5
 *   {@link ConflictDialog} so the conflict can be resolved from this view;
 * - a block MOVED to late testing opens {@link LateTestingDialog}: switch it
 *   back to the regular slot (which re-opens the conflict prompt, since the
 *   regular slot re-collides) or keep it at the regular time and move the
 *   other exam(s) instead — both routed through the shared resolutions store
 *   so the list view and the ICS export reflect the change identically.
 */

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here.
const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
const SUBJECTS_BY_ID: ReadonlyMap<string, ApSubject> = new Map(
  SUBJECTS.map((subject) => [subject.id, subject]),
);
const SUBJECT_INFO_BY_ID: ReadonlyMap<string, SubjectCalendarInfo> = new Map(
  SUBJECTS.map((subject) => [
    subject.id,
    { category: subject.category, totalMinutes: subject.format.totalMinutes },
  ]),
);
const CYCLE = dataset.cycle;
const SESSION_START_TIMES = dataset.sessionStartTimes;

/** Pixel height of one axis hour (drives all block positioning). */
const HOUR_PX = 44;

/** Vertical breathing gap between stacked blocks, absorbed by the buffer segment. */
const BLOCK_GAP_PX = 4;

/**
 * Category → block/legend colors — a soft PASTEL scheme (issue #30): low-
 * saturation fills carry a darker same-hue text + a soft same-hue left accent
 * bar, so the calendar reads like a calm planner rather than a saturated alert
 * board. Orange is deliberately NOT a category hue — it is reserved for the
 * unresolved-conflict style below, so a conflict block can never be confused
 * with a category one.
 *
 * Palette mechanism (updated per Jon's post-approval bounce on PR #34): the
 * four light-mode fills are Jon's EXACT hex codes, expressed as Tailwind v4
 * arbitrary values (`bg-[#C7CEEA]` …) rather than nearest stock shades. Career
 * Kickstart — the only category with no exam-bearing subject, so it renders
 * only as a legend / off-grid dot, never a grid block — takes a harmonizing
 * fifth pastel (soft lavender `#CDB4DB`) chosen to fill the blue→pink gap and
 * stay clear of both the pink Arts hue and the reserved orange.
 *
 *   Light fills — STEM `#C7CEEA` (blue) · Humanities `#F7DC8D` (yellow) ·
 *                 Languages `#C9E89B` (green) · Arts `#FF9AA2` (pink) ·
 *                 Career Kickstart `#CDB4DB` (lavender).
 *
 * Per-hue companions are derived from each fill: a darker same-hue text, a
 * mid same-hue left-accent border + legend dot, and a deep desaturated
 * same-hue DARK fill with a light same-hue text (a muted dark treatment — NOT
 * the light pastels inverted, and NOT the old emerald/indigo/rose/fuchsia
 * hues). Every text/fill pair clears WCAG AA (≥4.5:1) in BOTH themes — tightest
 * is light Arts at 5.09:1 — asserted live from the rendered colours in
 * e2e/issue-30-calendar-palette.spec.ts and captured in the QA evidence.
 */
const CATEGORY_STYLES: Record<
  Category,
  { block: string; dot: string }
> = {
  STEM: {
    block:
      "border-[#7C8AC4] bg-[#C7CEEA] text-[#28345E] dark:border-[#5566A0] dark:bg-[#2A3458] dark:text-[#DCE3F7]",
    dot: "bg-[#5E74C0] dark:bg-[#8296DC]",
  },
  Humanities: {
    block:
      "border-[#D6B94A] bg-[#F7DC8D] text-[#5C4708] dark:border-[#8A7526] dark:bg-[#52420F] dark:text-[#F6E6A8]",
    dot: "bg-[#CBA53A] dark:bg-[#E3C766]",
  },
  Languages: {
    block:
      "border-[#8FBF5A] bg-[#C9E89B] text-[#38541A] dark:border-[#63863C] dark:bg-[#2B4A1C] dark:text-[#DCEFBE]",
    dot: "bg-[#7EB84A] dark:bg-[#A0D172]",
  },
  Arts: {
    block:
      "border-[#E5666F] bg-[#FF9AA2] text-[#7A1E28] dark:border-[#A24A54] dark:bg-[#52222A] dark:text-[#FBC7CC]",
    dot: "bg-[#EF5D6A] dark:bg-[#F98A93]",
  },
  "Career Kickstart": {
    block:
      "border-[#A47CC0] bg-[#CDB4DB] text-[#4A2C63] dark:border-[#7A5C96] dark:bg-[#402A58] dark:text-[#E4CFF0]",
    dot: "bg-[#9866C0] dark:bg-[#B98FD8]",
  },
};

const FALLBACK_BLOCK_STYLE =
  "border-slate-400 bg-slate-100 text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-50";

/**
 * Shared ORANGE conflict style (issue #30). Every block in an UNRESOLVED
 * same-slot conflict renders in this style INSTEAD of its category style —
 * both/all members go orange regardless of subject category, so an unresolved
 * clash reads as a single "action needed" cluster. It is set apart from the
 * calm pastel categories on three axes, not colour alone (WCAG "colour is
 * never the only signal"): (a) the reserved orange hue, (b) a full 2px orange
 * outline versus the categories' single left accent bar, and (c) a ⚠️ marker +
 * a "Time conflict" caption on the block, with the conflict also spelled out
 * in the block's accessible name. Text/fill clears AA in both themes.
 *
 * The light fill is a deeper orange (`#FDBA74`, orange-300 weight) rather than
 * the earlier pale orange-200: with Jon's yellow Humanities pastel (`#F7DC8D`)
 * now the conflict's nearest neighbour, the extra depth keeps orange clearly
 * "warmer/deeper alert" at a glance while text-on-fill still clears AA
 * (5.56:1 light, 8.27:1 dark).
 *
 * Orange means ONLY "unresolved conflict": the moment a conflict is resolved
 * (a member moved to late testing) the blocks fall back to their category
 * styling — see `resolveSlots`/`unresolvedConflicts` feeding this component.
 */
const CONFLICT_BLOCK_STYLE =
  "border-2 border-[#EA580C] bg-[#FDBA74] text-[#7C2D12] dark:border-[#FB923C] dark:bg-[#6B2E12] dark:text-[#FFE0C7]";

/** "3 h 15 min" / "2 h" / "45 min" for a whole-minute duration. */
function minutesLabel(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/**
 * One positioned exam block. The whole block is a real `<button>` (keyboard-
 * activatable, focus-visible ring) whose accessible name carries the subject,
 * session, true exam span, and buffer note. Heights are duration-proportional:
 * the labeled portion spans exactly the published exam length from the start
 * time; the visually distinct hatched segment below it is the
 * {@link SETUP_BUFFER_MINUTES} setup allowance — deliberate product padding,
 * kept inspectable instead of silently inflating the published duration.
 */
function ExamBlock({
  block,
  axisStartHour,
  conflicted,
  onActivate,
}: {
  block: CalendarBlock;
  axisStartHour: number;
  /**
   * True when this block is a member of an UNRESOLVED same-slot conflict
   * (computed in {@link CalendarView} from the issue-#5 conflicts layer). It
   * overrides the category style with the shared orange {@link
   * CONFLICT_BLOCK_STYLE} and adds the ⚠️ marker + "time conflict" wording.
   */
  conflicted: boolean;
  onActivate: (block: CalendarBlock) => void;
}) {
  const top = (block.startHour - axisStartHour) * HOUR_PX;
  const examHeight = (block.endHour - block.startHour) * HOUR_PX;
  const bufferHeight = (SETUP_BUFFER_MINUTES / 60) * HOUR_PX - BLOCK_GAP_PX;
  const widthPct = 100 / block.laneCount;
  // Unresolved conflict wins over the category hue: both members go orange.
  const style = conflicted
    ? CONFLICT_BLOCK_STYLE
    : block.category
      ? CATEGORY_STYLES[block.category].block
      : FALLBACK_BLOCK_STYLE;

  const spanLabel = block.approximate
    ? `${block.startClock} · length pending`
    : `${block.startClock} – ${block.endClock}`;
  const spokenSpan = block.approximate
    ? `starts ${block.startClock}, exam length pending, approximate block`
    : `${block.startClock} to ${block.endClock} (${minutesLabel(block.examMinutes!)})`;
  // The conflict is carried in WORDS in the accessible name — never by the
  // orange fill or the ⚠️ glyph alone (both are aria-hidden decoration).
  const accessibleName = [
    block.subjectName,
    conflicted ? "unresolved time conflict, action needed" : null,
    `${block.session} session`,
    spokenSpan,
    `plus ${SETUP_BUFFER_MINUTES} minutes setup buffer`,
    block.movedToLate ? "moved to late testing" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li
      data-testid="calendar-block"
      data-subject-id={block.subjectId}
      data-approximate={block.approximate ? "true" : undefined}
      className="absolute"
      style={{
        top: `${top + 1}px`,
        height: `${examHeight + bufferHeight}px`,
        left: `${block.laneIndex * widthPct}%`,
        width: `calc(${widthPct}% - 3px)`,
      }}
    >
      <button
        type="button"
        onClick={() => onActivate(block)}
        aria-label={accessibleName}
        title={`${block.subjectName} — ${accessibleName.slice(block.subjectName.length + 2)}`}
        className={`flex h-full w-full flex-col overflow-hidden rounded-md border-l-4 text-left text-xs leading-tight transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:hover:brightness-110 dark:focus-visible:ring-offset-slate-950 ${style} ${block.approximate ? "border-dashed border-t border-r border-b" : ""}`}
      >
        <span
          aria-hidden="true"
          className="block min-h-0 flex-none overflow-hidden px-1.5 py-1"
          style={{ height: `${examHeight}px` }}
        >
          <span className="block font-semibold break-words">
            {conflicted && (
              // Decorative caution glyph — a SHAPE cue, not colour; the words
              // live in the button's accessible name and the caption below.
              <span aria-hidden="true" data-testid="block-conflict-marker">
                ⚠️{" "}
              </span>
            )}
            {block.subjectName}
          </span>
          <span className="mt-0.5 block">{spanLabel}</span>
          {conflicted && (
            <span className="mt-0.5 block font-medium italic">
              Time conflict
            </span>
          )}
          {block.approximate && (
            <span className="mt-0.5 block italic">Length pending</span>
          )}
          {block.movedToLate && (
            <span className="mt-0.5 block font-medium italic">
              Moved to late testing
            </span>
          )}
        </span>
        {/* Setup-buffer segment: hatched + dash-separated so the product
            padding reads as distinct from the published exam span. */}
        <span
          aria-hidden="true"
          data-testid="block-setup-buffer"
          className="block flex-none overflow-hidden border-t border-dashed border-current/50 px-1.5 text-[9px] leading-4 opacity-80"
          style={{
            height: `${bufferHeight}px`,
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent 0 5px, currentColor 5px 6px)",
          }}
        >
          <span className="opacity-90">+{SETUP_BUFFER_MINUTES} min setup</span>
        </span>
      </button>
    </li>
  );
}

function WeekGrid({
  week,
  axisStartHour,
  axisEndHour,
  conflictedSubjectIds,
  onActivateBlock,
}: {
  week: CalendarWeekLayout;
  axisStartHour: number;
  axisEndHour: number;
  /** Subject ids currently in an unresolved same-slot conflict (orange). */
  conflictedSubjectIds: ReadonlySet<string>;
  onActivateBlock: (block: CalendarBlock) => void;
}) {
  const hours: number[] = [];
  for (let h = axisStartHour; h < axisEndHour; h += 1) hours.push(h);
  const bodyHeight = hours.length * HOUR_PX;

  return (
    <section
      aria-label={
        week.late
          ? `Late-testing week, ${weekRangeLabel(week.days.map((d) => d.date))}`
          : `Week of ${weekRangeLabel(week.days.map((d) => d.date))}`
      }
      className="flex flex-col gap-2"
    >
      {/* The week range + late-testing badge render in the pager's position
          indicator above this section, which doubles as the aria-live region
          announcing week changes. */}

      {/* The grid may scroll horizontally INSIDE this container at narrow
          viewports; the page body itself never scrolls horizontally. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="min-w-[560px] sm:min-w-[640px]">
          {/* Header row: weekday + calendar date per column. */}
          <div
            className="grid border-b border-slate-200 dark:border-slate-800"
            style={{
              gridTemplateColumns: `3.5rem repeat(${week.days.length}, minmax(0, 1fr))`,
            }}
          >
            <div aria-hidden="true" className="sticky left-0 z-10 bg-white dark:bg-slate-950" />
            {week.days.map((day) => (
              <div
                key={day.date}
                className="border-l border-slate-200 px-2 py-2 text-center dark:border-slate-800"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {weekdayLabel(day.date)}
                  <span aria-hidden="true"> · </span>
                  <span className="text-slate-700 dark:text-slate-200">
                    {monthDayLabel(day.date)}
                  </span>
                </p>
              </div>
            ))}
          </div>

          {/* Body: time axis + day columns with positioned blocks. */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: `3.5rem repeat(${week.days.length}, minmax(0, 1fr))`,
            }}
          >
            <div
              aria-hidden="true"
              className="sticky left-0 z-10 bg-white dark:bg-slate-950"
              style={{ height: `${bodyHeight}px` }}
            >
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="pt-0.5 pr-1.5 text-right text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400"
                  style={{ height: `${HOUR_PX}px` }}
                >
                  {hourLabel(hour)}
                </div>
              ))}
            </div>

            {week.days.map((day) => (
              <div
                key={day.date}
                className="relative border-l border-slate-200 dark:border-slate-800"
                style={{ height: `${bodyHeight}px` }}
              >
                {/* Hour gridlines (the header's border-b marks the first line). */}
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className={
                      index === 0
                        ? ""
                        : "border-t border-slate-100 dark:border-slate-800/60"
                    }
                    style={{ height: `${HOUR_PX}px` }}
                  />
                ))}
                {day.blocks.length > 0 && (
                  <ul aria-label={`Exams on ${formatDateLabel(day.date)}`}>
                    {day.blocks.map((block) => (
                      <ExamBlock
                        key={block.key}
                        block={block}
                        axisStartHour={axisStartHour}
                        conflicted={conflictedSubjectIds.has(block.subjectId)}
                        onActivate={onActivateBlock}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 flex-none"
    >
      {direction === "left" ? (
        <path
          fillRule="evenodd"
          d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
          clipRule="evenodd"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

/** Shared style for the Previous/Next pager buttons (mirrors the view-switcher
 *  chips: ≥44px touch target on mobile, focus-visible ring, AA contrast). */
const PAGER_BUTTON_CLASS = [
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition sm:min-h-0",
  "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white dark:disabled:hover:bg-slate-900",
].join(" ");

/** Exam-count badge shown on a pager button when weeks in that direction hold
 *  exams (the count is also folded into the button's aria-label). */
function PagerBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold leading-4 text-white dark:bg-blue-400 dark:text-slate-950"
    >
      {count}
    </span>
  );
}

function pagerLabel(direction: "Previous" | "Next", examCount: number): string {
  if (examCount === 0) return `${direction} week`;
  const noun = examCount === 1 ? "exam" : "exams";
  const where = direction === "Previous" ? "earlier" : "later";
  return `${direction} week (${examCount} ${noun} in ${where} weeks)`;
}

/**
 * Prev/next week pager with an aria-live position indicator ("May 4 – May 8 ·
 * Week 1 of 3"). Buttons are native `<button>`s (keyboard-operable), always
 * visible, and DISABLED at the ends — no wrap-around (documented choice).
 */
function WeekPager({
  week,
  page,
  weekCount,
  examsBefore,
  examsAfter,
  onPage,
}: {
  week: CalendarWeekLayout;
  page: number;
  weekCount: number;
  examsBefore: number;
  examsAfter: number;
  onPage: (index: number) => void;
}) {
  return (
    <div
      data-testid="calendar-pager"
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <button
        type="button"
        aria-label={pagerLabel("Previous", examsBefore)}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className={PAGER_BUTTON_CLASS}
      >
        <ChevronIcon direction="left" />
        <span className="hidden sm:inline">Previous week</span>
        <span className="sm:hidden">Prev</span>
        {examsBefore > 0 && <PagerBadge count={examsBefore} />}
      </button>

      {/* Position indicator = the aria-live region announcing week changes. */}
      <p
        data-testid="calendar-week-indicator"
        aria-live="polite"
        aria-atomic="true"
        className="order-first flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-slate-600 sm:order-none sm:w-auto sm:flex-1 dark:text-slate-300"
      >
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {weekRangeLabel(week.days.map((d) => d.date))}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Week {page + 1} of {weekCount}
        </span>
        {week.late && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-500/30 dark:text-violet-200">
            Late testing
          </span>
        )}
      </p>

      <button
        type="button"
        aria-label={pagerLabel("Next", examsAfter)}
        disabled={page === weekCount - 1}
        onClick={() => onPage(page + 1)}
        className={PAGER_BUTTON_CLASS}
      >
        {examsAfter > 0 && <PagerBadge count={examsAfter} />}
        <span className="hidden sm:inline">Next week</span>
        <span className="sm:hidden">Next</span>
        <ChevronIcon direction="right" />
      </button>
    </div>
  );
}

function offGridLabel(item: OffGridEntry): string {
  switch (item.reason) {
    case "portfolio":
      return `Portfolio due ${formatDateLabel(item.entry.date)}`;
    case "no-published-time":
      return `${formatDateLabel(item.entry.date)} — session start time not published`;
    case "outside-windows":
      return `${formatDateLabel(item.entry.date)} — outside the published testing windows`;
  }
}

/**
 * Dialog for a block that a conflict resolution MOVED to late testing
 * (second bounce, item C9). Offers the two store-routed actions:
 *
 * - **Switch back to the regular time** — deletes the stored resolution, so
 *   the original same-slot conflict is unresolved again and the issue-#5
 *   prompt immediately re-opens for a fresh choice (the regular slot
 *   re-collides; nothing is silently double-booked).
 * - **Keep this exam at the regular time instead** — re-records the SAME
 *   conflict resolution with this subject as the keeper, moving the other
 *   exam(s) to their published late-testing slots. Same `setResolution`
 *   pathway as the conflict prompt, so calendar, list, and ICS export all
 *   reflect the swap identically.
 *
 * Plus a details escape-hatch to the shared InfoPanel. Modal a11y (focus
 * trap + restore, Escape, scroll lock) comes from the shared useModalDialog.
 */
function LateTestingDialog({
  subject,
  resolution,
  onClose,
  onSwitchBack,
  onSwap,
  onShowDetails,
}: {
  subject: ApSubject;
  resolution: SlotResolution;
  onClose: () => void;
  onSwitchBack: () => void;
  onSwap: () => void;
  onShowDetails: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(panelRef, onClose);

  const otherNames = resolution.memberIds
    .filter((id) => id !== subject.id)
    .map((id) => SUBJECTS_BY_ID.get(id)?.name ?? id);
  const lateSlot = subject.lateTesting;
  const regularLabel = `${formatDateLabel(resolution.date)} (${resolution.session} session)`;

  const actionClass =
    "inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

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
        data-testid="late-testing-dialog"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-semibold break-words text-slate-900 dark:text-slate-50"
            >
              {subject.name}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Moved to late testing
              {lateSlot &&
                ` — ${formatDateLabel(lateSlot.date)} (${lateSlot.session} session)`}
              , resolving its time conflict with {nameList(otherNames)} on{" "}
              {regularLabel}.
            </p>
          </div>
          <button
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

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            data-testid="late-switch-back"
            onClick={onSwitchBack}
            className={actionClass}
          >
            <span>
              Switch back to the regular time
              <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                Re-opens the {regularLabel} conflict so you can re-resolve it.
              </span>
            </span>
          </button>
          <button
            type="button"
            data-testid="late-swap"
            onClick={onSwap}
            className={actionClass}
          >
            <span>
              Keep {subject.name} at the regular time instead
              <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                {nameList(otherNames)}{" "}
                {otherNames.length === 1 ? "moves" : "move"} to late testing.
              </span>
            </span>
          </button>
          <button
            type="button"
            data-testid="late-view-details"
            onClick={onShowDetails}
            className={actionClass}
          >
            <span>View exam details</span>
          </button>
        </div>

        <p className="mt-4 text-xs italic text-slate-500 dark:text-slate-400">
          {COORDINATOR_NOTE}
        </p>
      </div>
    </div>
  );
}

export function CalendarView() {
  const { selectedIds, selectedCount } = useSelection();
  const storedResolutions = useResolutions();

  // Same effective-slot pipeline as the list view: conflicts + pruned-valid
  // resolutions feed `resolveSlots`, so both views render identical slots
  // from the same stored state.
  const conflicts = useMemo(
    () => findSameSlotConflicts(SUBJECTS, selectedIds),
    [selectedIds],
  );
  const validResolutions = useMemo(
    () => pruneResolutions(storedResolutions, conflicts),
    [storedResolutions, conflicts],
  );
  const unresolved = useMemo(
    () => unresolvedConflicts(conflicts, validResolutions),
    [conflicts, validResolutions],
  );
  // Every subject sitting in an UNRESOLVED conflict → its block renders orange
  // (issue #30). Reuses the issue-#5 conflicts layer verbatim: once a conflict
  // is resolved it drops out of `unresolved`, so both members return to their
  // pastel category styling automatically — orange strictly means "unresolved".
  const conflictedSubjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of unresolved)
      for (const id of group.subjectIds) ids.add(id);
    return ids;
  }, [unresolved]);
  const resolvedSlots = useMemo(
    () => resolveSlots(SUBJECTS, selectedIds, validResolutions),
    [selectedIds, validResolutions],
  );

  const schedule = useMemo(
    () => buildSchedule(SUBJECTS, selectedIds, resolvedSlots),
    [selectedIds, resolvedSlots],
  );

  const layout = useMemo(
    () => buildCalendarLayout(schedule, SESSION_START_TIMES, SUBJECT_INFO_BY_ID),
    [schedule],
  );

  // ---- Interactive events (second bounce, item C) --------------------------
  // One open popup at a time: a conflict prompt (keyed by regular-slot key),
  // the moved-to-late action dialog, or the shared exam-details InfoPanel.
  const [activeConflictKey, setActiveConflictKey] = useState<string | null>(
    null,
  );
  const [lateSubjectId, setLateSubjectId] = useState<string | null>(null);
  const [detailsSubject, setDetailsSubject] = useState<ApSubject | null>(null);

  const activeConflict = activeConflictKey
    ? (unresolved.find((g) => slotKey(g.slot) === activeConflictKey) ?? null)
    : null;
  const lateSubject = lateSubjectId
    ? (SUBJECTS_BY_ID.get(lateSubjectId) ?? null)
    : null;
  // The valid resolution that moved `lateSubject` (it is a non-keeper member).
  const lateResolution = lateSubjectId
    ? (validResolutions.find(
        (r) => r.keeperId !== lateSubjectId && r.memberIds.includes(lateSubjectId),
      ) ?? null)
    : null;

  const activateBlock = (block: CalendarBlock) => {
    const subject = SUBJECTS_BY_ID.get(block.subjectId);
    if (!subject) return;
    // 1. Unresolved conflict wins: surface the issue-#5 prompt first so the
    //    conflict can be resolved right here (bounce item C8).
    const group = unresolved.find((g) =>
      g.subjectIds.includes(block.subjectId),
    );
    if (group) {
      setActiveConflictKey(slotKey(group.slot));
      return;
    }
    // 2. A moved exam offers switch-back / swap (bounce item C9).
    if (block.movedToLate) {
      const resolution = validResolutions.find(
        (r) =>
          r.keeperId !== block.subjectId &&
          r.memberIds.includes(block.subjectId),
      );
      if (resolution) {
        setLateSubjectId(block.subjectId);
        return;
      }
    }
    // 3. Otherwise: the same details popup as the catalog's info button.
    setDetailsSubject(subject);
  };

  const switchBackToRegular = () => {
    if (!lateResolution) return;
    // Deleting the resolution un-moves every non-keeper member; the regular
    // slot re-collides, so hand focus straight to the re-opened conflict
    // prompt for a fresh choice (bounce item C9a).
    const remaining = validResolutions.filter((r) => r !== lateResolution);
    setLateSubjectId(null);
    setActiveConflictKey(slotKey(lateResolution));
    replaceResolutions(remaining);
  };

  const swapWithKeeper = () => {
    if (!lateResolution || !lateSubjectId) return;
    // Same slot, same members — this subject becomes the keeper, so the
    // other member(s) move to their published late-testing slots instead.
    setResolution({
      date: lateResolution.date,
      session: lateResolution.session,
      keeperId: lateSubjectId,
      memberIds: [...lateResolution.memberIds],
    });
    setLateSubjectId(null);
  };
  // ---------------------------------------------------------------------------

  // ---- Week pager state (issue-19 design bounce) --------------------------
  const weekCount = layout.weeks.length;
  const examCounts = useMemo(() => weekExamCounts(layout.weeks), [layout]);
  const defaultIndex = useMemo(() => defaultWeekIndex(layout.weeks), [layout]);
  const [pageIndex, setPageIndex] = useState(defaultIndex);
  const userPaged = useRef(false);

  // Follow the default (first week holding an exam) as the selection changes
  // live — but only until the student pages manually; their position then
  // wins for the life of this mounted view.
  useEffect(() => {
    if (!userPaged.current) setPageIndex(defaultIndex);
  }, [defaultIndex]);

  // Clamp defensively: weekCount is schema-derived and currently fixed, but a
  // stale index must never render an undefined week.
  const page = Math.min(Math.max(pageIndex, 0), Math.max(weekCount - 1, 0));
  const currentWeek = layout.weeks[page];
  const goToPage = (index: number) => {
    userPaged.current = true;
    setPageIndex(Math.min(Math.max(index, 0), weekCount - 1));
  };
  const examsBefore = examCounts
    .slice(0, page)
    .reduce((sum, count) => sum + count, 0);
  const examsAfter = examCounts
    .slice(page + 1)
    .reduce((sum, count) => sum + count, 0);
  // -------------------------------------------------------------------------

  const usedCategories = useMemo(() => {
    const used = new Set<Category>();
    for (const week of layout.weeks)
      for (const day of week.days)
        for (const block of day.blocks)
          if (block.category) used.add(block.category);
    return CATEGORIES.filter((category) => used.has(category));
  }, [layout]);

  return (
    <div data-testid="calendar-view" className="flex flex-col gap-4">
      {selectedCount === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Select subjects above to build your calendar — exams will appear on
          the grid at their session start times.
        </p>
      ) : (
        <>
          {usedCategories.length > 0 && (
            <ul
              aria-label="Category color legend"
              className="flex flex-wrap gap-x-4 gap-y-1"
            >
              {usedCategories.map((category) => (
                <li
                  key={category}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${CATEGORY_STYLES[category].dot}`}
                  />
                  {category}
                </li>
              ))}
            </ul>
          )}

          {currentWeek && (
            <>
              <WeekPager
                week={currentWeek}
                page={page}
                weekCount={weekCount}
                examsBefore={examsBefore}
                examsAfter={examsAfter}
                onPage={goToPage}
              />
              <WeekGrid
                week={currentWeek}
                axisStartHour={layout.axisStartHour}
                axisEndHour={layout.axisEndHour}
                conflictedSubjectIds={conflictedSubjectIds}
                onActivateBlock={activateBlock}
              />
            </>
          )}

          {(layout.offGrid.length > 0 || layout.undated.length > 0) && (
            <section
              aria-label="Not placed on the grid"
              data-testid="calendar-off-grid"
              className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700"
            >
              <h3 className="font-medium text-slate-600 dark:text-slate-300">
                Not placed on the grid
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Deadlines without a clock time and subjects without a published{" "}
                {CYCLE} exam date are listed here instead of being placed at a
                guessed position.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {layout.offGrid.map((item) => (
                  <li
                    key={`${item.entry.key}:offgrid`}
                    className="flex flex-wrap items-baseline gap-x-2 text-slate-700 dark:text-slate-200"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 flex-none rounded-full ${
                          SUBJECT_INFO_BY_ID.get(item.entry.subjectId)
                            ? CATEGORY_STYLES[
                                SUBJECT_INFO_BY_ID.get(item.entry.subjectId)!
                                  .category
                              ].dot
                            : "bg-slate-400"
                        }`}
                      />
                      {item.entry.subjectName}
                    </span>
                    <span
                      className={
                        item.reason === "portfolio"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-slate-600 dark:text-slate-400"
                      }
                    >
                      {offGridLabel(item)}
                    </span>
                  </li>
                ))}
                {layout.undated.map((subject) => (
                  <li
                    key={`${subject.id}:undated`}
                    className="flex flex-wrap items-baseline gap-x-2 text-slate-700 dark:text-slate-200"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 flex-none rounded-full ${
                          SUBJECT_INFO_BY_ID.get(subject.id)
                            ? CATEGORY_STYLES[
                                SUBJECT_INFO_BY_ID.get(subject.id)!.category
                              ].dot
                            : "bg-slate-400"
                        }`}
                      />
                      {subject.name}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">
                      No {CYCLE} exam date
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ---- Popups (one at a time; all share the modal a11y machinery) ---- */}
      {activeConflict && (
        <ConflictDialog
          key={slotKey(activeConflict.slot)}
          group={activeConflict}
          subjectsById={SUBJECTS_BY_ID}
          modalCandidate={true}
          onDismiss={() => setActiveConflictKey(null)}
          onKeep={(keeperId) => {
            setResolution({
              date: activeConflict.slot.date,
              session: activeConflict.slot.session,
              keeperId,
              memberIds: [...activeConflict.subjectIds],
            });
            setActiveConflictKey(null);
          }}
        />
      )}

      {lateSubject && lateResolution && (
        <LateTestingDialog
          subject={lateSubject}
          resolution={lateResolution}
          onClose={() => setLateSubjectId(null)}
          onSwitchBack={switchBackToRegular}
          onSwap={swapWithKeeper}
          onShowDetails={() => {
            setLateSubjectId(null);
            setDetailsSubject(lateSubject);
          }}
        />
      )}

      {detailsSubject && (
        <InfoPanel
          subject={detailsSubject}
          onClose={() => setDetailsSubject(null)}
        />
      )}
    </div>
  );
}
