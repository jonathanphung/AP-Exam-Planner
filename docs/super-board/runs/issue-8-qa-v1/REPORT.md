# QA report — issue #8 (Responsive and accessibility hardening) — v1 PASS

- **Branch:** `issue-8-a11y-hardening` @ Builder commit `0ebf463`
- **PR:** #18
- **Date:** 2026-07-06
- **Tester command:** `pnpm build && pnpm lint && pnpm test:unit && pnpm test:data && PORT=3214 pnpm test:e2e`

## Verdict: PASS — all 6 ACs verified

| AC | Result | Evidence |
|----|--------|----------|
| AC1 keyboard: tab order, focus indicators, focus-trapped dialogs + Escape | ✅ 4 tests in `e2e/a11y.spec.ts` (tab-order walk search → chips → card → details → export with computed-style focus-indicator checks; conflict modal + info panel trap focus over 8 Tab / 3 Shift+Tab cycles, close on Escape, focus restored) | `ac1-focus-indicator-export-desktop.png`, `ac1-conflict-modal-desktop.png` |
| AC2 axe-core zero serious/critical across states | ✅ 5 states scanned (empty, with-selections light+dark, conflict dialog, info panel, resolved light+dark) — **zero violations of ANY impact**, not just serious/critical | `ac2-axe-summary.json`, `ac2-resolved-dark-desktop.png` |
| AC3 conflict + moved-to-late contrast ≥ 4.5:1 | ✅ measured, light 6.42–9.29:1, dark 6.42–15.79:1 | `ac3-contrast-ratios.txt` (full table) |
| AC4 375×667: no horizontal scroll incl. dialogs; tap targets ≥ 44×44 | ✅ base page, info panel, conflict dialog all ≤ clientWidth+1; measured targets 44–165px wide × 44px tall | `ac4-mobile-conflict-dialog.png`, `ac4-tap-targets.json`, `mobile.png` |
| AC5 landmarks/labels: one h1, labelled search, named icon buttons, more-than-color states | ✅ 2 tests in `e2e/a11y.spec.ts` (h1 count, `Search subjects` label, per-subject details names, ✓ glyph + aria-pressed, "Moved to late testing" text badge, "pending" text badge) | `ac5-info-panel-pending-desktop.png` |
| AC6 `pnpm build` + full `pnpm test:e2e` pass | ✅ build clean, lint clean, unit 48/48, data 34/34, **e2e 79/79** (72 prior-card specs + 7 new issue-8 evidence tests) | this report |

## Measured contrast ratios (AC3)

```
                             [light]    [dark]
conflict prompt body          9.16:1    15.79:1
conflict prompt heading       9.16:1    15.79:1
keep-at-regular-time button   6.42:1     6.42:1
"Moved to late testing"       9.29:1     9.06:1
late-collision warning        9.16:1    15.79:1
```

## Measured tap targets @ 375×667 (AC4)

```
search input          327×44
category chip "All"    50×44
details affordance     44×44
export button         165×44
```

## Notes

- Builder's dual-state conflict UI (modal first, inline prompt after dismissal)
  keeps all 12 issue-5 specs green unmodified while satisfying AC1's
  focus-trap + Escape requirement — verified in the same run.
- Prior-issue evidence PNGs rewritten by the full e2e run were reverted before
  commit (same handling as the Builder used).
- axe scans exclude `nextjs-portal` (dev-overlay chrome, not shipped UI).

## Files added by Tester

- `e2e/issue-8-qa.spec.ts` — 7 evidence tests (screenshots, axe summary JSON, measured contrast ratios, measured tap targets)
- `docs/super-board/runs/issue-8-qa-v1/` — this folder
