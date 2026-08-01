import { describe, expect, it } from "vitest";
import { keeperAfterMoves, movableMemberIds } from "./conflict-moves";

/**
 * Issue #101 — the inverted conflict prompt's moving-set → keeper translation.
 *
 * The UI records a keeper-based `SlotResolution` (unchanged model); these
 * tests pin the pure translation the dialog uses to derive that keeper from
 * "Move {subject} to late testing" clicks.
 */

const SLOT = { date: "2027-05-19", session: "PM" as const };

/** Minimal subject lookup: only `lateTesting` matters to these helpers. */
function lookup(
  entries: Record<string, { date: string; session: "AM" | "PM" } | null>,
): ReadonlyMap<string, { lateTesting: { date: string; session: "AM" | "PM" } | null }> {
  return new Map(
    Object.entries(entries).map(([id, lateTesting]) => [id, { lateTesting }]),
  );
}

describe("keeperAfterMoves", () => {
  it("two-member conflict: one Move click leaves the other member as keeper", () => {
    expect(keeperAfterMoves(["a", "b"], new Set(["a"]))).toBe("b");
    expect(keeperAfterMoves(["a", "b"], new Set(["b"]))).toBe("a");
  });

  it("no clicks yet: no keeper (nothing to persist)", () => {
    expect(keeperAfterMoves(["a", "b"], new Set())).toBeNull();
    expect(keeperAfterMoves(["a", "b", "c"], new Set())).toBeNull();
  });

  it("N ≥ 3: keeper only exists once all but one member are moving", () => {
    const members = ["a", "b", "c"];
    expect(keeperAfterMoves(members, new Set(["a"]))).toBeNull(); // 2 remain
    expect(keeperAfterMoves(members, new Set(["a", "b"]))).toBe("c");
    expect(keeperAfterMoves(members, new Set(["a", "c"]))).toBe("b");
  });

  it("degenerate: every member moving yields no keeper (never persist)", () => {
    expect(keeperAfterMoves(["a", "b"], new Set(["a", "b"]))).toBeNull();
  });

  it("moving ids outside the member set are ignored", () => {
    expect(keeperAfterMoves(["a", "b"], new Set(["a", "zzz"]))).toBe("b");
  });

  it("keeper is drawn from member order, not moving-set order", () => {
    expect(keeperAfterMoves(["x", "y", "z"], new Set(["z", "x"]))).toBe("y");
  });
});

describe("movableMemberIds", () => {
  it("keeps only members with a published late-testing slot", () => {
    const subjects = lookup({ a: SLOT, b: null, c: SLOT });
    expect(movableMemberIds(["a", "b", "c"], subjects)).toEqual(["a", "c"]);
  });

  it("members missing from the lookup are not movable", () => {
    const subjects = lookup({ a: SLOT });
    expect(movableMemberIds(["a", "ghost"], subjects)).toEqual(["a"]);
  });

  it("shipped-dataset shape: every member movable, order preserved", () => {
    const subjects = lookup({ a: SLOT, b: SLOT });
    expect(movableMemberIds(["b", "a"], subjects)).toEqual(["b", "a"]);
  });
});
