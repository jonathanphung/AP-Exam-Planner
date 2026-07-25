# super-board QA v2 — issue #71 (PR #72)

**Verdict: PASS.** All seven ACs verified on `e528422` (rebuild 1). QA v1's single
defect is fixed at the root, and the fix holds in a state QA v1's reproducer never
entered.

| | |
|---|---|
| Branch | `issue-71-post-37-cleanup` |
| Commit under test | `e528422` |
| Evidence | `docs/super-board/runs/issue-71-qa-v2/` |
| New spec | `e2e/issue-71-qa-v2.spec.ts` (9 tests, all green, each mutation-verified) |

## Per-AC verdict

| AC | Verdict | How it was checked |
|---|---|---|
| AC1 README subject count | PASS | `src/data/doc-freshness.test.ts` (QA v1's guard) — README must not hardcode a roster count; re-verified green |
| AC2 `schema.ts` provenance | PASS | same guard: provenance names the SHIPPED cycle folder and every subject has a capture there |
| AC3 `sources.md` count | PASS | count equals `dataset.subjects.length` (43) with the AP Networking exception stated |
| AC4 `scroll-shift.ts` comment | PASS | comment names the subject the fixture actually seeds (AP Italian) |
| AC5 stale test titles | PASS | no test title claims a count the dataset does not produce |
| **AC6 `examNote` on schedule surfaces** | PASS | List / calendar grid / `.ics` / `.txt` / `.json` / both `.png` cards — 25 browser tests, plus the three states below that the rebuild newly touched |
| AC7 e2e evidence churn | PASS | full `pnpm test:e2e` -> `git status --porcelain docs/super-board/runs/` **empty**; 36 evidence folders redirected into gitignored `test-results/evidence/` |

## AC6 — the QA v1 defect, re-measured

`markerHeight / paintedHeight` of the `Published note` row (intersection of the row's
rect with its `overflow-hidden` face), the same measurement QA v1 used:

| state | desktop 1920x1080 | tablet 1024x768 | mobile 375x667 |
|---|---|---|---|
| regular slot | 13 / 13 OK (v1: 15/15) | 13 / 13 OK (v1: 15/15) | 13 / 13 OK (**v1: 30/0**) |
| moved to late testing | 13 / 13 OK (**v1: 15/1**) | 13 / 13 OK (**v1: 15/0**) | 13 / 13 OK (**v1: 30/0**) |
| **unresolved conflict (new)** | 13 / 13 OK | 13 / 13 OK | 13 / 13 OK |

Horizontal legibility of that row (`scrollWidth` vs `clientWidth`):

| state | desktop | tablet | mobile |
|---|---|---|---|
| regular / moved-to-late | full text (lane 159px) | full text (lane 113px) | full text (lane 97px) |
| unresolved conflict | ellipsised (74px of text in 61px, lane 78px) | ellipsised (in 38px, lane 55px) | ellipsised (in 30px, lane 47px) |

The ellipsised case is the documented, deliberate one: two same-slot blocks split a day
column, and the verbatim text is one tap/hover away in the accessible name, the `title`
tooltip and the details dialog.

## What QA v2 added (`e2e/issue-71-qa-v2.spec.ts`)

The rebuild changed three things nothing measured. Each new test was mutation-verified —
the mutation is named in the test's docstring.

1. **QA-V2-1 — the unresolved-conflict state, 3 viewports.** The narrowest lane the grid
   can produce (47px at 375px wide) *and* the only state that renders `Time conflict`.
   It needs no interaction: the qualified exam shares 2027-05-07 PM with AP
   Macroeconomics, so a student who picks both sees it on load. AC6-QA7 never enters it.
   *Mutation:* putting the qualifier row back below the secondary markers clips it to
   **6px of 13px** at 1024 and 375 — while all six AC6-QA7 cases stay green.
2. **QA-V2-2 — the ordering contract as a structural invariant, 3 viewports.** The
   qualifier row must never be the last row of a face that clips from the bottom.
   *Mutation:* the same reorder turns this red at all three viewports.
3. **QA-V2-3 — the pending-length signal after the clock lost `. length pending`.**
   Pins the three remaining carriers: dashed border, `Length pending` marker (painted,
   not merely attached), and the words in the button's accessible name.
   *Mutation:* restoring the clock suffix turns this red.
4. **QA-V2-4 — renderer parity for the exported calendar PNG.** The PNG face has the
   same fixed-height clip, and nothing observed its DOM order.
   *Mutation:* swapping the two `examSeg.append` blocks in `export-png-calendar.ts`
   turns this red while QA v1's AC6-QA2 stays green.
5. **QA-V2-5 — survey (measurement, not a gate).** Records subject-name clamping vs
   unused face height into `name-clamp-survey.json`; see the observation below.

## Non-blocking observation — the two-line subject-name cap (filed as a follow-up)

The rebuild capped the subject-name row at two lines. In the widest lane the grid ever
gives a block (one block, no same-slot partner) that ellipsises names while the face
still has unused vertical space:

| viewport | lane | names ellipsised | worst example | face | rows use | spare |
|---|---|---|---|---|---|---|
| desktop 1920 | 159px | 3 / 39 | AP United States Government and Politics | 132px | 45px | **87px** |
| tablet 1024 | 113px | 17 / 39 | (same) | 132px | 60px | 72px |
| mobile 375 | 97px | 23 / 39 | AP Macroeconomics | 95px | 60px | **35px** |

Not raised as an AC failure: the full name is still in the accessible name, the `title`
tooltip and the details dialog, and the cap is documented as intentional in the face's
ORDERING CONTRACT.

**It is also load-bearing, which is why the naive fix is wrong.** Removing
`line-clamp-2` from the name row was tested: AC6-QA7 stays 6/6 green and the long names
render in full — but **QA-V2-1 goes red at tablet and mobile**, because in the
unresolved-conflict state the freed lines push the qualifier row back under the clip
edge. The refinement that gets both is a height budget rather than a line cap: make the
face a flex column with the qualifier and secondary rows `flex-none`, and the name+clock
group `flex-1 min-h-0 overflow-hidden`. Then a long name uses spare space (87px on
desktop) and yields only in the cramped state. `QA-V2-1` is the test that must stay
green for any such change.

## Test results

```
pnpm exec vitest run src                                  308 passed (24 files)
pnpm exec playwright test e2e/issue-71-qa.spec.ts
                         e2e/issue-71-qa-v2.spec.ts        25 passed
pnpm exec playwright test e2e/issue-71-exam-note.spec.ts
                         e2e/issue-19-calendar-view.spec.ts
                         e2e/issue-30-calendar-palette.spec.ts
                         e2e/issue-30-qa.spec.ts
                         e2e/issue-5-conflict-resolution.spec.ts
                                                          48 passed
pnpm test:e2e (full)                                      496 passed / 7 failed
pnpm build                                                PASS
pnpm lint                                                 0 errors (2 pre-existing warnings)
pnpm exec tsc --noEmit                                    clean
```

The 7 full-suite failures:

- **6 pre-existing environment failures** — every one is a `channel: "chrome"` spec
  (`e2e/support/scroll-shift.ts` x5, `e2e/issue-49-real-chrome.spec.ts`) failing on
  `Chromium distribution 'chrome' is not found`. Google Chrome is not installed on this
  machine; identical on `main`.
- **1 timeout flake** — `e2e/issue-8-qa.spec.ts:238` (`AC2 evidence — axe summary`)
  exceeded the 30s test timeout under 4-worker contention. It uses ~21s of that budget
  on its own and passes 7/7 when the spec file is run alone. Not branch-related: the
  spec exercises the catalog info panel, which this branch does not modify.

## AC7, verified empirically

```
$ PORT=3191 pnpm exec playwright test          # full suite
$ git status --porcelain docs/super-board/runs/
                                               # <- empty
$ ls test-results/evidence | wc -l
36
```

The committed evidence folders that older issue/PR comments link to were not rewritten,
with no `git checkout --` needed.
