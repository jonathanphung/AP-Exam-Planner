import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { withUndatedSubject } from "./test-fixtures";
import type { ApDataset, ApSubject } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildWeekCards, WEEK_ZERO_INDEX } from "./week-cards";

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
 *     (2027-04-30 → the Week 0 deadlines card, issue #97).
 *   - AP Drawing's portfolio is due 2027-05-07, INSIDE Week 1's window, and
 *     still belongs to Week 0 — the split is by row kind, never by date.
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

  it("a 2-week selection emits exactly the two spanned weeks in order (plus Week 0 for its deadline)", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["physics-c-mechanics", "seminar"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 0", "Week 1", "Week 2"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-0", "week-1", "week-2"]);

    // Issue #97: the Seminar portfolio (Apr 30) is its OWN card, not a row
    // above the Week 1 exams.
    const week0 = cards[0];
    expect(week0.deadlines).toBe(true);
    expect(week0.late).toBe(false);
    expect(week0.rows.map((r) => `${r.subjectName}:${r.kind}`)).toEqual([
      "AP Seminar:portfolio",
    ]);
    const portfolio = week0.rows[0];
    expect(portfolio.date).toBe("2027-04-30");
    expect(portfolio.startClock).toBeNull();
    // The model still carries the submission note verbatim; the exported card
    // deliberately never prints it (Jon's #91 bounce).
    expect(portfolio.note).toBeTruthy();
    // The range label describes the rows the card holds, not a window.
    expect(week0.rangeLabel).toBe("Apr 30, 2027");

    // Week 1 is now exams only.
    const week1 = cards[1];
    expect(week1.deadlines).toBe(false);
    expect(week1.rows.map((r) => `${r.subjectName}:${r.kind}`)).toEqual([
      "AP Physics C: Mechanics:exam",
    ]);

    // Week 2: the Seminar sit-down exam (PM).
    const week2 = cards[2];
    expect(week2.rows.map((r) => r.subjectName)).toEqual(["AP Seminar"]);
    expect(week2.rows[0].startClock).toBe("12:00 PM");
    expect(week2.rows[0].endClock).toBe("2:00 PM");
  });

  it("a 3-week selection (a moved-to-late exam) emits Week 0, Week 1, Week 2, Late Testing", () => {
    const { cards } = buildWeekCards(
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
    // Week 0 does not shift the position-derived numbering.
    expect(cards[1].weekIndex).toBe(0);
    expect(cards[0].weekIndex).toBe(WEEK_ZERO_INDEX);

    const late = cards[3];
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

  it("puts an IN-window deadline (May 7, inside Week 1) on Week 0 with its real date", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["drawing"], // portfolio 2027-05-07, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    // The predicate is the row KIND, not a date cutoff (issue #97): May 7 falls
    // inside Week 1's window and the deadline STILL leaves the exam card.
    expect(cards.map((c) => c.label)).toEqual(["Week 0"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-0"]);
    const row = cards[0].rows[0];
    expect(row.kind).toBe("portfolio");
    expect(row.date).toBe("2027-05-07");
    expect(cards[0].rangeLabel).toBe("May 7, 2027");
  });

  it("puts an out-of-window deadline (Apr 30) on Week 0, not the nearest week", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["research"], // portfolio 2027-04-30, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 0"]);
    expect(cards[0].rows[0].date).toBe("2027-04-30");
  });

  it("collects BOTH deadline dates onto one Week 0 card, exam weeks left clean", () => {
    // The ticket's worst case: a language PPR (Apr 30), an Art & Design
    // portfolio (May 7 — inside Week 1), and a Week 1 exam.
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["research", "drawing", "physics-c-mechanics"],
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 0", "Week 1"]);

    const week0 = cards[0];
    expect(week0.rows.map((r) => [r.subjectName, r.date])).toEqual([
      ["AP Research", "2027-04-30"],
      ["AP Drawing", "2027-05-07"],
    ]);
    expect(week0.rows.every((r) => r.kind === "portfolio")).toBe(true);
    // A card spanning both deadline dates labels the span it actually holds.
    expect(week0.rangeLabel).toBe("Apr 30 – May 7, 2027");

    // No portfolio row survives on ANY exam week card.
    expect(
      cards.slice(1).flatMap((c) => c.rows.filter((r) => r.kind === "portfolio")),
    ).toEqual([]);
    expect(cards[1].rows.map((r) => r.subjectName)).toEqual([
      "AP Physics C: Mechanics",
    ]);
  });

  it("emits Week 0 for EVERY portfolio subject in the cycle and nothing else", () => {
    const portfolioIds = SUBJECTS.filter((s) => s.portfolio !== null).map(
      (s) => s.id,
    );
    // Fixture guard: the cycle really does ship the 12 deadlines the ticket
    // describes (a swap that changes this should re-point the suite loudly).
    expect(portfolioIds.length).toBeGreaterThan(1);

    const { cards } = buildWeekCards(
      SUBJECTS,
      portfolioIds,
      NO_RESOLUTIONS,
      START_TIMES,
    );
    const week0 = cards[0];
    expect(week0.label).toBe("Week 0");
    expect(
      week0.rows.filter((r) => r.kind === "portfolio").map((r) => r.subjectId),
    ).toEqual(expect.arrayContaining(portfolioIds));
    expect(
      cards.flatMap((c) =>
        c.deadlines ? [] : c.rows.filter((r) => r.kind === "portfolio"),
      ),
      "a portfolio row is still riding an exam week card",
    ).toEqual([]);
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
