# AP Exam Planner

A public, no-login, client-side web app that helps AP students plan their **May 2026** exam schedule: official exam dates and AM/PM sessions, digital-portfolio deadlines, same-slot conflict detection with late-testing resolution, per-subject format and pass-rate info, and an ICS calendar export.

All data ships bundled with the app — there is no backend, no login, and no runtime network access.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + React + TypeScript (strict mode)
- [Tailwind CSS](https://tailwindcss.com/)
- [Playwright](https://playwright.dev/) for end-to-end tests
- Managed with [pnpm](https://pnpm.io/)

## Local development

```bash
pnpm install     # install dependencies
pnpm dev         # start the dev server at http://localhost:3000
pnpm build       # production build
pnpm test:e2e    # run the Playwright end-to-end suite
```
