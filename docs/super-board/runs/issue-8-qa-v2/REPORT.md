# Issue #8 — QA v2 (Tester rebuild after Reviewer bounce)

- **Issue:** #8 — Responsive and accessibility hardening across the app
- **PR:** #18 · branch `issue-8-a11y-hardening`
- **Pass:** v2 (rebuild — Reviewer bounced Review → QA with one `[QA]` thread)
- **Date:** 2026-07-06

## What the Reviewer found (v1 bounce)

`e2e/issue-8-qa.spec.ts` AC2 axe scan failed 3/3 full-suite reruns on a clean
checkout of `73799a3`: `AxeBuilder.analyze()` raced the export button's
`transition-colors` disabled → enabled hydration flip (fires when selections
are seeded via localStorage) and sampled interpolated colors
(`#eceff3` on `#3d7bfe`, 3.33:1) — a serious color-contrast violation against
a settled UI that is compliant. The same flake class hit
`e2e/a11y.spec.ts` ("info panel open") once on run 1.

## Fix (test-only, per the `[QA]` thread's sketch)

Added a `settleAnimations(page)` helper to both scan paths and call it before
every `.analyze()`:

- `e2e/issue-8-qa.spec.ts` — `scan()` helper (AC2 evidence test)
- `e2e/a11y.spec.ts` — `expectNoSeriousViolations()` (all AC2 scans)

The helper awaits `document.getAnimations().map((a) => a.finished)` (with a
per-animation `catch` because `Animation.finished` rejects on cancel), raced
against a 2 s safety valve so a future infinite animation can never hang a
scan (the app currently has none). Axe now always samples settled colors.

No `src/` changes. The AC3 `contrastRatio` call sites were left untouched:
they measure statically-rendered badges/warnings that have no state-flip
transition, and v1 + v2 measured identical settled ratios there.

## Verification (this worktree, branch at `73799a3` + this fix)

| Check | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm build` | pass (static prerender OK) |
| `pnpm test:unit` | 48/48 |
| `pnpm test:data` | 34/34 |
| `pnpm test:e2e` run 1 (PORT=3218) | 79/79 |
| `pnpm test:e2e` run 2 (PORT=3219) | 79/79 |
| `pnpm test:e2e` run 3 (PORT=3220) | 79/79 |

Thread asked for ≥2 consecutive green full-suite runs; 3/3 delivered.

## Evidence in this folder (regenerated on run 3)

- `ac2-axe-summary.json` — 0 violations (total, not just serious/critical)
  across all 5 states: empty · with-selections · conflict-dialog-open ·
  info-panel-open · resolved-dark
- `ac3-contrast-ratios.txt` — measured ratios: light 6.42–9.29:1,
  dark 6.42–15.79:1 (all ≥ 4.5:1, matching v1)
- `ac4-tap-targets.json` — 375×667: search 327×44 · chip 50×44 ·
  details 44×44 · export 165×44
- `desktop.png` / `tablet.png` / `mobile.png` — standard viewports,
  resolved-schedule state (moved badges + late-collision warning)
- `ac1-*` / `ac2-*` / `ac4-*` / `ac5-*` screenshots — per-AC visual evidence
  (same capture points as v1)
