# QA report — issue #1 (v1)

**Card:** #1 Scaffold Next.js app with Tailwind, TypeScript, and Playwright harness
**PR:** #10 · branch `issue-1-scaffold-nextjs-app` · base `main`
**Lane:** Tester (super-qa, repo-backed first pass)
**Result:** PASS — all 6 acceptance criteria verified
**Environment:** Node v26.4.0, pnpm 10.32.1, Next.js 16.2.10, Playwright 1.61.1

## Per-AC verification

| AC | Criterion | Method | Result |
|----|-----------|--------|--------|
| AC1 | Latest stable Next.js (App Router) + TS strict + Tailwind, pnpm packageManager pinned, boilerplate removed | Inspected package.json (next@16.2.10, packageManager pnpm@10.32.1, tailwindcss@^4), tsconfig.json (strict: true), App Router under src/app/; no public/*.svg, no create-next-app default page content | PASS |
| AC2 | / titled "AP Exam Planner", visible h1, empty main region, zero console errors | e2e/qa-evidence.spec.ts — 3 viewports assert toHaveTitle, visible h1, main empty, 0 console/page errors; screenshots captured | PASS |
| AC3 | pnpm build exits 0 | Ran pnpm build -> exit 0; / prerendered as Static | PASS |
| AC4 | Playwright configured with webServer; e2e/smoke.spec.ts asserts h1 + title, passes headless | Reviewed playwright.config.ts (webServer: pnpm dev); ran pnpm test:e2e -> 4 passed headless | PASS |
| AC5 | pnpm lint exits 0 | Ran pnpm lint -> exit 0, no findings | PASS |
| AC6 | README replaced with description + local commands | Inspected README.md: project description + pnpm dev / pnpm build / pnpm test:e2e | PASS |

## Commands run (exit codes)

    pnpm install --frozen-lockfile   -> 0
    pnpm lint                        -> 0
    pnpm build                       -> 0  (/ Static, prerendered)
    pnpm test:e2e                    -> 0  (4 passed, chromium, headless)

## Evidence

- desktop.png (1920x1080), tablet.png (1024x768), mobile.png (375x667) — / rendering: "AP Exam Planner" header + empty main.
- Test specs: e2e/smoke.spec.ts (Builder), e2e/qa-evidence.spec.ts (Tester, this pass).
- Command logs: lint.log, build.log, e2e.log.

## Reviewer self-verification command

    pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test:e2e
