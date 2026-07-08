# QA report — issue #29 · v1 · PASS

Branch: `issue-29-sidebar-my-schedules` (rebased onto origin/main after #24/PR #32 merged — per the ticket's "whichever lands second rebases")
Build under test: a225bf8 → rebased head (see PR #35)
Tester spec: `e2e/issue-29-qa.spec.ts` (20 tests, one observable test per AC clause)
Unit coverage: `src/lib/schedules.test.ts` (20 tests — migration, parse, transitions, isolation), `src/data/resources.test.ts` (parenthesis audit)

## Verification commands (all green, run in this worktree post-rebase)

| Command | Result | Log |
|---|---|---|
| `npx tsc --noEmit` | PASS | `tsc.log` |
| `pnpm test:unit` | PASS (109) | `test-unit.log` |
| `pnpm test:data` | PASS (43) | `test-data.log` |
| `pnpm lint` | PASS | `lint.log` |
| `PORT=3100 pnpm test:e2e` | PASS (165/165 — 131 accumulated + 20 new + evidence re-runs) | `test-e2e-full.log` |

Note: two intermediate full-suite runs showed cascading `ERR_CONNECTION_REFUSED` failures — root-caused to the Playwright-managed dev server being torn down/reused across overlapping local runs (environment, not app). A clean single managed run is 165/165; a11y and issue-8 axe specs pass in isolation and in the clean full run.

## Per-AC results

| AC | Criterion | Result | Evidence |
|---|---|---|---|
| AC1 | Desktop hierarchy: branding h1 → MY SCHEDULES → divider → RESOURCES; collapse toggle (`aria-expanded`) widens main; remembered in `apx.sidebar.v1` across reload | PASS | spec AC1; `desktop.png`, `desktop-collapsed.png` |
| AC2 | Mobile keeps #22/#23 disclosure pattern; schedule switching works inside the disclosure; no collapse toggle | PASS | spec AC2; `mobile.png`, `mobile-schedules-open.png` |
| AC3 | All 8 resource labels on one line, untruncated, at 1024/1440/1920 and in the 375px disclosure | PASS | spec AC3 (scrollWidth ≤ clientWidth per label + single-line anchor height) |
| AC4 | Labels parenthesis-free | PASS | spec AC4 + `src/data/resources.test.ts` |
| AC5 | Hover underline on label text only — never the ↗, anchor carries no underline (desktop + mobile disclosure, all 8 links) | PASS | spec AC5 (computed `text-decoration-line`) |
| AC6 | Switching swaps the entire app immediately: chips, list, calendar blocks, ICS export enable-state + contents | PASS | spec AC6 (ICS blob contains Schedule 1's exams; export disabled on empty Schedule 2) |
| AC7 | `+` creates auto-named empty "Schedule N"; inline rename; delete behind confirm dialog (cancel honored); last schedule undeletable | PASS | spec AC7; `delete-dialog.png` |
| AC8 | Per-schedule selection AND resolutions; opposite resolutions of the same collision coexist with zero leak; legacy mirror follows active schedule | PASS | spec AC8 + unit isolation tests |
| AC9 | Client-side persistence: versioned `apx.schedules.v1` localStorage, zero cookies, survives reload | PASS | spec AC9 (`document.cookie === ""`) |
| AC10 | Migration: legacy `apx.selection.v1` + `apx.resolutions.v1` adopted as "Schedule 1", selection AND resolution intact | PASS | spec AC10 (browser) + `schedules.test.ts` (unit) |
| AC11 | Cross-tab sync via storage events (create + switch reflected in a second tab) | PASS | spec AC11 |
| AC12 | Radiogroup w/ roving tabindex + arrow-key select, Home/End; rename focus restore on Escape; delete dialog focus-trapped w/ restore; collapse toggle keyboard-operable | PASS | spec AC12 |
| AC13 | No horizontal scroll at 375/1024/1440/1920, expanded AND collapsed; contrast/reduced-motion regression-covered by `e2e/a11y.spec.ts` axe scans in the same suite | PASS | spec AC13; standard screenshots |

## Screenshots

- `desktop.png` — 1920×1080, expanded sidebar
- `tablet.png` — 1024×768 (lg breakpoint: persistent sidebar)
- `mobile.png` — 375×667, disclosure card
- `desktop-collapsed.png` — collapsed rail, widened main
- `mobile-schedules-open.png` — mobile My Schedules disclosure open, 2 schedules
- `delete-dialog.png` — delete confirm dialog

## Verdict

All 13 ACs pass. QA → Review.
