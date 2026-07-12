import { describe, expect, it } from "vitest";
import apData from "../data/ap-2026.json";
import type { ApDataset, ApSubject } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import type { CalendarBlock } from "./calendar";
import { buildCalendarCards, type CalendarCard } from "./calendar-cards";

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
 *   - AP Biology (2026-05-04 AM, STEM, 180 min) → Week 1 grid, 8:00–11:00 AM.
 *   - AP Latin (2026-05-04 AM) shares Biology's slot; keeping Biology bumps
 *     Latin to its real late slot (2026-05-18 PM) → the Late Testing grid.
 *   - AP Seminar has an exam (2026-05-11 PM → Week 2 grid) AND a portfolio
 *     deadline (2026-04-30 → off-grid, nearest week = Week 1).
 *   - AP Cybersecurity (Career Kickstart) has no dated 2026 entry → `undated`.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;
const START_TIMES = dataset.sessionStartTimes;

const NO_RESOLUTIONS: SlotResolution[] = [];

/** Keep Biology at 2026-05-04 AM; Latin is bumped to its real late slot. */
const KEEP_BIOLOGY: SlotResolution = {
  date: "2026-05-04",
  session: "AM",
  keeperId: "biology",
  memberIds: ["biology", "latin"],
};

/** Every positioned block across a card's days, in day order. */
function blocksOf(card: CalendarCard): CalendarBlock[] {
  return card.week.days.flatMap((day) => day.blocks);
}

describe("buildCalendarCards — exact set of emitted weeks by span (AC)", () => {
  it("a 1-week selection emits exactly one calendar card", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["biology"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1"]);
    expect(cards[0].late).toBe(false);
    expect(cards[0].rangeLabel).toBe("May 4 – May 8, 2026");

    const blocks = blocksOf(cards[0]);
    expect(blocks.map((b) => b.subjectName)).toEqual(["AP Biology"]);
    const bio = blocks[0];
    expect(bio.startClock).toBe("8:00 AM");
    expect(bio.endClock).toBe("11:00 AM");
    expect(bio.approximate).toBe(false);
    expect(bio.movedToLate).toBe(false);
    // Axis range is shared across cards and is real chrome, not data.
    expect(cards[0].axisStartHour).toBeLessThanOrEqual(bio.startHour);
    expect(cards[0].axisEndHour).toBeGreaterThan(bio.endHour);
  });

  it("a 2-week selection emits exactly the two spanned weeks in order", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["biology", "seminar"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1", "Week 2"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1", "week-2"]);

    // Week 1: the Biology block on the grid, the Seminar portfolio off-grid.
    const week1 = cards[0];
    expect(blocksOf(week1).map((b) => b.subjectName)).toEqual(["AP Biology"]);
    expect(week1.offGrid.map((o) => o.subjectName)).toEqual(["AP Seminar"]);
    const portfolio = week1.offGrid[0];
    expect(portfolio.reason).toBe("portfolio");
    expect(portfolio.label).toBe("Portfolio due Thursday, April 30, 2026");

    // Week 2: the Seminar sit-down exam block (PM).
    const week2 = cards[1];
    const seminar = blocksOf(week2)[0];
    expect(seminar.subjectName).toBe("AP Seminar");
    expect(seminar.startClock).toBe("12:00 PM");
    expect(seminar.endClock).toBe("2:00 PM");
  });

  it("a 3-week selection (a moved-to-late exam) emits Week 1, Week 2, Late Testing", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["biology", "latin", "seminar"],
      [KEEP_BIOLOGY],
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual([
      "Week 1",
      "Week 2",
      "Late Testing",
    ]);
    expect(cards.map((c) => c.slug)).toEqual([
      "week-1",
      "week-2",
      "late-testing",
    ]);

    const late = cards[2];
    expect(late.late).toBe(true);
    expect(late.rangeLabel).toBe("May 18 – May 22, 2026");
    // Latin renders at its EFFECTIVE (late) slot, flagged moved.
    const latin = blocksOf(late)[0];
    expect(latin.subjectName).toBe("AP Latin");
    expect(latin.movedToLate).toBe(true);
    expect(latin.session).toBe("PM");
    expect(latin.startClock).toBe("12:00 PM");
    expect(latin.endClock).toBe("3:00 PM");
    // The Latin block sits on a May 18–22 day column.
    const latinDay = late.week.days.find((d) =>
      d.blocks.some((b) => b.subjectId === "latin"),
    );
    expect(latinDay?.date).toBe("2026-05-18");
  });
});

describe("buildCalendarCards — hard data rule (pending length → approximate block)", () => {
  const PENDING_SUBJECT = {
    id: "pending-exam",
    name: "AP Pending Length",
    category: "STEM",
    exam: { date: "2026-05-05", session: "AM" },
    lateTesting: { date: "2026-05-19", session: "AM" },
    format: {
      sections: [],
      totalMinutes: "pending",
      calculator: "pending",
      delivery: "pending",
    },
    passRate: "pending",
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
      ["biology", "cybersecurity"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const placed = cards.flatMap((c) => blocksOf(c).map((b) => b.subjectId));
    expect(placed).not.toContain("cybersecurity");
    expect(undated.map((u) => u.id)).toEqual(["cybersecurity"]);
  });

  it("emits a Week 1 card (empty grid, off-grid strip) for a portfolio-only May 8 deadline", () => {
    const { cards } = buildCalendarCards(
      SUBJECTS,
      ["drawing"], // portfolio 2026-05-08, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(blocksOf(cards[0])).toEqual([]);
    expect(cards[0].offGrid.map((o) => o.reason)).toEqual(["portfolio"]);
    expect(cards[0].offGrid[0].label).toBe("Portfolio due Friday, May 8, 2026");
  });
});

describe("buildCalendarCards — zero qualifying weeks", () => {
  it("emits no cards when every selection is undated", () => {
    const { cards, undated } = buildCalendarCards(
      SUBJECTS,
      ["cybersecurity", "business-with-personal-finance"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards).toEqual([]);
    expect(undated.map((u) => u.id).sort()).toEqual([
      "business-with-personal-finance",
      "cybersecurity",
    ]);
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
