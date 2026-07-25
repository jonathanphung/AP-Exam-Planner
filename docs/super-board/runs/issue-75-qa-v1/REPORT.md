# super-board QA — issue #75 (+ #78), v1

Branch `issue-75-sidebar-sticky-scroll-lock` · PR #79 · base `main` (`e6a9654`)
Tester lane, pass 1. Host: Windows 10, bundled Chromium + real Chrome.

**Verdict: PASS.** All ten acceptance criteria verified. Two specs added by this
lane (`e2e/issue-75-qa.spec.ts`, `e2e/issue-75-real-chrome.spec.ts`).

---

## How this pass was run

QA's job here was not to re-read the Builder's table and agree with it. Three
claims in the handoff are the kind that are easy to assert and hard to check, so
each was re-derived from scratch:

1. **Is the new regression spec actually a regression spec?** — re-run against
   the *old* lock, in place, rather than trusting "it fails 8/11".
2. **Are the three relaxed `toBe(0)` assertions masking a regression this branch
   introduced?** — re-run on a clean `origin/main` worktree with the diff
   absent, and read the received values.
3. **Does `overflow: clip` hold #49's guarantee in the engine that actually
   reproduces #49?** — bundled Chromium is launched with `--hide-scrollbars` and
   drops the gutter anyway; real Chrome is the one that retains it. Neither
   existing spec measures the sidebar there.

## 1. The fix is the fix — the spec fails against the old lock

`src/lib/modal.ts` patched in place, `SCROLL_LOCK_OVERFLOW` back to `"hidden"`,
nothing else touched, `e2e/issue-75-scroll-lock-sticky.spec.ts` re-run:

```
10 failed, 3 passed
  while the dialog is open: sidebar y moved (-45 -> -1024)      1440x900 @ 1200
  while the dialog is open: sidebar y moved (40 -> -1160)       1024x768 @ 1200
  open at 1440px @ 400px:       sidebar y moved (40 -> -360)
  open at 1920px @ 1200px:      sidebar y moved (-45 -> -844)
  open at 1440px @ page bottom: sidebar y moved (-45 -> -1024)
  ... all five useModalDialog consumers among them
```

Reverted, re-run: **13 passed**. The keyword is load-bearing and the coverage is
real, not decorative.

The three that still passed under `hidden` are the AC2 lock test, the AC3 focus
test and the evidence test — correct, because none of them depends on the
keyword. AC3 was therefore verified separately, by removing
`preventScroll: true` from both `focus()` calls:

```
AC3 — the dialog's initial focus does not scroll the document (preventScroll)
  Error: restoring focus on close scrolled the page back to the opener
  Expected: 0      Received: 1421
```

Exactly the Builder's measured 0 -> 1421. Reverted; green.

## 2. The relaxed assertions were already red on `main`

Fresh worktree at `origin/main` (`e6a9654`), `pnpm install --frozen-lockfile`,
this branch's diff absent:

| assertion | on `main` | received |
|---|---|---|
| `issue-49-qa.spec.ts:350` AC8 mobile 375 | red | `-10` |
| `issue-60-qa.spec.ts:337` AC4 mobile 375 | red | `-10` |
| `issue-60-qa.spec.ts:337` AC4 tablet 768 | red | `-10` |
| `issue-60-qa.spec.ts:147` AC2 precondition | red | `scrollHeight` not `> 615` |
| `issue-41-theme-toggle.spec.ts:190` | red | label `dark`, expected `light` |

All five reproduce on `main` with the branch absent, and `-10` is exactly the
reserved-gutter width #49 introduced. So `toBe(0)` -> `toBeLessThanOrEqual(0)`
is a correction of an assertion that was wrong the day #49 landed, not a
regression being papered over. The surviving half of each assertion still
catches real overflow, which is a *positive* delta.

## 3. Real Chrome, classic scrollbars, scrolled, dialog open

New: `e2e/issue-75-real-chrome.spec.ts`. The gap it closes is that #75 and #49
pull in opposite directions and nothing measured both at the same instant in the
engine where #49 actually bites:

- bundled Chromium runs with `--hide-scrollbars`, so no scrollbar occupies
  layout width and the horizontal half of the contract is vacuous there;
- real Chrome **retains** the `scrollbar-gutter: stable` reservation under
  `overflow: hidden` — that divergence is why `issue-49-real-chrome.spec.ts`
  exists at all (Jon's bounce: the old width-inference fix shifted the shell
  *left* by 5-7px in real Chrome while bundled Chromium stayed green);
- under `clip` the root is not a scroll container, so the reservation is now
  dropped **everywhere**, including real Chrome. That is a live behaviour change
  in exactly the engine #49 was bounced over.

The test forces classic scrollbars, asserts the scrollbar really occupies layout
width, scrolls to 1200, opens the delete dialog and asserts **both** halves at
once: sidebar box within 1px, and the centered shell's `rect.left`
byte-identical, closed -> open -> closed. **Passes.** #49's position-invariant
padding correction does absorb the dropped gutter, as the Builder claimed.

## AC-by-AC

| AC | Verdict | Evidence |
|---|---|---|
| #75 AC1 — sidebar unmoved, several depths incl. page bottom | PASS | `issue-75-scroll-lock-sticky.spec.ts` 13/13; fails 10/13 against `hidden` |
| #75 AC2 — lock holds for wheel / touch / Space / PageDown / arrows | PASS | same spec, with a control loop proving each gesture moves the *unlocked* page first |
| #75 AC3 — scrollY unchanged on open and on close, focus restored | PASS | same spec; fails 0 -> 1421 without `preventScroll` |
| #75 AC4 — #49 does not regress | PASS | `issue-49-scrollbar-gutter` 6/6, `issue-49-real-chrome` 6/6, `issue-49-qa` 8/8, plus the new real-Chrome sticky+shell test |
| #75 AC5 — contract assertions re-pointed deliberately | PASS | `issue-6-exam-info-panel.spec.ts` asserts the exported `SCROLL_LOCK_OVERFLOW` with a why-comment; `a11y.spec.ts:416` asserts empty-after-close, which is keyword-agnostic, and carries a comment saying so |
| #75 AC6 — regression coverage: sidebar box unchanged within 1px while scrolled | PASS | `expectSameBox` over x/y/width/height, all five consumers |
| #75 AC7 — evidence at the standard viewports, light + dark, both dialogs, scrolled | PASS | `issue-75-qa.spec.ts` -> 12 PNGs in this folder |
| #78 AC1 — theme toggle green 10x at workers=1 and workers=2 | PASS | `theme-toggle-20x.txt` — 20/20 runs, 31 tests each, independent re-run |
| #78 AC2 — issue-60 AC2 precondition holds again | PASS | red on `main`, green here; region overflows post-hydration, not re-anchored |
| #78 AC3 — failure-mode note in the evidence folder | PASS | `../issue-75-build-v1/flaky-specs-note.md`, independently confirmed above |

## Screenshots in this folder

Every shot is taken with the page scrolled and a dialog open — a shot at scroll
top proves nothing about this bug.

| viewport | delete-schedule | exam details |
|---|---|---|
| desktop 1920x1080 | light, dark | light, dark |
| tablet 1024x768 | light, dark | light, dark |
| mobile 375x667 | light, dark | light, dark |

375 is included even though the symptom is desktop-only by construction
(`Sidebar.tsx` gates `lg:sticky`): the change is to a lock every viewport
shares, so mobile has to be *shown* unharmed rather than assumed. At 375 the
sidebar is a normal block at the top of the document, so the delete-dialog shot
necessarily sits near scroll top — the scrolled-mobile case is carried by the
exam-details shot, whose opener is deep in the catalog by construction. The spec
asserts that precondition rather than leaving it to the reader.

## Observations — not blocking, not filed

1. **`overflow: clip` browser floor.** `clip` is Chrome 90+ / Firefox 81+ /
   Safari 16+. `applyScrollLock()` assigns then reads back, so an older engine
   silently keeps `hidden` — the pre-#75 behaviour, locked but with the sticky
   bug, rather than no lock at all. That is the right failure direction and the
   read-back is the correct detection (`CSS.supports` would answer for the
   property, not the keyword). Untested here: no such engine on this runner.
2. **AC2's input-path coverage is desktop-only.** The wheel/touch/keyboard
   assertions run at 1440x900. Nothing about the keyword swap is viewport
   dependent, and the lock's observable is asserted at 375 by
   `issue-49-qa.spec.ts` AC8 and `a11y.spec.ts`, so this is a note, not a gap
   worth a card.
3. **Pre-existing red, untouched by this branch** — see FULL-SUITE.md. Same
   failures, same messages, on a clean `origin/main` worktree. They belong to
   whoever owns #71/#60's evidence specs.
4. **Two pre-existing lint warnings** (unused imports in
   `issue-39-sweep-v1/specs/11-misc-features.spec.ts` and `issue-51-qa.spec.ts`)
   are in files this branch does not touch.
