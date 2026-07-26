# College Board provenance — May 2027 cycle

Evidence behind every value in `src/data/ap-2027.json`. Written during the
annual dataset swap (issue #37) on **2026-07-24**.

## What's here

| Path | What it is |
|---|---|
| `<subject-id>.json` | One provenance record per shipped subject (43). Section names, question counts, minutes, weights, and the verbatim page quote each came from, plus the exact `sourceUrl` and `totalMinutesSource`. |
| `pages/<subject-id>.txt` | The extracted text of the two pages fetched for that subject — the AP Central `/exam` page and the AP Students `/assessment` page — separated by a `===== student =====` marker. |
| `pages/2027-exam-dates.txt` | The "2027 AP Exam Dates" page: narrative plus both week tables, cell by cell. |
| `pages/2027-late-testing-dates.txt` | The "2027 AP Exam Late-Testing Dates" page and its table. |
| `pages/2027-exam-start-times.txt` | The new per-UTC-offset start-time table and the Session 1 / Session 2 rename. |
| `pages/2026-score-distributions.txt` | The score-distribution tables the 2027 `passRate` values were re-read from (the 2026 administration is still the most recent published). |
| `pages/calculator-policies.txt` | The calculator-policy tables. |
| `pages/ap-course-list.txt` | The AP Central course index, used to confirm the 2027 roster. |
| `pages/ap-career-kickstart.txt` | The Career Kickstart overview and its launch/exam timeline. |

## How the records relate to the dataset

`src/data/ap-2027.sections.test.ts` re-derives every subject's
`format.sections` from its record here on each test run, using the
normalization rules documented in `src/data/sources.md`. A hand-edit to the
dataset that the provenance does not support fails that test.

## What "re-verified" means for this cycle

Every subject's two pages were re-fetched on 2026-07-24 and diffed against the
values `ap-2026.json` shipped. Seven subjects had moved (both Calculus exams,
Precalculus, and the four Physics exams); their records carry fresh 2027 quotes
and a `changedFor2027` field naming the change. The rest matched exactly, so
their 2026 quotes stand — the quote is still what the page prints. Nothing was
copied forward without that diff.

`fetchedAt` on every record is the fetch date, not an inherited one.

## The one record with no page

`networking.json` has `sections: []` and no `totalMinutes`. AP Networking is on
the published 2027 exam schedule ("Networking (2026-27 pilot schools only)") but
has no AP Central exam page and no AP Students assessment page — both 404 as of
2026-07-24, re-checked and still 404 on 2026-07-25. Its `notes` field records
that. Nothing about its format is estimated.

## Issue #84 — the `"pending"` re-verification (2026-07-25)

Nine records carried `"minutes": "pending"` on a section or a part, meaning
"College Board prints a duration here that this capture does not have". Issue
#84 went back to the **live** page behind each one — deliberately not to the
captured text in `pages/`, since the capture is what produced the claim — and
found that College Board prints no such duration in any of the nine cases.

Those values are now `null`, which the sections test normalizes to an omitted
field, and each record carries a `pendingResolved2026_07_25` string naming the
URL, the date, what the page actually prints, and why the printed phrasing is
not a duration that can be stored. The dataset renders them as the
not-published dash.

Two things deliberately did NOT change:

- The `quote` fields. They are what the page printed and they still are.
- The `"pending"` strings inside `datasetDiscrepancies`. Those describe the
  *2026* dataset's state at capture time — audit history, not a shipped value.

The lesson from the 2026 cycle still holds and is now enforced rather than
remembered: **never write an unpublished marker over a number you have not
checked on the live page.** The difference is that there is no marker left to
write — `src/data/ap-2027.test.ts` fails if the string `"pending"` appears
anywhere in the shipped JSON.
