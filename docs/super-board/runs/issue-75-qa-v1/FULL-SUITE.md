# Full suite — QA lane re-run, and the same run on clean `origin/main`

Tester lane, issue #75 / #78, branch `issue-75-sidebar-sticky-scroll-lock`.

## This branch

```
PORT=3412 pnpm exec playwright test --workers=2
-> 549 passed, 8 failed (6.1m)
```

Plus, all green:

```
pnpm test:unit    234 passed (19 files)
pnpm test:data     74 passed (5 files)
pnpm build        compiled + typechecked clean
pnpm exec tsc --noEmit   clean
pnpm lint         0 errors, 2 warnings (both pre-existing, in files this
                  branch does not touch)
```

## The 8 failures are pre-existing — re-verified by this lane, not inherited

Clean worktree at `origin/main` (`e6a9654`), fresh
`pnpm install --frozen-lockfile`, this branch's diff absent:

```
PORT=3512 pnpm exec playwright test \
  e2e/issue-60-bounce1-meta-row.spec.ts e2e/issue-71-exam-note.spec.ts \
  e2e/issue-71-qa.spec.ts --workers=2
-> 22 passed, 8 failed
```

**Same eight tests, same messages, same `Received: -10` on every one.**

| spec | tests | on `main`? |
|---|---|---|
| `issue-60-bounce1-meta-row.spec.ts:69` | mobile, tablet | yes |
| `issue-71-exam-note.spec.ts:176` | desktop, tablet, mobile | yes |
| `issue-71-qa.spec.ts:471` | desktop, tablet, mobile | yes |

All eight are the same defect as the three the Builder corrected in
`issue-60-qa.spec.ts` / `issue-49-qa.spec.ts`: they assert
`documentElement.scrollWidth - documentElement.clientWidth === 0`, and since
#49 reserved the scrollbar gutter the resting delta is `-10`. Horizontal
overflow is a POSITIVE delta, so `=== 0` is simply the wrong operator.

**They are deliberately NOT fixed on this branch.** They live in #71's and
#60's evidence specs, no #75 or #78 acceptance criterion covers them, and #78
scoped the pair it wanted fixed by name. One consequence worth stating plainly,
because the PR body reads otherwise: merging this does **not** make `main`
fully green — it takes `main` from 10 red to 8 red, and the residue is one
mechanical operator change in three files that belongs to a follow-up card.

## Delta vs. the Builder's run

The Builder recorded 540 passed / 10 failed. This lane records 549 / 8:

- +7 tests: `e2e/issue-75-qa.spec.ts` (6) and `e2e/issue-75-real-chrome.spec.ts`
  (1), both added by this lane.
- -2 failures: the Builder's two `qa-evidence.spec.ts` failures did not recur.
  They are the intermittent React hydration-mismatch console error naming
  `style={{caret-color:"transparent"}}` on `#subject-search` — an inline style
  injected by Playwright's own screenshot caret-hiding, i.e. a harness artifact
  that fires or does not depending on timing. Also present on `main`.
