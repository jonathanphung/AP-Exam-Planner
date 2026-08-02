import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CYCLE } from "@/data/cycle";
import { officialCollegeBoardUrl } from "@/lib/college-board-links";
import { EXAM_NOTE_LABEL, formatDateLabel } from "@/lib/schedule";
import {
  SESSION_START_TIMES,
  SUBJECTS,
  subjectPageDescription,
  subjectPageTitle,
  subjectPath,
} from "@/lib/seo-subjects";
import { SITE_NAME } from "@/lib/site";

/*
 * Per-subject SEO pages (issue #116): one statically generated route per
 * dataset subject, so long-tail queries ("AP Biology exam date 2027") have a
 * crawlable page to land on and the root page inherits 43 internal links'
 * worth of relevance for the head term.
 *
 * Everything printed here goes through the dataset accessors — the same
 * standard the visible catalog meets (PRD §7.5/§8/§11). A value College Board
 * has not published renders as the not-published dash, mirroring InfoPanel's
 * `NotPublishedDash`; a subject with no sit-down exam says so instead of
 * inventing a date.
 *
 * Build-time only: `generateStaticParams` + `dynamicParams = false` prerender
 * all 43 pages and 404 anything else, so the route adds no runtime data path
 * (PROJECT.md: no network calls at runtime, no API routes).
 */

export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return SUBJECTS.map((subject) => ({ slug: subject.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const subject = SUBJECTS.find((s) => s.id === slug);
  if (!subject) return {};

  const title = subjectPageTitle(subject);
  const description = subjectPageDescription(subject);
  const path = subjectPath(subject.id);

  // `metadataBase` is inherited from the root layout, so the relative path
  // resolves to an absolute canonical/og:url on the production origin; the
  // root `opengraph-image.png` file convention cascades to this segment, so
  // the preview card needs no per-page image.
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      title,
      description,
      locale: "en_US",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * The not-published dash, matching InfoPanel's rendering exactly (an em dash
 * is silence to a screen reader, so the sr-only text travels with the glyph).
 * Duplicated rather than exported from InfoPanel because that module is a
 * "use client" dialog and this page stays a server component.
 */
function NotPublishedDash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">none published</span>
    </>
  );
}

/** One labeled fact row. `dt`/`dd` keep the fact list semantic for crawlers. */
function FactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  );
}

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const subject = SUBJECTS.find((s) => s.id === slug);
  // Unreachable with `dynamicParams = false`; narrows the type.
  if (!subject) notFound();

  const officialUrl = officialCollegeBoardUrl(subject.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:text-blue-200 dark:focus-visible:outline-blue-400"
      >
        ← {SITE_NAME}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {subject.name}
      </h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {`${subject.category} · ${CYCLE} AP exam cycle`}
      </p>

      <dl className="mt-6 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {subject.exam ? (
          <FactRow label="Exam date">
            {`${formatDateLabel(subject.exam.date)} — ${subject.exam.session} session, ${SESSION_START_TIMES[subject.exam.session]}`}
            {subject.examNote ? (
              <span className="mt-1 block text-slate-600 dark:text-slate-400">
                {`${EXAM_NOTE_LABEL}: ${subject.examNote}`}
              </span>
            ) : null}
          </FactRow>
        ) : (
          <FactRow label="Exam date">
            {subject.portfolio
              ? `No sit-down exam in ${CYCLE} — this course is assessed through its portfolio.`
              : (subject.noExamReason ?? <NotPublishedDash />)}
          </FactRow>
        )}

        {subject.lateTesting ? (
          <FactRow label="Late testing">
            {`${formatDateLabel(subject.lateTesting.date)} — ${subject.lateTesting.session} session, ${SESSION_START_TIMES[subject.lateTesting.session]}`}
          </FactRow>
        ) : null}

        {subject.portfolio ? (
          <FactRow label="Portfolio deadline">
            {formatDateLabel(subject.portfolio.deadline)}
            <span className="mt-1 block text-slate-600 dark:text-slate-400">
              {subject.portfolio.note}
            </span>
            <span className="mt-1 block text-slate-600 dark:text-slate-400">
              Schools often set earlier internal deadlines — check with your AP
              coordinator.
            </span>
          </FactRow>
        ) : null}

        <FactRow label="Scored 3 or higher">
          {subject.passRate !== undefined ? (
            `${subject.passRate}% in the most recent published administration`
          ) : (
            <>
              <NotPublishedDash />
              {subject.passRateNote ? (
                <span className="mt-1 block text-slate-600 dark:text-slate-400">
                  {subject.passRateNote}
                </span>
              ) : null}
            </>
          )}
        </FactRow>
      </dl>

      <div className="mt-8 flex flex-col items-start gap-4">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400"
        >
          Plan your full AP schedule
        </Link>

        {officialUrl ? (
          <a
            href={officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:text-blue-200 dark:focus-visible:outline-blue-400"
          >
            {`Official College Board page for ${subject.name} ↗`}
          </a>
        ) : null}
      </div>
    </div>
  );
}
