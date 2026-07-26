import { describe, expect, it } from "vitest";
import { LATE_TESTING_WINDOW, REGULAR_WINDOWS } from "../data/schema";
import {
  blockVisualEndHour,
  buildCalendarLayout,
  calendarWeeks,
  clockLabel,
  defaultWeekIndex,
  enumerateDates,
  hourLabel,
  monthDayLabel,
  parseStartHour,
  weekdayLabel,
  weekExamCounts,
  weekRangeLabel,
  NOMINAL_EXAM_MINUTES,
  SETUP_BUFFER_MINUTES,
  type SubjectCalendarInfo,
} from "./calendar";
import type { Schedule, ScheduleEntry } from "./schedule";

/**
 * Unit tests for the pure calendar-grid layout logic (issue #19).
 * Fixtures are synthetic Schedule shapes so every branch (exam placement,
 * duration-proportional heights, buffer-aware lane splitting, the
 * marked-approximate unpublished-length fallback, portfolio/off-grid routing,
 * unparseable times) is exercised regardless of the real dataset's contents.
 */

const START_TIMES = { AM: "8 a.m. local time", PM: "12 p.m. local time" };

function examEntry(
  subjectId: string,
  date: string,
  session: "AM" | "PM",
  movedToLate = false,
  examNote: string | null = null,
): ScheduleEntry {
  return {
    key: `${subjectId}:exam`,
    subjectId,
    subjectName: `AP ${subjectId}`,
    kind: "exam",
    date,
    session,
    note: null,
    examNote,
    movedToLate,
  };
}

function portfolioEntry(subjectId: string, date: string): ScheduleEntry {
  return {
    key: `${subjectId}:portfolio`,
    subjectId,
    subjectName: `AP ${subjectId}`,
    kind: "portfolio",
    date,
    session: null,
    note: "fixture note",
    examNote: null,
    movedToLate: false,
  };
}

function scheduleOf(entries: ScheduleEntry[], undated: Schedule["undated"] = []): Schedule {
  const byDate = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const group = byDate.get(entry.date);
    if (group) group.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  return {
    groups: Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, group]) => ({ date, entries: group })),
    undated,
  };
}

// bio: a real 3h15m exam; euro: 2h; latin: no published length — the
// documented nominal/approximate fallback path.
const SUBJECT_INFO: ReadonlyMap<string, SubjectCalendarInfo> = new Map([
  ["bio", { category: "STEM", totalMinutes: 195 }],
  ["euro", { category: "Humanities", totalMinutes: 120 }],
  ["latin", { category: "Languages", totalMinutes: undefined }],
] as const);

describe("enumerateDates", () => {
  it("returns every date from start to end inclusive", () => {
    expect(enumerateDates("2027-05-03", "2027-05-07")).toEqual([
      "2027-05-03",
      "2027-05-04",
      "2027-05-05",
      "2027-05-06",
      "2027-05-07",
    ]);
  });

  it("handles a single-day range and month boundaries", () => {
    expect(enumerateDates("2027-05-03", "2027-05-03")).toEqual(["2027-05-03"]);
    expect(enumerateDates("2027-04-30", "2027-05-01")).toEqual([
      "2027-04-30",
      "2027-05-01",
    ]);
  });
});

describe("calendarWeeks", () => {
  it("covers every day of the published windows, regular weeks first, late last", () => {
    const weeks = calendarWeeks();
    expect(weeks).toHaveLength(REGULAR_WINDOWS.length + 1);
    REGULAR_WINDOWS.forEach((window, i) => {
      expect(weeks[i].late).toBe(false);
      expect(weeks[i].days[0]).toBe(window.start);
      expect(weeks[i].days[weeks[i].days.length - 1]).toBe(window.end);
    });
    const late = weeks[weeks.length - 1];
    expect(late.late).toBe(true);
    expect(late.days[0]).toBe(LATE_TESTING_WINDOW.start);
    expect(late.days[late.days.length - 1]).toBe(LATE_TESTING_WINDOW.end);
  });
});

describe("parseStartHour", () => {
  it("parses the dataset's published session labels", () => {
    expect(parseStartHour(START_TIMES.AM)).toBe(8);
    expect(parseStartHour(START_TIMES.PM)).toBe(12);
  });

  it("handles minutes, casing, and 12 a.m.", () => {
    expect(parseStartHour("1:30 p.m.")).toBe(13.5);
    expect(parseStartHour("9 A.M.")).toBe(9);
    expect(parseStartHour("12 a.m. midnight")).toBe(0);
  });

  it("returns null for unparseable labels (never guesses)", () => {
    expect(parseStartHour("pending")).toBeNull();
    expect(parseStartHour("morning session")).toBeNull();
    expect(parseStartHour("25 p.m.")).toBeNull();
  });
});

describe("clockLabel", () => {
  it("formats fractional hours as 12-hour clock labels", () => {
    expect(clockLabel(8)).toBe("8:00 AM");
    expect(clockLabel(11.25)).toBe("11:15 AM");
    expect(clockLabel(12)).toBe("12:00 PM");
    expect(clockLabel(15.75)).toBe("3:45 PM");
    expect(clockLabel(0)).toBe("12:00 AM");
  });
});

describe("buildCalendarLayout", () => {
  it("places exams on their effective date at the parsed session start hour", () => {
    const layout = buildCalendarLayout(
      scheduleOf([
        examEntry("bio", "2027-05-03", "AM"),
        examEntry("euro", "2027-05-10", "PM"),
      ]),
      START_TIMES,
      SUBJECT_INFO,
    );

    const may4 = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!;
    expect(may4.blocks).toHaveLength(1);
    expect(may4.blocks[0]).toMatchObject({
      subjectId: "bio",
      category: "STEM",
      session: "AM",
      startHour: 8,
      startLabel: START_TIMES.AM,
    });

    const may11 = layout.weeks[1].days.find((d) => d.date === "2027-05-10")!;
    expect(may11.blocks[0]).toMatchObject({
      subjectId: "euro",
      category: "Humanities",
      startHour: 12,
    });
    expect(layout.offGrid).toHaveLength(0);
  });

  it("spans each block over the subject's published exam length (bounce item A1)", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("bio", "2027-05-03", "AM")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    const block = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!
      .blocks[0];
    // 195 published minutes from 8:00 AM → 11:15 AM; the labels carry the
    // TRUE exam span only — the setup buffer is a separate visual allowance.
    expect(block).toMatchObject({
      examMinutes: 195,
      approximate: false,
      startHour: 8,
      endHour: 11.25,
      startClock: "8:00 AM",
      endClock: "11:15 AM",
    });
    expect(blockVisualEndHour(block)).toBeCloseTo(
      11.25 + SETUP_BUFFER_MINUTES / 60,
    );
  });

  it("falls back to the documented nominal block for unpublished lengths, marked approximate (A2)", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("latin", "2027-05-03", "PM")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    const block = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!
      .blocks[0];
    expect(block).toMatchObject({
      examMinutes: null,
      approximate: true,
      startHour: 12,
      endHour: 12 + NOMINAL_EXAM_MINUTES / 60,
    });
  });

  it("treats a subject missing from the info map as approximate, never inventing a length", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("mystery", "2027-05-03", "AM")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    const block = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!
      .blocks[0];
    expect(block).toMatchObject({
      category: null,
      examMinutes: null,
      approximate: true,
    });
  });

  it("renders a moved exam in the late-testing week, not its regular slot", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("latin", "2027-05-18", "PM", true)]),
      START_TIMES,
      SUBJECT_INFO,
    );
    const lateWeek = layout.weeks[layout.weeks.length - 1];
    const may19 = lateWeek.days.find((d) => d.date === "2027-05-18")!;
    expect(may19.blocks[0]).toMatchObject({
      subjectId: "latin",
      movedToLate: true,
    });
  });

  it("splits same-day same-start blocks into side-by-side lanes", () => {
    const layout = buildCalendarLayout(
      scheduleOf([
        examEntry("euro", "2027-05-03", "AM"),
        examEntry("bio", "2027-05-03", "AM"),
        examEntry("latin", "2027-05-03", "PM"),
      ]),
      START_TIMES,
      SUBJECT_INFO,
    );
    const may4 = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!;
    const am = may4.blocks.filter((b) => b.startHour === 8);
    // Sorted by name: AP bio before AP euro.
    expect(am.map((b) => [b.subjectId, b.laneIndex, b.laneCount])).toEqual([
      ["bio", 0, 2],
      ["euro", 1, 2],
    ]);
    // bio's rendered span (8:00 + 195min + buffer → 11:45) ends before the
    // PM start, so latin sits alone in its own cluster at full width.
    const pm = may4.blocks.find((b) => b.startHour === 12)!;
    expect([pm.laneIndex, pm.laneCount]).toEqual([0, 1]);
  });

  it("lane-splits blocks whose rendered spans overlap even with different starts", () => {
    // A synthetic 270-minute AM exam (8:00–12:30 + buffer → 13:00) overlaps
    // the 12:00 PM start, so the PM block must not be hidden underneath it.
    const longInfo: ReadonlyMap<string, SubjectCalendarInfo> = new Map([
      ["bio", { category: "STEM", totalMinutes: 270 }],
      ["latin", { category: "Languages", totalMinutes: 120 }],
    ] as const);
    const layout = buildCalendarLayout(
      scheduleOf([
        examEntry("bio", "2027-05-03", "AM"),
        examEntry("latin", "2027-05-03", "PM"),
      ]),
      START_TIMES,
      longInfo,
    );
    const may4 = layout.weeks[0].days.find((d) => d.date === "2027-05-03")!;
    expect(
      may4.blocks.map((b) => [b.subjectId, b.laneIndex, b.laneCount]),
    ).toEqual([
      ["bio", 0, 2],
      ["latin", 1, 2],
    ]);
  });

  it("routes portfolio deadlines off-grid instead of guessing a time", () => {
    const layout = buildCalendarLayout(
      scheduleOf([portfolioEntry("bio", "2027-04-30")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(layout.weeks.flatMap((w) => w.days).flatMap((d) => d.blocks)).toHaveLength(0);
    expect(layout.offGrid).toEqual([
      expect.objectContaining({ reason: "portfolio" }),
    ]);
  });

  it("routes exams with unparseable session labels off-grid", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("bio", "2027-05-03", "AM")]),
      { AM: "pending", PM: START_TIMES.PM },
      SUBJECT_INFO,
    );
    expect(layout.offGrid).toEqual([
      expect.objectContaining({ reason: "no-published-time" }),
    ]);
  });

  it("routes exam dates outside every published window off-grid", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("bio", "2027-05-08", "AM")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(layout.offGrid).toEqual([
      expect.objectContaining({ reason: "outside-windows" }),
    ]);
  });

  it("extends the axis to fit the tallest rendered block — exam plus buffer (A3)", () => {
    // 195-minute PM exam: 12:00 → 15:15 + 30min buffer → 15:45, so the axis
    // must reach past 4 PM (ceil → 16) for nothing to clip.
    const pmInfo: ReadonlyMap<string, SubjectCalendarInfo> = new Map([
      ["bio", { category: "STEM", totalMinutes: 195 }],
    ] as const);
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("bio", "2027-05-03", "PM")]),
      START_TIMES,
      pmInfo,
    );
    expect(layout.axisStartHour).toBe(8);
    expect(layout.axisEndHour).toBe(16);
  });

  it("derives the empty-grid axis from the session starts plus the nominal block and buffer", () => {
    const layout = buildCalendarLayout(scheduleOf([]), START_TIMES, SUBJECT_INFO);
    expect(layout.axisStartHour).toBe(8);
    expect(layout.axisEndHour).toBe(
      Math.ceil(12 + (NOMINAL_EXAM_MINUTES + SETUP_BUFFER_MINUTES) / 60),
    );
  });

  it("passes undated subjects through", () => {
    const layout = buildCalendarLayout(
      scheduleOf([], [{ id: "cyber", name: "AP Cybersecurity", reason: "2027" }]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(layout.undated).toEqual([
      { id: "cyber", name: "AP Cybersecurity", reason: "2027" },
    ]);
  });
});

describe("week pager helpers", () => {
  it("counts placed exam blocks per week", () => {
    const layout = buildCalendarLayout(
      scheduleOf([
        examEntry("bio", "2027-05-03", "AM"),
        examEntry("euro", "2027-05-04", "PM"),
        examEntry("latin", "2027-05-18", "PM", true),
      ]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(weekExamCounts(layout.weeks)).toEqual([2, 0, 1]);
  });

  it("defaults the pager to the first week containing an exam", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("euro", "2027-05-12", "PM")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(defaultWeekIndex(layout.weeks)).toBe(1);
  });

  it("defaults to the late-testing week when it holds the only exam", () => {
    const layout = buildCalendarLayout(
      scheduleOf([examEntry("bio", "2027-05-19", "PM", true)]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(defaultWeekIndex(layout.weeks)).toBe(layout.weeks.length - 1);
  });

  it("falls back to week 1 when nothing is placed on the grid", () => {
    const empty = buildCalendarLayout(scheduleOf([]), START_TIMES, SUBJECT_INFO);
    expect(defaultWeekIndex(empty.weeks)).toBe(0);
    expect(weekExamCounts(empty.weeks)).toEqual(
      empty.weeks.map(() => 0),
    );

    // Off-grid entries (portfolio deadlines) never influence the default.
    const offGridOnly = buildCalendarLayout(
      scheduleOf([portfolioEntry("bio", "2027-05-07")]),
      START_TIMES,
      SUBJECT_INFO,
    );
    expect(defaultWeekIndex(offGridOnly.weeks)).toBe(0);
  });
});

describe("labels", () => {
  it("formats weekday and month-day headers without timezone day-shift", () => {
    expect(weekdayLabel("2027-05-03")).toBe("MON");
    expect(monthDayLabel("2027-05-03")).toBe("May 3");
  });

  it("formats week ranges", () => {
    expect(weekRangeLabel(["2027-05-03", "2027-05-04", "2027-05-07"])).toBe(
      "May 3 – May 7",
    );
    expect(weekRangeLabel(["2027-05-03"])).toBe("May 3");
    expect(weekRangeLabel([])).toBe("");
  });

  it("formats axis hour ticks", () => {
    expect(hourLabel(8)).toBe("8 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(15)).toBe("3 PM");
    expect(hourLabel(0)).toBe("12 AM");
  });
});
