# QA v2 — issue #44, Jon's PR #48 design bounce (partless spacious rows)

- **Date:** 2026-07-09 (pass 1 of the bounce wave)
- **Branch:** `issue-44-exam-details-sections` @ 2028401 (bounce commit under test)
- **Verdict:** PASS — all bounce requirements verified; QA → Review

## What the bounce required (Jon, issue comment)

| Requirement | Result |
|---|---|
| ANY section has parts → table completely unchanged | PASS — Calc AB renders the 4-column table with nested A/B rows; recapturing v1's `desktop.png`, `mobile.png`, `chinese-range-{light,dark}-desktop.png` against the bounced code produced **byte-identical** PNGs (pixel-untouched, literally) |
| NO parts → no table/header; one spacious label/value row per section, identical to metadata rows | PASS — computed-style identity (padding, border, dt font/size/color) asserted for Biology AND all five AAS rows against the "Exam length" row |
| Branch is parts-based, never count-based | PASS — dataset audit: 4 portfolio / 14 partful / 24 partless; AAS (5 sections), music-theory + business-with-personal-finance (3 each) all render spacious rows |
| Value shape `<count> questions · <length> · <weight>% of score` | PASS — exact `toHaveText` on Biology, Seminar, AAS rows |
| Singular/plural | PASS — Seminar essay "1 question", AAS Section IB / DBQ "1 question", Biology "60 questions" |
| Pending badge inline in its slot; never blank/drop | PASS — AAS Individual Student Project: `[pending] · 8.5% of score`, question segment omitted (omission ≠ pending) |
| Ranges verbatim | PASS — Chinese "40–45 min" unchanged (table case, byte-identical evidence) |
| No data changes | PASS — `git diff 2847819..2028401 -- src/data src/lib/ics.ts docs/super-board/research` is empty |
| Semantics + #8 bar | PASS — dt/dd association in the shared `<dl>`; table semantics intact for parts case; no h-scroll at 320/375; axe serious/critical = 0 |
| All three surfaces | PASS — catalog panel, mobile Tier-2 (375 + 320), and **calendar event popup** (QA-added test: Builder's revision only covered the popup surface for the table case) |

## Fixture note

Jon's bounce comment suggested Psychology / World History: Modern as partless
fixtures — both actually HAVE Part A/B splits in the dataset (so they keep the
table, correctly). Biology and AAS are the partless fixtures, as the Builder's
handoff flagged.

## Test runs (local, worktree `.worktrees/issue-44-qa`)

- `pnpm lint` — clean
- `pnpm test:data` — 61 passed
- `pnpm test:unit` — 141 passed (includes Builder's `exam-sections.test.ts` branch-rule suite)
- `pnpm build` — clean
- `PORT=3100 pnpm test:e2e` — **298 passed** (Builder's 285 + 13 QA-v2: 4 independent tests + 9 evidence captures)

## Evidence files

- `desktop.png` / `tablet.png` / `mobile.png` — AP Biology (the fix), light; `mobile.png` is the mobile Tier-2 partless shot
- `biology-partless-{light,dark}-desktop.png` — plain 2-section exam
- `aas-5-sections-partless-{light,dark}-desktop.png` — multi-section partless (pending badge inline)
- `calculus-ab-table-unchanged-{light,dark}-desktop.png` — table case untouched
