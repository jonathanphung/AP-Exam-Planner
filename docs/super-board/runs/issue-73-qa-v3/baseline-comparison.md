# Full-suite baseline — branch vs `origin/main`, measured this pass

Both runs on the same machine, same session, same `PORT=3173`, same worker count.
`package.json`, `pnpm-lock.yaml` and `playwright.config.ts` are **byte-identical**
between `origin/main` and the branch (`git diff origin/main...HEAD` on those three
paths is empty), so `origin/main` was checked out **in this worktree** with the
existing `node_modules` — a true baseline, not an inferred one.

| Run | Result |
|---|---|
| Branch `issue-73-standardize-exam-sections` @ v3, full suite | **534 pass / 14 fail** |
| Same 7 failing spec files, in isolation, on the branch | 69 pass / **12 fail** |
| Same 7 spec files, in isolation, at `origin/main` (`e6a9654`) | 67 pass / **14 fail** |

**The branch introduces zero failures.** Every failing test on the branch also
fails at `origin/main`. This is a stronger statement than the prior QA lanes
could make — they compared against `741a900` (an earlier commit of this same
branch), which rules out the rebuild but not the branch.

## The stable 12 — identical on both sides, character for character

```
issue-49-qa.spec.ts:350            AC8 — mobile 375: catalog (light) + dialog open (dark), no horizontal overflow
issue-60-bounce1-meta-row.spec.ts  bounce1 — mobile / tablet: support pair as a quiet meta row      (x2)
issue-60-qa.spec.ts:147            AC2 — desktop (tall content): sections region scrolls internally
issue-60-qa.spec.ts:337            AC4 — mobile 375 / tablet 768: sidebar card ends after RESOURCES (x2)
issue-71-exam-note.spec.ts:176     evidence — List and Calendar qualifier at desktop / tablet / mobile (x3)
issue-71-qa.spec.ts:471            evidence — qualifier on List + Calendar at desktop / tablet / mobile (x3)
```

All are viewport/overflow geometry measurements — the `scrollbar-gutter` class on
this box that every prior lane recorded. `issue-49-qa` AC8 is the only one that
opens a dialog at all, and it fails on its horizontal-overflow measurement, not
on dialog content; it fails identically at `origin/main`, where none of this
ticket's code exists.

## The 2 nondeterministic ones — same tests, different instances

```
issue-41-theme-toggle.spec.ts:190  AC: an explicit choice stops following the OS
qa-evidence.spec.ts:23             AC2 — no console errors  (desktop on the branch run, TABLET at main)
```

Both passed in isolation on the branch and failed at main; `qa-evidence` failed at
a *different viewport* in each run, which is what makes it a flake rather than a
regression. The theme-toggle race is already filed as **#78**. The `qa-evidence`
console error is Next dev-mode's hydration warning about
`style={{caret-color:"transparent"}}` on the search input — present on `main`,
unrelated to this ticket.

## Ticket specs — the 9 files this ticket wrote or retargeted

`issue-73-qa-v2`, `issue-73-qa`, `issue-73-one-presentation`,
`issue-44-qa{,-v2,-v3,-v4}`, `issue-45-qa-v3`, `issue-6-exam-info-panel`

**137 pass / 0 fail**, three times over (see `playwright-ticket.log` for the third
run). Zero of the 14 baseline failures live in these files.
