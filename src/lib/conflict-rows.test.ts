import { describe, expect, it } from "vitest";
import { conflictActionRows, lateTestingDestination } from "./conflict-rows";
import type { ApSubject, Category } from "../data/schema";

/**
 * Issue #111 — the conflict prompt's merged action stack.
 *
 * The destination bullet list is gone: every member renders exactly one row
 * carrying its own late-testing destination. These tests pin the row kinds and
 * the destination copy, including the `no-late-slot` row that no browser
 * fixture can reach (the shipped dataset's schema guarantees a late-testing
 * slot for every subject with a regular exam).
 */

type Slot = { date: string; session: "AM" | "PM" };
type Member = Pick<ApSubject, "name" | "category" | "lateTesting">;

const FRIDAY: Slot = { date: "2027-05-21", session: "AM" };
const THURSDAY: Slot = { date: "2027-05-20", session: "PM" };

function lookup(entries: Record<string, Member>): ReadonlyMap<string, Member> {
  return new Map(Object.entries(entries));
}

function subject(name: string, lateTesting: Slot | null): Member {
  return { name, category: "STEM" as Category, lateTesting };
}

const SUBJECTS = lookup({
  macro: subject("AP Macroeconomics", FRIDAY),
  physics: subject("AP Physics 2", THURSDAY),
  seminar: subject("AP Seminar", null),
});

describe("lateTestingDestination", () => {
  it("formats date + session from the subject's own late-testing slot", () => {
    expect(lateTestingDestination(FRIDAY)).toBe(
      "Friday, May 21, 2027 · AM session",
    );
    expect(lateTestingDestination(THURSDAY)).toBe(
      "Thursday, May 20, 2027 · PM session",
    );
  });
});

describe("conflictActionRows", () => {
  it("a member with a late slot is an actionable Move row carrying its destination", () => {
    const rows = conflictActionRows(["macro"], SUBJECTS, new Set());
    expect(rows).toEqual([
      {
        kind: "move",
        subjectId: "macro",
        name: "AP Macroeconomics",
        category: "STEM",
        destination: "Friday, May 21, 2027 · AM session",
      },
    ]);
  });

  it("a clicked member becomes a moving row and KEEPS its destination (N≥3 parity)", () => {
    const rows = conflictActionRows(
      ["macro", "physics"],
      SUBJECTS,
      new Set(["macro"]),
    );
    expect(rows.map((r) => r.kind)).toEqual(["moving", "move"]);
    expect(rows[0]).toMatchObject({
      kind: "moving",
      destination: "Friday, May 21, 2027 · AM session",
    });
    expect(rows[1]).toMatchObject({
      kind: "move",
      destination: "Thursday, May 20, 2027 · PM session",
    });
  });

  it("a member with NO published late-testing slot is an inert row, never a Move row", () => {
    const rows = conflictActionRows(["seminar"], SUBJECTS, new Set());
    expect(rows).toEqual([
      {
        kind: "no-late-slot",
        subjectId: "seminar",
        name: "AP Seminar",
        category: "STEM",
      },
    ]);
    // No destination is invented for a slot the College Board never published.
    expect(rows[0]).not.toHaveProperty("destination");
  });

  it("marking a slot-less member as moving cannot promote it out of the inert row", () => {
    const rows = conflictActionRows(["seminar"], SUBJECTS, new Set(["seminar"]));
    expect(rows[0].kind).toBe("no-late-slot");
  });

  it("emits exactly one row per member, in the group's member order", () => {
    const rows = conflictActionRows(
      ["physics", "seminar", "macro"],
      SUBJECTS,
      new Set(),
    );
    expect(rows.map((r) => r.subjectId)).toEqual([
      "physics",
      "seminar",
      "macro",
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["move", "no-late-slot", "move"]);
  });

  it("a member missing from the lookup falls back to its id and stays inert", () => {
    const rows = conflictActionRows(["ghost"], SUBJECTS, new Set());
    expect(rows).toEqual([
      {
        kind: "no-late-slot",
        subjectId: "ghost",
        name: "ghost",
        category: undefined,
      },
    ]);
  });
});
