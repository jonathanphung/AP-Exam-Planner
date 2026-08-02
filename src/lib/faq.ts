// Relative imports (not `@/`): src/lib modules run under vitest, which has no
// path-alias config — matches the other lib modules' convention.
import apData from "../data/ap-2027.json";
import { CYCLE } from "../data/cycle";
import {
  LATE_TESTING_WINDOW,
  REGULAR_WINDOWS,
  type ApDataset,
} from "../data/schema";
import { formatDateLabel } from "./schedule";
import { SITE_NAME } from "./site";

/**
 * Homepage FAQ copy (issue #116) — one array feeds both the visible section
 * (`src/components/Faq.tsx`) and the `FAQPage` JSON-LD, so the structured
 * data can never say something the page does not (Google's requirement for
 * FAQ rich results, and this repo's data rule in one move).
 *
 * Every dated claim derives from the dataset or the published window
 * constants in `src/data/schema.ts` — the annual swap re-writes the answers
 * with no edit here. Questions about the app itself (account, exports,
 * conflicts) state only what the app does.
 */

const dataset = apData as unknown as ApDataset;

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * "May 3–7, 2027" from an ISO window. The published AP windows sit inside a
 * single month; a window that ever spans two falls back to two full
 * {@link formatDateLabel} labels rather than printing a wrong compact range.
 */
export function formatWindowLabel(window: {
  start: string;
  end: string;
}): string {
  const [startYear, startMonth, startDay] = window.start.split("-").map(Number);
  const [endYear, endMonth, endDay] = window.end.split("-").map(Number);
  if (startYear !== endYear || startMonth !== endMonth) {
    return `${formatDateLabel(window.start)} to ${formatDateLabel(window.end)}`;
  }
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(startYear, startMonth - 1, startDay),
  );
  return `${monthName} ${startDay}–${endDay}, ${startYear}`;
}

/** The FAQ, in display order. Pure — same input dataset, same copy. */
export function faqItems(): FaqItem[] {
  const items: FaqItem[] = [];

  const regularWindows = REGULAR_WINDOWS.map(formatWindowLabel).join(" and ");
  items.push({
    question: `When are the ${CYCLE} AP exams?`,
    answer:
      `The ${CYCLE} AP Exams are administered in schools ${regularWindows}. ` +
      `Late testing runs ${formatWindowLabel(LATE_TESTING_WINDOW)}.`,
  });

  items.push({
    question: "What time do AP exams start?",
    answer:
      `Morning (AM) exams start at ${dataset.sessionStartTimes.AM}, and ` +
      `afternoon (PM) exams start at ${dataset.sessionStartTimes.PM}.`,
  });

  items.push({
    question: "What happens if two AP exams fall in the same time slot?",
    answer:
      `When two selected exams share a date and session, ${SITE_NAME} flags ` +
      `the conflict and offers to move one exam to its official late-testing ` +
      `date, then re-checks the moved exams against each other. Late testing ` +
      `is arranged through your school — ask your AP coordinator.`,
  });

  // Derived, never hand-listed: the subjects carrying a published portfolio
  // or project deadline, bracketed by their earliest and latest dates. ISO
  // strings sort chronologically. Skipped entirely if a future cycle ships
  // no portfolio deadlines — an empty claim is worse than no entry.
  const deadlines = dataset.subjects
    .flatMap((subject) => (subject.portfolio ? [subject.portfolio.deadline] : []))
    .sort();
  if (deadlines.length > 0) {
    items.push({
      question: "When are AP portfolio deadlines due?",
      answer:
        `${deadlines.length} AP subjects carry a published portfolio or ` +
        `project deadline in ${CYCLE}, falling between ` +
        `${formatDateLabel(deadlines[0])} and ` +
        `${formatDateLabel(deadlines[deadlines.length - 1])}. Each subject ` +
        `page lists its exact deadline, and schools often set earlier ` +
        `internal deadlines — check with your AP coordinator.`,
    });
  }

  items.push({
    question: `Do I need an account to use ${SITE_NAME}?`,
    answer:
      `No. ${SITE_NAME} is free with no sign-up — your schedules are saved ` +
      `in your browser's local storage and never leave your device.`,
  });

  items.push({
    question: "Can I export my AP exam schedule to my calendar?",
    answer:
      "Yes. Export your schedule as an .ics calendar file that opens in " +
      "Google Calendar, Apple Calendar, and Outlook — or as a designed .png, " +
      "a machine-readable .json, or a plain-text itinerary.",
  });

  return items;
}

/**
 * `FAQPage` structured data built from {@link faqItems} — the verbatim
 * questions and answers, nothing added, so the block and the visible section
 * are the same text by construction.
 */
export function faqJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems().map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
