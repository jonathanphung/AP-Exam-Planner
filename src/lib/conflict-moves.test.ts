import { describe, expect, it } from "vitest";
import {
  conflictMembersKey,
  keeperAfterMoves,
  movableMemberIds,
} from "./conflict-moves";
import { conflictActionRows } from "./conflict-rows";

/**
 * Issue #101 — the inverted conflict prompt's moving-set → keeper translation.
 *
 * The UI records a keeper-based `SlotResolution` (unchanged model); these
 * tests pin the pure translation the dialog uses to derive that keeper from
 * "Move {subject} to late testing" clicks.
 *
 * Issue #109 adds the membership guard that keeps an in-progress moving-set
 * from outliving the collision it was built for.
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

describe("conflictMembersKey (issue #109)", () => {
  it("same members in a different order are the SAME collision", () => {
    expect(conflictMembersKey(["a", "b", "c"])).toBe(
      conflictMembersKey(["c", "a", "b"]),
    );
  });

  it("dropping a member changes the key", () => {
    expect(conflictMembersKey(["a", "b"])).not.toBe(
      conflictMembersKey(["a", "b", "c"]),
    );
  });

  it("adding a member changes the key", () => {
    expect(conflictMembersKey(["a", "b", "c", "d"])).not.toBe(
      conflictMembersKey(["a", "b", "c"]),
    );
  });

  it("swapping one member for another changes the key", () => {
    expect(conflictMembersKey(["a", "z"])).not.toBe(
      conflictMembersKey(["a", "b"]),
    );
  });

  it("kebab-case ids cannot collide across different memberships", () => {
    // The separator is absent from every dataset id, so "a-b" + "c" and
    // "a" + "b-c" stay distinguishable.
    expect(conflictMembersKey(["a-b", "c"])).not.toBe(
      conflictMembersKey(["a", "b-c"]),
    );
  });
});

describe("issue #109 — a moving-set never outlives its membership", () => {
  /** Row-shaped lookup: every member has a late slot (shipped-dataset shape). */
  const subjects = new Map(
    ["french", "physics", "world-history"].map((id) => [
      id,
      { name: id, category: "STEM" as const, lateTesting: SLOT },
    ]),
  );
  const moveButtonIds = (memberIds: string[], moving: ReadonlySet<string>) =>
    conflictActionRows(memberIds, subjects, moving)
      .filter((row) => row.kind === "move")
      .map((row) => row.subjectId);

  it("the stale set is dropped when a non-moving member is deselected, so the prompt keeps its Move buttons", () => {
    const trio = ["french", "physics", "world-history"];
    const stored = {
      membersKey: conflictMembersKey(trio),
      moving: new Set(["french"]),
    };

    // World History is deselected mid-flow: same slot, different membership.
    const shrunk = ["french", "physics"];
    const applies = stored.membersKey === conflictMembersKey(shrunk);
    expect(applies).toBe(false);

    // What the dialog renders with: the empty set, i.e. both members are
    // offered a Move button again — never the zero-button dead end.
    const effective: ReadonlySet<string> = applies ? stored.moving : new Set();
    expect(moveButtonIds(shrunk, effective)).toEqual(["french", "physics"]);
    expect(keeperAfterMoves(shrunk, effective)).toBeNull(); // nothing to persist

    // And the very next click resolves the (now two-member) conflict.
    expect(keeperAfterMoves(shrunk, new Set(["french"]))).toBe("physics");
  });

  it("without the guard the same sequence dead-ends: every member moving, no keeper, no button", () => {
    // Pins the regression itself — replaying the trio's set against the pair
    // marks french moving, so clicking the last button leaves nothing behind.
    const shrunk = ["french", "physics"];
    const stale = new Set(["french", "physics"]);
    expect(keeperAfterMoves(shrunk, stale)).toBeNull();
    expect(moveButtonIds(shrunk, stale)).toEqual([]);
  });

  it("a re-ordered membership keeps the in-progress set (no gratuitous restart)", () => {
    const trio = ["french", "physics", "world-history"];
    const reordered = ["world-history", "french", "physics"];
    expect(conflictMembersKey(reordered)).toBe(conflictMembersKey(trio));
    expect(moveButtonIds(reordered, new Set(["french"]))).toEqual([
      "world-history",
      "physics",
    ]);
  });
});
