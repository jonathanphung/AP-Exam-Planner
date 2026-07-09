"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSchedules, type Schedule } from "@/lib/schedules";
import { useModalDialog } from "@/lib/modal";

/**
 * MY SCHEDULES section body (issue #29): the radio-style list of saved
 * schedules with create / rename / delete controls.
 *
 * Semantics (per the issue's a11y AC):
 *   - The list is a real `radiogroup`: each schedule row's switch control is
 *     `role="radio"` with `aria-checked`, roving tabindex, and full arrow-key
 *     operation (Up/Down/Left/Right move AND select, Home/End jump) — the
 *     standard WAI-ARIA radio-group pattern.
 *   - Rename and delete are separate real buttons (never nested inside the
 *     radio) with per-schedule accessible names ("Rename Schedule 1").
 *   - Rename is INLINE (builder's documented call — a text field replaces the
 *     row; Enter commits, Escape cancels, blur commits): lighter than a
 *     dialog for a one-field edit, and focus returns to the row's Rename
 *     button on keyboard exit.
 *   - Delete confirms via a small modal dialog reusing the app's QA'd
 *     `useModalDialog` machinery (focus trapped, Escape cancels, focus
 *     restored). The last remaining schedule cannot be deleted — its delete
 *     button is disabled with an explanatory title.
 *   - Drag-to-reorder from the reference is intentionally NOT implemented
 *     (builder's documented call): schedules are few, creation order is
 *     stable, and reorder adds drag-and-drop a11y complexity with no AC
 *     behind it.
 *
 * Switching schedules swaps the entire app state (selection, resolutions,
 * list/calendar views, export) because every consumer reads the same
 * schedules store — see `src/lib/schedules.ts`.
 */

function DeleteScheduleDialog({
  schedule,
  onCancel,
  onConfirm,
}: {
  schedule: Schedule;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalDialog(panelRef, onCancel, cancelRef);

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/50"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-schedule-title"
        aria-describedby="delete-schedule-desc"
        className="relative w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2
          id="delete-schedule-title"
          className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
        >
          Delete &ldquo;{schedule.name}&rdquo;?
        </h2>
        <p
          id="delete-schedule-desc"
          className="mt-2 text-sm text-slate-600 dark:text-slate-400"
        >
          This removes the schedule&rsquo;s exam selections and conflict
          choices from this browser. This can&rsquo;t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-9 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:outline-blue-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-11 items-center rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 sm:min-h-9 dark:bg-red-500 dark:text-slate-950 dark:hover:bg-red-400 dark:focus-visible:outline-red-400"
          >
            Delete schedule
          </button>
        </div>
      </div>
    </div>
  );

  // Render through a portal on <body> rather than inline. The desktop sidebar
  // is now `position: sticky` (post-approval bounce), which makes it a
  // stacking context that paints *below* <main>. An inline `fixed inset-0
  // z-50` overlay is trapped inside that context, so its backdrop cannot dim
  // the catalog filter bar (`sticky top-0 z-30` in <main>) — the bar stayed
  // "lit up" over the dim (QA v3 R6). Portaling to <body> lifts the overlay to
  // the root stacking context so it covers the entire app, filter bar
  // included. `document` is always present here: this component only mounts
  // after a client-side click, never during SSR/hydration.
  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}

export function MySchedules() {
  const { schedules, activeId, setActive, create, rename, remove } =
    useSchedules();

  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<Schedule | null>(null);

  const radioRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameOpenerRef = useRef<HTMLButtonElement | null>(null);
  const focusActiveAfterChange = useRef(false);

  // After create/delete, move keyboard focus to the (new) active radio.
  useEffect(() => {
    if (!focusActiveAfterChange.current) return;
    focusActiveAfterChange.current = false;
    radioRefs.current.get(activeId)?.focus();
  }, [activeId, schedules.length]);

  function onRadioKeyDown(event: React.KeyboardEvent, index: number) {
    let target: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        target = (index + 1) % schedules.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        target = (index - 1 + schedules.length) % schedules.length;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = schedules.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = schedules[target].id;
    setActive(id);
    radioRefs.current.get(id)?.focus();
  }

  function commitRename(refocusOpener: boolean) {
    if (!renaming) return;
    rename(renaming.id, renaming.draft); // blank names are ignored by the store
    setRenaming(null);
    if (refocusOpener) renameOpenerRef.current?.focus();
  }

  function cancelRename() {
    if (!renaming) return;
    setRenaming(null);
    renameOpenerRef.current?.focus();
  }

  function onCreate() {
    focusActiveAfterChange.current = true;
    create();
  }

  function onConfirmDelete() {
    if (!confirming) return;
    focusActiveAfterChange.current = true;
    remove(confirming.id);
    setConfirming(null);
  }

  const lastRemaining = schedules.length === 1;

  return (
    <div data-testid="my-schedules">
      {/* A div (not a ul) — an explicit radiogroup role on a ul would orphan
          the li elements' implicit listitem roles (axe `listitem` rule). */}
      <div
        role="radiogroup"
        aria-label="My schedules"
        className="flex flex-col gap-1"
      >
        {schedules.map((schedule, index) => {
          const active = schedule.id === activeId;
          const isRenaming = renaming?.id === schedule.id;
          return (
            <div key={schedule.id} className="flex items-center gap-1">
              {isRenaming ? (
                <form
                  className="min-w-0 flex-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename(true);
                  }}
                >
                  <input
                    autoFocus
                    value={renaming.draft}
                    aria-label={`New name for ${schedule.name}`}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      setRenaming({ id: schedule.id, draft: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => commitRename(false)}
                    className="w-full min-w-0 rounded-md border border-blue-400 bg-white px-2 py-1.5 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-blue-500 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:outline-blue-400"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  ref={(node) => {
                    if (node) radioRefs.current.set(schedule.id, node);
                    else radioRefs.current.delete(schedule.id);
                  }}
                  onClick={() => setActive(schedule.id)}
                  onKeyDown={(event) => onRadioKeyDown(event, index)}
                  className={[
                    "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm lg:min-h-9",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400",
                    active
                      ? "bg-blue-50 font-medium text-blue-900 dark:bg-blue-950/50 dark:text-blue-100"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      active
                        ? "border-blue-600 dark:border-blue-400"
                        : "border-slate-400 dark:border-slate-500",
                    ].join(" ")}
                  >
                    {active && (
                      <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {schedule.name}
                  </span>
                </button>
              )}
              <button
                type="button"
                aria-label={`Rename ${schedule.name}`}
                onClick={(event) => {
                  renameOpenerRef.current = event.currentTarget;
                  setRenaming({ id: schedule.id, draft: schedule.name });
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:h-8 lg:w-8 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:outline-blue-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                  <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Delete ${schedule.name}`}
                disabled={lastRemaining}
                title={
                  lastRemaining
                    ? "You always keep at least one schedule"
                    : undefined
                }
                onClick={() => setConfirming(schedule)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500 lg:h-8 lg:w-8 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400 dark:focus-visible:outline-blue-400 dark:disabled:hover:text-slate-400"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-dashed border-slate-300 px-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:min-h-9 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-blue-400"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 shrink-0"
        >
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
        </svg>
        New schedule
      </button>

      {confirming && (
        <DeleteScheduleDialog
          schedule={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={onConfirmDelete}
        />
      )}
    </div>
  );
}
