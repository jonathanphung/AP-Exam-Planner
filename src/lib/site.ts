import { CYCLE } from "@/data/cycle";

/**
 * The one place the app names itself and its own origin (issue #104).
 *
 * Five surfaces need the production URL — the canonical `<link>`, the
 * `Sitemap:` line in `robots.txt`, the single `<loc>` in `sitemap.xml`, the
 * `url` of the `WebApplication` JSON-LD, and the wordmark in the PNG exports'
 * footer. That last one already existed as its own literal, which is exactly
 * the failure mode this module removes: a domain change would have moved the
 * canonical tag and left every exported image on the old host. The origin is
 * written once here and everything else derives from it; the layout, the two
 * metadata routes, and `export-card-theme.ts` import it rather than spelling
 * the host out, and `e2e/issue-104-seo.spec.ts` pins that with a grep of
 * `src/`.
 *
 * The same rule as {@link CYCLE} applies to the copy: the title and the
 * description name the exam cycle by reading the dataset accessor, never by
 * spelling the label out. An annual dataset swap re-labels the page title, the
 * meta description, the Open Graph / Twitter cards, and the JSON-LD
 * description with no edit here.
 *
 * Nothing in this module states a date, a deadline, or a pass rate (PRD
 * §7.5/§8/§11) — the data rule governs structured data too, so the JSON-LD
 * describes only what the app *is*, never what College Board has scheduled.
 */

/**
 * Production origin — the single source for every absolute URL the app emits.
 *
 * No trailing slash, deliberately. The app is one route, so this string is
 * also the canonical URL of that route, and Next (with the default
 * `trailingSlash: false`) renders `alternates.canonical: "/"` in exactly this
 * form. Writing it slash-less here keeps `<link rel="canonical">`, `og:url`,
 * the sitemap `<loc>`, and the JSON-LD `url` byte-identical instead of
 * splitting the site into two URLs a crawler has to reconcile.
 */
export const SITE_URL = "https://apexamplanner.vercel.app";

/**
 * Host without the scheme — what the PNG exports print in their footer.
 *
 * Derived rather than re-typed: the export footer was the app's second copy of
 * the domain before issue #104, and a domain change would have updated the
 * canonical tag while leaving every exported image pointing at the old host.
 */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

/** Product name — `og:site_name`, `applicationName`, JSON-LD `name`. */
export const SITE_NAME = "AP Exam Planner";

/** `<title>` / `og:title` / `twitter:title`. Cycle label comes from the dataset. */
export const SITE_TITLE = `${SITE_NAME} — ${CYCLE} AP exam dates and schedule`;

/** Meta description, shared verbatim with `og:description` and the JSON-LD. */
export const SITE_DESCRIPTION = `Plan your ${CYCLE} AP exam schedule: official dates and sessions, portfolio deadlines, conflict detection, and calendar export.`;

/**
 * `WebApplication` structured data for the site (one `application/ld+json`
 * block, rendered by the root layout).
 *
 * Deliberately factual-only: name, URL, what kind of app it is, and that it is
 * free with no account. No `datePublished`, no exam dates, no deadlines, no
 * pass rates — a search engine must not be able to quote this app on a date
 * College Board has not published. The only cycle reference is the one inside
 * {@link SITE_DESCRIPTION}, which is dataset-derived.
 */
export function siteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any modern web browser",
    browserRequirements: "Requires JavaScript.",
    inLanguage: "en",
    // Free, and there is no sign-up: the planner keeps every schedule in the
    // browser's own storage, so there is nothing to charge for or log into.
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}
