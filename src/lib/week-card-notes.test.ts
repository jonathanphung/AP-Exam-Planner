import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import type { ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildWeekCards, weekCardNotes, type WeekCardRow } from "./week-cards";

/**
 * Builder unit tests (issue #91, amended by Jon's bounce 2026-07-27) — the
 * list-card notes model.
 *
 * History: PR #96 first fixed the "310-char PPR paragraph printed six times"
 * defect by grouping BOTH verbatim strings (`row.note` + `row.examNote`) into
 * a de-duplicated strip. Jon then bounced the card with the call that the
 * portfolio submission note should not be on the exported list card AT ALL —
 * not inline, not in the strip, not as a marker. So `weekCardNotes` now emits
 * only the published exam qualifiers, and this suite's job is to pin BOTH
 * halves of that contract:
 *
 * 1. `examNote` still survives, verbatim, de-duplicated, attributed — #71's
 *    "the qualifier is never lost on the one surface with no interaction"
 *    requirement is untouched by the bounce.
 * 2. `row.note` is deliberately EXCLUDED — and the exclusion is proven
 *    non-vacuously, against rows that really carry the shared PPR text.
 *
 * Everything is derived from the SHIPPED dataset (the `week-cards.test.ts` /
 * `exports.test.ts` precedent) — no note text and no subject id is hardcoded,
 * so the next annual swap re-points the suite instead of going stale, and the
 * fixture guard fails loudly rather than letting an assertion go vacuous.
 *
 * The RENDERING half (marker on the row, strip below the rows, portfolio text
 * absent from the card DOM) has no DOM in the vitest setup to assert against;
 * `e2e/issue-91-list-note-strip.spec.ts` measures the rasterized card.
 */

const dataset = apData as unknown as ApDataset;
const SUBJECTS = dataset.subjects;
const START_TIMES = dataset.sessionStartTimes;
const NO_RESOLUTIONS: SlotResolution[] = [];

/** Subject ids grouped by their exact portfolio note, largest group first. */
const PORTFOLIO_GROUPS = (() => {
  const byNote = new Map<string, string[]>();
  for (const subject of SUBJECTS) {
    const note = subject.portfolio?.note;
    if (!note) continue;
    const ids = byNote.get(note) ?? [];
    ids.push(subject.id);
    byNote.set(note, ids);
  }
  return [...byNote.entries()]
    .map(([note, ids]) => ({ note, ids }))
    .sort((a, b) => b.ids.length - a.ids.length);
})();

/** The most-repeated portfolio note in the cycle (May 2027: the PPR text ×6). */
const SHARED = PORTFOLIO_GROUPS[0];
/** A subject whose exam carries a published qualifier (May 2027: AP Networking). */
const NOTED_EXAM = SUBJECTS.find((s) => s.examNote && s.exam !== null);

/** Every row on every emitted card for a selection. */
function rowsFor(ids: readonly string[]): WeekCardRow[] {
  const { cards } = buildWeekCards(
    SUBJECTS,
    ids,
    NO_RESOLUTIONS,
    START_TIMES,
  );
  return cards.flatMap((card) => card.rows);
}

describe("weekCardNotes — fixture guard", () => {
  it("the dataset still ships the strings both halves of the contract need", () => {
    // Without these the exclusion tests would pass vacuously on a cycle whose
    // subjects carry no portfolio note — a swap needs re-pointing, not silence.
    expect(SHARED, "no subject in this cycle carries a portfolio note").toBeTruthy();
    expect(
      SHARED.ids.length,
      "no portfolio note is shared by 2+ subjects — the six-times-over defect is unreproducible",
    ).toBeGreaterThan(1);
    expect(SHARED.note.length).toBeGreaterThan(100);
    expect(
      NOTED_EXAM,
      "no exam carries a published qualifier this cycle — the survival half is unprovable",
    ).toBeTruthy();
  });
});

describe("weekCardNotes — portfolio notes are excluded (Jon's bounce, 2026-07-27)", () => {
  it("emits NOTHING for rows that carry only portfolio notes", () => {
    const rows = rowsFor(SHARED.ids);
    // Non-vacuous: the rows really do carry the shared verbatim text …
    expect(rows.some((row) => row.note === SHARED.note)).toBe(true);
    // … and none of it reaches the strip model.
    expect(weekCardNotes(rows)).toEqual([]);
  });

  it("never leaks any portfolio note text, whatever the selection", () => {
    const everyBearer = [
      ...PORTFOLIO_GROUPS.flatMap((g) => g.ids),
      ...(NOTED_EXAM ? [NOTED_EXAM.id] : []),
    ];
    const notes = weekCardNotes(rowsFor(everyBearer));
    for (const group of PORTFOLIO_GROUPS) {
      expect(
        notes.some((n) => n.text === group.note),
        `the portfolio note for ${group.ids.join(", ")} leaked into the strip model`,
      ).toBe(false);
    }
  });
});

describe("weekCardNotes — the exam qualifier still survives (#71 unchanged)", () => {
  it("emits the qualifier verbatim, attributed to its subject", () => {
    if (!NOTED_EXAM) return; // a cycle that publishes no qualifier
    const notes = weekCardNotes(rowsFor([NOTED_EXAM.id, SHARED.ids[0]]));
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe(NOTED_EXAM.examNote);
    expect(notes[0].subjectNames).toEqual([NOTED_EXAM.name]);
  });

  it("returns no notes for a card of plain exams", () => {
    const plain = SUBJECTS.find(
      (s) => s.exam !== null && !s.examNote && !s.portfolio?.note,
    )!;
    expect(weekCardNotes(rowsFor([plain.id]))).toEqual([]);
  });

  it("returns no notes for no rows", () => {
    expect(weekCardNotes([])).toEqual([]);
  });
});

describe("weekCardNotes — de-duplication and honesty (stub rows: the dataset ships one examNote)", () => {
  it("prints a shared qualifier ONCE, attributed to every subject that carries it", () => {
    const rows: WeekCardRow[] = [
      { ...stubRow("a", "AP A", "STEM"), examNote: "same qualifier" },
      { ...stubRow("b", "AP B", "STEM"), examNote: "same qualifier" },
      { ...stubRow("c", "AP C", "STEM"), examNote: "other qualifier" },
    ];
    const notes = weekCardNotes(rows);
    expect(notes.map((n) => n.text)).toEqual([
      "same qualifier",
      "other qualifier",
    ]);
    expect(notes[0].subjectNames).toEqual(["AP A", "AP B"]);
    expect(notes[0].category).toBe("STEM");
  });

  it("drops to null rather than implying a category the group does not share", () => {
    const rows: WeekCardRow[] = [
      { ...stubRow("a", "AP A", "STEM"), examNote: "same text" },
      { ...stubRow("b", "AP B", "Humanities"), examNote: "same text" },
    ];
    const notes = weekCardNotes(rows);
    expect(notes).toHaveLength(1);
    expect(notes[0].subjectNames).toEqual(["AP A", "AP B"]);
    expect(notes[0].category).toBeNull();
  });

  it("orders notes by first appearance in row order", () => {
    const rows: WeekCardRow[] = [
      { ...stubRow("a", "AP A", "STEM"), examNote: "second" },
      { ...stubRow("b", "AP B", "STEM"), examNote: "first" },
    ];
    // Row order IS the emit order — reverse the rows, the notes reverse too.
    expect(weekCardNotes(rows).map((n) => n.text)).toEqual([
      "second",
      "first",
    ]);
    expect(weekCardNotes([...rows].reverse()).map((n) => n.text)).toEqual([
      "first",
      "second",
    ]);
  });
});

/** Minimal row stand-in for shapes the shipped dataset cannot produce. */
function stubRow(
  id: string,
  name: string,
  category: WeekCardRow["category"],
): WeekCardRow {
  return {
    key: id,
    subjectId: id,
    subjectName: name,
    kind: "exam",
    category,
    date: "2027-05-03",
    weekday: "Mon",
    monthDay: "May 3",
    session: "AM",
    startClock: null,
    endClock: null,
    lengthPending: false,
    movedToLate: false,
    note: null,
    examNote: null,
  };
}
