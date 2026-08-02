import type { MetadataRoute } from "next";
import { SUBJECTS, subjectPath } from "@/lib/seo-subjects";
import { SITE_URL } from "@/lib/site";

/**
 * `/sitemap.xml` (issue #104; per-subject pages added by issue #116).
 *
 * The root URL first, then one entry per dataset subject — the same iteration
 * that generates the routes (`generateStaticParams` in
 * `src/app/subjects/[slug]/page.tsx`) and the footer index, so a subject
 * added in an annual swap appears in all three surfaces with no extra edit.
 *
 * No `lastModified`: it would be a build timestamp, which changes the file on
 * every deploy without telling a crawler anything true about the content. The
 * dataset is the thing that changes, and its swap is a code change anyway.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL },
    ...SUBJECTS.map((subject) => ({
      url: `${SITE_URL}${subjectPath(subject.id)}`,
    })),
  ];
}
