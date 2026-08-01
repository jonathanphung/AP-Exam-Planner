// QA evidence capture for issue #104 — screenshots of the PRODUCTION build
// (`next build` + `next start`) at the three super-board viewports, proving the
// SEO card changed no on-screen pixel (AC7).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.QA_BASE ?? "http://localhost:3413";
const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
];

const browser = await chromium.launch();
const notes = [];

for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
  });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const facts = await page.evaluate(() => {
    const ld = document.querySelectorAll('script[type="application/ld+json"]');
    const h1s = [...document.querySelectorAll("h1")];
    const de = document.documentElement;
    return {
      title: document.title,
      h1Count: h1s.length,
      h1Text: h1s.map((h) => h.textContent?.trim()),
      ldCount: ld.length,
      ldOffsetHeight: ld[0] ? ld[0].offsetHeight : null,
      ldOffsetWidth: ld[0] ? ld[0].offsetWidth : null,
      ldDisplay: ld[0] ? getComputedStyle(ld[0]).display : null,
      bodyChildTags: [...document.body.children].map((n) =>
        n.tagName.toLowerCase(),
      ),
      horizontalOverflow: de.scrollWidth > de.clientWidth,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      canonical:
        document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
        null,
    };
  });

  await page.screenshot({
    path: resolve(OUT, `${vp.name}.png`),
    fullPage: false,
  });

  notes.push({ viewport: `${vp.name} ${vp.width}x${vp.height}`, ...facts, consoleErrors });
  await page.close();
}

await browser.close();
writeFileSync(resolve(OUT, "viewport-facts.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
