import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { withUndatedSubject } from "./test-fixtures";
import type { ApDataset, ApSubject } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildWeekCards } from "./week-cards";

/**
 * Builder unit tests (issue #56) — the pure per-week PNG model.
 *
 * The AC-critical assertion: feed a selection spanning 1, 2, and 3 testing
 * weeks and check the EXACT set of emitted weeks. The partition is driven by
 * the shared `calendarWeeks()` window model (no hardcoded May dates here), so
 * these run against the REAL shipped dataset (the exports.test.ts precedent):
 *
 *   - AP Physics C: Mechanics (2027-05-03 AM, STEM, 180 min) → Week 1, 8:00–11:00 AM.
 *   - AP Human Geography (2027-05-03 AM) shares Physics C: Mechanics's slot; keeping Physics C: Mechanics bumps
 *     Human Geography to its real late slot (2027-05-17 PM) → the Late Testing week.
 *   - AP Seminar has an exam (2027-05-10 PM → Week 2) AND a portfolio deadline
 *     (2027-04-30, before every window → nearest = Week 1).
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

describe("buildWeekCards — exact set of emitted weeks by span (AC)", () => {
  it("a 1-week selection emits exactly one card", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["physics-c-mechanics"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1"]);
    expect(cards[0].late).toBe(false);
    // rangeLabel is the canonical weekRangeLabel() output + year (reuse, not
    // reinvent) — within-May windows keep both month names.
    expect(cards[0].rangeLabel).toBe("May 3 – May 7, 2027");
    expect(cards[0].rows.map((r) => r.subjectName)).toEqual(["AP Physics C: Mechanics"]);
    const bio = cards[0].rows[0];
    expect(bio.startClock).toBe("8:00 AM");
    expect(bio.endClock).toBe("11:00 AM");
    expect(bio.lengthPending).toBe(false);
    expect(bio.movedToLate).toBe(false);
  });

  it("a 2-week selection emits exactly the two spanned weeks in order", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["physics-c-mechanics", "seminar"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1", "Week 2"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1", "week-2"]);

    // Week 1 rows are chronological: the Seminar portfolio (Apr 30) precedes
    // the Physics C: Mechanics exam (May 4); the out-of-window deadline rides Week 1.
    const week1 = cards[0];
    expect(week1.rows.map((r) => `${r.subjectName}:${r.kind}`)).toEqual([
      "AP Seminar:portfolio",
      "AP Physics C: Mechanics:exam",
    ]);
    const portfolio = week1.rows[0];
    expect(portfolio.kind).toBe("portfolio");
    expect(portfolio.date).toBe("2027-04-30");
    expect(portfolio.startClock).toBeNull();
    expect(portfolio.note).toBeTruthy();

    // Week 2: the Seminar sit-down exam (PM).
    const week2 = cards[1];
    expect(week2.rows.map((r) => r.subjectName)).toEqual(["AP Seminar"]);
    expect(week2.rows[0].startClock).toBe("12:00 PM");
    expect(week2.rows[0].endClock).toBe("2:00 PM");
  });

  it("a 3-week selection (a moved-to-late exam) emits Week 1, Week 2, Late Testing", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["physics-c-mechanics", "human-geography", "seminar"],
      [KEEP_PHYSICS_C],
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
    expect(late.rangeLabel).toBe("May 17 – May 21, 2027");
    // Human Geography renders at its EFFECTIVE (late) slot, flagged moved.
    expect(late.rows.map((r) => r.subjectName)).toEqual(["AP Human Geography"]);
    const humanGeography = late.rows[0];
    expect(humanGeography.movedToLate).toBe(true);
    expect(humanGeography.date).toBe("2027-05-17");
    expect(humanGeography.session).toBe("PM");
    expect(humanGeography.startClock).toBe("12:00 PM");
    expect(humanGeography.endClock).toBe("2:15 PM");
  });
});

describe("buildWeekCards — hard data rule (pending length → no end clock)", () => {
  const PENDING_SUBJECT = {
    id: "pending-exam",
    name: "AP Pending Length",
    category: "STEM",
    exam: { date: "2027-05-04", session: "AM" },
    lateTesting: { date: "2027-05-18", session: "AM" },
    format: {
      sections: [],
      totalMinutes: "pending",
      calculator: "pending",
      delivery: "pending",
    },
    passRate: "pending",
    portfolio: null,
  } as unknown as ApSubject;

  it("shows the published start but never a fabricated end time", () => {
    const { cards } = buildWeekCards(
      [PENDING_SUBJECT],
      ["pending-exam"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const row = cards[0].rows[0];
    expect(row.startClock).toBe("8:00 AM");
    expect(row.endClock).toBeNull();
    expect(row.lengthPending).toBe(true);
  });
});

describe("buildWeekCards — nothing silently dropped", () => {
  it("returns undated selections separately and never on a card", () => {
    const { cards, undated } = buildWeekCards(
      SUBJECTS,
      ["physics-c-mechanics", "test-undated-course"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const placedIds = cards.flatMap((c) => c.rows.map((r) => r.subjectId));
    expect(placedIds).not.toContain("test-undated-course");
    expect(undated.map((u) => u.id)).toEqual(["test-undated-course"]);
    expect(undated[0].reason).toBeTruthy();
  });

  it("places an in-window portfolio-only deadline (May 8) on its window's week", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["drawing"], // portfolio 2027-05-07, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    const row = cards[0].rows[0];
    expect(row.kind).toBe("portfolio");
    expect(row.date).toBe("2027-05-07");
  });

  it("attaches an out-of-window deadline (Apr 30) to the nearest week", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["research"], // portfolio 2027-04-30, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards[0].rows[0].date).toBe("2027-04-30");
  });
});

describe("buildWeekCards — zero qualifying weeks", () => {
  it("emits no cards when every selection is undated", () => {
    const { cards, undated } = buildWeekCards(
      SUBJECTS,
      ["test-undated-course"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards).toEqual([]);
    expect(undated.map((u) => u.id)).toEqual(["test-undated-course"]);
  });

  it("emits no cards for an empty selection", () => {
    const { cards, undated } = buildWeekCards(
      SUBJECTS,
      [],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards).toEqual([]);
    expect(undated).toEqual([]);
  });
});
