import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import type { ApDataset } from "../data/schema";
import { buildIcsCalendar } from "./ics";
import { buildCalendarCards } from "./calendar-cards";
import { buildWeekCards } from "./week-cards";
import { buildSchedule } from "./schedule";
import { buildTxtExport } from "./exports";
import { findSameSlotConflicts, resolveSlots } from "./conflicts";

/**
 * Annual dataset swap — saved user state survives it (issue #37 AC).
 *
 * A student's selection and saved schedules live in localStorage as bare
 * subject ids. After a cycle swap two things can happen to them:
 *
 *   1. An id that exists in both cycles keeps working (the common case — the
 *      May 2027 roster kept every May 2026 id).
 *   2. An id that no longer exists in the new dataset is STALE. Nothing may
 *      crash on it, and nothing may invent an entry for it.
 *
 * These tests pin (2) at the derivation layer that every surface funnels
 * through, so a future swap that *does* drop a course cannot take the app down
 * with it. The store keeps stale ids rather than silently rewriting a user's
 * saved plan — every consumer here is dataset-driven (`subjects.filter(...)`),
 * so an unknown id simply contributes nothing.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;
const START_TIMES = dataset.sessionStartTimes;

/** A saved id that no cycle has ever published. */
const STALE_ID = "ap-course-retired-after-2026";
const LIVE_ID = "biology";
const SELECTED = [LIVE_ID, STALE_ID];

describe("annual cycle swap — a stale saved subject id degrades gracefully", () => {
  it("is not in the shipped dataset (guards the fixture itself)", () => {
    expect(SUBJECTS.some((s) => s.id === STALE_ID)).toBe(false);
    expect(SUBJECTS.some((s) => s.id === LIVE_ID)).toBe(true);
  });

  it("buildSchedule keeps the live entry and drops the stale id entirely", () => {
    const { groups, undated } = buildSchedule(
      SUBJECTS,
      SELECTED,
      resolveSlots(SUBJECTS, SELECTED, []),
    );
    const ids = [
      ...groups.flatMap((g) => g.entries.map((e) => e.subjectId)),
      ...undated.map((u) => u.id),
    ];
    expect(ids).toContain(LIVE_ID);
    expect(ids).not.toContain(STALE_ID);
  });

  it("conflict detection ignores the stale id (never a phantom collision)", () => {
    expect(() => findSameSlotConflicts(SUBJECTS, SELECTED)).not.toThrow();
    expect(findSameSlotConflicts(SUBJECTS, SELECTED)).toEqual([]);
    expect([...resolveSlots(SUBJECTS, SELECTED, []).keys()]).toEqual([LIVE_ID]);
  });

  it("a stored resolution naming only stale ids is inert, not fatal", () => {
    const stale = [
      {
        date: "2027-05-03",
        session: "PM" as const,
        keeperId: STALE_ID,
        memberIds: [STALE_ID, "another-retired-course"],
      },
    ];
    expect(() => resolveSlots(SUBJECTS, SELECTED, stale)).not.toThrow();
    const resolved = resolveSlots(SUBJECTS, SELECTED, stale);
    expect([...resolved.keys()]).toEqual([LIVE_ID]);
    expect(resolved.get(LIVE_ID)?.movedToLate).toBe(false);
  });

  it("every export surface renders the live entry and omits the stale one", () => {
    const ics = buildIcsCalendar(SUBJECTS, SELECTED, [], START_TIMES);
    expect(ics).toContain("AP Biology exam");
    expect(ics).not.toContain(STALE_ID);

    const txt = buildTxtExport(SUBJECTS, SELECTED, [], "Plan", dataset.cycle);
    expect(txt).toContain("AP Biology");
    expect(txt).not.toContain(STALE_ID);

    const week = buildWeekCards(SUBJECTS, SELECTED, [], START_TIMES);
    expect(week.undated.map((u) => u.id)).not.toContain(STALE_ID);
    const calendar = buildCalendarCards(SUBJECTS, SELECTED, [], START_TIMES);
    expect(calendar.undated.map((u) => u.id)).not.toContain(STALE_ID);
    expect(
      calendar.cards.flatMap((c) =>
        // `week` is null on the Week 0 deadlines card (issue #97) — it has no
        // grid, so it contributes no blocks.
        (c.week?.days ?? []).flatMap((d) =>
          d.blocks.map((b) => b.subjectId),
        ),
      ),
    ).toEqual([LIVE_ID]);
  });

  it("a selection of ONLY stale ids yields an empty plan, not a crash", () => {
    const onlyStale = [STALE_ID, "another-retired-course"];
    const empty = buildSchedule(
      SUBJECTS,
      onlyStale,
      resolveSlots(SUBJECTS, onlyStale, []),
    );
    expect(empty.groups).toEqual([]);
    expect(empty.undated).toEqual([]);
    expect(buildCalendarCards(SUBJECTS, onlyStale, [], START_TIMES).cards).toEqual(
      [],
    );
    expect(() =>
      buildIcsCalendar(SUBJECTS, onlyStale, [], START_TIMES),
    ).not.toThrow();
  });
});
