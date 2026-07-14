# QA report — issue #33 · v1

**Card:** Refresh README with final feature set and current screenshots
**Branch:** `issue-33-refresh-readme` · **PR:** #65
**Lane:** Tester (QA) · **Result:** PASS (all 6 ACs)
**Deliverable under test:** `README.md` + `docs/screenshots/*` (documentation only — no app source changed; the issue-33 commit touches only `README.md`, 6 screenshots, and `scripts/capture-screenshots.mjs`).

This card is documentation. Every AC was verified by reading the merged code the README describes, rendering-linting the markdown, viewing each committed screenshot against its alt text, and health-checking the live link. Raw transcript: `verify.log`.

## Per-AC results

| AC | Verdict | How verified |
|----|---------|--------------|
| AC1 — feature overview matches merged code | PASS | Category groups in README (STEM, Humanities, Languages, Arts, Career Kickstart) == dataset `category` set exactly. 42-subject catalog == `ap-2026.json` (42 subjects). Three-tier per-course details; List+Calendar with Calendar default confirmed at `src/components/ScheduleViews.tsx:47` (`useState<ViewMode>("calendar")`). Duration-proportional blocks + labeled +30-min buffer confirmed at `src/lib/calendar.ts:45` (`SETUP_BUFFER_MINUTES = 30`). Conflict + late-testing + calendar round-trip, multiple client-side schedules (`apx.schedules.v1`), Resources sidebar, per-subject emoji (`src/lib/subject-emoji.ts`), PNG/ICS/JSON/TXT exporters (`export-png*.ts`, `ics.ts`, `exports.ts`), dark mode (`ThemeToggle.tsx`), responsive/a11y — all present in merged code. No described feature is unmerged. |
| AC2 — fresh screenshots, stale replaced, committed, sized, alt text | PASS | 6 screenshots on branch, all resolve (home-desktop 196K, subject-details 220K, calendar 88K, conflict 140K, sidebar 128K, home-mobile 92K; ~864K total). Each viewed and matches the current build + its alt text (home shows "9 selected"; calendar shows hatched +30-min buffers and April 30 deadlines; details shows AP Biology 71% pass rate / hybrid delivery; conflict shows Chemistry vs Human Geography May 5 AM). Stale `schedule.png` deleted; `home-desktop`/`home-mobile` replaced (1MB->92K). Every image has 160-236-char descriptive alt text. |
| AC3 — live app linked prominently | PASS | `https://apexamplanner.vercel.app` on line 10 (first screen, bold "Try it live"). Health check -> HTTP 200. |
| AC4 — #9 essentials survive | PASS | CB data attribution (footer + intro), non-affiliation section, annual dataset-swap note naming the `"pending"` literal, current cycle May 2026 read from the dataset (`ap-2026.json.cycle == "May 2026"`; 19 `"pending"` values present). |
| AC5 — quick-start + architecture, no invented roadmap/CI | PASS | Quickstart commands (`pnpm dev/build/lint/test:data/test:unit/test:e2e`) match `package.json` scripts exactly. Architecture note describes static Next.js App Router, client-side `localStorage` persistence, and the `src/data/ap-2026.json` swap point. No badges, shields.io, CI claims, or roadmap. |
| AC6 — markdown lints clean, renders on GitHub | PASS | `markdownlint-cli2 README.md` -> 0 errors. Heading hierarchy clean (single H1 -> H2 sections -> H3 feature subsections). All 6 image paths valid on the branch. |

## Notes
- Per the issue constraint, the README's own screenshots were NOT copied into `docs/super-board/runs/` — they are the deliverable and are cited in the QA comment via their on-branch raw URLs.
- Local main was stale relative to the branch parent (`cb8eba2`, PR #63); a `main...HEAD` diff over-reports files, but the issue-33 commit (`53c60b9`) itself changes only README + screenshots + capture script.
