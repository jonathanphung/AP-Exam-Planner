# QA v4 — issue #44 post-merge "9px matched" spacing follow-up (PR #53)

- **Branch:** `issue-44-9px-matched-spacing` @ 33485be
- **Lane:** Tester (super-qa), pass 1 · 2026-07-10
- **Verdict:** PASS — all 4 ACs verified independently.

## Spec under test

Jon's follow-up comment on #44 (2026-07-10), variant "Reduced 9px + matched
meta gap": (1) partless section block vertical padding → 9px, hairline
between blocks stays; (2) sections→metadata rendered gap = exactly 11px
above the divider over "Exam length" (builder's documented call: 9px block
bottom padding + 2px group margin), matched to the metadata rhythm.
Everything else as shipped; multi-part table byte-untouched; no data changes.

## Method (independent of the builder's suite)

`e2e/issue-44-qa-v4.spec.ts` measures **rendered distances with
getBoundingClientRect geometry** — the spec's parenthetical names the
rendered distance as authoritative — instead of re-running the builder's
computed-style pins:

1. **Every block, not just Biology's two:** AAS's 5 partless blocks and
   Biology's 2 each keep 9px above/below content (first block keeps the
   shipped 4px header offset — builder's documented call, verified as
   shipped-in-#48 behavior); hairline on the bottom edge of every non-last
   block, none on the last; inter-block content rhythm = 9+1+9 = 19px with
   the hairline centered.
2. **The 11px matched gap as geometry:** metadata `<dl>` border-top edge
   minus last block content bottom = 11px; divider to first metadata row
   content = 10px; metadata rows keep 10px on both sides of their hairlines
   (the rhythm the gap is matched to). Verified at desktop 1920 AND mobile
   375, light and dark.
3. **Hairline-token consistency:** inter-block hairline color === metadata
   row hairline color (slate-100 / dark slate-800), and the zone divider
   stays a distinct stronger token (slate-200 / dark slate-700) — both themes.
4. **Table branch runtime guard:** Calc AB keeps the table, no partless
   sections `<dl>` exists, metadata group keeps shipped `mt-2` (8px) with
   0px border-top (the partless-only divider must not leak).

## AC results

| AC | Result | Evidence |
|----|--------|----------|
| AC1 — matches "Reduced 9px + matched meta gap", light + dark | ✅ | geometry tests (desktop/mobile, light/dark) + screenshots in this folder |
| AC2 — ALL partless exams; table branch byte-untouched | ✅ | AAS 5-block + Biology 2-block geometry; `git diff origin/main` touches only `InfoPanel.tsx` partless branch + e2e spec; **cross-build capture: Calc AB dialog element screenshot on origin/main (447059b) vs this branch, light + dark — byte-identical PNGs (sha256 equal, `cmp` clean), see `table-diff/`** |
| AC3 — existing #44 suites green incl. no-mid-phrase-wrap e2e | ✅ | full suite re-run: lint · test:data 61 · test:unit 141 · build · e2e 338 (319 existing + 19 new v4) — all green |
| AC4 — evidence Biology + AAS, light + dark, desktop + mobile | ✅ | 8 PNGs + Calc AB light/dark + 3 standard viewports in this folder |

## Cross-build table proof (`table-diff/`)

`capture-dialog.mjs` run against two dev servers on the same machine/Chromium:
origin/main worktree (447059b) on :3211 and this branch on :3212, capturing
the AP Calculus AB dialog element at 1920×1080, light + dark.

```
sha256(main-calc-dialog-light.png)  == sha256(branch-calc-dialog-light.png)
sha256(main-calc-dialog-dark.png)   == sha256(branch-calc-dialog-dark.png)
cmp → identical, 0 differing bytes (both themes)
```

## Notes for Reviewer

- Two spec numbers intentionally read differently in CSS than in Jon's prose,
  both pre-documented by the builder and verified as "stays as shipped":
  the first block's top offset is the shipped 4px (`first:pt-1`), and the
  stats-line offset is the shipped `mt-1` (4px) — neither was one of the two
  specified changes.
- The 11px gap is implemented as 9px padding + 2px margin (`mt-0.5`), not a
  single 11px token — the spec explicitly delegates that structure to the
  builder; the rendered 11px is what's asserted.
- Local tests: `pnpm lint && pnpm test:data && pnpm test:unit && pnpm build && PORT=3100 pnpm test:e2e`
