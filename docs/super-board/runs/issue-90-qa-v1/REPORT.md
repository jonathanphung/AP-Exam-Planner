# QA evidence — issue #90 · v1 · PASS

Export filenames carry the active schedule's slug: `<schedule-slug>-ap-exams-<year>.*`.

- Branch: `issue-90-schedule-name-in-export-filenames` (PR #95, Builder commit 6081962)
- Date: 2026-07-27 · Lane: Tester (QA v1)

## Verdict per AC

| AC | Criterion | Verified by | Result |
|----|-----------|-------------|--------|
| AC1 | All four formats carry the active schedule's name, one shared convention | `e2e/issue-90-qa.spec.ts` "AC1/AC6" (real downloads: `.ics`/`.json`/`.txt` from two schedules) + "AC2" (`.png`); unit `exports.test.ts` filename-convention block | PASS |
| AC2 | Per-week `.png` keeps week slug AND view suffix (list/calendar never collide) | `e2e/issue-90-qa.spec.ts` "AC2" — renamed schedule, 2 weeks x 2 views = 4 distinct names; unit `weekPngFileName` suite | PASS |
| AC3 | Cycle year derived from `ICS_FILE_NAME`, no hardcoded `2027` | Unit: `EXPORT_BASE_NAME` derivation test; `issue-37-qa.spec.ts` asserts `schedule-1-ap-exams-${CYCLE_YEAR}.ics`; new spec derives year from `apData.cycle` | PASS |
| AC4 | Slugification is one exported, unit-tested pure function | `scheduleNameSlug` in `src/lib/exports.ts:84` — single definition, all call sites route through `scheduleExportBaseName` | PASS |
| AC5 | Unit tests: reserved chars, empty-slug fallback, device names, dots/spaces, non-ASCII, 60-char cap | `src/lib/exports.test.ts:93-173` (`scheduleNameSlug` suite) — all present, all green | PASS |
| AC6 | Same format, two schedules → two different filenames | e2e "AC1/AC6": `schedule-1-ap-exams-2027.ics` vs `ambitious-draft-ap-exams-2027.ics` (+ json/txt), driven through the real create/rename UI | PASS |
| AC7 | `exports.test.ts` convention block re-pinned, coverage kept | `exports.test.ts:58-91` asserts the NEW convention incl. the old stem-derivation check | PASS |
| AC8 | `ICS_FILE_NAME` untouched for other consumers | `ics.test.ts:661` still pins `ap-exams-2027.ics`; only consumers are `exports.ts` (stem) + tests | PASS |

Constraint checks (issue Notes):
- `src/lib/ics.ts` diff vs main: zero bytes (`git diff origin/main...HEAD -- src/lib/ics.ts` → empty). Filename changed at the `ExportButton` call site only; stale "same filename" doc lines rewritten.
- Contents untouched: e2e "edge — Windows-reserved characters" asserts the `.json` envelope still carries the verbatim user-typed name (`plan: "final"?`) while the filename is slugged.
- Module-doc convention (`exports.ts:18-30`) rewritten to describe the new naming — no longer states the old spec.

## Slug hardening observed end-to-end (not just unit)

| Schedule name (typed in the real rename UI) | Downloaded filename |
|---|---|
| `Schedule 1` | `schedule-1-ap-exams-2027.{ics,json,txt}` |
| `Ambitious Draft` | `ambitious-draft-ap-exams-2027.{ics,json,txt}` |
| `My Plan` | `my-plan-ap-exams-2027-week-{1,2}-{list,calendar}.png` |
| `plan: "final"?` | `plan-final-ap-exams-2027.json` (content keeps the verbatim name) |
| `???` | `ap-exams-2027.ics` (bare-stem fallback, no leading dash) |

## Commands run (all green)

```
pnpm test:unit                                  261/261 passed (19 files)
pnpm lint                                       0 errors (4 pre-existing warnings, identical on main)
pnpm build                                      passed
pnpm exec playwright test e2e/issue-90-qa.spec.ts                    5/5 passed
pnpm exec playwright test e2e/issue-7-export-ics.spec.ts \
  e2e/issue-37-qa.spec.ts e2e/issue-51-qa.spec.ts \
  e2e/issue-56-qa.spec.ts e2e/issue-56-png-cards.spec.ts             69/69 passed
```

No other e2e spec pins the old `ap-exams-2027.*` filenames (grepped: only the five updated specs reference export filenames, all on the new convention).

## Artifacts

- `desktop.png` — 1920x1080: two-schedule sidebar, "Ambitious Draft" active with its own selection (the AC6 state).
- `mobile.png` — 375x667: renamed schedule, export menu open.
