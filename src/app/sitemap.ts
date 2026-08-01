import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * `/sitemap.xml` (issue #104).
 *
 * The app is a single route, so the sitemap is one entry: the canonical URL —
 * the same string the `<link rel="canonical">` and `og:url` carry.
 *
 * No `lastModified`: it would be a build timestamp, which changes the file on
 * every deploy without telling a crawler anything true about the content. The
 * dataset is the thing that changes, and its swap is a code change anyway.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL }];
}
