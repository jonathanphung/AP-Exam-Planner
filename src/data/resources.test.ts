import { describe, expect, it } from "vitest";
import {
  CYCLE,
  OFFICIAL_HOSTS,
  RESOURCE_GROUPS,
  headingId,
  resolveLabel,
  type ResourceLink,
} from "./resources";
import apData from "./ap-2027.json";

/**
 * Sourcing-discipline tests for the Resources list (#23).
 *
 * The crux of the ticket is trustworthiness: every link must be a real, official
 * College Board URL — no fabricated, guessed, or placeholder links (PRD
 * §7.5/§8/§11). These tests fail loudly if anyone later drops an off-host,
 * non-https, or placeholder URL into the curated list.
 */

const allLinks: ResourceLink[] = RESOURCE_GROUPS.flatMap((g) => [...g.links]);

/** URLs already documented as verified in src/data/sources.md (the backbone). */
const VERIFIED_BACKBONE = [
  "https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates",
  "https://apcentral.collegeboard.org/exam-administration-ordering-scores/exam-dates/late-testing-dates",
  "https://apcentral.collegeboard.org/about-ap/ap-coordinators/calendar-deadlines",
  "https://apstudents.collegeboard.org/about-ap-scores/score-distributions",
  "https://apstudents.collegeboard.org/exam-policies-guidelines/calculator-policies",
  "https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/digital-ap-exams/exam-modes",
];

describe("resources data", () => {
  it("has at least one link in every group and no empty groups", () => {
    expect(RESOURCE_GROUPS.length).toBeGreaterThan(0);
    for (const group of RESOURCE_GROUPS) {
      expect(group.heading.trim().length).toBeGreaterThan(0);
      expect(group.links.length).toBeGreaterThan(0);
    }
  });

  it("every href is https on an official College Board host", () => {
    for (const link of allLinks) {
      const url = new URL(link.href); // throws on a malformed URL
      expect(url.protocol, `${link.href} must be https`).toBe("https:");
      expect(
        (OFFICIAL_HOSTS as readonly string[]).includes(url.hostname),
        `${link.href} host "${url.hostname}" is not an official College Board host`,
      ).toBe(true);
      expect(
        url.hostname.endsWith("collegeboard.org"),
        `${link.href} must be a collegeboard.org page`,
      ).toBe(true);
    }
  });

  it("has no placeholder, fabricated, or bare-anchor hrefs", () => {
    const banned = [
      "example.com",
      "example.org",
      "localhost",
      "todo",
      "tbd",
      "placeholder",
      "your-",
    ];
    for (const link of allLinks) {
      const href = link.href.toLowerCase();
      expect(href).not.toBe("#");
      expect(href.startsWith("http://")).toBe(false);
      for (const bad of banned) {
        expect(href.includes(bad), `${link.href} looks like a placeholder`).toBe(
          false,
        );
      }
    }
  });

  it("uses descriptive link text — never 'click here' / 'read more' / bare 'link'", () => {
    for (const link of allLinks) {
      const label = resolveLabel(link.label).trim();
      expect(label.length).toBeGreaterThan(3);
      expect(label.toLowerCase()).not.toMatch(/click here|read more|learn more|^link$|^here$/);
    }
  });

  it("keeps labels parenthesis-free (issue #29 link-label audit)", () => {
    for (const link of allLinks) {
      const label = resolveLabel(link.label);
      expect(
        label,
        `"${label}" should fold parenthetical info into the label`,
      ).not.toMatch(/[()]/);
    }
  });

  it("keeps every verified backbone URL from sources.md in the list", () => {
    const hrefs = new Set(allLinks.map((l) => l.href));
    for (const url of VERIFIED_BACKBONE) {
      expect(hrefs.has(url), `backbone URL missing from Resources: ${url}`).toBe(
        true,
      );
    }
  });

  it("has no duplicate hrefs", () => {
    const hrefs = allLinks.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("reads the cycle from dataset metadata (never hardcoded)", () => {
    expect(CYCLE).toBe((apData as { cycle: string }).cycle);
    // At least one label references the cycle and resolves to the dataset value.
    const cycleLabels = allLinks
      .filter((l) => l.label.includes("{cycle}"))
      .map((l) => resolveLabel(l.label));
    expect(cycleLabels.length).toBeGreaterThan(0);
    for (const label of cycleLabels) {
      expect(label).toContain(CYCLE);
      expect(label).not.toContain("{cycle}");
    }
  });

  it("produces stable, unique aria heading ids", () => {
    const ids = RESOURCE_GROUPS.map((g) => headingId(g.heading));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^resources-[a-z0-9-]+$/);
    }
  });
});
