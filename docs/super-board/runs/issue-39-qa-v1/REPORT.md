# Issue #39 — Tester verification (QA v1)

QA of the sweep card's deliverable (evidence + filed issues, no product code).
Run 2026-07-13 in `.worktrees/issue-39-qa/` on branch `issue-39-adversarial-qa-sweep`
(tip fd73aa8 + this lane's fix commit), fresh `pnpm build` + `PORT=3100 pnpm start`.

## Verdict: PASS (after one QA-lane fix committed in this lane)

## Defect found and fixed in this lane (test-artifact, `[QA]`-owned)

The Builder's commit fd73aa8 **broke `pnpm build`** on the branch: Next.js
typechecks `**/*.ts` (tsconfig include), which covers the archived specs under
`docs/super-board/runs/issue-39-sweep-v1/specs/`, and `helpers.ts` line 4 had
`import apData from "../../src/data/ap-2026.json"` — a path that only resolves
from the runnable `sweep/specs/` location. This is also why the Vercel deploy
on PR #63 shows Error. Since the broken files are test artifacts (QA-lane
property per the `[builder]`/`[QA]` ownership model), the Tester fixed them
in-branch rather than bouncing:

- `specs/helpers.ts`: replaced the static JSON import with a runtime
  `fs.readFileSync` + repo-root discovery, and made `EVIDENCE_DIR`
  repo-root-based — the file now typechecks and runs from BOTH its archived
  home and `sweep/specs/`.
- Verified: `pnpm build` passes with the archive in the tree (and with a
  `sweep/` copy present). No product source touched (fix is docs-only).

## Per-AC verification

| AC | Check | Result |
|---|---|---|
| Limit testing (all-42, spam, viewports 320-1920, zoom, dark, reduced-motion, offline, zero console errors) | Re-ran the full 56-test sweep suite against a fresh production build at the branch tip | ✅ 56/56 passed (`sweep-rerun.log`) |
| A11y: axe on each major state, light + dark | Parsed all 12 `axe-*.json` artifacts | ✅ 0 violations in every scan |
| A11y: keyboard / focus / headings / emoji / touch targets | Covered by passing specs 07-10; independently re-probed the flagged 32px toolbar pills | ✅ pills carry `max-sm:before:` `top-1/2 -translate-y-1/2 h-11` (ScheduleViews.tsx:90, ExportButton.tsx:477) — centered 44px hit band; correctly not filed |
| Official links resolve | Inspected `link-check.txt` | ✅ 51/51 HTTP 200 |
| One issue per finding, house format, evidence, severity label | Read #62 in full | ✅ Goal/AC/Notes format, `enhancement` label, repro steps, evidence path, grounded in `src/lib/schedules.ts` (`withScheduleRenamed` verified: trims + rejects blank, no dup/length check — finding is real) |
| Issues on board #6 in Backlog, not Ready | `gh project item-list 6` | ✅ #62 in Backlog |
| De-duplicate before filing | Searched open+closed issues for schedule-name/duplicate/rename items | ✅ #62 is the only one |
| Summary comment on #39, grouped Bugs/Accessibility/Suggestions + clean coverage | Read the comment | ✅ present and complete |
| No product source changes | `git diff origin/main...HEAD --name-only` | ✅ docs-only |
| Honest reporting (hard data rule, caveats) | REPORT.md declares no-real-screen-reader + zoom-equivalent caveats; "pending" rule spec passes | ✅ |

## Evidence in this folder
- `sweep-rerun.log` — full 56-test rerun output (56 passed)
- `desktop.png` / `tablet.png` / `mobile.png` — app at 1920x1080 / 1024x768 /
  375x667 with selections active; zero console/page errors at each capture

## Not re-verified (accepted with Builder's stated caveats)
- Real screen-reader pass (semantic checks only, as Builder disclosed)
- Importing the exported .ics into a real calendar client (ical.js parse
  covered by spec 05; a real-client import remains an optional follow-up)
