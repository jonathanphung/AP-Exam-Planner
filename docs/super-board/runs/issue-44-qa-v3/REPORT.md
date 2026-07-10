# QA v3 — issue #44, PR #48 design bounce pass 2 (two-line left-aligned section blocks)

- Branch: `issue-44-exam-details-sections` @ 328dd63 (builder's bounce-2 revision)
- Date: 2026-07-10 · Tester: super-board QA lane (independent pass)
- Spec under test: Jon-approved RECOMMENDED layout from the bounce-2 issue comment
  (2026-07-10T04:28Z approval): name line + muted left-aligned stats line, nowrap
  per stat phrase, ~1.5x block padding, divider + larger sections-vs-metadata gap,
  pending badge inline in its stat slot, multi-part table byte-untouched.

## Verdict: PASS

## Suites (run in `.worktrees/issue-44-qa`, port 3100)

| Suite | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm test:data` | 61 passed |
| `pnpm test:unit` | 141 passed |
| `pnpm build` | success |
| `PORT=3100 pnpm test:e2e` (full) | **319 passed** (298 existing + 21 new v3) |

## Independent v3 checks (e2e/issue-44-qa-v3.spec.ts — new this pass)

1. **Wrap detector independence + self-test.** This pass does NOT reuse the
   builder's rect-separation detector. A height-based single-line detector
   (phrase bounding-box height <= 2.05 x font-size) is self-tested in-page —
   proven to fire on a forced wrap and stay quiet on nowrap — then applied to
   every stat phrase for AP Biology AND AAS at 1920 / 375 / 320 px. No
   mid-phrase wrap anywhere; no horizontal page scroll with the dialog open.
2. **Never truncated.** AAS Section IB ("…—Exam Day Validation Question", the
   longest section name in the dataset) renders its full verbatim title with
   zero horizontal/vertical clipping — it wraps, it is never elided.
3. **Pending inline + omission != pending, in the partless layout.** AAS
   "Individual Student Project" (minutes `"pending"`, questionCount omitted):
   exactly 2 stat phrases, no "questions" text, the pending badge sits inside
   its stat slot on the same line as the weight phrase.
4. **Zone divider correctness both ways.** Partless (Biology): metadata `<dl>`
   carries a 1px top divider. Table case (Calc AB): 0px — the divider does not
   leak into the byte-untouched table layout (which keeps its `mt-2`).
5. **Left alignment + hierarchy, light AND dark.** Stats line computed
   `text-align` is left/start (bounce-1's right-aligned values are gone) and
   the stats color differs from the name color in both themes.
6. **Axe:** no serious/critical violations with the partless dialog open —
   Biology (light) and AAS 5-section (dark).
7. **Third surface:** the calendar event popup renders the two-line blocks
   (name above left-aligned stats, no table) and passes the wrap detector.

## "Multi-part table byte-untouched" — pixel-diff proof

Recaptured `calculus-ab-table-unchanged-{light,dark}-desktop.png` (v3) vs the
Reviewer-approved v2 captures, full 1920x1080 canvas-level pixel diff:

| Theme | Differing pixels | Where | Max channel delta |
|---|---|---|---|
| light | 102 / 2,073,600 | bbox (1248,269)-(1261,279) | <=15/765 summed (~5/255 per channel) |
| dark  | 73 / 2,073,600 | bbox (1248,269)-(1261,278) | <=4/765 summed |

The dialog is `max-w-lg` (512px) centered → x 704-1216. The differing box
starts at x=1248, i.e. entirely OUTSIDE the dialog: it is a sub-perceptual
anti-aliasing sample of the background card's expand-chevron (mid-transition
capture timing), invisible to the eye. **Inside the dialog: 0 differing
pixels in both themes.** Combined with the code diff (328dd63 touches zero
`SectionsTable` lines), the table case is unchanged.

## Evidence files (Jon's mandated set)

- `desktop.png` / `tablet.png` / `mobile.png` — AP Biology, light, standard viewports
- `biology-partless-{light,dark}-{desktop,mobile}.png`
- `aas-5-sections-partless-{light,dark}-{desktop,mobile}.png`
- `calculus-ab-table-unchanged-{light,dark}-desktop.png`

## Notes

- No data changes in the bounce-2 revision: `git diff a804b56..328dd63 -- src/data src/lib/ics.ts docs/super-board/research` is empty.
- PR #48 review threads: none open.
