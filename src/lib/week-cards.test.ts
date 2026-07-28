import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { withUndatedSubject } from "./test-fixtures";
import type { ApDataset, ApSubject } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { calendarWeeks } from "./calendar";
import {
  belongsOnWeekZero,
  buildWeekCards,
  firstWindowStart,
  WEEK_ZERO_INDEX,
} from "./week-cards";

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
 *     (2027-04-30, before every window → the Week 0 deadlines card, issue #97).
 *   - AP Drawing's portfolio is due 2027-05-07, INSIDE Week 1's window, so it
 *     rides Week 1 like any other May 7 entry — the split is a DATE CUTOFF
 *     (strictly before the first testing day), not the row kind. #97's first
 *     build routed it to Week 0 by kind and Jon bounced that (2026-07-27).
 *   - A synthetic undated subject (no May 2027 course is undated) → `undated`.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = withUndatedSubject(dataset.subjects);
const START_TIMES = dataset.sessionStartTimes;

const NO_RESOLUTIONS: SlotResolution[] = [];

/**
 * The Week 0 cutoff, derived the way production derives it — the first day of
 * the earliest published window. Never spelled as a literal here, so an annual
 * dataset swap re-pages these expectations instead of breaking them.
 */
const FIRST_DAY = firstWindowStart(calendarWeeks())!;

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

  it("keeps an IN-window deadline (May 7, inside Week 1) on the week it occurs in", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["drawing"], // portfolio 2027-05-07, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    // Jon's bounce on issue #97: the predicate is a DATE CUTOFF, not the row
    // kind. May 7 is not before exam week, so the Art & Design deadline stays
    // exactly where it sat pre-#97 — no Week 0 card is emitted at all here.
    expect(cards.map((c) => c.label)).toEqual(["Week 1"]);
    expect(cards.map((c) => c.slug)).toEqual(["week-1"]);
    expect(cards[0].deadlines).toBe(false);
    const row = cards[0].rows[0];
    expect(row.kind).toBe("portfolio");
    expect(row.date).toBe("2027-05-07");
  });

  it("puts a BEFORE-window deadline (Apr 30) on Week 0, not the nearest week", () => {
    const { cards } = buildWeekCards(
      SUBJECTS,
      ["research"], // portfolio 2027-04-30, no exam
      NO_RESOLUTIONS,
      START_TIMES,
    );
    expect(cards.map((c) => c.label)).toEqual(["Week 0"]);
    expect(cards[0].rows[0].date).toBe("2027-04-30");
    // One date on the card → a single-date label, never an invented span.
    expect(cards[0].rangeLabel).toBe("Apr 30, 2027");
  });

  it("splits the two deadline dates across Week 0 and the week each occurs in", () => {
    // The ticket's worst case: a language PPR (Apr 30, before every window), an
    // Art & Design portfolio (May 7 — inside Week 1), and a Week 1 exam. The
    // cutoff, not the kind, decides: only the Apr 30 row leaves Week 1.
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
    ]);
    expect(week0.rows.every((r) => r.kind === "portfolio")).toBe(true);
    expect(week0.rangeLabel).toBe("Apr 30, 2027");

    // Week 1 keeps its exam AND the in-window deadline, chronological: the
    // May 3 exam, then the May 7 deadline (portfolios sort last within a day).
    expect(cards[1].rows.map((r) => [r.subjectName, r.kind])).toEqual([
      ["AP Physics C: Mechanics", "exam"],
      ["AP Drawing", "portfolio"],
    ]);
  });

  it("routes every pre-window deadline in the cycle to Week 0, in-window ones to their own week", () => {
    const portfolioIds = SUBJECTS.filter((s) => s.portfolio !== null).map(
      (s) => s.id,
    );
    // Fixture guard: the cycle really does ship deadlines on BOTH sides of the
    // cutoff (a swap that changes this should re-point the suite loudly).
    const deadlineOf = (id: string) =>
      SUBJECTS.find((s) => s.id === id)!.portfolio!.deadline;
    const beforeWindow = portfolioIds.filter((id) => deadlineOf(id) < FIRST_DAY);
    const inWindow = portfolioIds.filter((id) => deadlineOf(id) >= FIRST_DAY);
    expect(beforeWindow.length).toBeGreaterThan(0);
    expect(inWindow.length).toBeGreaterThan(0);

    const { cards } = buildWeekCards(
      SUBJECTS,
      portfolioIds,
      NO_RESOLUTIONS,
      START_TIMES,
    );
    const week0 = cards[0];
    expect(week0.label).toBe("Week 0");
    expect(week0.rows.map((r) => r.subjectId).sort()).toEqual(
      [...beforeWindow].sort(),
    );
    // Nothing from the near side of the cutoff leaked onto the deadlines card.
    expect(
      week0.rows.filter((r) => r.date >= FIRST_DAY),
      "an in-window deadline is riding the Week 0 card",
    ).toEqual([]);
    // …and every in-window deadline is still on a real exam week.
    expect(
      cards
        .filter((c) => !c.deadlines)
        .flatMap((c) => c.rows.filter((r) => r.kind === "portfolio"))
        .map((r) => r.subjectId)
        .sort(),
    ).toEqual([...inWindow].sort());
  });
});

describe("buildWeekCards — the whole roster, the shape Jon's bounce specified", () => {
  it("splits the cycle's deadlines across Week 0 and the weeks they occur in", () => {
    // Every real subject selected — the case the bounce comment tabulates.
    const ids = dataset.subjects.map((s) => s.id);
    const { cards } = buildWeekCards(SUBJECTS, ids, NO_RESOLUTIONS, START_TIMES);
    expect(cards.map((c) => c.slug)).toEqual(["week-0", "week-1", "week-2"]);

    const deadlines = dataset.subjects.filter((s) => s.portfolio !== null);
    const before = deadlines.filter((s) => s.portfolio!.deadline < FIRST_DAY);
    const inWindow = deadlines.filter((s) => s.portfolio!.deadline >= FIRST_DAY);

    // Week 0 holds exactly the pre-window deadlines and nothing else.
    const [week0, ...examWeeks] = cards;
    expect(week0.rows.map((r) => r.subjectId).sort()).toEqual(
      before.map((s) => s.id).sort(),
    );
    expect(week0.rangeLabel).toBe("Apr 30, 2027");

    // Each in-window deadline is a row on the week whose window CONTAINS its
    // date — derived from the shared week model, never asserted as a literal.
    const weeks = calendarWeeks();
    for (const subject of inWindow) {
      const expected = weeks.findIndex((w) =>
        w.days.includes(subject.portfolio!.deadline),
      );
      const carrier = examWeeks.find((c) =>
        c.rows.some((r) => r.subjectId === subject.id && r.kind === "portfolio"),
      );
      expect(carrier, `${subject.id}'s deadline vanished`).toBeTruthy();
      expect(carrier!.weekIndex).toBe(expected);
    }

    // No exam week keeps a pre-window deadline, and Week 0 keeps no exam.
    expect(
      examWeeks.flatMap((c) => c.rows.filter((r) => r.date < FIRST_DAY)),
    ).toEqual([]);
    expect(week0.rows.filter((r) => r.kind === "exam")).toEqual([]);
  });
});

describe("belongsOnWeekZero — the shared Week 0 cutoff (Jon's bounce on #97)", () => {
  const WEEKS = calendarWeeks();

  it("claims a portfolio deadline strictly before the first testing day", () => {
    expect(belongsOnWeekZero(WEEKS, "portfolio", "2027-04-30")).toBe(true);
  });

  it("does NOT claim a deadline dated ON the first testing day", () => {
    // Strict `<`: a deadline due the morning exams start is not "before exam
    // week", so it rides that week — the same one sentence that keeps the Art
    // & Design trio on Week 1.
    expect(belongsOnWeekZero(WEEKS, "portfolio", FIRST_DAY)).toBe(false);
  });

  it("does NOT claim a deadline dated after the first testing day", () => {
    expect(belongsOnWeekZero(WEEKS, "portfolio", "2027-05-07")).toBe(false);
    // Nor a make-up dated after every window — that is a nearest-week case, not
    // a "due before exams start" one.
    expect(belongsOnWeekZero(WEEKS, "portfolio", "2027-06-01")).toBe(false);
  });

  it("never claims an exam, whatever its date", () => {
    expect(belongsOnWeekZero(WEEKS, "exam", "2027-04-01")).toBe(false);
    expect(belongsOnWeekZero(WEEKS, "exam", "2027-05-03")).toBe(false);
  });

  it("emits no Week 0 at all when the dataset publishes no window", () => {
    // Unreachable with the shipped data; pinned so the fallback stays "nothing
    // qualifies" rather than an invented cutoff date.
    expect(firstWindowStart([])).toBeNull();
    expect(belongsOnWeekZero([], "portfolio", "2027-04-30")).toBe(false);
  });

  it("derives the cutoff by reduction, not by trusting weeks[0]", () => {
    const reversed = [...WEEKS].reverse();
    expect(firstWindowStart(reversed)).toBe(FIRST_DAY);
    expect(belongsOnWeekZero(reversed, "portfolio", "2027-04-30")).toBe(true);
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
