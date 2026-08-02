// Relative imports (not `@/`): src/lib modules run under vitest, which has no
// path-alias config — matches the other lib modules' convention.
import apData from "../data/ap-2027.json";
import { CYCLE } from "../data/cycle";
import type { ApDataset, ApSubject } from "../data/schema";
import { formatDateLabel } from "./schedule";
import { SITE_NAME } from "./site";

/**
 * Pure helpers for the per-subject SEO pages (issue #116).
 *
 * One module owns the subject-page URL shape and the `<title>` / meta
 * description copy, so the route, the sitemap, the footer index, and the e2e
 * spec all derive them from the same functions — none of the four can drift
 * from the others.
 *
 * Data rule (PRD §7.5/§8/§11): every date and label below reads the dataset
 * (or the {@link CYCLE} accessor), never a hand-written string, so the annual
 * dataset swap re-titles and re-describes all 43 pages with no edit here.
 */

// The dataset ships bundled and is validated by `pnpm test:data`; the JSON
// module's inferred type is widened, so re-assert the schema's types here
// (same idiom as CatalogGrid).
const dataset = apData as unknown as ApDataset;

/** Every subject in the shipped dataset, in dataset order. */
export const SUBJECTS: readonly ApSubject[] = dataset.subjects;

/** Published session start times ("8 a.m. local time" / "12 p.m. local time"). */
export const SESSION_START_TIMES = dataset.sessionStartTimes;

/**
 * Route path for a subject page. The dataset id is already the slug — the
 * schema enforces kebab-case ids, so no separate slugging step exists to
 * disagree with it.
 */
export function subjectPath(subjectId: string): string {
  return `/subjects/${subjectId}`;
}

/**
 * `<title>` for a subject page. Names what the page actually answers: the
 * exam date for sit-down subjects, the portfolio deadline for portfolio-only
 * ones, and a neutral "exam status" for a listed course with neither (none in
 * the current dataset, but the function stays total for the next swap).
 */
export function subjectPageTitle(subject: ApSubject): string {
  const topic = subject.exam
    ? "exam date and late testing"
    : subject.portfolio
      ? "portfolio deadline"
      : "exam status";
  return `${subject.name}: ${CYCLE} ${topic} — ${SITE_NAME}`;
}

/**
 * Meta description: the page's dated facts in one breath, then the product
 * line. Every date goes through {@link formatDateLabel} from the dataset —
 * a subject with no published exam states that rather than inventing one.
 */
export function subjectPageDescription(subject: ApSubject): string {
  const parts: string[] = [];

  if (subject.exam) {
    parts.push(
      `${subject.name} ${CYCLE} exam: ${formatDateLabel(subject.exam.date)}, ` +
        `${subject.exam.session} session, ${SESSION_START_TIMES[subject.exam.session]}.`,
    );
    if (subject.lateTesting) {
      parts.push(
        `Late testing: ${formatDateLabel(subject.lateTesting.date)}, ` +
          `${subject.lateTesting.session} session.`,
      );
    }
  } else if (subject.portfolio) {
    parts.push(
      `${subject.name} has no sit-down exam in ${CYCLE} — the portfolio is the assessment.`,
    );
  } else {
    parts.push(`${subject.name} has no published exam in ${CYCLE}.`);
  }

  if (subject.portfolio) {
    parts.push(
      `Portfolio deadline: ${formatDateLabel(subject.portfolio.deadline)}.`,
    );
  }

  parts.push("Plan your full AP schedule free and export it to your calendar.");
  return parts.join(" ");
}
