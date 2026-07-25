# PROJECT.md — AP Exam Planner

Context file for super-board lane agents. Read this before touching any card. The full product spec is `docs/PRD.md` — it is the source of truth for scope; this file is the source of truth for conventions.

## What this app is

A public, no-login, client-side web app for AP students. The student picks the AP exams they're taking from the full subject catalog and gets: official May 2027 exam dates and AM/PM sessions, digital-portfolio deadlines (for the handful of subjects that have them), same-slot conflict detection with late-testing resolution, per-subject format and pass-rate info, and an ICS calendar export. Portfolio project — no branding, no lead capture, no backend.

## Stack and layout

- Next.js (App Router) + React + TypeScript (strict) + Tailwind CSS, managed with **pnpm**.
- Static site behavior: all data ships as bundled JSON; **no network calls at runtime**, no database, no API routes.
- Layout:
  - `src/app/` — routes and layout (single-page app: catalog + schedule on one screen is fine).
  - `src/components/` — UI components.
  - `src/lib/` — pure logic: selection store, conflict detection, ICS generation. Keep logic out of components so it's unit-testable.
  - `src/data/` — `ap-2027.json` (the one swappable data file), `schema.ts` (zod + the `REGULAR_WINDOWS` / `LATE_TESTING_WINDOW` constants), `cycle.ts` (the single accessor for the cycle label — never hand-write "May 2027" in a component), `sources.md` (citation URLs).
  - `e2e/` — Playwright specs. QA lane appends here; one spec file per issue (`e2e/issue-<N>-*.spec.ts`).
- Playwright is configured with `webServer` so `pnpm test:e2e` boots the app itself. Standard viewports for evidence: 1920×1080, 1024×768, 375×667.
- **Evidence screenshots (issue #71):** specs never hardcode `docs/super-board/runs/…` — they call `evidenceDir("<slug>")` from `e2e/support/evidence.ts`. A default `pnpm test:e2e` writes to gitignored `test-results/evidence/<slug>/`, so a full run can never rewrite the committed PNGs that older issue/PR comments embed by raw URL. To capture committed evidence for your card, point one spec at your folder: `QA_EVIDENCE_DIR=docs/super-board/runs/issue-<N>-qa-v1 pnpm exec playwright test e2e/issue-<N>-*.spec.ts`. No lane needs `git checkout -- docs/super-board/runs/` any more.

## Commands

- `pnpm dev` — dev server
- `pnpm build` — production build (must stay green on every card)
- `pnpm test:e2e` — full Playwright suite
- `pnpm test:data` — dataset schema validation

## Conventions

- Client state only. Selection lives in localStorage key `apx.selection.v1` (array of subject ids); conflict resolutions in `apx.resolutions.v1`. Version-suffix any new keys.
- Mobile-first. No horizontal scroll at 375 px. Keyboard operable; visible focus states; conflict warnings must meet WCAG AA contrast.
- Dates/times: exam dates are calendar dates with an `"AM" | "PM"` session — never invent clock times except where the official session start times are used (ICS export). Treat times as local ("floating"), not UTC.
- Keep components dumb; `src/lib/` functions pure and unit-tested where cheap.

## The data rule (hard requirement, from PRD §7.5/§8/§11)

- **Never invent or estimate dates, deadlines, or pass rates.** Every value in `src/data/ap-2027.json` must come from College Board's published pages (AP calendar, late-testing calendar, score distribution report). Anything not yet verifiable is the literal string `"pending"`.
- All dates reflect the **May 2027 cycle** (regular testing May 3–7 and May 10–14; late testing May 17–21 — `REGULAR_WINDOWS` / `LATE_TESTING_WINDOW` in `schema.ts`). The rule is about the *next* cycle, not a fixed year: whichever calendar College Board has not published yet must never be projected. The JSON file is the single swap point when it is.
- Known anchors (verified 2026-07-24 against College Board; provenance in `src/data/sources.md`): AP Seminar / AP Research / AP CSP portfolio deadline = **2027-04-30**; AP Art & Design portfolio submission = **2027-05-07**, 11:59 p.m. ET. Six world-language courses also carry a published Personalized Project Reference deadline — per-subject, only where the course page prints it. Portfolio deadlines get equal visual weight to exam dates, and the UI notes that schools often set earlier internal deadlines.

## Definition of done (per card and overall)

- Each card's acceptance criteria are the completion contract — do not edit checkboxes to fake completion.
- `pnpm build` and the accumulated `pnpm test:e2e` suite stay green on every branch handed to Review.
- v1 success: a student can select subjects, see their grouped schedule with portfolio deadlines, resolve conflicts to real late-testing slots, read format/pass-rate info, and download an ICS that opens in Google/Apple/Outlook calendars.
