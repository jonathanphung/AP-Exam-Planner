import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { parseApDataset, type ApSubject } from "../data/schema";
import { buildCalendarLayout, calendarWeeks } from "./calendar";
import { buildCalendarCards } from "./calendar-cards";
import { buildJsonExport, buildTxtExport } from "./exports";
import { buildIcsCalendar } from "./ics";
import { EXAM_NOTE_LABEL, buildSchedule } from "./schedule";
import { buildWeekCards } from "./week-cards";

/**
 * Cross-surface contract for a published exam qualifier (`examNote`), issue #71
 * AC6.
 *
 * The May 2027 swap (#37) added AP Networking, whose exam College Board lists as
 * "Networking (2026-27 pilot schools only)". #37 disclosed that qualifier on the
 * two CATALOG surfaces (`SubjectChip` Tier-1, `InfoPanel` details dialog) and
 * was explicitly forbidden from touching anything else, so every SCHEDULE
 * surface printed a bare "May 7 · PM" — a published date without its published
 * restriction, which reads as an exam any student can sit.
 *
 * This suite pins the qualifier onto every pure schedule surface at once, so a
 * future refactor cannot quietly drop it from one of them:
 *
 * | surface                     | asserted here                              |
 * |-----------------------------|--------------------------------------------|
 * | `buildSchedule` entry model | source of truth for every surface below    |
 * | calendar grid block         | `CalendarBlock.examNote` (site + PNG grid) |
 * | `.ics` DESCRIPTION          | leading `Published note:` line             |
 * | `.txt` export               | trailing `| Published note: …` column      |
 * | `.json` export              | verbatim dataset record (already)          |
 * | `.png` list card row        | `WeekCardRow.examNote`                     |
 * | `.png` calendar card block  | block on the emitted card carries the note |
 *
 * The React render sites (`ScheduleView` row, `CalendarView` block face +
 * accessible name) are covered in the browser by `e2e/issue-71-exam-note.spec.ts`
 * (render sites + downloads) and `e2e/issue-71-qa.spec.ts` (the PNG renderers,
 * the moved-to-late path, and the block face's paint geometry).
 *
 * Every assertion is derived from the dataset — the subject id, the note text,
 * and the date are never hardcoded — so the next annual swap re-points them
 * automatically, and the suite skips cleanly in a cycle that ships no qualifier.
 */

const dataset = parseApDataset(apData);
const SUBJECTS = dataset.subjects;
const START_TIMES = dataset.sessionStartTimes;

/** The dataset's noted subject, or null in a cycle that publishes no qualifier. */
const NOTED: ApSubject | null =
  SUBJECTS.find((s) => s.examNote && s.exam !== null) ?? null;

describe(`published exam qualifier reaches every schedule surface (${EXAM_NOTE_LABEL})`, () => {
  it("fixture: the shipped dataset carries at least one exam-bearing examNote", () => {
    // Guards the skips below from silently disabling the whole suite: if a swap
    // drops every qualifier this is the one test that fails, and the rest are
    // legitimately vacuous.
    expect(
      SUBJECTS.some((s) => s.examNote),
      "no subject carries an examNote — if that is correct for this cycle, delete this suite; if not, the dataset regressed",
    ).toBe(true);
  });

  it("buildSchedule copies the verbatim note onto the exam entry and never onto a portfolio entry", () => {
    if (!NOTED) return;
    const portfolioSubject = SUBJECTS.find((s) => s.portfolio !== null)!;
    const { groups } = buildSchedule(SUBJECTS, [
      NOTED.id,
      portfolioSubject.id,
    ]);
    const entries = groups.flatMap((g) => g.entries);

    const exam = entries.find(
      (e) => e.subjectId === NOTED.id && e.kind === "exam",
    );
    expect(exam?.examNote).toBe(NOTED.examNote);

    for (const entry of entries.filter((e) => e.kind === "portfolio")) {
      expect(entry.examNote).toBeNull();
    }
    // A subject WITHOUT a qualifier must stay null — never an empty string.
    const plain = SUBJECTS.find((s) => !s.examNote && s.exam !== null)!;
    const plainEntry = buildSchedule(SUBJECTS, [plain.id]).groups[0].entries[0];
    expect(plainEntry.examNote).toBeNull();
  });

  it("the positioned calendar block carries the note (site grid + PNG grid read the same model)", () => {
    if (!NOTED) return;
    const schedule = buildSchedule(SUBJECTS, [NOTED.id]);
    const layout = buildCalendarLayout(
      schedule,
      START_TIMES,
      new Map(
        SUBJECTS.map((s) => [
          s.id,
          { category: s.category, totalMinutes: s.format.totalMinutes },
        ]),
      ),
    );
    const blocks = layout.weeks.flatMap((w) =>
      w.days.flatMap((d) => d.blocks),
    );
    const block = blocks.find((b) => b.subjectId === NOTED.id);
    expect(block, "the noted subject should be placed on the grid").toBeTruthy();
    expect(block!.examNote).toBe(NOTED.examNote);
  });

  it("the .ics DESCRIPTION leads with the verbatim note above the section rows", () => {
    if (!NOTED) return;
    const ics = buildIcsCalendar(
      SUBJECTS,
      [NOTED.id],
      [],
      START_TIMES,
      new Date("2026-07-24T12:00:00Z"),
    );
    // Unfold RFC 5545 continuation lines before matching (the note is long).
    const unfolded = ics.replace(/\r\n /g, "");
    const description = unfolded
      .split("\r\n")
      .find((line) => line.startsWith("DESCRIPTION:"))!;
    expect(description).toContain(`${EXAM_NOTE_LABEL}: `);
    // Verbatim, with only RFC 5545 TEXT escaping applied.
    const escaped = NOTED.examNote!.replace(/,/g, "\\,").replace(/;/g, "\\;");
    expect(description).toContain(escaped);
    // It LEADS: the qualifier is the first thing in the DESCRIPTION, before
    // any section or total row. Anchored on the DESCRIPTION's own start rather
    // than on the total row, because the noted subject (AP Networking) has no
    // published length and therefore no Total Length row since issue #84 —
    // the previous "before Total Length:" form silently passed on -1.
    const body = description.slice("DESCRIPTION:".length);
    expect(body.startsWith(`${EXAM_NOTE_LABEL}: `)).toBe(true);
  });

  it("the .txt export appends the verbatim note as a trailing column on the exam line", () => {
    if (!NOTED) return;
    const txt = buildTxtExport(
      SUBJECTS,
      [NOTED.id],
      [],
      "Schedule 1",
      dataset.cycle,
    );
    const line = txt
      .split("\r\n")
      .find((l) => l.includes(NOTED.name))!;
    expect(line).toContain(`| ${EXAM_NOTE_LABEL}: ${NOTED.examNote}`);
  });

  it("the .json export still serializes the note verbatim on the dataset record", () => {
    if (!NOTED) return;
    const parsed = JSON.parse(
      buildJsonExport(SUBJECTS, [NOTED.id], [], "Schedule 1"),
    );
    expect(parsed.schedule.subjects[0].examNote).toBe(NOTED.examNote);
  });

  it("the .png list card row carries the note", () => {
    if (!NOTED) return;
    const { cards } = buildWeekCards(SUBJECTS, [NOTED.id], [], START_TIMES);
    const row = cards
      .flatMap((c) => c.rows)
      .find((r) => r.subjectId === NOTED.id);
    expect(row?.examNote).toBe(NOTED.examNote);
  });

  it("the .png calendar card's block carries the note", () => {
    if (!NOTED) return;
    const { cards } = buildCalendarCards(SUBJECTS, [NOTED.id], [], START_TIMES);
    const block = cards
      .flatMap((c) => c.week.days)
      .flatMap((d) => d.blocks)
      .find((b) => b.subjectId === NOTED.id);
    expect(block?.examNote).toBe(NOTED.examNote);
  });

  it("no surface truncates, paraphrases, or re-cases the published text", () => {
    if (!NOTED) return;
    // The label names the CLASS of text; the qualifier itself must appear
    // byte-for-byte. This guards against a future "short badge" refactor
    // sneaking a derived summary onto a schedule surface.
    const note = NOTED.examNote!;
    const txt = buildTxtExport(
      SUBJECTS,
      [NOTED.id],
      [],
      "Schedule 1",
      dataset.cycle,
    );
    expect(txt).toContain(note);
    const { cards } = buildWeekCards(SUBJECTS, [NOTED.id], [], START_TIMES);
    expect(cards.flatMap((c) => c.rows)[0].examNote).toBe(note);
    expect(note.length).toBeGreaterThan(40); // it really is a paragraph
  });

  it("the noted exam is placed inside a real testing week (the note is not a stand-in for a missing date)", () => {
    if (!NOTED) return;
    const weeks = calendarWeeks();
    const inAWeek = weeks.some((w) => w.days.includes(NOTED.exam!.date));
    expect(inAWeek).toBe(true);
  });
});
