# issue #73 — QA v3 (Tester rebuild after the Reviewer's `[QA]` bounce)

**Branch:** `issue-73-standardize-exam-sections`
**Parent (reviewed) commit:** `b7ab917`
**Lane path:** Build → QA pass v1 → Review ✅ → 🔁 Jon bounce → Build → QA pass v2 → Review 🔁 QA → **QA v3**

The Reviewer bounced Review → QA with exactly one `[QA]` thread. Nothing else on
the branch was red, and no product work is reopened here: `git diff b7ab917 -- src/`
is **empty**. This lane changes one test file.

---

## The `[QA]` thread

> `e2e/issue-73-qa-v2.spec.ts:139` — two test titles break
> `src/data/doc-freshness.test.ts` (issue #71 AC5), so `pnpm test:data` is
> **76 pass / 1 fail** at `b7ab917`.

Reproduced at the parent commit before fixing, rather than taken on trust —
`vitest-data-BEFORE-b7ab917.log`:

```
FAIL  src/data/doc-freshness.test.ts > AC5 — no test title counts the roster to
      a number the dataset disagrees with   (allowed: 3, 5, 8, 13, 14, 43)
+ ["… \"bounce AC1 — each of the 18 subjects Jon named …\" claims 18",
+  "… \"bounce AC3 — … across all 38 sit-down subjects, …\" claims 38"]
 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 76 passed (77)
```

### Resolution — option 1 (re-title), and why not option 2

The Reviewer offered two fixes and said to pick one. **Chosen: re-title.**

Option 2 was to widen `doc-freshness.test.ts`'s `allowed` set with two
dataset-derived structural counts — subjects with at least one section (38) and
subjects with sections but no parts (18). Rejected for a reason specific to this
branch:

> **`18` counts "subjects whose sections publish no parts" — the exact predicate
> this branch deleted.** `sectionsHavePartRows` *was* the table-vs-prose branch
> rule; the port removed it, so after this PR "sections but no parts" is no
> longer a rendering distinction at all. Teaching a general-purpose #71 guard to
> recognise that number would re-enshrine, in a guard that outlives this ticket,
> the very split the ticket exists to remove.

`38` alone would have been a fair addition, but the instruction was one fix or
the other, not a half-measure. So the literals leave the titles and the #71
guard is left exactly as #71 shipped it.

### What replaces them — the counts became assertions, not prose

Dropping a number from a title loses nothing only if the number is asserted
somewhere. It was not. Both sweeps stated their scope and checked neither:

| Sweep | Before | After |
|---|---|---|
| `BOUNCE_18` (AC1) | 18 ids transcribed from Jon's bounce; length never asserted | `expect(BOUNCE_18).toHaveLength(18)` |
| `WITH_SECTIONS` (AC3) | **derived** from the dataset; could shrink silently | `expect(WITH_SECTIONS).toHaveLength(38)` |

`WITH_SECTIONS` is the one that mattered: it is computed (`sections.length > 0`),
so a dataset edit that dropped a subject's sections would have quietly narrowed
"across all 38 sit-down subjects" to a smaller walk with nothing failing. The
title said 38 and the test would have accepted 12. A title cannot fail; an
`expect()` can.

A third title (`bounce AC4 — … used to give the 18`) also carried the literal but
slipped past the guard's regex by accident (`the 18` matches neither
`\ball (\d{2})\b` nor `(\d{2})[-\s]subjects?`). Re-worded too — keeping it would
have meant "the number stays where the regex happens not to look", which is
evasion rather than resolution.

The file's doc header now records why no title here carries a literal count, so
the next reader does not helpfully put them back.

---

## Gates (all re-run at the fix commit, with the spec file on disk)

The ordering failure the Reviewer named — `pnpm test:data` measured *before* the
spec existed, so the guard that walks `e2e/` at test time could not see it — is
closed by running the data gate last, after every file is written.

| Gate | Command | Result | Log |
|---|---|---|---|
| Data / doc-freshness | `pnpm test:data` | **77 pass / 0 fail** (was 76/1) | `vitest-data.log` |
| Unit | `pnpm test:unit` | **237 pass** | `vitest-unit.log` |
| Types | `npx tsc --noEmit` | clean, exit 0 | `tsc.log` |
| Lint | `pnpm lint` | **0 errors**, 2 pre-existing warnings in untouched files | `eslint.log` |
| Ticket e2e | 9 spec files (below) | **137 pass / 0 fail** (3 runs) | `playwright-ticket.log` |
| Full e2e | `npx playwright test` | **534 pass / 14 fail** — every one of the 14 also fails at `origin/main` | `playwright-full.log`, `baseline-comparison.md` |

**The branch introduces zero failures**, established against `origin/main`
(`e6a9654`) rather than against an earlier commit of this same branch. Deps and
`playwright.config.ts` are byte-identical between main and the branch, so main
was checked out in this worktree with the same `node_modules` and the same 7
failing spec files re-run: **14 fail at main, 12 of them the identical stable
set, the other 2 the same nondeterministic pair** (`issue-41` theme-toggle race,
already filed as #78; `qa-evidence`'s Next dev-mode hydration console error,
which failed at a *different viewport* in each run). Full breakdown in
`baseline-comparison.md`.

Ticket e2e batch = every spec this ticket wrote or retargeted: `issue-73-qa-v2`,
`issue-73-qa`, `issue-73-one-presentation`, `issue-44-qa{,-v2,-v3,-v4}`,
`issue-45-qa-v3`, `issue-6-exam-info-panel`.

### One flake, disclosed rather than buried

The **first** run of the ticket batch reported 136 pass / 1 fail:
`evidence — calculus-bc exam details (light)` timed out for 30 s waiting on
`View exam details for AP Calculus BC` after the expand click — a click that
lands before hydration is a silent no-op on a React toggle. It did **not**
reproduce:

| Run | Result |
|---|---|
| ticket batch, run 1 (137 tests, 6 workers) | 136 pass / **1 fail** |
| `issue-73-qa-v2.spec.ts` alone (20 tests) | **20 pass** |
| ticket batch, run 2 (137 tests, 6 workers) | **137 pass** |

It is an evidence-capture test, not an assertion of any bounce AC, and it is the
same machine-contention class both prior QA lanes recorded. Deliberately **not**
"fixed" with a retry loop around the expand control: the control is a toggle, so
a retry firing after a successful-but-slow open would collapse the panel —
trading a rare contention flake for a new failure mode, in a lane whose only job
this pass was one thread. Recorded here so a reviewer rerun that hits it knows
what it is.

---

## Visual evidence

**Unchanged from v2, deliberately.** `git diff b7ab917 -- src/` is empty — no
component, style or dataset byte moved in this lane, so re-capturing the twelve
PNGs would add pixel-identical churn to a folder older comments link by raw URL.
The v2 screenshots remain the current state of the branch:
`docs/super-board/runs/issue-73-qa-v2/`.

Both evidence-capture suites were re-run anyway (they are part of the 137) and
produced their screenshots without error, into the gitignored
`test-results/evidence/` default #71 AC7 introduced. `git status
docs/super-board/runs/` stays clean apart from this v3 folder.
