import apData from "./ap-2027.json";

/**
 * Curated, verified official College Board resources for the Resources page (#23).
 *
 * SOURCING RULE (issue #23 AC, PRD §7.5/§8/§11): every `href` here is an official
 * College Board page. The backbone links are the exact URLs already verified in
 * `src/data/sources.md` (fetched 2026-07-04 for the dataset); the AP Students hub
 * and the course/exam index were additionally confirmed live before inclusion.
 * No URL here is guessed, placeholder, or fabricated — if a resource cannot be
 * verified it is omitted rather than shipped broken.
 *
 * Labels may contain the `{cycle}` token, replaced at render time with the
 * dataset's `cycle` (e.g. "May 2026"), so the annual JSON swap re-labels the
 * cycle-specific resources automatically — mirroring the footer and the
 * schedule banner, which also derive their cycle from `apData.cycle`.
 */

/** The dataset cycle, read from metadata (never hardcoded). */
export const CYCLE: string = (apData as { cycle: string }).cycle;

/**
 * Official College Board hosts a resource link is allowed to point at. Matches
 * the repo's WebFetch allowlist (apcentral / apstudents / reports /
 * collegeboard.org). Used by the data test to reject any off-host URL.
 */
export const OFFICIAL_HOSTS = [
  "apcentral.collegeboard.org",
  "apstudents.collegeboard.org",
  "reports.collegeboard.org",
  "collegeboard.org",
  "www.collegeboard.org",
] as const;

export interface ResourceLink {
  /** Descriptive link text; never "click here". May contain the `{cycle}` token. */
  label: string;
  /** Verified official College Board URL (https, official host). */
  href: string;
}

export interface ResourceGroup {
  /** Section heading, rendered as an <h2> landmark within the Resources page. */
  heading: string;
  links: readonly ResourceLink[];
}

/**
 * The curated list. Groupings follow the issue's suggestion: exam logistics,
 * scores, and planning & deadlines.
 */
export const RESOURCE_GROUPS: readonly ResourceGroup[] = [
  {
    heading: "Exam logistics",
    links: [
      {
        label: "{cycle} AP Exam dates",
        href: "https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates",
      },
      {
        label: "{cycle} AP late-testing dates",
        href: "https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates/late-testing-dates",
      },
      {
        label: "AP Exams calculator policy",
        href: "https://apstudents.collegeboard.org/exam-policies-guidelines/calculator-policies",
      },
      {
        // Shortened from "Digital AP Exams and Bluebook exam modes" so the
        // label fits on a single line everywhere — including the 375px mobile
        // disclosure card (issue #29 link polish).
        label: "Bluebook digital exam modes",
        href: "https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/digital-ap-exams/exam-modes",
      },
    ],
  },
  {
    heading: "Scores",
    links: [
      {
        label: "AP Score distributions",
        href: "https://apstudents.collegeboard.org/about-ap-scores/score-distributions",
      },
    ],
  },
  {
    heading: "Planning & deadlines",
    links: [
      {
        // Shortened from "AP coordinator key dates and deadlines" to fit on
        // one line in the expanded sidebar (issue #29 link polish).
        label: "AP coordinator dates and deadlines",
        href: "https://apcentral.collegeboard.org/about-ap/ap-coordinators/calendar-deadlines",
      },
      {
        label: "AP Students hub",
        href: "https://apstudents.collegeboard.org/",
      },
      {
        // Parenthesis-free per issue #29's label audit — the "(all 42
        // subjects)" qualifier folded into the label itself.
        label: "All AP courses and exams index",
        href: "https://apstudents.collegeboard.org/course-index-page",
      },
    ],
  },
];

/** Replace the `{cycle}` token in a label with the dataset cycle. */
export function resolveLabel(label: string): string {
  return label.replace(/\{cycle\}/g, CYCLE);
}

/** Convert a group heading into a stable id for `aria-labelledby`. */
export function headingId(heading: string): string {
  return `resources-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
