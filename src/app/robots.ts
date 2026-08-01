import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * `/robots.txt` (issue #104).
 *
 * A build-time route convention, not an API route: Next emits a static text
 * file at build. It does not add a runtime network call, so it stays inside
 * PROJECT.md's "no network calls at runtime / no API routes" rule, which
 * governs the client app's data path.
 *
 * No environment branching: Vercel already serves `X-Robots-Tag: noindex` on
 * preview deployments, so preview URLs stay out of the index without this file
 * having to know which deployment it is on.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
