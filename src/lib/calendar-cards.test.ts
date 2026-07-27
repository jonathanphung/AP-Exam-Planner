import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { withUndatedSubject } from "./test-fixtures";
import type { ApDataset, ApSubject } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import type { CalendarBlock } from "./calendar";
import { buildCalendarCards, type CalendarCard } from "./calendar-cards";
import { buildWeekCards } from "./week-cards";

/**
 * Builder unit tests (Jon's pre-merge bounce on issue #56) — the pure per-week
 * CALENDAR model.
 *
 * The AC-critical assertion is the same one the list variant carries: feed a
 * selection spanning 1, 2, and 3 testing weeks and check the EXACT set of
 * emitted weeks — the two variants MUST fan out the same weeks. The partition
 * is driven by the shared `calendarWeeks()` window model (no hardcoded May
 * dates), so these run against the REAL shipped dataset, same fixtures as
 * `week-cards.test.ts`:
 *
 *   - AP Physics C: Mechanics (2027-05-03 AM, STEM, 180 min) → Week 1 grid, 8:00–11:00 AM.
 *   - AP Human Geography (2027-05-03 AM) shares Physics C: Mechanics's slot; keeping Physics C: Mechanics bumps
 *     Human Geography to its real late slot (2027-05-17 PM) → the Late Testing grid.
 *   - AP Seminar has an exam (2027-05-10 PM → Week 2 grid) AND a portfolio
 *     deadline (2027-04-30, before every window → the strip-only Week 0 card,
 *     issue #97). AP Drawing's May 7 deadline is INSIDE Week 1's window and
 *     stays on Week 1's own off-grid strip — the split is a date cutoff, not
 *     the row kind (Jon's bounce, 2026-07-27).
 *   - A synthetic undated subject (no May 2027 course is undated) → `undated`.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = withUndatedSubject(dataset.subjects);
const START_TIMES = dataset.sessionStartTimes;

const NO_RESOLUTIONS: SlotResolution[] = [];

/** Keep Physics C: Mechanics at 2027-05-03 AM; Human Geography is bumped to its real late slot. */
const KEEP_PHYSICS_C: SlotResolution = {
  date: "2027-05-03",
  session: "AM",
  keeperId: "physics-c-mechanics",
  memberIds: ["physics-c-mechanics", "human-geography"],
};

/**
 * Every positioned block across a card's days, in day order. The Week 0
 * deadlines card has no grid at all (`week: null`, issue #97), so it
 * contributes no blocks.
 */
function blocksOf(card: CalendarCard): CalendarBlock[] {
  return (card.week?.days ?? []).flatMap((day) => day.blocks);
}

describe("buildCalendarCards — exact set of emitted weeks by span (AC)", () => {
  it("a 1-week selection emits exactly one calendar card", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["physics-c-mechanics"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1"]);
    expect(cards[0].late).toBe(false);
    expect(cards[0].rangeLabel).toBe("May 3 – May 7, 2027");

    const blocks = blocksOf(cards[0]);
    expect(blocks.map((b) => b.subjectName)).toEqual(["AP Physics C: Mechanics"]);
    const bio = blocks[0];
    expect(bio.startClock).toBe("8:00 AM");
    expect(bio.endClock).toBe("11:00 AM");
    expect(bio.approximate).toBe(false);
    expect(bio.movedToLate).toBe(false);
    // Axis range is shared across cards and is real chrome, not data.
    expect(cards[0].axisStartHour).toBeLessThanOrEqual(bio.startHour);
    expect(cards[0].axisEndHour).toBeGreaterThan(bio.endHour);
  });

  it("a 2-week selection emits exactly the two spanned weeks in order (plus Week 0 for its deadline)", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["physics-c-mechanics", "seminar"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 0", "Week 1", "Week 2"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-0", "week-1", "week-2"]);

    // Week 0: strip-only, no grid — the Seminar portfolio left Week 1 (#97).
    const week0 = cards[0];
    expect(week0.deadlines).toBe(true);
    expect(week0.week).toBeNull();
    expect(week0.offGrid.map((o) => o.subjectName)).toEqual(["AP Seminar"]);
    const portfolio = week0.offGrid[0];
    expect(portfolio.reason).toBe("portfolio");
    expect(portfolio.label).toBe("Portfolio due Friday, April 30, 2027");

    // Week 1: the Physics C: Mechanics block, and NOTHING off-grid any more.
    const week1 = cards[1];
    expect(blocksOf(week1).map((b) => b.subjectName)).toEqual([
      "AP Physics C: Mechanics",
    ]);
    expect(week1.offGrid).toEqual([]);

    // Week 2: the Seminar sit-down exam block (PM).
    const week2 = cards[2];
    const seminar = blocksOf(week2)[0];
    expect(seminar.subjectName).toBe("AP Seminar");
    expect(seminar.startClock).toBe("12:00 PM");
    expect(seminar.endClock).toBe("2:00 PM");
  });

  it("a 3-week selection (a moved-to-late exam) emits Week 0, Week 1, Week 2, Late Testing", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["physics-c-mechanics", "human-geography", "seminar"],
      [KEEP_PHYSICS_C],
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual([
      "Week 0",
      "Week 1",
      "Week 2",
      "Late Testing",
    ]);
    expect(cards.map((c) => c.slug)).toEqual([
      "week-0",
      "week-1",
      "week-2",
      "late-testing",
    ]);

    const late = cards[3];
    expect(late.late).toBe(true);
    expect(late.rangeLabel).toBe("May 17 – May 21, 2027");
    // Human Geography renders at its EFFECTIVE (late) slot, flagged moved.
    const humanGeography = blocksOf(late)[0];
    expect(humanGeography.subjectName).toBe("AP Human Geography");
    expect(humanGeography.movedToLate).toBe(true);
    expect(humanGeography.session).toBe("PM");
    expect(humanGeography.startClock).toBe("12:00 PM");
    expect(humanGeography.endClock).toBe("2:15 PM");
    // The Human Geography block sits on a May 17–21 day column.
    const humanGeographyDay = late.week?.days.find((d) =>
      d.blocks.some((b) => b.subjectId === "human-geography"),
    );
    expect(humanGeographyDay?.date).toBe("2027-05-17");
  });
});

describe("buildCalendarCards — hard data rule (unpublished length → approximate block)", () => {
  const PENDING_SUBJECT = {
    id: "pending-exam",
    name: "AP Pending Length",
    category: "STEM",
    exam: { date: "2027-05-04", session: "AM" },
    lateTesting: { date: "2027-05-18", session: "AM" },
    format: {
      sections: [],
      totalMinutes: undefined,
      calculator: undefined,
      delivery: undefined,
    },
    passRate: undefined,
    portfolio: null,
  } as unknown as ApSubject;

  it("marks the block approximate with no usable exam length (renderer hides the end)", () => {
    const { cards } = buildCalendarCards(
      [PENDING_SUBJECT],
      ["pending-exam"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const block = blocksOf(cards[0])[0];
    expect(block.startClock).toBe("8:00 AM");
    expect(block.approximate).toBe(true);
    expect(block.examMinutes).toBeNull();
  });
});

describe("buildCalendarCards — nothing silently dropped", () => {
  it("returns undated selections separately and never on the grid", () => {
    const { cards, undated } = buildCalendarCards(
      SUBJECTS,
      ["physics-c-mechanics", "test-undated-course"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const placed = cards.flatMap((c) => blocksOf(c).map((b) => b.subjectId));
    expect(placed).not.toContain("test-undated-course");
    expect(undated.map((u) => u.id)).toEqual(["test-undated-course"]);
  });

  it("keeps a portfolio-only May 7 deadline on Week 1's own off-grid strip", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["drawing"], // portfolio 2027-05-07, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    // Date cutoff, not a kind predicate (Jon's bounce on issue #97): May 7 sits
    // inside Week 1's window, so the deadline rides Week 1 exactly as it did
    // pre-#97 — an empty grid plus the "Not placed on the grid" strip. No
    // Week 0 card is emitted at all.
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards[0].deadlines).toBe(false);
    expect(cards[0].week).not.toBeNull();
    expect(blocksOf(cards[0])).toEqual([]);
    expect(cards[0].offGrid.map((o) => o.reason)).toEqual(["portfolio"]);
    expect(cards[0].offGrid[0].label).toBe("Portfolio due Friday, May 7, 2027");
  });

  it("fans out the SAME cards as the list variant, deadlines included", () => {
    // The #73 one-presentation principle, pinned across the two exports for the
    // ticket's worst case (both deadline dates + a Week 1 exam). This is the
    // assertion that catches the cutoff being applied to only one variant.
    const selection = ["research", "drawing", "physics-c-mechanics"];
    const calendar = buildCalendarCards(
      SUBJECTS,
      selection,
      NO_RESOLUTIONS,
      START_TIMES,
    );
    const list = buildWeekCards(SUBJECTS, selection, NO_RESOLUTIONS, START_TIMES);
    expect(calendar.cards.map((c) => c.slug)).toEqual(
      list.cards.map((c) => c.slug),
    );
    expect(calendar.cards.map((c) => c.label)).toEqual(["Week 0", "Week 1"]);
    expect(calendar.cards.map((c) => c.rangeLabel)).toEqual(
      list.cards.map((c) => c.rangeLabel),
    );
    // Apr 30 leaves for Week 0; the in-window May 7 deadline stays on Week 1,
    // beside that week's grid — the same split the list variant makes.
    expect(calendar.cards[0].offGrid.map((o) => o.subjectName)).toEqual([
      "AP Research",
    ]);
    expect(calendar.cards[1].offGrid.map((o) => o.subjectName)).toEqual([
      "AP Drawing",
    ]);
    expect(
      list.cards[1].rows.filter((r) => r.kind === "portfolio").map((r) => r.subjectName),
    ).toEqual(["AP Drawing"]);
  });
});

describe("buildCalendarCards — zero qualifying weeks", () => {
  it("emits no cards when every selection is undated", () => {
    const { cards, undated } = buildCalendarCards(
      SUBJECTS,
      ["test-undated-course"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards).toEqual([]);
    expect(undated.map((u) => u.id)).toEqual(["test-undated-course"]);
  });

  it("emits no cards for an empty selection", () => {
    const { cards, undated } = buildCalendarCards(
      SUBJECTS,
      [],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards).toEqual([]);
    expect(undated).toEqual([]);
  });
});
