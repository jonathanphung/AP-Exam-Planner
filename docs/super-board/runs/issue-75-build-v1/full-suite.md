# Full `pnpm test:e2e` on this branch, and the same 10 failures on clean `main`

Builder run, issue #75 / #78 branch `issue-75-sidebar-sticky-scroll-lock`.

## This branch

```
PORT=3210 pnpm exec playwright test --workers=2
→ 540 passed, 10 failed (6.9m)
```

## The 10 failures are pre-existing on `main` — verified, not asserted

Reproduced with the #78 recipe: a detached worktree at `origin/main`
(`e6a9654`), fresh `pnpm install --frozen-lockfile`, this branch's diff absent.

```
git worktree add .worktrees/main-baseline origin/main --detach
PORT=3311 pnpm exec playwright test \
  e2e/issue-60-bounce1-meta-row.spec.ts e2e/issue-71-exam-note.spec.ts \
  e2e/issue-71-qa.spec.ts e2e/qa-evidence.spec.ts --workers=2
→ 24 passed, 9 failed   (identical tests, identical messages)
```

The 10th (`qa-evidence` desktop 1920) is the same assertion as the tablet one
and fails on `main` too — it just needed a second run to show up:

```
PORT=3311 pnpm exec playwright test e2e/qa-evidence.spec.ts --workers=2 --repeat-each=2
→ 5 passed, 1 failed  ← AC2 desktop 1920x1080
```

| spec | tests | on main? |
|---|---|---|
| `issue-60-bounce1-meta-row.spec.ts:69` | mobile, tablet | yes |
| `issue-71-exam-note.spec.ts:176` | desktop, tablet, mobile evidence | yes |
| `issue-71-qa.spec.ts:471` | desktop, tablet, mobile evidence | yes |
| `qa-evidence.spec.ts:23` | desktop, tablet | yes (intermittent) |

`qa-evidence.spec.ts` fails on a React hydration-mismatch console error naming
`style={{caret-color:"transparent"}}` on `#subject-search` — that inline style
is injected by Playwright's own screenshot caret-hiding, so it is a
harness/timing artifact of the evidence capture, not app output. Filing them is
out of scope for this card; they belong to whoever owns #71/#60's evidence
specs.

## What this branch's own specs did

| spec | result |
|---|---|
| `issue-75-scroll-lock-sticky.spec.ts` (new) | 13 passed |
| `issue-75-scroll-lock-sticky.spec.ts` against the OLD lock | 8 of 11 failed — `sidebar y moved (-45 → -1024)` |
| `issue-49-scrollbar-gutter.spec.ts` (bundled Chromium) | 6 passed |
| `issue-49-real-chrome.spec.ts` (real Chrome, `channel: "chrome"`) | 6 passed |
| `issue-49-qa.spec.ts` | 8 passed |
| `issue-6-exam-info-panel.spec.ts`, `a11y.spec.ts` | passed |
| `issue-41-theme-toggle.spec.ts` | 31 passed × 20 runs (see `theme-toggle-10x.txt`) |
| `issue-60-qa.spec.ts` | 10 passed |
| `pnpm test:unit` / `pnpm test:data` / `pnpm build` | 234 / 74 / clean |

Note on Chrome: #78 listed 6 `Chromium distribution 'chrome' is not found`
failures as environmental. On this host Chrome IS installed
(`C:\Program Files\Google\Chrome\Application\chrome.exe`) and
`issue-49-real-chrome.spec.ts` — exactly 6 tests — runs and passes. That matters
for #75 AC4, which requires the real-Chrome half of the #49 contract to hold
under the new lock keyword: it does.
