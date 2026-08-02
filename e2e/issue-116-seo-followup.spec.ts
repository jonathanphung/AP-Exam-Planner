import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CYCLE } from "../src/data/cycle";
import type { ApSubject } from "../src/data/schema";
import { faqItems } from "../src/lib/faq";
import { formatDateLabel } from "../src/lib/schedule";
import {
  SUBJECTS,
  subjectPageDescription,
  subjectPageTitle,
  subjectPath,
} from "../src/lib/seo-subjects";
import { SITE_URL } from "../src/lib/site";

/**
 * Issue #116 — SEO follow-up: env-driven Search Console / Bing verification,
 * one statically generated page per dataset subject, crawlable footer links,
 * and the homepage FAQ with its FAQPage JSON-LD.
 *
 * Same philosophy as e2e/issue-104-seo.spec.ts (which this card also revised:
 * its sitemap and JSON-LD-count pins moved to the new contract): assert the
 * RENDERED output, and derive every expectation from the dataset accessors so
 * the suite survives the annual swap. The sitemap's full 44-URL contract
 * lives in the revised #104 AC3 and is not duplicated here.
 */

const REPO_ROOT = resolve(__dirname, "..");

/**
 * The source files this card added to the SEO surface. Same rule #104 pins
 * for its own files: the cycle label and every date must come through the
 * accessors, so an annual dataset swap re-labels all of them with no edit —
 * no file below may hand-write either.
 */
const NEW_SEO_SOURCES = [
  "src/lib/seo-subjects.ts",
  "src/lib/faq.ts",
  "src/app/subjects/[slug]/page.tsx",
  "src/components/Faq.tsx",
  "src/components/Footer.tsx",
  "src/app/sitemap.ts",
];

async function metaContent(page: Page, selector: string): Promise<string> {
  const el = page.locator(`head > ${selector}`);
  await expect(el, `expected exactly one ${selector}`).toHaveCount(1);
  return (await el.getAttribute("content")) ?? "";
}

/** Representative subject per dataset state, chosen by shape rather than id. */
function representativeSubjects(): ApSubject[] {
  const candidates = [
    SUBJECTS.find((s) => s.exam !== null && s.portfolio === null),
    SUBJECTS.find((s) => s.exam === null && s.portfolio !== null),
    SUBJECTS.find((s) => s.exam !== null && s.portfolio !== null),
    SUBJECTS.find((s) => s.examNote !== undefined),
    SUBJECTS.find((s) => s.passRate === undefined),
  ];
  const byId = new Map<string, ApSubject>();
  for (const subject of candidates) {
    if (subject) byId.set(subject.id, subject);
  }
  return [...byId.values()];
}

test.describe("issue #116 — SEO follow-up", () => {
  test("AC1: verification tags absent by default, wired to env rather than committed", async ({
    page,
  }) => {
    // A shell that exports the real tokens would legitimately render the tags
    // — skip rather than fail in that (deliberate) configuration.
    test.skip(
      Boolean(
        process.env.GOOGLE_SITE_VERIFICATION ||
          process.env.BING_SITE_VERIFICATION,
      ),
      "verification env vars are set in this shell",
    );

    await page.goto("/");
    await expect(
      page.locator('head > meta[name="google-site-verification"]'),
    ).toHaveCount(0);
    await expect(page.locator('head > meta[name="msvalidate.01"]')).toHaveCount(
      0,
    );

    // The wiring exists and reads the environment — no token literal in src.
    const site = readFileSync(resolve(REPO_ROOT, "src/lib/site.ts"), "utf8");
    expect(site).toContain("process.env.GOOGLE_SITE_VERIFICATION");
    expect(site).toContain("process.env.BING_SITE_VERIFICATION");
  });

  test("AC2: every dataset subject has a live page; unknown slugs 404", async ({
    request,
  }) => {
    // 44 sequential fetches against the dev server: ~12s serial, but the
    // suite runs fullyParallel and worker contention can push this past the
    // default 30s — slow() triples the budget without weakening the sweep.
    test.slow();
    expect(SUBJECTS.length).toBeGreaterThan(0);
    for (const subject of SUBJECTS) {
      const res = await request.get(subjectPath(subject.id));
      expect(res.status(), `GET ${subjectPath(subject.id)}`).toBe(200);
    }
    // dynamicParams = false: the route prerenders the dataset and nothing else.
    expect((await request.get("/subjects/not-a-real-subject")).status()).toBe(
      404,
    );
  });

  test("AC3: representative subject pages carry their dated facts, head tags, and canonical", async ({
    page,
  }) => {
    const representatives = representativeSubjects();
    expect(representatives.length).toBeGreaterThan(0);

    for (const subject of representatives) {
      await page.goto(subjectPath(subject.id));

      await expect(page).toHaveTitle(subjectPageTitle(subject));
      expect(await metaContent(page, 'meta[name="description"]')).toBe(
        subjectPageDescription(subject),
      );

      const canonical = page.locator('head > link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      expect(await canonical.getAttribute("href")).toBe(
        `${SITE_URL}${subjectPath(subject.id)}`,
      );

      const h1 = page.locator("h1");
      await expect(h1, subject.id).toHaveCount(1);
      await expect(h1).toHaveText(subject.name);

      const body = (await page.locator("body").textContent()) ?? "";
      if (subject.exam) {
        expect(body, subject.id).toContain(formatDateLabel(subject.exam.date));
      } else if (subject.portfolio) {
        // No invented exam date — the page says what the assessment is.
        expect(body, subject.id).toContain("No sit-down exam");
      }
      if (subject.lateTesting) {
        expect(body, subject.id).toContain(
          formatDateLabel(subject.lateTesting.date),
        );
      }
      if (subject.portfolio) {
        expect(body, subject.id).toContain(
          formatDateLabel(subject.portfolio.deadline),
        );
      }
      if (subject.examNote) {
        expect(body, subject.id).toContain(subject.examNote);
      }
      if (subject.passRate === undefined) {
        // The pass-rate row renders the not-published dash, never a number
        // and never a deleted row.
        expect(body, subject.id).toContain("—");
      }

      // Link back to the planner root.
      expect(
        await page.locator('a[href="/"]').count(),
        subject.id,
      ).toBeGreaterThan(0);
    }
  });

  test("AC4: the root page's HTML links to every subject page", async ({
    page,
  }) => {
    await page.goto("/");

    const hrefs = await page
      .locator('a[href^="/subjects/"]')
      .evaluateAll((anchors) =>
        anchors.map((a) => a.getAttribute("href") ?? ""),
      );
    const expected = SUBJECTS.map((subject) => subjectPath(subject.id));
    expect([...new Set(hrefs)].sort()).toEqual([...expected].sort());
  });

  test("AC5: the FAQ is visible and mirrored by exactly one FAQPage JSON-LD block", async ({
    page,
  }) => {
    await page.goto("/");

    const section = page.getByTestId("faq-section");
    await expect(section).toBeVisible();
    await expect(section.locator("h2")).toHaveText(
      "Frequently asked questions",
    );

    const blocks = (
      await page
        .locator('script[type="application/ld+json"]')
        .allTextContents()
    ).map((raw) => JSON.parse(raw) as Record<string, unknown>);
    const faqBlocks = blocks.filter((block) => block["@type"] === "FAQPage");
    expect(faqBlocks).toHaveLength(1);

    const items = faqItems();
    const entities = faqBlocks[0].mainEntity as Array<{
      name: string;
      acceptedAnswer: { text: string };
    }>;
    expect(entities.map((e) => e.name)).toEqual(items.map((i) => i.question));
    expect(entities.map((e) => e.acceptedAnswer.text)).toEqual(
      items.map((i) => i.answer),
    );

    // The visible copy IS the structured data's copy, verbatim.
    const sectionText = (await section.textContent()) ?? "";
    for (const item of items) {
      expect(sectionText).toContain(item.question);
      expect(sectionText).toContain(item.answer);
    }
  });

  test("AC6: the new SEO sources derive the cycle and every date from accessors", async () => {
    for (const file of NEW_SEO_SOURCES) {
      const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
      expect(
        source,
        `${file} hand-writes the cycle label "${CYCLE}"`,
      ).not.toContain(CYCLE);
      expect(source, `${file} hand-writes an ISO date`).not.toMatch(
        /\b\d{4}-\d{2}-\d{2}\b/,
      );
    }
  });
});
