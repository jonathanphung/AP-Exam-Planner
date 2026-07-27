import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import type { ApDataset } from "../data/schema";
import type { SlotResolution } from "./conflicts";
import { buildWeekCards, weekCardNotes, type WeekCardRow } from "./week-cards";

/**
 * Builder unit tests (issue #91) — the list-card notes model.
 *
 * The defect: `export-png.ts` inlined `row.note` and `row.examNote` verbatim
 * under each subject name. The PPR submission note is BYTE-IDENTICAL across all
 * six AP language subjects, so a card for a student taking two of them printed
 * the same 310-character paragraph twice, and one taking all six printed it six
 * times — at 12px on a 680px card that is a wall of text sitting on top of the
 * May dates the export exists to communicate.
 *
 * `weekCardNotes` is the fix's data half: group by (kind, verbatim text) so the
 * renderer paints "one note, many subjects" instead of "one note per row".
 * Everything here is derived from the SHIPPED dataset (the `week-cards.test.ts`
 * / `exports.test.ts` precedent) — no note text and no subject id is hardcoded,
 * so the next annual swap re-points the suite instead of going stale, and the
 * fixture guard fails loudly rather than letting an assertion go vacuous.
 *
 * The RENDERING half (marker on the row, strip below the rows) has no DOM in
 * the vitest setup to assert against; `e2e/issue-71-qa.spec.ts` already observes
 * the rasterized card's DOM and pins the verbatim qualifier there.
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
  it("the dataset still ships a note shared by several subjects", () => {
    // Without this the de-duplication tests would pass vacuously on a cycle
    // whose notes happen to be unique — a swap needs re-pointing, not silence.
    expect(SHARED, "no subject in this cycle carries a portfolio note").toBeTruthy();
    expect(
      SHARED.ids.length,
      "no portfolio note is shared by 2+ subjects — nothing to de-duplicate",
    ).toBeGreaterThan(1);
    expect(SHARED.note.length).toBeGreaterThan(100);
  });
});

describe("weekCardNotes — de-duplication (AC4)", () => {
  it("prints a shared note ONCE, attributed to every subject that carries it", () => {
    const notes = weekCardNotes(rowsFor(SHARED.ids));
    const shared = notes.filter((n) => n.text === SHARED.note);
    expect(
      shared,
      `the shared note was emitted ${shared.length} times for ${SHARED.ids.length} subjects`,
    ).toHaveLength(1);

    const expectedNames = SHARED.ids.map(
      (id) => SUBJECTS.find((s) => s.id === id)!.name,
    );
    expect([...shared[0].subjectNames].sort()).toEqual(
      [...expectedNames].sort(),
    );
  });

  it("attributes only the SELECTED subjects, never the whole group", () => {
    const [first, second] = SHARED.ids;
    const notes = weekCardNotes(rowsFor([first, second]));
    const shared = notes.filter((n) => n.text === SHARED.note);
    expect(shared).toHaveLength(1);
    expect(shared[0].subjectNames).toHaveLength(2);
  });

  it("keeps distinct notes distinct (de-dup is by text, not by kind)", () => {
    const oneEach = PORTFOLIO_GROUPS.map((g) => g.ids[0]);
    const notes = weekCardNotes(rowsFor(oneEach));
    const texts = notes.map((n) => n.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toHaveLength(PORTFOLIO_GROUPS.length);
  });
});

describe("weekCardNotes — nothing dropped, nothing invented (AC2, AC3)", () => {
  it("every note a row carries survives, verbatim and unmodified", () => {
    const ids = [
      ...SHARED.ids,
      ...(NOTED_EXAM ? [NOTED_EXAM.id] : []),
      ...PORTFOLIO_GROUPS.slice(1).map((g) => g.ids[0]),
    ];
    const rows = rowsFor(ids);
    const notes = weekCardNotes(rows);

    for (const row of rows) {
      if (row.note) {
        const hit = notes.find(
          (n) => n.kind === "portfolio" && n.text === row.note,
        );
        expect(hit, `lost the portfolio note for ${row.subjectName}`).toBeTruthy();
        expect(hit!.subjectNames).toContain(row.subjectName);
      }
      if (row.examNote) {
        const hit = notes.find(
          (n) => n.kind === "exam" && n.text === row.examNote,
        );
        expect(hit, `lost the exam qualifier for ${row.subjectName}`).toBeTruthy();
        expect(hit!.subjectNames).toContain(row.subjectName);
      }
    }
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

describe("weekCardNotes — kinds and ordering", () => {
  it("separates the exam qualifier from portfolio notes by kind", () => {
    if (!NOTED_EXAM) return; // a cycle that publishes no qualifier
    const notes = weekCardNotes(rowsFor([NOTED_EXAM.id, SHARED.ids[0]]));
    const exam = notes.filter((n) => n.kind === "exam");
    expect(exam).toHaveLength(1);
    expect(exam[0].text).toBe(NOTED_EXAM.examNote);
    expect(exam[0].subjectNames).toEqual([NOTED_EXAM.name]);
    expect(notes.some((n) => n.kind === "portfolio")).toBe(true);
  });

  it("orders notes by first appearance in row order", () => {
    const ids = PORTFOLIO_GROUPS.map((g) => g.ids[0]);
    const rows = rowsFor(ids);
    const notes = weekCardNotes(rows);
    const firstSeen = notes.map((note) =>
      rows.findIndex(
        (row) =>
          (note.kind === "portfolio" ? row.note : row.examNote) === note.text,
      ),
    );
    expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
  });
});

describe("weekCardNotes — bullet category is honest", () => {
  it("keeps the shared category when the whole group agrees", () => {
    const notes = weekCardNotes(rowsFor(SHARED.ids));
    const shared = notes.find((n) => n.text === SHARED.note)!;
    const categories = new Set(
      SHARED.ids.map((id) => SUBJECTS.find((s) => s.id === id)!.category),
    );
    expect(shared.category).toBe(
      categories.size === 1 ? [...categories][0] : null,
    );
  });

  it("drops to null rather than implying a category the group does not share", () => {
    const rows: WeekCardRow[] = [
      { ...stubRow("a", "AP A", "STEM"), note: "same text" },
      { ...stubRow("b", "AP B", "Humanities"), note: "same text" },
    ];
    const notes = weekCardNotes(rows);
    expect(notes).toHaveLength(1);
    expect(notes[0].subjectNames).toEqual(["AP A", "AP B"]);
    expect(notes[0].category).toBeNull();
  });
});

/** Minimal row stand-in for the mixed-category case the dataset cannot produce. */
function stubRow(
  id: string,
  name: string,
  category: WeekCardRow["category"],
): WeekCardRow {
  return {
    key: id,
    subjectId: id,
    subjectName: name,
    kind: "portfolio",
    category,
    date: "2027-04-30",
    weekday: "Fri",
    monthDay: "Apr 30",
    session: null,
    startClock: null,
    endClock: null,
    lengthPending: false,
    movedToLate: false,
    note: null,
    examNote: null,
  };
}
