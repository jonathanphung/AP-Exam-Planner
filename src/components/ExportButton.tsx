"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import apData from "@/data/ap-2026.json";
import type { ApDataset, ApSubject } from "@/data/schema";
import { useSelection } from "@/lib/selection";
import { useResolutions } from "@/lib/resolutions";
import { useSchedules } from "@/lib/schedules";
import {
  buildIcsCalendar,
  ICS_FILE_NAME,
  ICS_MIME_TYPE,
  type SessionStartTimes,
} from "@/lib/ics";
import {
  buildJsonExport,
  buildTxtExport,
  JSON_FILE_NAME,
  JSON_MIME_TYPE,
  TXT_FILE_NAME,
  TXT_MIME_TYPE,
  weekPngFileName,
  type ExportView,
} from "@/lib/exports";
import { buildWeekCards } from "@/lib/week-cards";
import { buildCalendarCards } from "@/lib/calendar-cards";
import {
  captureWeekCardPng,
  type ExportTheme,
  type WeekCardRenderOptions,
} from "@/lib/export-png";
import {
  captureCalendarCardPng,
  type CalendarCardRenderOptions,
} from "@/lib/export-png-calendar";

/**
 * "Export" menu button (issue #51; previously the one-shot "Export to
 * Calendar" button from issue #7).
 *
 * The trigger is labeled just "Export" (with a tray-and-up-arrow export icon)
 * at EVERY width — the old <360px label-shortening special case is gone
 * because the label is short everywhere now. Clicking it opens a WAI-ARIA
 * menu of five "Save as …" items:
 *
 *   list .png     — one DESIGNED, decluttered LIST card per non-empty AP
 *                   testing week (issue #56 + Jon's bounce): subject + a small
 *                   category dot + day/session/clock, no chip/pill. Built from
 *                   src/lib/week-cards.ts, rendered by src/lib/export-png.ts.
 *   calendar .png — one DESIGNED WEEK-GRID card per non-empty testing week (the
 *                   bounce): mirrors the site's Calendar view (day columns,
 *                   hourly axis, positioned category-colored blocks, legend,
 *                   off-grid strip). Built from src/lib/calendar-cards.ts via
 *                   buildCalendarLayout, rendered by export-png-calendar.ts.
 *   .ics          — EXACTLY the pre-#51 calendar export: same buildIcsCalendar
 *                   call, same filename, same MIME; src/lib/ics.ts untouched
 *   .json         — versioned machine-readable envelope (src/lib/exports.ts)
 *   .txt          — human-readable chronological schedule (src/lib/exports.ts)
 *
 * Both `.png` variants share the SAME per-week fan-out (calendarWeeks() /
 * resolveSlots → buildSchedule) and the SAME design tokens
 * (src/lib/export-card-theme.ts), so they are the same export in two formats —
 * one file per week the student has a placed entry in, not a screenshot.
 *
 * Builder decision (issue #51): the calendar row says "Save as .ics", not the
 * mock's ".cal" — the file that lands on disk IS a `.ics`, and labeling it
 * anything else would lie about the extension the OS shows the student.
 *
 * All four are client-side Blob downloads — zero network — built from the
 * shared selection + conflict resolutions of the ACTIVE schedule.
 *
 * Menu behavior (WAI-ARIA APG "menu button" pattern):
 * - `aria-haspopup="menu"` + `aria-expanded` on the trigger; `role="menu"` /
 *   `role="menuitem"` with roving focus inside.
 * - Click, Enter, Space, or ArrowDown opens and focuses the first item;
 *   ArrowUp opens and focuses the last.
 * - ArrowDown/ArrowUp cycle, Home/End jump, Escape closes and returns focus
 *   to the trigger, Tab closes (focus returns to the trigger so the default
 *   Tab lands on the next toolbar control), click-outside closes, selecting
 *   an item performs the export and closes.
 * - NO body scroll lock (the #49 defect class): a dropdown is not a dialog,
 *   so `useModalDialog` is deliberately not reused here — opening the menu
 *   must never shift the page.
 * - Stacking (the #42 R6 defect class): the menu PORTALS to `document.body`
 *   and positions `fixed` at `z-50` (the dialog layer, above the catalog's
 *   sticky `z-30` quick-jump bar), following the FeedbackDialog portal
 *   precedent — an inline absolutely-positioned menu would be trapped under
 *   any higher ancestor stacking context. It re-anchors to the trigger on
 *   scroll/resize instead of freezing the page.
 * - Motion: no open/close animation at all, so `prefers-reduced-motion` is
 *   respected trivially; items keep the app's standard `transition-colors`
 *   hover blend (a color fade, not movement).
 * - Touch: every item is ≥44px tall below `sm:` (issue #8 AC4); on pointer
 *   viewports items are 36px like other dense rows.
 *
 * Trigger sizing is unchanged from issue #31: slim 32px pill matching the
 * List/Calendar switcher, ≥44px effective touch target via the transparent
 * `::before` hit-area below `sm:`, disabled until a subject is selected
 * (the menu cannot open at zero selected).
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS: readonly ApSubject[] = dataset.subjects;
const SESSION_START_TIMES: SessionStartTimes = dataset.sessionStartTimes;
const CYCLE = dataset.cycle;

type ExportFormat = "png-list" | "png-calendar" | "ics" | "json" | "txt";

/** Menu rows in order: list-png, calendar-png, ics, json, txt (Jon's bounce). */
const MENU_ITEMS: ReadonlyArray<{
  format: ExportFormat;
  label: string;
  Icon: () => React.JSX.Element;
}> = [
  { format: "png-list", label: "Save as list view .png", Icon: ListPngIcon },
  {
    format: "png-calendar",
    label: "Save as calendar view .png",
    Icon: CalendarPngIcon,
  },
  { format: "ics", label: "Save as .ics", Icon: CalendarIcon },
  { format: "json", label: "Save as .json", Icon: CodeFileIcon },
  { format: "txt", label: "Save as .txt", Icon: TextLinesIcon },
];

/** Shared in-memory Blob download (the issue-#7 pattern). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on a LATER tick, not synchronously. `link.click()` starts the
  // download asynchronously; revoking the blob URL in the same tick can cancel
  // it before the browser has read it — harmless-looking for a single file,
  // but the race bites the per-week PNG export (issue #56), where several
  // downloads fire in quick succession and an early revoke drops all but the
  // first. A deferred revoke still frees the blob; it just waits for the
  // browser to grab the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Ms between consecutive PNG downloads — a deliberate stagger (see below). */
const PNG_DOWNLOAD_STAGGER_MS = 200;

/**
 * Render + download one designed PNG per week, sequentially (issue #56 + Jon's
 * bounce — shared by BOTH the list and calendar variants).
 *
 * Each week is a SEPARATE file (Jon asked for separate files per week, not a
 * zip). Firing several Blob downloads back-to-back can trip a browser's "allow
 * multiple downloads?" prompt or throttle, so we await each rasterization and
 * add a small stagger between saves. A single failed week is logged and
 * skipped — client-side rasterization has no server to report to — so one bad
 * card never blocks the rest. The `view` suffix keeps the two variants' files
 * from colliding for the same week (see {@link weekPngFileName}).
 */
async function downloadWeekPngs<Card extends { slug: string }>(
  cards: readonly Card[],
  view: ExportView,
  render: (card: Card) => Promise<Blob>,
): Promise<void> {
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    try {
      const blob = await render(card);
      downloadBlob(blob, weekPngFileName(card.slug, view));
    } catch (error: unknown) {
      console.error(`PNG export failed for ${view} ${card.slug}`, error);
    }
    if (i < cards.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, PNG_DOWNLOAD_STAGGER_MS),
      );
    }
  }
}

/** Active theme for the PNG export — matches the app's `.dark` root class. */
function activeExportTheme(): ExportTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Zero qualifying weeks (every selection is undated — all Career Kickstart, no
 * May date). Do NOT download an empty/misleading file: inertly no-op with a
 * console note. The trigger is already disabled at 0 selected, so this only
 * fires for all-undated selections. Shared by both `.png` variants.
 */
function logNoDatedExams(which: string): void {
  console.info(
    `No dated exams to export as ${which} — every selected subject has no May 2026 date.`,
  );
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  right: number;
}

/** Estimated open-menu height used only for the flip-up decision (5 items). */
const MENU_HEIGHT_ESTIMATE = 280;

export function ExportButton() {
  const { selectedIds, selectedCount } = useSelection();
  const resolutions = useResolutions();
  const { active } = useSchedules();
  const disabled = selectedCount === 0;

  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, right: 0 });
  const initialFocusIndex = useRef(0);

  /** Anchor the fixed-position menu to the trigger (right edges aligned). */
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < MENU_HEIGHT_ESTIMATE && rect.top > spaceBelow) {
      // Trigger near the viewport bottom: open upward instead of clipping.
      setPosition({ bottom: window.innerHeight - rect.top + 6, right });
    } else {
      setPosition({ top: rect.bottom + 6, right });
    }
  }, []);

  const openMenu = useCallback(
    (focusIndex: number) => {
      initialFocusIndex.current = focusIndex;
      reposition();
      setOpen(true);
    },
    [reposition],
  );

  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Focus the requested item once the menu has rendered.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[initialFocusIndex.current]?.focus();
  }, [open]);

  // Click/tap outside closes (pointerdown so it beats the click's focus move).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, closeMenu]);

  // The page keeps scrolling underneath (no scroll lock) — re-anchor the
  // menu to the trigger on any scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  // Selection can hit zero while the menu is open (e.g. a cross-tab storage
  // edit clears it; in-page paths already close via pointerdown-outside/Tab)
  // — a disabled trigger must not strand an open menu. Render-phase state
  // adjustment per React's "adjusting state when a prop changes" pattern.
  if (open && disabled) {
    setOpen(false);
  }

  const runExport = useCallback(
    (format: ExportFormat) => {
      if (selectedCount === 0) return;
      switch (format) {
        case "ics": {
          // The one exception (issue #51 AC): EXACTLY today's ICS export —
          // same builder, same filename, same MIME, byte-for-byte unchanged.
          const ics = buildIcsCalendar(
            SUBJECTS,
            selectedIds,
            resolutions,
            SESSION_START_TIMES,
          );
          downloadBlob(new Blob([ics], { type: ICS_MIME_TYPE }), ICS_FILE_NAME);
          break;
        }
        case "json": {
          const json = buildJsonExport(
            SUBJECTS,
            selectedIds,
            resolutions,
            active.name,
          );
          downloadBlob(
            new Blob([json], { type: JSON_MIME_TYPE }),
            JSON_FILE_NAME,
          );
          break;
        }
        case "txt": {
          const txt = buildTxtExport(
            SUBJECTS,
            selectedIds,
            resolutions,
            active.name,
            CYCLE,
          );
          downloadBlob(new Blob([txt], { type: TXT_MIME_TYPE }), TXT_FILE_NAME);
          break;
        }
        case "png-list": {
          // One designed LIST card per non-empty testing week (issue #56 +
          // bounce). The week partition + effective slots come from the shared
          // pipeline in week-cards.ts — no screenshot of the current view.
          const { cards, undated } = buildWeekCards(
            SUBJECTS,
            selectedIds,
            resolutions,
            SESSION_START_TIMES,
          );
          if (cards.length === 0) {
            logNoDatedExams("list view .png");
            break;
          }
          const options: WeekCardRenderOptions = {
            theme: activeExportTheme(),
            cycle: CYCLE,
            scheduleName: active.name,
            undatedNames: undated.map((subject) => subject.name),
          };
          void downloadWeekPngs(cards, "list", (card) =>
            captureWeekCardPng(card, options),
          );
          break;
        }
        case "png-calendar": {
          // One designed CALENDAR week-grid card per non-empty testing week
          // (Jon's bounce). Same per-week fan-out + effective slots as the list
          // variant, built from buildCalendarLayout (calendar-cards.ts).
          const { cards, undated } = buildCalendarCards(
            SUBJECTS,
            selectedIds,
            resolutions,
            SESSION_START_TIMES,
          );
          if (cards.length === 0) {
            logNoDatedExams("calendar view .png");
            break;
          }
          const options: CalendarCardRenderOptions = {
            theme: activeExportTheme(),
            cycle: CYCLE,
            scheduleName: active.name,
            undatedNames: undated.map((subject) => subject.name),
          };
          void downloadWeekPngs(cards, "calendar", (card) =>
            captureCalendarCardPng(card, options),
          );
          break;
        }
      }
    },
    [selectedCount, selectedIds, resolutions, active.name],
  );

  const activateItem = (format: ExportFormat) => {
    closeMenu(true);
    runExport(format);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter/Space already fire click on a native button; the arrows are the
    // APG extras (open + focus first/last item).
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!disabled) openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!disabled) openMenu(MENU_ITEMS.length - 1);
    }
  };

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = MENU_ITEMS.length;
    const current = itemRefs.current.findIndex(
      (el) => el === document.activeElement,
    );
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem((current + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem((current - 1 + count) % count);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(count - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case "Tab":
        // Close and hand focus back to the trigger WITHOUT preventing the
        // default, so Tab/Shift+Tab continue to the adjacent toolbar control
        // (APG: menu items are not in the tab sequence).
        closeMenu(true);
        break;
    }
  };

  const menuStyle: CSSProperties = {
    top: position.top,
    bottom: position.bottom,
    right: position.right,
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        data-testid="export-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Export your exam schedule"
        className={[
          // Slim 32px visible pill (issue #31 pill-slimming bounce), equal to
          // the List/Calendar switcher so the toolbar row reads as one control
          // set. The ≥44px touch tap target (issue #8 AC4) is preserved behind
          // the slimmer pill by a transparent, centered ::before hit-area on
          // touch viewports (< sm); on sm:+ pointer viewports the slim height
          // is fine.
          "relative inline-flex h-8 w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors",
          "max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:top-1/2 max-sm:before:h-11 max-sm:before:-translate-y-1/2 max-sm:before:content-['']",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
          disabled
            ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600"
            : // Dark uses a light blue fill + near-black text: white-on-blue-500
              // was 3.68:1, under the 4.5:1 AA bar (issue #8 AC2).
              "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950 dark:hover:bg-blue-300",
        ].join(" ")}
      >
        <ExportIcon />
        <span>Export</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Export formats"
            data-testid="export-menu"
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {MENU_ITEMS.map(({ format, label, Icon }, index) => (
              <button
                key={format}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-testid={`export-menu-item-${format}`}
                onClick={() => activateItem(format)}
                className={[
                  // ≥44px row on touch viewports (issue #8 AC4); 36px on sm:+
                  // pointer viewports. AA text both themes: slate-700 on white
                  // ≈ 8.6:1, slate-200 on slate-900 ≈ 13:1.
                  "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium transition-colors sm:min-h-9",
                  "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                  // Roving focus is applied programmatically; paint the row on
                  // ANY focus (not just focus-visible) so the active item is
                  // always visually tracked, plus a ring for keyboard users.
                  "focus:bg-slate-100 focus:outline-none dark:focus:bg-slate-800",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400",
                ].join(" ")}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────
 * Repo inline-icon pattern (ArrowUpRightIcon / ThemeToggle / Sidebar):
 * aria-hidden, stroke="currentColor", no hardcoded fill — they inherit the
 * row's text color in both themes. File-type glyphs follow the mock's
 * stroked style: a PNG badge, a calendar, a code-brackets file, and a
 * text-lines file.
 */

/** Trigger glyph: share/export tray with an up arrow. */
function ExportIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M10 12.5V3" />
      <path d="m6.5 6.5 3.5-3.5 3.5 3.5" />
      <path d="M3.5 12.5v2.5A1.5 1.5 0 0 0 5 16.5h10a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
    </svg>
  );
}

/** List-view .png marker: an image badge with list lines. */
function ListPngIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <rect x="2.25" y="4.25" width="15.5" height="11.5" rx="2" />
      <path d="M5.5 8h9" />
      <path d="M5.5 10.5h9" />
      <path d="M5.5 13h6" />
    </svg>
  );
}

/** Calendar-view .png marker: an image badge with a grid. */
function CalendarPngIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <rect x="2.25" y="4.25" width="15.5" height="11.5" rx="2" />
      <path d="M2.25 8h15.5" />
      <path d="M7.5 8v7.75" />
      <path d="M12.5 8v7.75" />
    </svg>
  );
}

/** Calendar (the .ics row — the existing calendar export). */
function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.75h14" />
      <path d="M7 2.5v3.5" />
      <path d="M13 2.5v3.5" />
    </svg>
  );
}

/** Code-brackets file (the .json row). */
function CodeFileIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M11.5 2.5h-6A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7z" />
      <path d="M11.5 2.5V7H16" />
      <path d="m8.25 10.5-1.75 2 1.75 2" />
      <path d="m11.75 10.5 1.75 2-1.75 2" />
    </svg>
  );
}

/** Text-lines file (the .txt row). */
function TextLinesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M11.5 2.5h-6A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7z" />
      <path d="M11.5 2.5V7H16" />
      <path d="M7 11h6" />
      <path d="M7 14h4.5" />
    </svg>
  );
}
