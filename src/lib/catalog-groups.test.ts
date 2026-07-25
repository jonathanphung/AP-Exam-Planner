import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { CATEGORIES, parseApDataset } from "../data/schema";
import { groupSubjectsByCategory, matchesSubjectQuery } from "./catalog-groups";

/**
 * Unit tests for the pure category-grouping helper (issue #22).
 *
 * Guarantees: canonical category order, complete coverage with an empty
 * query, search semantics identical to the flat grid (trimmed,
 * case-insensitive name match), and empty categories dropped rather than
 * rendered as dead sections.
 */

const dataset = parseApDataset(apData);

describe("groupSubjectsByCategory", () => {
  it("groups all 42 subjects under their category in canonical order for an empty query", () => {
    const groups = groupSubjectsByCategory(dataset.subjects);

    // Every category is represented (the shipped dataset has ≥1 per category)
    // and appears in CATEGORIES order.
    expect(groups.map((g) => g.category)).toEqual([...CATEGORIES]);

    // Complete, non-overlapping coverage.
    const total = groups.reduce((n, g) => n + g.subjects.length, 0);
    expect(total).toBe(dataset.subjects.length);
    for (const group of groups) {
      for (const subject of group.subjects) {
        expect(subject.category).toBe(group.category);
      }
    }
  });

  it("filters by name case-insensitively with trimming, like the flat grid", () => {
    const lower = groupSubjectsByCategory(dataset.subjects, "bio");
    const upper = groupSubjectsByCategory(dataset.subjects, "  BIO  ");
    expect(lower).toEqual(upper);
    expect(lower).toHaveLength(1);
    expect(lower[0].category).toBe("STEM");
    expect(lower[0].subjects.map((s) => s.id)).toEqual(["biology"]);
  });

  it("drops empty categories instead of rendering dead sections", () => {
    // "history" matches Humanities + Arts subjects only.
    const groups = groupSubjectsByCategory(dataset.subjects, "history");
    expect(groups.map((g) => g.category)).toEqual(["Humanities", "Arts"]);
  });

  it("returns [] when nothing matches (caller renders its no-matches state)", () => {
    expect(groupSubjectsByCategory(dataset.subjects, "zzz-no-match")).toEqual(
      [],
    );
  });
});

describe("matchesSubjectQuery", () => {
  it("matches every subject on an empty or whitespace-only query", () => {
    for (const subject of dataset.subjects) {
      expect(matchesSubjectQuery(subject, "")).toBe(true);
      expect(matchesSubjectQuery(subject, "   ")).toBe(true);
    }
  });
});
