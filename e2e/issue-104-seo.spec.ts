import { test, expect, type Page } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { CYCLE } from "../src/data/cycle";
import { SUBJECTS, subjectPath } from "../src/lib/seo-subjects";
import {
  SITE_DESCRIPTION,
  SITE_HOST,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  siteJsonLd,
} from "../src/lib/site";

/**
 * Issue #104 — SEO surface: canonical + metadataBase, Open Graph / Twitter
 * cards, robots.txt, sitemap.xml, and WebApplication JSON-LD.
 *
 * Lighthouse is not in this toolchain, so these assertions ARE the
 * verification contract for the card. They deliberately check the *rendered*
 * output (head tags, HTTP responses) rather than the metadata object, because
 * the thing that breaks in practice is Next's resolution step — a missing
 * `metadataBase` silently emits relative `og:image` URLs that no crawler can
 * follow, and the object looks perfectly fine either way.
 *
 * Two structural assertions guard the card's real invariant — that the SEO
 * layer has exactly one source of truth for the origin and exactly one for the
 * cycle label. Without them the tags can all pass today and drift apart on the
 * next domain change or dataset swap.
 */

const REPO_ROOT = resolve(__dirname, "..");
const SITE_MODULE = "src/lib/site.ts";

/** Source files that make up the SEO surface (spot-checked for stale copy). */
const SEO_SOURCES = [
  SITE_MODULE,
  "src/app/layout.tsx",
  "src/app/robots.ts",
  "src/app/sitemap.ts",
];

async function metaContent(page: Page, selector: string): Promise<string> {
  const el = page.locator(`head > ${selector}`);
  await expect(el, `expected exactly one ${selector}`).toHaveCount(1);
  return (await el.getAttribute("content")) ?? "";
}

/** Every file under `src/`, repo-relative with forward slashes. */
function srcFiles(dir = resolve(REPO_ROOT, "src")): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    return statSync(full).isDirectory()
      ? srcFiles(full)
      : [relative(REPO_ROOT, full).split(sep).join("/")];
  });
}

test.describe("issue #104 — SEO metadata", () => {
  test("AC1: head carries canonical, Open Graph, and Twitter card tags", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(SITE_TITLE);
    expect(await metaContent(page, 'meta[name="description"]')).toBe(
      SITE_DESCRIPTION,
    );

    const canonical = page.locator('head > link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    expect(await canonical.getAttribute("href")).toBe(SITE_URL);

    expect(await metaContent(page, 'meta[property="og:title"]')).toBe(
      SITE_TITLE,
    );
    expect(await metaContent(page, 'meta[property="og:description"]')).toBe(
      SITE_DESCRIPTION,
    );
    expect(await metaContent(page, 'meta[property="og:url"]')).toBe(SITE_URL);
    expect(await metaContent(page, 'meta[property="og:site_name"]')).toBe(
      SITE_NAME,
    );
    expect(await metaContent(page, 'meta[property="og:type"]')).toBe("website");

    // Absolute — the whole point of metadataBase. A relative og:image is the
    // classic silent failure: it renders in the HTML but every crawler drops
    // the preview card.
    //
    // The origin is asserted as a set, not a constant, because Next resolves
    // the `opengraph-image` file convention against the *dev* origin while
    // `next dev` is running (so the local preview actually loads) and against
    // `metadataBase` in a production build. The canonical and og:url
    // assertions above already prove metadataBase is wired: those carry the
    // production origin in both modes.
    const ogImage = await metaContent(page, 'meta[property="og:image"]');
    const ogImageUrl = new URL(ogImage);
    expect(ogImageUrl.pathname).toBe("/opengraph-image.png");
    expect([SITE_URL, new URL(baseURL ?? "").origin]).toContain(
      ogImageUrl.origin,
    );

    expect(await metaContent(page, 'meta[name="twitter:card"]')).toBe(
      "summary_large_image",
    );
  });

  test("AC1: the cycle label in the SEO copy comes from the dataset accessor", async () => {
    // The copy must name the cycle...
    expect(SITE_TITLE).toContain(CYCLE);
    expect(SITE_DESCRIPTION).toContain(CYCLE);

    // ...and no SEO source file may spell it out. `src/lib/site.ts` builds
    // both strings from `CYCLE`, so an annual dataset swap re-labels the
    // title, description, cards, and JSON-LD with no edit to any of these.
    for (const file of SEO_SOURCES) {
      const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
      expect(source, `${file} hand-writes the cycle label "${CYCLE}"`).not.toContain(
        CYCLE,
      );
    }
  });

  test("AC2: /robots.txt allows every agent and points at the sitemap", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");

    const body = await res.text();
    expect(body).toMatch(/^user-agent:\s*\*\s*$/im);
    expect(body).toMatch(/^allow:\s*\/\s*$/im);
    expect(body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(body).not.toMatch(/^disallow:\s*\/\s*$/im);
  });

  test("AC3: /sitemap.xml lists the root plus every subject page", async ({
    request,
  }) => {
    // Originally "exactly the root URL"; issue #116 added one page per
    // dataset subject, derived from the same SUBJECTS/subjectPath iteration
    // the route and the footer index use — so this assertion still pins the
    // sitemap to the full set of real routes and nothing else.
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("xml");

    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    expect(locs).toEqual([
      SITE_URL,
      ...SUBJECTS.map((subject) => `${SITE_URL}${subjectPath(subject.id)}`),
    ]);
  });

  test("AC4: the og:image resolves as a 1200x630 image", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const ogImage = await metaContent(page, 'meta[property="og:image"]');

    // The tag is absolute on the production origin, which is not what this
    // suite is running against — replay just the path (+ Next's cache-busting
    // query) on the local server. Nothing here reaches the public internet.
    const { pathname, search } = new URL(ogImage);
    const res = await request.get(`${pathname}${search}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\//);

    // PNG header: width and height are big-endian uint32 at byte 16 and 20.
    const png = readFileSync(resolve(REPO_ROOT, "src/app/opengraph-image.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  test("AC5: exactly one WebApplication JSON-LD block, matching the canonical", async ({
    page,
  }) => {
    await page.goto("/");

    // Originally the page's ONLY ld+json script; issue #116 added the FAQPage
    // block beside it, so the invariant is now "exactly one WebApplication
    // among the blocks" — the FAQ block has its own contract in
    // e2e/issue-116-seo-followup.spec.ts.
    const scripts = page.locator('script[type="application/ld+json"]');
    const blocks = (await scripts.allTextContents()).map(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
    );
    const webApplications = blocks.filter(
      (block) => block["@type"] === "WebApplication",
    );
    expect(webApplications).toHaveLength(1);
    const jsonLd = webApplications[0];
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebApplication");
    expect(jsonLd.name).toBe(SITE_NAME);
    expect(jsonLd.applicationCategory).toBe("EducationalApplication");
    expect(jsonLd.description).toBe(SITE_DESCRIPTION);

    const canonicalHref = await page
      .locator('head > link[rel="canonical"]')
      .getAttribute("href");
    expect(jsonLd.url).toBe(canonicalHref);

    // The rendered block is the module's object, not a hand-maintained copy.
    expect(jsonLd).toEqual(siteJsonLd());
  });

  test("AC5: the JSON-LD states no date, deadline, or pass rate", async () => {
    // PRD §7.5/§8/§11 governs structured data too: a search engine must not be
    // able to quote this app on a date College Board has not published. The
    // only cycle reference allowed is the dataset-derived label inside the
    // description, so it is removed before the scan.
    const scanned = JSON.stringify(siteJsonLd()).split(CYCLE).join("");

    expect(scanned, "ISO date in JSON-LD").not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(scanned, "calendar year in JSON-LD").not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(scanned, "percentage in JSON-LD").not.toMatch(/\d\s*%/);
    expect(
      Object.keys(siteJsonLd()).filter((key) =>
        /date|deadline|rate|score/i.test(key),
      ),
      "date/deadline/rate-shaped key in JSON-LD",
    ).toEqual([]);
  });

  test("AC6: the production origin is written in exactly one source file", async () => {
    // Matched on the bare host so both `https://…` (canonical, sitemap,
    // JSON-LD) and the scheme-less export-card footer are caught. Before this
    // card there were two copies; the assertion is what keeps it at one.
    const carriers = srcFiles().filter((file) =>
      readFileSync(resolve(REPO_ROOT, file), "utf8").includes(SITE_HOST),
    );
    expect(carriers).toEqual([SITE_MODULE]);
  });

  test("AC7: the page still has exactly one h1, and JSON-LD renders zero pixels", async ({
    page,
  }) => {
    await page.goto("/");

    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(SITE_NAME);

    // JSON-LD blocks are scripts: present in the DOM, zero pixels on screen.
    // Two since issue #116 (WebApplication + FAQPage), checked individually —
    // a multi-match locator would trip Playwright's strict mode.
    const ld = page.locator('script[type="application/ld+json"]');
    const count = await ld.count();
    expect(count).toBe(2);
    for (let i = 0; i < count; i++) {
      const script = ld.nth(i);
      await expect(script).toBeHidden();
      expect(
        await script.evaluate((el) => (el as HTMLElement).offsetHeight),
      ).toBe(0);
    }
  });
});
