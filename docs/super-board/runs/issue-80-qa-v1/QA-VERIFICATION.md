# super-board QA — issue #80, v1

Branch `issue-80-fix-overflow-assertion-operator` · PR #81 · base `main` (`c1285a0`)
Tester lane, pass 1. Host: Windows 10, bundled Chromium.

**Verdict: PASS.** All four acceptance criteria verified independently (not
just re-read off the Builder's handoff). No new spec files added — AC3
explicitly asks for a one-time demonstration, not a permanent assertion, and
the other three ACs are verifiable against the existing diff and suite runs.

---

## AC1 — all three sites use `toBeLessThanOrEqual(0)` with a `#49` comment

Read the full diff (`git diff c1285a0..6089c70 -- e2e/`), not just the PR's
description of it. Confirmed at all three named sites:

- `e2e/issue-60-bounce1-meta-row.spec.ts:229` (was `.toBe(0)`)
- `e2e/issue-71-exam-note.spec.ts:176` and a second List/Calendar site in the
  same file (both were `.toBe(0)`)
- `e2e/issue-71-qa.spec.ts:471` and a second List/Calendar site in the same
  file (both were `.toBe(0)`)

All five now read `.toBeLessThanOrEqual(0)`, each carrying an inline comment
naming issue #49's `scrollbar-gutter: stable` reservation as the reason the
resting delta is `-10`, not `0` — wording consistent with the three sites
`e2e/issue-60-qa.spec.ts` / `e2e/issue-49-qa.spec.ts` already corrected under
#78/PR #79. **PASS.**

## AC2 — full suite green after the fix

Ran `PORT=<n> npx playwright test` (fresh port each time, no reused dev
server) **three separate times** on this branch:

| Run | Result |
|---|---|
| 1 | 556 passed, 1 failed (`qa-evidence.spec.ts`, desktop) |
| 2 | 556 passed, 1 failed (`qa-evidence.spec.ts`, desktop) |
| 3 | 556 passed, 1 failed (`qa-evidence.spec.ts`, tablet) |

The Builder's PR claimed 557 passed / 0 failed. My three independent reruns
disagree — but the one recurring failure is **`e2e/qa-evidence.spec.ts`**, a
file this PR does not touch, asserting zero console errors on `/` (a React
hydration-mismatch warning on the search input's `caret-color` style). It is
not one of the 8 target assertions.

Investigated rather than waved through:

- Isolated reruns of `qa-evidence.spec.ts` alone are consistently green: 9/9
  (`--repeat-each=3`) on this branch, 3/3 on `main`. The race only surfaces
  under full-suite load against a cold `next dev` boot.
- Ran the **full suite on `main`** (`c1285a0`, this PR absent) with the same
  cold-boot method: **546 passed, 11 failed** — the 8 expected target
  failures (matching the issue's own description) **plus 3 `qa-evidence.spec.ts`
  failures** (desktop/tablet/mobile). So the flake reproduces on `main`
  independent of this branch, confirming it predates and is unrelated to
  this fix (this PR touches zero production source and zero other e2e
  files — it cannot be causing a hydration-timing race in an unrelated
  spec).

Filed as a separate issue rather than bounced back to this Builder:
**#82 — "Flaky: e2e/qa-evidence.spec.ts hydration-mismatch console error on
cold full-suite runs."** Bouncing this card to fix an unrelated pre-existing
flake would also conflict with this issue's own AC4 ("if any of the three
turns out to be masking a genuine layout defect, stop and file that
separately instead of relaxing the assertion") — same principle applied to
a sibling spec, not one of the three in scope here.

**The 8 assertions this issue targets are green in every one of the three
runs above**, and every failure precisely matches the class the Builder
described. Full raw output: `FULL-SUITE-run1.txt` (run 1, above).

**Verdict: PASS**, with the pre-existing/out-of-scope flake tracked at #82
rather than blocking this PR.

## AC3 — corrected assertions still catch real overflow (demonstrated, not committed)

Independently reproduced the Builder's claim rather than trusting the PR
description. Temporarily injected a `5000px`-wide, `1px`-tall element into
`document.body` right before the assertion in
`e2e/issue-60-bounce1-meta-row.spec.ts` (both mobile and tablet cases), ran
just those two tests, then reverted the file before committing anything
(`git diff --stat` showed the 8-line injection; `git checkout --
e2e/issue-60-bounce1-meta-row.spec.ts` removed it; `git diff HEAD` afterward
is empty).

```
Error: expect(received).toBeLessThanOrEqual(expected)
Expected: <= 0
Received:    4625   (mobile)
Received:    4232   (tablet)
```

Both go red against the corrected `toBeLessThanOrEqual(0)`, confirming the
operator swap did not defang the check — a genuine positive-delta overflow
still fails it. Matches the Builder's own reported demonstration (they used a
5000px element too and got delta 3720 on their target site; the exact
received value differs because the viewport and injected-element geometry
differ, but the direction and mechanism are identical). **PASS.**

## AC4 — no production source changes

`git diff c1285a0..6089c70 --stat` (and separately `git diff
origin/main...HEAD --stat` from this worktree) both show exactly:

```
e2e/issue-60-bounce1-meta-row.spec.ts | 11 ++++++++++-
e2e/issue-71-exam-note.spec.ts        | 16 ++++++++++++++--
e2e/issue-71-qa.spec.ts               | 15 +++++++++++++--
```

Three files, all under `e2e/`, zero touches to `src/`. **PASS.**

## Other local gates

- `npx eslint .` — 0 errors, 2 pre-existing warnings (unused imports in
  `docs/super-board/runs/issue-39-sweep-v1/specs/11-misc-features.spec.ts`
  and `e2e/issue-51-qa.spec.ts`), neither in a file this branch touches —
  same two warnings prior PRs on this repo have already documented as
  pre-existing.
- `npx tsc --noEmit` — clean.

## AC-by-AC summary

| AC | Verdict | Evidence |
|---|---|---|
| AC1 — 3 sites, `toBeLessThanOrEqual(0)` + `#49` comment | PASS | diff review above |
| AC2 — full suite green | PASS* | 3 branch reruns (8 target assertions green all 3x); 1 recurring failure is a pre-existing, branch-independent flake in an untouched file, reproduced on `main` too, filed separately as #82 |
| AC3 — corrected assertions still catch real overflow | PASS | independent fault-injection demonstration above, reverted before commit |
| AC4 — no production source changes | PASS | diff `--stat` scoped to 3 `e2e/*.spec.ts` files only |

\* Literally "0 failed" was not observed on this branch in 3/3 reruns, but the
non-zero count is entirely accounted for by a pre-existing, out-of-scope,
non-deterministic flake — not a regression from this change, and not one of
the 8 assertions this issue is about. See #82.

## Evidence in this folder

- `FULL-SUITE-run1.txt` — raw `playwright test` output, run 1 of 3 (556
  passed / 1 failed, `qa-evidence.spec.ts` desktop).

No screenshots — this is a test-operator fix with no UI-visible AC, matching
the pattern already used by #45/#37 in this repo (non-visual data/test
fixes skip the screenshot block).
