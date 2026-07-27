# QA evidence — issue #89 (drop the redundant "Late window" pill) — v1

- **Verdict:** PASS (all 8 ACs)
- **Branch:** `issue-89-drop-late-window-pill` @ Builder commit `10067f5`
- **Spec:** `e2e/issue-56-qa.spec.ts` (pre-existing evidence-generation spec covering both
  exporter variants) — re-run in full against the fix, capturing the actual downloaded
  PNGs as this ticket's evidence.
- **Commands (run in the QA worktree, PORT=3189):**
  - `PORT=3189 QA_EVIDENCE_DIR=docs/super-board/runs/issue-89-qa-v1 pnpm exec playwright test e2e/issue-56-qa.spec.ts` -> **13 passed** (21.3s)
  - `PORT=3189 pnpm test:e2e` (full suite) -> see PR/issue comment for result
  - `pnpm test:unit` -> **251 passed** * `pnpm lint` -> 0 errors (4 pre-existing unrelated warnings) * `pnpm build` -> PASS

## Per-AC results

| AC | Check | Result |
|----|-------|--------|
| AC1 pill gone from list `.png` | `e2e/issue-56-qa.spec.ts` 3week x list x {light,dark} pass; visual check of `3week-list-*-late-testing-list.png` shows header row with only `card.label` + range -- no pill | PASS |
| AC2 pill gone from calendar `.png` | Same spec, 3week x calendar x {light,dark} pass; visual check of `3week-calendar-*-late-testing-calendar.png` confirms no pill | PASS |
| AC3 late-testing card still unmistakable | Visual check: `card.label` renders "Late Testing" (22px/700) and the header keeps its distinct warm/amber background + orange top-border accent, unchanged from before the pill was removed | PASS |
| AC4 `card.late` still drives label/slug/accent | Code diff only deletes the `if (card.late) {...pill...}` block -- the flag itself, `weekCardMeta`'s label derivation, and the `late-testing` filename slug are untouched (evidence filenames literally contain `late-testing`); accent border-top still keyed off `card.late ? tokens.lateAccent : tokens.regularAccent` in both files | PASS |
| AC5 no unused-variable lint fallout | `grep -n "accent" src/lib/export-png.ts src/lib/export-png-calendar.ts` shows `accent` still consumed by `cardBox`'s `borderTop` in both files; `pnpm lint` -> 0 errors | PASS |
| AC6 regular Week 1/2 cards pixel-unchanged | Environment-controlled A/B: reverted both exporter files to the pre-fix commit (`2f737a3`) in this same worktree/browser session, re-ran the 1week scenario, then restored the fix and diffed bytes. All 4 regular-card files (list/calendar x light/dark) came back **byte-identical** before vs. after. (A naive diff against the 2-day-old `issue-56-qa-v2` evidence showed non-identical bytes at matching dimensions -- that's Chromium/font-hinting drift between capture sessions, not a regression; the same-session A/B is the controlled comparison and it is exact.) | PASS |
| AC7 on-screen views untouched; string lives only in the two exporters | `grep -rn "Late window" .` (excluding `node_modules`/`.next`) -> zero matches anywhere in the repo now (the string was deleted from its only two occurrences); `git diff main...HEAD --stat` touches only `src/lib/export-png.ts` and `src/lib/export-png-calendar.ts` | PASS |
| AC8 evidence regenerated; no live assertion on the pill | Re-ran `e2e/issue-56-qa.spec.ts` in full (13/13 pass, see evidence below); read the spec -- its only "late window" references are in the file header comment (lines 12-17), no assertion targets the pill element | PASS |

## Evidence files

24 PNGs in this folder -- the full 1-week / 2-week / 3-week x list/calendar x light/dark
matrix from `e2e/issue-56-qa.spec.ts`, captured against the fixed branch. The 4 files with
`late-testing` in their name are the AC1-AC4 evidence; the rest cover AC6/AC9.
