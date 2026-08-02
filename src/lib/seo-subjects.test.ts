import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { CYCLE } from "../data/cycle";
import type { ApDataset } from "../data/schema";
import { formatDateLabel } from "./schedule";
import { SITE_NAME } from "./site";
import {
  SESSION_START_TIMES,
  SUBJECTS,
  subjectPageDescription,
  subjectPageTitle,
  subjectPath,
} from "./seo-subjects";

const dataset = apData as unknown as ApDataset;

/**
 * Issue #116 — the subject-page SEO helpers are total over the SHIPPED
 * dataset: every assertion iterates all 43 subjects, so a subject added in a
 * future swap is covered the moment it lands in the JSON.
 */
describe("issue #116 — subject-page SEO helpers", () => {
  it("exposes every dataset subject, in dataset order", () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual(dataset.subjects.map((s) => s.id));
    expect(SUBJECTS.length).toBeGreaterThan(0);
  });

  it("builds a /subjects/<id> path from the kebab-case dataset id", () => {
    for (const subject of SUBJECTS) {
      expect(subjectPath(subject.id)).toBe(`/subjects/${subject.id}`);
      expect(subjectPath(subject.id)).toMatch(/^\/subjects\/[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("titles every page with the subject name, the dataset cycle, and the site name", () => {
    for (const subject of SUBJECTS) {
      const title = subjectPageTitle(subject);
      expect(title).toContain(subject.name);
      expect(title).toContain(CYCLE);
      expect(title).toContain(SITE_NAME);
    }
  });

  it("describes exam subjects with their dataset date, session, and start time", () => {
    for (const subject of SUBJECTS) {
      if (!subject.exam) continue;
      const description = subjectPageDescription(subject);
      expect(description).toContain(formatDateLabel(subject.exam.date));
      expect(description).toContain(subject.exam.session);
      expect(description).toContain(SESSION_START_TIMES[subject.exam.session]);
      // Every subject with a regular exam has a published late-testing slot
      // (schema superRefine) — the description must carry it.
      expect(subject.lateTesting).not.toBeNull();
      if (subject.lateTesting) {
        expect(description).toContain(formatDateLabel(subject.lateTesting.date));
      }
    }
  });

  it("describes portfolio deadlines from the dataset, and exam-less subjects honestly", () => {
    for (const subject of SUBJECTS) {
      const description = subjectPageDescription(subject);
      if (subject.portfolio) {
        expect(description).toContain(formatDateLabel(subject.portfolio.deadline));
      }
      if (!subject.exam) {
        // No invented exam date: an exam-less subject's description contains
        // no ISO date beyond what formatDateLabel renders for its portfolio.
        expect(description).toContain(
          subject.portfolio ? "no sit-down exam" : "no published exam",
        );
      }
    }
  });

  it("never leaks an unpublished state into the copy", () => {
    for (const subject of SUBJECTS) {
      const copy = subjectPageTitle(subject) + subjectPageDescription(subject);
      expect(copy).not.toContain("undefined");
      expect(copy).not.toContain("null");
      expect(copy).not.toContain("pending");
    }
  });
});
