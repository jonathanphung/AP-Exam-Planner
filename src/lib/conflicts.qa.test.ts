import { describe, expect, it } from "vitest";
import type { ApSubject, ExamFormat, ExamSlot } from "../data/schema";
import {
  findLateLateCollisions,
  findSameSlotConflicts,
  resolveSlots,
  unresolvedConflicts,
  type SlotResolution,
} from "./conflicts";

/**
 * super-board QA (issue #5, Tester lane) — AC4 observable coverage.
 *
 * AC4: "Three or more subjects sharing one slot use the same
 * choose-one-to-keep flow: all non-keepers move to their late-testing slots."
 *
 * The shipped May-2026 dataset contains only 2-way slot collisions, so the
 * browser (e2e/issue-5-conflict-resolution.spec.ts) cannot reach a 3-way
 * conflict. This test chains the pure functions in the exact order
 * ScheduleView does — group → prompt set → keeper resolution → resolveSlots →
 * late-late scan — with a synthetic 3-way fixture, so the whole AC4 flow is
 * observed end-to-end at the lib layer via `pnpm test:unit`.
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
  exam: ExamSlot,
  lateTesting: ExamSlot,
): ApSubject {
  return {
    id,
    name: `AP ${id}`,
    category: "STEM",
    exam,
    lateTesting,
    format: { ...FORMAT },
    passRate: "pending",
    portfolio: null,
  } as ApSubject;
}

const SHARED: ExamSlot = { date: "2026-05-06", session: "AM" };

// Three subjects colliding on one slot, each with its OWN distinct late slot.
const trio = [
  subject("one", SHARED, { date: "2026-05-18", session: "AM" }),
  subject("two", SHARED, { date: "2026-05-19", session: "PM" }),
  subject("three", SHARED, { date: "2026-05-21", session: "AM" }),
];
// A bystander that must stay untouched throughout.
const bystander = subject(
  "bystander",
  { date: "2026-05-13", session: "PM" },
  { date: "2026-05-22", session: "AM" },
);

const SUBJECTS = [...trio, bystander];
const SELECTED = SUBJECTS.map((s) => s.id);

describe("issue #5 QA — AC4: 3+ subjects on one slot, full resolution chain", () => {
  it("groups all three into ONE conflict requiring ONE keeper choice, then moves BOTH non-keepers to their own late slots", () => {
    // Grouping: exactly one conflict, containing all three subjects.
    const conflicts = findSameSlotConflicts(SUBJECTS, SELECTED);
    expect(conflicts).toHaveLength(1);
    expect([...conflicts[0].subjectIds].sort()).toEqual([
      "one",
      "three",
      "two",
    ]);

    // Before resolving: the single group is the one unresolved prompt.
    expect(unresolvedConflicts(conflicts, [])).toHaveLength(1);

    // The student keeps "two" at the regular time (same choose-one flow).
    const choice: SlotResolution = {
      date: SHARED.date,
      session: SHARED.session,
      keeperId: "two",
      memberIds: ["one", "two", "three"],
    };

    // The one choice fully resolves the group — no second prompt.
    expect(unresolvedConflicts(conflicts, [choice])).toHaveLength(0);

    // Every non-keeper moved to ITS OWN late slot; keeper + bystander regular.
    const resolved = resolveSlots(SUBJECTS, SELECTED, [choice]);
    expect(resolved.get("two")).toMatchObject({
      date: SHARED.date,
      session: SHARED.session,
      movedToLate: false,
    });
    expect(resolved.get("one")).toMatchObject({
      date: "2026-05-18",
      session: "AM",
      movedToLate: true,
    });
    expect(resolved.get("three")).toMatchObject({
      date: "2026-05-21",
      session: "AM",
      movedToLate: true,
    });
    expect(resolved.get("bystander")).toMatchObject({
      date: "2026-05-13",
      session: "PM",
      movedToLate: false,
    });

    // Distinct late slots → no late-late warning for this resolution.
    expect(findLateLateCollisions(resolved)).toHaveLength(0);
  });
});
