import type { ApSubject } from "../data/schema";

/**
 * Test-only fixtures. Nothing in `src/app` or `src/components` imports this
 * module — it exists so unit suites can exercise code paths the *shipped*
 * dataset no longer reaches.
 *
 * Why it exists (May 2027 swap, issue #37): through the May 2026 cycle the two
 * launched AP Career Kickstart courses had neither an exam date nor a portfolio
 * deadline, so `AP Cybersecurity` was the natural fixture for "selected but
 * undated". For May 2027 College Board schedules every listed course — so no
 * real subject is undated any more, and the undated branches in
 * `week-cards.ts`, `calendar-cards.ts`, `ics.ts`, and `exports.ts` would go
 * untested if the suites just dropped those cases.
 *
 * The branches must keep working: a future cycle can reintroduce an undated
 * course (a newly announced course whose first administration has not been
 * scheduled), and silently losing the coverage would let those paths rot.
 */

/**
 * A selected subject with no exam, no late-testing slot, and no portfolio
 * deadline — the "nothing to place on a calendar" case. Deliberately given an
 * id that cannot collide with a real College Board course.
 */
export const UNDATED_SUBJECT: ApSubject = {
  id: "test-undated-course",
  name: "AP Test Undated Course",
  category: "Career Kickstart",
  exam: null,
  lateTesting: null,
  noExamReason:
    "Test fixture: a listed course whose first exam administration has not been scheduled yet.",
  format: {
    // College Board publishes nothing about this course's exam — every format
    // field is absent, the only shape the schema allows alongside no sections
    // (issue #84 replaced the literal "pending" with omission).
    sections: [],
  },
  portfolio: null,
};

/** The shipped subjects plus {@link UNDATED_SUBJECT}, for undated-path tests. */
export function withUndatedSubject(
  subjects: readonly ApSubject[],
): readonly ApSubject[] {
  return [...subjects, UNDATED_SUBJECT];
}
