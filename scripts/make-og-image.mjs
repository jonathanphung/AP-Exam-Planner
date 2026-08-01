// Compose the 1200×630 social preview card at src/app/opengraph-image.png.
//
//   node scripts/make-og-image.mjs
//
// The output is committed — Next's `opengraph-image` file convention wants a
// static asset, and rendering it at request time would be a runtime cost for a
// file that only changes when the branding does. This script exists so the
// asset is reproducible instead of a mystery binary: re-run it after a design
// change and commit the result.
//
// Two deliberate constraints (issue #104):
//
//  1. **No cycle label, no dates.** The card is a committed binary, so any
//     "May 2027" baked into its pixels would survive the annual dataset swap
//     and start lying. The cycle lives in the *text* metadata (og:title /
//     og:description), which reads it from `src/data/cycle.ts` and re-labels
//     itself for free. The PRD data rule (§7.5/§8/§11) applies to the preview
//     card too: it may show what the app is, never what College Board has
//     scheduled.
//  2. **The screenshot crop is the catalog only.** `home-desktop.png` is a
//     full-window capture whose sidebar prints exam-calendar links with a
//     cycle label in them; the crop window below starts to the right of that
//     sidebar, so only subject chips — which carry no dates — make it in.
//
// Uses the Playwright chromium that already ships as a devDependency: no new
// image library, no new dependency (issue #104 "do not add new dependencies").

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SHOT = resolve(ROOT, "docs/screenshots/home-desktop.png");
const OUT = resolve(ROOT, "src/app/opengraph-image.png");

/** Open Graph's recommended card size, and what the spec asserts. */
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Crop window into `home-desktop.png` (a 1440×1000 capture): the catalog
 * column, starting right of the sidebar. See constraint 2 above.
 *
 * `y` starts at the category filter row rather than the top of the window —
 * the search row above it ends with a "9 selected" counter that the card's
 * right-edge bleed would slice mid-word.
 */
const CROP = { x: 456, y: 112, scale: 0.69 };

const shot = `data:image/png;base64,${readFileSync(SOURCE_SHOT).toString("base64")}`;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
      body {
        position: relative;
        font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(1000px 520px at -8% -18%, #dbeafe 0%, rgba(219,234,254,0) 62%),
          linear-gradient(160deg, #ffffff 0%, #f1f5f9 100%);
        color: #0f172a;
        -webkit-font-smoothing: antialiased;
      }

      /* Left column: brand + one-line promise + what it actually does. */
      .copy { position: absolute; left: 76px; top: 108px; width: 500px; }
      .mark {
        display: flex; align-items: center; gap: 16px; margin-bottom: 30px;
      }
      .tile {
        width: 60px; height: 60px; border-radius: 16px; background: #2563eb;
        color: #fff; font-size: 25px; font-weight: 700; letter-spacing: 0.02em;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 24px rgba(37, 99, 235, 0.32);
      }
      .kicker {
        font-size: 19px; font-weight: 600; letter-spacing: 0.14em;
        text-transform: uppercase; color: #2563eb;
      }
      h1 {
        font-size: 62px; line-height: 1.04; font-weight: 700;
        letter-spacing: -0.025em; margin-bottom: 22px;
      }
      p {
        font-size: 25px; line-height: 1.4; color: #475569; margin-bottom: 34px;
      }
      ul { list-style: none; display: flex; flex-direction: column; gap: 14px; }
      li {
        display: flex; align-items: center; gap: 13px;
        font-size: 21px; font-weight: 500; color: #334155;
      }
      li span {
        width: 9px; height: 9px; border-radius: 999px; background: #2563eb;
        flex: none;
      }

      /* Right column: the app itself, bleeding off the right/bottom edges. */
      .shot {
        position: absolute; left: 626px; top: 92px;
        width: 632px; height: 566px; overflow: hidden;
        border-radius: 22px; border: 1px solid #cbd5e1; background: #fff;
        box-shadow: 0 34px 70px rgba(15, 23, 42, 0.20);
      }
      .shot img {
        position: absolute;
        width: ${1440 * CROP.scale}px;
        left: ${-CROP.x * CROP.scale}px;
        top: ${-CROP.y * CROP.scale}px;
      }
    </style>
  </head>
  <body>
    <div class="copy">
      <div class="mark">
        <div class="tile">AP</div>
        <div class="kicker">Exam planner</div>
      </div>
      <h1>Plan your AP exams</h1>
      <p>Pick your courses, see the official schedule, catch the clashes.</p>
      <ul>
        <li><span></span>Official College&nbsp;Board dates and sessions</li>
        <li><span></span>Same-slot conflict detection</li>
        <li><span></span>Calendar export — free, no account</li>
      </ul>
    </div>
    <div class="shot"><img src="${shot}" /></div>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
writeFileSync(OUT, await page.screenshot({ type: "png" }));
await browser.close();

console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT})`);
