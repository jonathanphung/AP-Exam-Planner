/**
 * Verified official College Board page per subject (issue #22, Tier 3).
 *
 * Data rule (PROJECT.md / PRD §7.5/§8/§11): links are never guessed. The
 * documented pattern (`src/data/sources.md`) is
 * `https://apcentral.collegeboard.org/courses/ap-<id>/exam`, where `<id>` is
 * the dataset subject id. Every id in {@link VERIFIED_PATTERN_IDS} returned an
 * HTTP 200 from that exact URL when verified on 2026-07-07; the handful of
 * subjects whose official page does NOT follow the pattern live in
 * {@link OFFICIAL_PAGE_EXCEPTIONS} with their individually verified URL.
 * Anything else resolves to `null` — the UI omits the link rather than
 * shipping a 404.
 *
 * This module is the single source of truth for these URLs (no scattered
 * hardcoded strings). Verification notes: `src/data/sources.md` §"Official
 * course/exam pages".
 */

const PATTERN_PREFIX = "https://apcentral.collegeboard.org/courses/ap-";

/**
 * Subject ids whose `ap-<id>/exam` page was individually verified (HTTP 200 —
 * originally 2026-07-07, re-verified in full during the May 2027 dataset swap
 * on 2026-07-24). 37 of the 43 shipped subjects follow the pattern.
 */
export const VERIFIED_PATTERN_IDS: ReadonlySet<string> = new Set([
  "african-american-studies",
  "art-history",
  "biology",
  "calculus-ab",
  "calculus-bc",
  "chemistry",
  "chinese-language-and-culture",
  "comparative-government-and-politics",
  "computer-science-a",
  "computer-science-principles",
  "cybersecurity",
  "english-language-and-composition",
  "english-literature-and-composition",
  "environmental-science",
  "european-history",
  "french-language-and-culture",
  "german-language-and-culture",
  "human-geography",
  "italian-language-and-culture",
  "japanese-language-and-culture",
  "latin",
  "macroeconomics",
  "microeconomics",
  "music-theory",
  "physics-1",
  "physics-2",
  "physics-c-electricity-and-magnetism",
  "physics-c-mechanics",
  "precalculus",
  "psychology",
  "research",
  "seminar",
  "spanish-language-and-culture",
  "spanish-literature-and-culture",
  "statistics",
  "united-states-government-and-politics",
  "united-states-history",
]);

/**
 * Subjects whose official page does not follow the `ap-<id>/exam` pattern.
 * Each URL was individually verified (HTTP 200, 2026-07-07):
 *
 * - `business-with-personal-finance` — College Board's slug drops "with"
 *   (`ap-business-personal-finance`); the patterned URL 404s.
 * - `world-history-modern` — the official page lives at `ap-world-history`
 *   (no "-modern" suffix); the patterned URL 404s.
 * - The three Art & Design portfolio-only courses have no `/exam` page —
 *   their assessment is the portfolio, documented at `/portfolio`.
 * - `networking` — new for the May 2027 cycle. The course is still in pilot
 *   (launches fall 2027), so `ap-networking/exam` 404s; the only official page
 *   is the adoption page, verified HTTP 200 on 2026-07-24.
 */
export const OFFICIAL_PAGE_EXCEPTIONS: Readonly<Record<string, string>> = {
  "business-with-personal-finance":
    "https://apcentral.collegeboard.org/courses/ap-business-personal-finance/exam",
  "world-history-modern":
    "https://apcentral.collegeboard.org/courses/ap-world-history/exam",
  "2-d-art-and-design":
    "https://apcentral.collegeboard.org/courses/ap-2-d-art-and-design/portfolio",
  "3-d-art-and-design":
    "https://apcentral.collegeboard.org/courses/ap-3-d-art-and-design/portfolio",
  drawing: "https://apcentral.collegeboard.org/courses/ap-drawing/portfolio",
  networking:
    "https://apcentral.collegeboard.org/courses/ap-networking/adopt",
};

/**
 * Resolve the verified official College Board page for a subject id, or
 * `null` when no verified URL exists (an unverifiable link is omitted, never
 * guessed). A unit test pins full coverage for every shipped subject.
 */
export function officialCollegeBoardUrl(subjectId: string): string | null {
  const exception = OFFICIAL_PAGE_EXCEPTIONS[subjectId];
  if (exception) return exception;
  if (VERIFIED_PATTERN_IDS.has(subjectId)) {
    return `${PATTERN_PREFIX}${subjectId}/exam`;
  }
  return null;
}
