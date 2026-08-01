# super-board QA — issue #104 (v1)

**Card:** #104 — SEO: metadataBase + canonical, Open Graph / Twitter cards, `robots.ts`, `sitemap.ts`, and `WebApplication` JSON-LD
**PR:** #106 · **Branch:** `issue-104-seo-metadata` · **Builder commit under test:** `becbdd1`
**Verdict: PASS** — 8/8 acceptance criteria verified, QA → Review.

## How this was verified

Every acceptance criterion on this card describes the **production build**, and the Playwright
suite runs against `next dev` (`playwright.config.ts` → `webServer: pnpm dev`). Dev and prod
resolve the `opengraph-image` file convention against different origins, so a dev-only pass
would have left the card's headline claim unverified. QA therefore ran the tag/route checks
twice:

1. **Real production build** — `pnpm build && PORT=3413 pnpm start`, then `curl` against the
   served output. This is the authoritative evidence below (`prod-head-tags.txt`,
   `http-probes.log`, `prod-index.html`, `static-checks.log`).
2. **The committed spec suite** — `pnpm test:e2e`, which is what Review re-runs.

The Vercel preview deployment on the PR could not serve as a third source: it sits behind
Vercel deployment protection and answers `302` + `X-Robots-Tag: noindex` to an unauthenticated
fetch (`vercel-preview-probe.log`). No credentials were requested; the local production build
covers the same ground.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC1 — canonical + `og:title`/`description`/`url`/`site_name`/`type`/`image` (absolute) + `twitter:card=summary_large_image`; cycle label from `CYCLE`, no hand-written cycle string in `src/` | PASS | `prod-head-tags.txt` (all tags present in the served production HTML); `static-checks.log`; spec AC1 ×2 |
| AC2 — `/robots.txt` 200, allows all agents, absolute `Sitemap:` line | PASS | `http-probes.log`: `200 text/plain`, `User-Agent: *` / `Allow: /` / `Sitemap: https://apexamplanner.vercel.app/sitemap.xml`; `robots.txt` |
| AC3 — `/sitemap.xml` 200, exactly the root URL on the production origin | PASS | `http-probes.log`: `200 application/xml`, one `<loc>https://apexamplanner.vercel.app</loc>`; `sitemap.xml` |
| AC4 — `og:image` resolves 200 with an image content-type; source asset is 1200×630 | PASS | `http-probes.log`: `200 image/png`, 263,178 bytes; `static-checks.log`: PNG header reports `1200x630`, valid signature |
| AC5 — exactly one `application/ld+json`, parses, `@type: WebApplication`, `url` == canonical, no date/deadline/pass-rate | PASS | `static-checks.log`: 1 block; `url == canonical` → `True`; scan (with the dataset-derived cycle label removed) finds no ISO date, no calendar year, no percentage, and no date/rate-shaped key |
| AC6 — the origin lives in one file and is the single source for all four surfaces | PASS | `static-checks.log`: only `src/lib/site.ts` under `src/` contains the host (repo-wide, only `README.md` prose besides it); `export-card-theme.ts` now derives `DEFAULT_FOOTER_URL` from `SITE_HOST` |
| AC7 — one `<h1>`, no new visible UI, theme script + `suppressHydrationWarning` untouched | PASS | `layout-diff.txt` (the additions are metadata + one `<script>`; the pre-paint script and `suppressHydrationWarning` lines are unchanged context); `viewport-facts.json`: `h1Count: 1`, JSON-LD `display: none` / `offsetHeight: 0`, no horizontal overflow at any viewport; `desktop.png` / `tablet.png` / `mobile.png` |
| AC8 — new e2e spec asserts the above; `pnpm build`, `pnpm lint`, and the full `pnpm test:e2e` suite stay green | PASS | `build.log` (7/7 static routes), `lint.log` (0 errors, 4 pre-existing warnings), `e2e-full.log`, `vitest.log` |

## QA-authored coverage added this lane

`e2e/issue-104-qa.spec.ts` — four assertions the Builder's AC spec does not make. Each one
guards a surface that could regress with the entire existing suite still green:

| Test | Gap it closes |
|---|---|
| QA1 — `og:image:alt` renders the sidecar text verbatim | Scope item 3 requires alt text via the `opengraph-image.alt.txt` sidecar. Nothing asserted the tag; deleting the sidecar drops it silently and the preview card ships unlabelled to screen-reader users. |
| QA2 — `twitter:image` is absolute and equals `og:image` | `summary_large_image` without an image renders as the bare link this card exists to fix. Nothing asserted that Next's derivation actually happened. |
| QA3 — the PNG-export footer wordmark stays a bare host | This card replaced `DEFAULT_FOOTER_URL`'s literal with `SITE_HOST`, so every exported card's footer is now derived from `SITE_URL`. A `SITE_URL` that grew a trailing slash or a path would print `apexamplanner.vercel.app/` into user-facing images — a surface no SEO test looks at. |
| QA4 — canonical, `og:url`, sitemap `<loc>`, and JSON-LD `url` are one byte-identical string | The AC spec checks each surface against the constant separately, so a "normalise to a trailing slash" change to one of them could be made to pass individually while splitting the site into two URLs a crawler has to reconcile. |

## Test results

```
pnpm build      PASS  7/7 routes prerendered static, incl. /robots.txt, /sitemap.xml, /opengraph-image.png
pnpm lint       PASS  0 errors, 4 warnings (all pre-existing, in untouched files)
pnpm test:unit  PASS  294 tests, 20 files
pnpm test:data  PASS  110 tests, 7 files
pnpm test:e2e   PASS  733 tests (729 accumulated + 4 new QA tests), no retries, no flakes
```

The build output confirms the Notes/Constraints claim on the card: `robots.txt`, `sitemap.xml`,
and `opengraph-image.png` are all reported as static/prerendered at build time, so they add no
runtime request and do not violate PROJECT.md's "no network calls at runtime / no API routes"
rule, which governs the client app's data path.

## Notes for Review (not defects)

- **Two 404s on the local production build** — `/_vercel/speed-insights/script.js` and
  `/_vercel/insights/script.js`. Pre-existing and environmental: `@vercel/analytics` and
  `@vercel/speed-insights` were already mounted in `layout.tsx` on `main`, and those scripts are
  injected by the Vercel edge, so they only exist on a Vercel deployment. Not introduced by this
  card; no other request fails.
- **`README.md` also spells out the host.** AC6 scopes the de-dup to `src/`, and the README
  occurrence is prose in the quickstart, not a value anything reads. Left alone.
- **The OG card carries no cycle label and no date**, verified by eye against the committed
  binary: the crop starts to the right of the sidebar (whose links do print a cycle label), so
  only subject chips make it in, and the headline copy is timeless. `scripts/make-og-image.mjs`
  reproduces it with the already-installed Playwright chromium — no new dependency, no network.
- **`docs/screenshots/home-desktop.png` is stale** (its sidebar still shows a `May 2026` label).
  The Builder already flagged it; the OG crop excludes that region, so it does not affect this
  card. Worth its own ticket.

## Files in this evidence folder

| File | What it is |
|---|---|
| `prod-head-tags.txt` | The SEO tags + JSON-LD block extracted from the served production HTML |
| `prod-index.html` | Full production HTML the tags were extracted from |
| `http-probes.log` | `curl` status/headers/bodies for `/robots.txt`, `/sitemap.xml`, `/opengraph-image.png` |
| `robots.txt`, `sitemap.xml` | The served bodies, verbatim |
| `static-checks.log` | JSON-LD parse + data-rule scan, `<h1>` count, PNG dimensions, origin de-dup sweep |
| `layout-diff.txt` | `git diff main...HEAD -- src/app/layout.tsx` (AC7) |
| `viewport-facts.json` | Per-viewport DOM facts from the production build (h1 count, JSON-LD box size, overflow) |
| `desktop.png`, `tablet.png`, `mobile.png` | Production-build screenshots at 1920×1080 / 1024×768 / 375×667 |
| `capture.mjs` | The script that produced the three screenshots + `viewport-facts.json` |
| `build.log`, `lint.log`, `vitest.log`, `e2e-issue-104.log`, `e2e-full.log` | Raw command output |
| `vercel-preview-probe.log` | Why the Vercel preview deployment could not serve as evidence |
