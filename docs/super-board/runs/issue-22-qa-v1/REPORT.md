# QA evidence — issue #22 (mobile category-grouped chips + progressive disclosure) — v1

- **Verdict:** PASS (all 14 ACs)
- **Branch:** `issue-22-mobile-category-chips` @ Builder commit `e34166e`
- **Design under test:** mobile (<640px) catalog replaced by category-grouped
  chip sections (STEM → Humanities → Languages → Arts → Career Kickstart) with
  a sticky quick-jump nav and 3-tier progressive disclosure: chip expand →
  Tier 1 timing/date → Tier 2 shared InfoPanel (#6) → Tier 3 verified official
  College Board link. Desktop DOM unchanged (one layout mounted at a time via
  SSR-safe `matchMedia`).
- **Spec:** `e2e/issue-22-qa.spec.ts` — 15 tests: one observable test per AC
  (AC9+AC10 combined: link semantics + both exception classes; AC11 pinned at
  unit level) + 3 viewport evidence captures.
- **Commands (run in the QA worktree, PORT=3100 to dodge the orphaned :3000 server):**
  - `PORT=3100 pnpm test:e2e` (full suite incl. new spec) → **131 passed** (45.9s)
  - `pnpm test:unit` → **93 passed** · `pnpm test:data` → **42 passed** · `pnpm lint` → clean
- **Live-link spot check (QA-side re-verification, 2026-07-07):** `curl -L`
  HTTP status for `ap-biology/exam` (pattern), `ap-world-history/exam` +
  `ap-business-personal-finance/exam` (slug exceptions), `ap-drawing/portfolio`
  (portfolio exception), `ap-cybersecurity/exam` (pattern, 2027 first exam) →
  **all 200**, matching the Builder's 42/42 verification claim.

## Per-AC results

| AC | Test | Result |
|----|------|--------|
| AC1 category-grouped sections, not a flat list | `AC1 — mobile catalog is grouped…` (5 region landmarks in canonical order, per-category chip counts 13/14/8/5/2 = 42, flat `ul.grid` NOT mounted) | ✅ |
| AC2 chip selected state, ≥44px, emoji+name | `AC2 — chip: emoji + name…` (🧬 from #20's source, `aria-pressed` flips + border color changes, chip body ≥44px tall, expand ≥44×44) | ✅ |
| AC3 quick category navigation | `AC3 — sticky quick-jump…` (`position: sticky`; one tap from top reaches Career Kickstart: heading focused + in viewport) | ✅ |
| AC4 search filters sectioned view | `AC4 — search filters…` ("calc" → STEM only, 3 chips, quick-jump shrinks to 1; gibberish → no-matches state with zero section shells; clear restores 42) | ✅ |
| AC5 shared selection semantics | `AC5 — chip tap toggles…` ("1 selected" + subject appears in schedule surface immediately; toggle off → "0 selected") | ✅ |
| AC6 expand ≠ select | `AC6 — expand and select are separate…` (expanding never selects, selecting never expands; distinct accessible labels) | ✅ |
| AC7 Tier 1 timing/date | `AC7 (Tier 1) — expand reveals…` (Biology: "Mon, May 4 · AM (8 a.m. local time)" + late "Wed, May 20 · PM (12 p.m. local time)"; Drawing: "Portfolio due Fri, May 8, 2026", no Exam row; Cybersecurity: sourced 2027 reason verbatim, zero `dt` rows, no invented date) | ✅ |
| AC8 Tier 2 shared InfoPanel | `AC8 (Tier 2) — 'Full exam details'…` (`aria-haspopup="dialog"`; dialog carries the #6 content: MCQ/FRQ/Calculator/Pass rate) | ✅ |
| AC9 Tier 3 official link | `AC9/AC10 (Tier 3) — …` (`target="_blank"`, `rel="noopener noreferrer"`, visible ↗ aria-hidden + sr-only "(opens in a new tab)") | ✅ |
| AC10 verified slug, exceptions handled | same test (biology → `ap-biology/exam`; World History: Modern → `ap-world-history/exam`; Drawing → `ap-drawing/portfolio`) + live curl spot check above | ✅ |
| AC11 single source of truth | `src/lib/college-board-links.test.ts` (unit, in the 93) pins 42/42 coverage + the no-guess `null` rule; `src/data/sources.md` documents the verification table | ✅ |
| AC12 keyboard/SR disclosure | `AC12 — disclosure is keyboard/SR-accessible…` (`aria-controls` targets the real panel, hidden until expanded; keyboard-only expand; Tab lands on the revealed details button; dialog traps focus; Escape restores focus to opener) | ✅ |
| AC13 landmarks, buttons, reduced motion | `AC13 — real landmarks/headings…` (5 regions + real h2s; all 42 chips are `<button aria-pressed>`; quick-jump works under `reducedMotion: reduce`) + full-suite `a11y.spec.ts` axe runs green | ✅ |
| AC14 desktop unregressed, no h-scroll | `AC14 — desktop unregressed…` (1920px: flat multi-column grid + category filter group, no quick-jump nav; no horizontal scroll at 375/768/1024/1920) | ✅ |

## Screenshots

- `desktop.png` / `tablet.png` / `mobile.png` — the three standard viewports with AP Biology selected (mobile also expanded to show Tier 1).
- `mobile-tier1-timing.png` — expanded Biology chip: exam + late-testing rows with published start times.
- `mobile-tier1-noexam.png` — Cybersecurity's sourced no-exam reason + Drawing's portfolio deadline; sticky quick-jump visible mid-scroll.
- `mobile-tier3-official-link.png` — InfoPanel with the verified official College Board link (↗).
- `mobile-search-filtered.png` — "calc" filter: STEM-only section, empty categories hidden.
