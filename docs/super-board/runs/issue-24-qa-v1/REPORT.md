# QA report — issue #24, v1 (PR #32, branch `issue-24-desktop-grouped-catalog` @ 211d896)

Verdict: **PASS** — all 8 ACs verified, including Jon's human-bounce geometry spec (vertical-only expansion + stable arrow).

Spec: `e2e/issue-24-qa.spec.ts` — 14 tests (7 AC tests + AC8 geometry at 4 viewports + 3 evidence captures).

| AC | Result | Observable check |
|----|--------|------------------|
| AC1 grouped by default | ✅ | 5 labeled `region` landmarks in canonical order, per-category counts 13/14/8/5/2, all 42 chips inside named sections, zero chips outside any section |
| AC2 multi-column desktop | ✅ | STEM section grid: 3 cols @1920, 2 cols @1024, 1 col @375; identical chip structure (select toggle + expand affordance) at every width |
| AC3 search + filter role resolved | ✅ | "Filter by category" group gone; sticky quick-jump nav works at 1920 (click → heading focused + in viewport); "calc" → 1 section / 3 chips / 1 nav chip; no-matches state; clear restores 42 |
| AC4 selection semantics unchanged | ✅ | Chip click flips `aria-pressed` + "1 selected" + schedule lists subject; expanding changes no selection; deselect returns to 0 |
| AC5 shared #22 disclosure | ✅ | Desktop Tier-1 timing ("Mon, May 4 · AM (8 a.m. local time)" + late testing), Tier-2 shared InfoPanel dialog (Pass rate), Tier-3 verified CB link `ap-biology/exam` |
| AC6 canonical order | ✅ | Heading order = `CATEGORIES` order at 1920 AND 375 (identical arrays); quick-jump chips in the same order |
| AC7 a11y + responsive | ✅ | Real headings/landmarks; 42 real `<button aria-pressed>`; Tab order search → 5 nav chips → first chip toggle → its expand button; no h-scroll at 1920/1440/1024/375 |
| AC8 human bounce | ✅ | boundingBox probes at 1920×1080 / 1024×768 / 768×900 / 375×667 on the first STEM card: card width/x/y identical collapsed↔expanded (tol 0.5px), height grows >20px downward only, computed `grid-column` state-independent (no col-span), same-row neighbors' boxes identical (no horizontal reflow), every card keeps its column x/width, arrow boundingBox identical across collapsed → expanded → re-collapsed |

## Test runs (worktree `.worktrees/issue-24-qa`, dev server PORT=3200)

- `PORT=3200 playwright test e2e/issue-24-qa.spec.ts` — **14/14 pass** (`test-e2e-issue-24.log`). Two spec-side fixes during authoring (CSS-uppercase innerText comparison; xpath ancestor dedupe) — **no app changes were needed at any point**.
- Full suite (145 tests): run 1 — 141 pass / 4 fail; run 2 (`--workers=4`) — 143 pass / 2 fail. **Failure sets disjoint between runs** (issue-8 axe evidence, issue-9 footer ×2, qa-evidence console, issue-5 evidence) and **all 6 pass in isolated reruns** → machine-load flakes (two concurrent super-board lanes were running builds/e2e on this host, load avg ~79), not regressions. Every one of the 145 tests passed at least once this session; `issue-24-qa.spec.ts` passed in every completed run.
- `pnpm lint` PASS · `pnpm test:unit` PASS (93) · `pnpm test:data` PASS (42) — logs in this folder.

## Verification re-run (reporting QA lane, 2026-07-08, fresh worktree, PORT=3457)

The lane that authored this suite was interrupted before reporting; the reporting QA lane
re-verified everything independently from a clean `pnpm install`:

- `PORT=3457 pnpm test:e2e e2e/issue-24-qa.spec.ts` — **14/14 pass** (19.8s)
- `PORT=3457 pnpm test:e2e` (full suite) — **145/145 pass** (55.3s) — no flakes this run,
  confirming the v1 report's failures were machine-load artifacts, not regressions
- `pnpm lint` PASS · `pnpm test:unit` 93/93 · `pnpm test:data` 42/42
- Committed screenshots refreshed from this verified run (identical UI, same code @ 211d896);
  desktop.png and geometry-1920-expanded.png visually spot-checked — grouped sections in
  canonical order, expansion vertical-only, chevron position stable.

## Evidence

- `desktop.png` / `tablet.png` / `mobile.png` — grouped catalog, 1 selected + 1 expanded (1920×1080 / 1024×768 / 375×667, full page)
- `geometry-<375|768|1024|1920>-{collapsed,expanded}.png` — the SAME card (first STEM chip, AP Biology) in both disclosure states at each bounce viewport
