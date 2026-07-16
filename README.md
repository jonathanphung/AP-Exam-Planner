# AP Exam Planner

A public, no-login web app that helps AP students plan their **May 2026** exam season. Pick your subjects from the full College Board catalog and the app builds a dated schedule: exam days and AM/PM sessions, portfolio deadlines, same-slot conflict detection that resolves to official late-testing dates, per-subject format and pass-rate details, a week-by-week calendar, and exports for Google, Apple, or Outlook calendars.

**▶ Try it live: <https://apexamplanner.vercel.app>**

![The AP Exam Planner: the My Schedules switcher and official Resources links in a left sidebar, beside the category-grouped subject catalog with nine subjects selected](docs/screenshots/home-desktop.png)

Everything runs client-side. The AP dataset ships bundled with the app, so there's no backend, no account, and no network calls at runtime. Your schedules are kept in `localStorage` and survive a reload without ever leaving your browser.

Why it exists: College Board publishes exam dates, late-testing dates, portfolio deadlines, and score distributions across several different pages. A student sitting five or six exams has to cross-reference all of them by hand to check for collisions, portfolio due dates, or scoring format. This app pulls those facts into one place and does the collision math for you. It's a portfolio piece: no branding, no lead capture, no tracking. Every value is sourced from College Board's published pages rather than estimated (see [`src/data/sources.md`](src/data/sources.md)).

## Features

### Category-grouped catalog with per-course details

The full 42-subject AP catalog is grouped into labeled sections (STEM, Humanities, Languages, Arts, and Career Kickstart) with search and a quick-jump nav, each subject carrying a topical emoji. Adding an exam is one tap.

Every course chip expands in place through three tiers of detail:

1. **Timing**: the regular exam date and AM/PM session (with the published session start time), the official late-testing slot, and any portfolio deadline. Career Kickstart subjects with no May 2026 exam show the sourced reason instead of an invented date.
2. **Full exam details**: a dialog with the multiple-choice and free-response section breakdown (question counts, timing, weight), total length, calculator policy, delivery mode (paper / digital / hybrid), and the published "scored 3 or higher" pass rate. Anything College Board hasn't published shows as a muted **pending** badge instead of a guess.
3. **Official College Board page**: a link straight to that subject's exam page on College Board.

![The AP Biology exam details dialog: multiple-choice and free-response section breakdown, exam length, calculator policy, delivery mode, a 71 percent pass rate, and a link to the official College Board page](docs/screenshots/subject-details.png)

### List and Calendar schedule views

Your plan renders two ways from one shared model, switchable from a toolbar: a chronological **List** and a week-paged **Calendar** (the default on load). On the calendar, each exam is a **duration-proportional block** colored by subject category, with a labeled **+30-minute setup buffer** drawn onto the end of every session. Portfolio deadlines and any subject without a placed clock time are listed below the grid rather than pinned to a guessed slot.

![The Calendar view for the first testing week: duration-proportional exam blocks colored by category, each with a hatched plus-thirty-minute setup buffer, a week pager, and April 30 portfolio deadlines listed below the grid](docs/screenshots/calendar-desktop.png)

### Same-slot conflict detection with late-testing resolution

When two selected exams share a date and session, the app flags the collision and offers to move one to its official late-testing slot, then re-checks that the moved exams don't land on top of each other again. The prompt appears in both views. On the calendar you can round-trip a move: send an exam to late testing, switch it back (which re-opens the choice), or swap which exam keeps the regular slot.

![The exam-time conflict prompt: AP Chemistry and AP Human Geography both fall in the May 5 morning slot, with buttons to keep one at the regular time and move the other to its official late-testing date](docs/screenshots/conflict-dialog.png)

### Multiple schedules, saved on your device

Keep several draft plans (a full load, a STEM-only shortlist, a backup) and switch the whole app between them from the **My Schedules** panel; create, rename, and delete are all inline. Each schedule owns its own selection and conflict resolutions, saved under a versioned `localStorage` key. The same panel holds a **Resources** list of verified College Board links (exam dates, late-testing, calculator policy, score distributions, and more), each opening in a new tab.

![The sidebar: a My Schedules switcher listing Full load, STEM focus, and Backup plan with rename and delete controls, above a Resources list of official College Board links grouped under Exam logistics, Scores, and Planning and deadlines](docs/screenshots/sidebar-desktop.png)

### Exports, dark mode, and a responsive, accessible UI

- **Exports**: save your schedule as a designed per-week **list `.png`** or **calendar `.png`**, an **`.ics`** calendar file (opens in Google, Apple, or Outlook), a machine-readable **`.json`** envelope, or a plain-text **`.txt`** itinerary.
- **Dark mode**: a theme toggle in the app panel; the choice is remembered.
- **Responsive and accessible**: one layout from 375px phones to desktop with no horizontal scroll, keyboard-operable controls with visible focus states, and WCAG AA contrast on conflict warnings and status colors.

![The planner on a phone-width screen: the app panel with collapsible My Schedules and Resources disclosures above the search box and the category-grouped catalog](docs/screenshots/home-mobile.png)

## Data and the annual swap

All dates, deadlines, and pass rates reflect the **May 2026 AP exam cycle** and come from College Board's published pages. [`src/data/sources.md`](src/data/sources.md) lists the exact URL behind every field. Anything College Board hasn't published is stored as the literal string `"pending"` and renders as a pending badge rather than a guess.

The dataset lives in a single file, **`src/data/ap-2026.json`**. That's the one swap point for next year: when College Board posts the May 2027 calendar, drop in an `ap-2027.json` and update the testing-window constants in [`src/data/schema.ts`](src/data/schema.ts). No component changes required. The UI reads the cycle label straight from the dataset, so the schedule banner and footer attribution re-label themselves automatically.

## Quickstart

```bash
pnpm install     # install dependencies
pnpm dev         # dev server at http://localhost:3000
pnpm build       # production build
pnpm lint        # eslint
pnpm test:data   # validate the AP dataset against its zod schema
pnpm test:unit   # unit tests for selection / conflict / schedule logic
pnpm test:e2e    # Playwright end-to-end suite (boots the app itself)
```

The README screenshots are generated by a small Playwright script. Regenerate them with a build served locally (or point `BASE_URL` at any running instance):

```bash
pnpm build && pnpm start                       # serves on http://localhost:3000
node scripts/capture-screenshots.mjs           # writes docs/screenshots/*.png
```

## Architecture

A static Next.js (App Router) single-page app: no server, no database, no API routes. The bundled dataset is the only data source, so the whole app is prerendered and served as static files.

- `src/app/`: the route, layout, and global styles.
- `src/components/`: presentational UI (catalog, schedule views, dialogs, sidebar). Components stay dumb.
- `src/lib/`: pure, unit-tested logic (the multi-schedule store, conflict detection, calendar layout, and the ICS / PNG / JSON / text exporters).
- `src/data/`: `ap-2026.json` (the one swappable data file), `schema.ts` (zod validation + testing-window constants), and `sources.md` (citation URLs).

Client state only: schedules persist in `localStorage` under a versioned key, so plans survive a reload but never leave the browser.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + React + TypeScript (strict mode)
- [Tailwind CSS](https://tailwindcss.com/)
- [zod](https://zod.dev/) for dataset validation
- [Playwright](https://playwright.dev/) for end-to-end tests and [Vitest](https://vitest.dev/) for data + logic unit tests
- Managed with [pnpm](https://pnpm.io/)

## Contributing

Contributions are welcome.

1. Fork the repo and clone your fork.
2. Install dependencies with `pnpm install`.
3. Create a branch: `git checkout -b fix/short-description`.
4. Make your change. Keep components dumb and logic in `src/lib/`.
5. Run `pnpm lint`, `pnpm test:data`, `pnpm test:unit`, and `pnpm test:e2e` before opening a PR.
6. Open a pull request describing what changed and why.

Bug reports and feature requests are welcome as GitHub issues. If you spot a sourcing error in the AP dataset, include the College Board URL that supports the correction.

## Not affiliated with College Board

This is an independent student tool. AP and College Board are trademarks of the College Board, which does not endorse and is not involved in this project. Data is drawn from College Board's public AP calendar, late-testing calendar, portfolio-deadline, and score-distribution pages for the May 2026 cycle.
