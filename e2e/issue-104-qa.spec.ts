import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_FOOTER_URL } from "../src/lib/export-card-theme";
import { SITE_HOST, SITE_URL } from "../src/lib/site";

/**
 * Issue #104 — super-board QA lane.
 *
 * `e2e/issue-104-seo.spec.ts` (Builder) already walks the acceptance criteria
 * one assertion at a time. This file does NOT restate them; it closes the four
 * gaps QA found while verifying that spec against a real `next build` +
 * `next start`:
 *
 *  1. **`og:image:alt` is unasserted.** Scope item 3 asks for alt text via the
 *     `opengraph-image.alt.txt` sidecar. Deleting that file drops the tag and
 *     every existing test stays green — the preview card would ship to
 *     screen-reader users as an unlabelled image.
 *  2. **`twitter:image` is unasserted.** `twitter:card: summary_large_image`
 *     without an image renders as a bare link on X — exactly the failure the
 *     card exists to fix. Next derives the tag from the same file convention,
 *     so the assertion is that the derivation happened, not that a second copy
 *     of the asset exists.
 *  3. **The exported PNGs' footer is a new regression channel.** This card
 *     replaced `DEFAULT_FOOTER_URL`'s literal with `SITE_HOST`, so the wordmark
 *     printed into every exported card is now derived from `SITE_URL`. A
 *     `SITE_URL` that ever grows a trailing slash or a path would silently
 *     print `apexamplanner.vercel.app/` into user-facing images — a surface no
 *     SEO test looks at.
 *  4. **The four absolute-URL surfaces are only checked against the constant,
 *     never against each other.** Canonical, `og:url`, the sitemap `<loc>`, and
 *     the JSON-LD `url` are one URL by design; a "fix" that normalises one of
 *     them to a trailing slash splits the site into two URLs a crawler has to
 *     reconcile, and each individual assertion could still be updated to match.
 */

const REPO_ROOT = resolve(__dirname, "..");

async function metaContent(page: Page, selector: string): Promise<string> {
  const el = page.locator(`head > ${selector}`);
  await expect(el, `expected exactly one ${selector}`).toHaveCount(1);
  return (await el.getAttribute("content")) ?? "";
}

test.describe("issue #104 QA — SEO surfaces the AC spec does not pin", () => {
  test("QA1: og:image:alt renders the sidecar text verbatim", async ({
    page,
  }) => {
    await page.goto("/");

    const sidecar = readFileSync(
      resolve(REPO_ROOT, "src/app/opengraph-image.alt.txt"),
      "utf8",
    ).trim();
    expect(sidecar.length, "alt sidecar is empty").toBeGreaterThan(0);

    expect(await metaContent(page, 'meta[property="og:image:alt"]')).toBe(
      sidecar,
    );
  });

  test("QA2: twitter:image points at the same asset as og:image", async ({
    page,
  }) => {
    await page.goto("/");

    const ogImage = await metaContent(page, 'meta[property="og:image"]');
    const twitterImage = await metaContent(page, 'meta[name="twitter:image"]');

    // Absolute, or no crawler can fetch it.
    expect(new URL(twitterImage).protocol).toMatch(/^https?:$/);
    // Same file convention, so the same resolved URL — not a second copy that
    // could drift out of sync with the card.
    expect(twitterImage).toBe(ogImage);
  });

  test("QA3: the PNG-export footer wordmark stays a bare host", async () => {
    // The exported cards print this string; it now derives from SITE_URL.
    expect(DEFAULT_FOOTER_URL).toBe(SITE_HOST);
    expect(DEFAULT_FOOTER_URL, "footer wordmark carries a scheme").not.toMatch(
      /^[a-z]+:\/\//i,
    );
    expect(
      DEFAULT_FOOTER_URL,
      "footer wordmark carries a slash, path, or query",
    ).toMatch(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i);
  });

  test("QA4: canonical, og:url, sitemap <loc>, and JSON-LD url are one string", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    const canonical = await page
      .locator('head > link[rel="canonical"]')
      .getAttribute("href");
    const ogUrl = await metaContent(page, 'meta[property="og:url"]');
    const jsonLd = JSON.parse(
      (await page
        .locator('script[type="application/ld+json"]')
        .textContent()) ?? "",
    ) as { url?: string };

    const sitemap = await request.get("/sitemap.xml");
    const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );

    // One URL, byte-identical across all four surfaces — including the trailing
    // slash (there is none).
    expect(new Set([canonical, ogUrl, jsonLd.url, ...locs])).toEqual(
      new Set([SITE_URL]),
    );
  });
});
