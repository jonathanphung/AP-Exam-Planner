import { describe, expect, it } from "vitest";
import type { ApSubject, ExamFormat, ExamSlot, Portfolio } from "../data/schema";
import {
  findLateLateCollisions,
  findSameSlotConflicts,
  isResolutionValid,
  pruneResolutions,
  resolveSlots,
  slotKey,
  unresolvedConflicts,
  type SlotResolution,
} from "./conflicts";

/**
 * Unit tests for the pure conflict logic (issue #5, AC: same-slot grouping,
 * late reassignment, and late-late collision detection each covered).
 * Fixtures are synthetic so every shape (pairs, triples, portfolio-only,
 * shared late slots) is exercised regardless of the real dataset's contents.
 */

// Issue #44: fixture format uses the sections[] model (flat MCQ/FRQ fields
// were replaced by the ordered per-section breakdown).
const FORMAT: ExamFormat = {
  sections: [
    { name: "Multiple Choice", questionCount: 1, minutes: 30, weightPercent: 50 },
    { name: "Free Response", questionCount: 1, minutes: 30, weightPercent: 50 },
  ],
  totalMinutes: 60,
  calculator: false,
  delivery: "digital",
};

function subject(
  id: string,
  exam: ExamSlot | null,
  lateTesting: ExamSlot | null,
  portfolio: Portfolio | null = null,
): ApSubject {
  return {
    id,
    name: `AP ${id}`,
    category: "STEM",
    exam,
    lateTesting,
    format: { ...FORMAT },
    passRate: "pending",
    portfolio,
    ...(exam === null && portfolio === null
      ? { noExamReason: "fixture: no May 2026 exam" }
      : {}),
  } as ApSubject;
}

const MAY7PM: ExamSlot = { date: "2026-05-07", session: "PM" };

// Two subjects sharing May 7 PM, with DIFFERENT late slots.
const alpha = subject("alpha", MAY7PM, { date: "2026-05-19", session: "PM" });
const beta = subject("beta", MAY7PM, { date: "2026-05-20", session: "AM" });
// Third subject on the same slot — its late slot equals beta's (late-late collision bait).
const gamma = subject("gamma", MAY7PM, { date: "2026-05-20", session: "AM" });
// Same date as the trio but the OTHER session — never a conflict with them.
const delta = subject(
  "delta",
  { date: "2026-05-07", session: "AM" },
  { date: "2026-05-21", session: "AM" },
);
// A second, independent conflict pair on May 12 AM; epsilon's late slot
// collides with alpha's (cross-group late-late collision bait).
const epsilon = subject(
  "epsilon",
  { date: "2026-05-12", session: "AM" },
  { date: "2026-05-19", session: "PM" },
);
const zeta = subject(
  "zeta",
  { date: "2026-05-12", session: "AM" },
  { date: "2026-05-22", session: "AM" },
);
// Portfolio-only subjects sharing one deadline date — must NEVER conflict.
const portfolioA = subject("portfolio-a", null, null, {
  deadline: "2026-04-30",
  weightPct: 100,
  note: "fixture portfolio",
});
const portfolioB = subject("portfolio-b", null, null, {
  deadline: "2026-04-30",
  weightPct: 100,
  note: "fixture portfolio",
});

const ALL = [alpha, beta, gamma, delta, epsilon, zeta, portfolioA, portfolioB];

const resolution = (
  slot: ExamSlot,
  keeperId: string,
  memberIds: string[],
): SlotResolution => ({
  date: slot.date,
  session: slot.session,
  keeperId,
  memberIds,
});

describe("findSameSlotConflicts — same-slot grouping", () => {
  it("groups two selected subjects sharing date AND session", () => {
    const groups = findSameSlotConflicts(ALL, ["alpha", "beta"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].slot).toEqual(MAY7PM);
    expect(groups[0].subjectIds).toEqual(["alpha", "beta"]);
  });

  it("same date but different session is NOT a conflict", () => {
    expect(findSameSlotConflicts(ALL, ["alpha", "delta"])).toEqual([]);
  });

  it("unselected subjects never join a group", () => {
    // beta shares alpha's slot but is not selected.
    expect(findSameSlotConflicts(ALL, ["alpha", "delta", "zeta"])).toEqual([]);
  });

  it("three subjects on one slot form a single group of three", () => {
    const groups = findSameSlotConflicts(ALL, ["alpha", "beta", "gamma"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subjectIds).toEqual(["alpha", "beta", "gamma"]);
  });

  it("independent slots yield independent groups, chronological order", () => {
    const groups = findSameSlotConflicts(ALL, [
      "epsilon",
      "zeta",
      "alpha",
      "beta",
    ]);
    expect(groups.map((g) => slotKey(g.slot))).toEqual([
      "2026-05-07:PM",
      "2026-05-12:AM",
    ]);
  });

  it("portfolio deadlines never trigger the conflict flow (AC7)", () => {
    // Both share deadline 2026-04-30; neither has an exam slot.
    expect(findSameSlotConflicts(ALL, ["portfolio-a", "portfolio-b"])).toEqual(
      [],
    );
  });
});

describe("resolveSlots — late reassignment", () => {
  it("keeper stays at the regular slot; the other moves to ITS OWN late slot", () => {
    const resolved = resolveSlots(
      ALL,
      ["alpha", "beta"],
      [resolution(MAY7PM, "alpha", ["alpha", "beta"])],
    );
    expect(resolved.get("alpha")).toEqual({
      subjectId: "alpha",
      date: "2026-05-07",
      session: "PM",
      movedToLate: false,
    });
    expect(resolved.get("beta")).toEqual({
      subjectId: "beta",
      date: "2026-05-20",
      session: "AM",
      movedToLate: true,
    });
  });

  it("three-way conflict: ALL non-keepers move, each to its own late slot", () => {
    const resolved = resolveSlots(
      ALL,
      ["alpha", "beta", "gamma"],
      [resolution(MAY7PM, "beta", ["alpha", "beta", "gamma"])],
    );
    expect(resolved.get("beta")?.movedToLate).toBe(false);
    expect(resolved.get("alpha")).toMatchObject({
      date: "2026-05-19",
      session: "PM",
      movedToLate: true,
    });
    expect(resolved.get("gamma")).toMatchObject({
      date: "2026-05-20",
      session: "AM",
      movedToLate: true,
    });
  });

  it("subjects without conflicts keep their regular slots untouched", () => {
    const resolved = resolveSlots(ALL, ["alpha", "delta"], []);
    expect(resolved.get("alpha")?.movedToLate).toBe(false);
    expect(resolved.get("delta")).toMatchObject({
      date: "2026-05-07",
      session: "AM",
      movedToLate: false,
    });
  });

  it("a stale resolution (member deselected) is ignored — everyone back at regular slots", () => {
    // Resolution recorded for {alpha, beta}, but beta was deselected.
    const resolved = resolveSlots(
      ALL,
      ["alpha", "delta"],
      [resolution(MAY7PM, "alpha", ["alpha", "beta"])],
    );
    expect(resolved.get("alpha")).toMatchObject({
      date: "2026-05-07",
      session: "PM",
      movedToLate: false,
    });
  });

  it("deselecting the KEEPER also restores the moved exam to its regular slot", () => {
    const resolved = resolveSlots(
      ALL,
      ["beta", "delta"],
      [resolution(MAY7PM, "alpha", ["alpha", "beta"])],
    );
    expect(resolved.get("beta")).toMatchObject({
      date: "2026-05-07",
      session: "PM",
      movedToLate: false,
    });
  });
});

describe("resolution validity + pruning", () => {
  const conflictsFor = (ids: string[]) => findSameSlotConflicts(ALL, ids);

  it("valid while the colliding member set is unchanged", () => {
    expect(
      isResolutionValid(
        resolution(MAY7PM, "alpha", ["alpha", "beta"]),
        conflictsFor(["alpha", "beta"]),
      ),
    ).toBe(true);
  });

  it("stale when a member was deselected", () => {
    expect(
      isResolutionValid(
        resolution(MAY7PM, "alpha", ["alpha", "beta"]),
        conflictsFor(["alpha"]),
      ),
    ).toBe(false);
  });

  it("stale when a NEW subject joins the same slot (prompt must re-appear)", () => {
    const conflicts = conflictsFor(["alpha", "beta", "gamma"]);
    const stale = resolution(MAY7PM, "alpha", ["alpha", "beta"]);
    expect(isResolutionValid(stale, conflicts)).toBe(false);
    expect(unresolvedConflicts(conflicts, [stale])).toHaveLength(1);
  });

  it("invalid when the keeper is not part of the stored member set", () => {
    expect(
      isResolutionValid(
        resolution(MAY7PM, "delta", ["alpha", "beta"]),
        conflictsFor(["alpha", "beta"]),
      ),
    ).toBe(false);
  });

  it("pruneResolutions drops stale entries and duplicate slots, keeps valid ones", () => {
    const conflicts = conflictsFor(["alpha", "beta"]);
    const valid = resolution(MAY7PM, "alpha", ["alpha", "beta"]);
    const duplicate = resolution(MAY7PM, "beta", ["alpha", "beta"]);
    const stale = resolution({ date: "2026-05-12", session: "AM" }, "epsilon", [
      "epsilon",
      "zeta",
    ]);
    expect(pruneResolutions([valid, duplicate, stale], conflicts)).toEqual([
      valid,
    ]);
  });

  it("unresolvedConflicts excludes groups with a valid resolution", () => {
    const conflicts = conflictsFor(["alpha", "beta", "epsilon", "zeta"]);
    const unresolved = unresolvedConflicts(conflicts, [
      resolution(MAY7PM, "alpha", ["alpha", "beta"]),
    ]);
    expect(unresolved).toHaveLength(1);
    expect(slotKey(unresolved[0].slot)).toBe("2026-05-12:AM");
  });
});

describe("findLateLateCollisions — late-late collision detection", () => {
  it("flags two moved exams from DIFFERENT groups landing on the same late slot", () => {
    // Keep beta (alpha moves to 05-19 PM); keep zeta (epsilon moves to 05-19 PM).
    const resolved = resolveSlots(
      ALL,
      ["alpha", "beta", "epsilon", "zeta"],
      [
        resolution(MAY7PM, "beta", ["alpha", "beta"]),
        resolution({ date: "2026-05-12", session: "AM" }, "zeta", [
          "epsilon",
          "zeta",
        ]),
      ],
    );
    const collisions = findLateLateCollisions(resolved);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].slot).toEqual({ date: "2026-05-19", session: "PM" });
    expect([...collisions[0].subjectIds].sort()).toEqual(["alpha", "epsilon"]);
  });

  it("flags two moved exams from the SAME group whose own late slots coincide", () => {
    // Keep alpha: beta and gamma both move to 2026-05-20 AM.
    const resolved = resolveSlots(
      ALL,
      ["alpha", "beta", "gamma"],
      [resolution(MAY7PM, "alpha", ["alpha", "beta", "gamma"])],
    );
    const collisions = findLateLateCollisions(resolved);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].slot).toEqual({ date: "2026-05-20", session: "AM" });
    expect([...collisions[0].subjectIds].sort()).toEqual(["beta", "gamma"]);
  });

  it("no collision when moved exams land on distinct late slots", () => {
    const resolved = resolveSlots(
      ALL,
      ["alpha", "beta"],
      [resolution(MAY7PM, "alpha", ["alpha", "beta"])],
    );
    expect(findLateLateCollisions(resolved)).toEqual([]);
  });

  it("unmoved exams never count, even when their published late slots coincide", () => {
    // beta and gamma share a late slot but nothing moved them.
    const resolved = resolveSlots(ALL, ["beta", "delta"], []);
    expect(findLateLateCollisions(resolved)).toEqual([]);
  });
});
