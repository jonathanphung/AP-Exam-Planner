import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { parseApDataset } from "../data/schema";
import {
  OFFICIAL_PAGE_EXCEPTIONS,
  VERIFIED_PATTERN_IDS,
  officialCollegeBoardUrl,
} from "./college-board-links";

/**
 * Unit tests for the verified College Board link map (issue #22, Tier 3).
 *
 * The load-bearing guarantees:
 *   - every shipped subject resolves to a verified official URL (full
 *     coverage — a future subject added without verification fails here, so
 *     the UI's "omit when unverified" branch never silently hides a link);
 *   - no id is guessed: an unknown id resolves to `null`, and the verified
 *     sets contain only real dataset ids (no stale entries).
 */

// Validate against the real shipped dataset — this is the coverage contract.
const dataset = parseApDataset(apData);
const shippedIds = new Set(dataset.subjects.map((subject) => subject.id));

describe("college-board-links", () => {
  it("resolves a verified https URL for every shipped subject (full coverage)", () => {
    for (const subject of dataset.subjects) {
      const url = officialCollegeBoardUrl(subject.id);
      expect(url, `no verified URL for "${subject.id}"`).not.toBeNull();
      expect(url).toMatch(/^https:\/\/apcentral\.collegeboard\.org\/courses\/ap-/);
    }
  });

  it("uses the documented ap-<id>/exam pattern for pattern-verified ids", () => {
    expect(officialCollegeBoardUrl("biology")).toBe(
      "https://apcentral.collegeboard.org/courses/ap-biology/exam",
    );
    expect(officialCollegeBoardUrl("african-american-studies")).toBe(
      "https://apcentral.collegeboard.org/courses/ap-african-american-studies/exam",
    );
  });

  it("routes non-conforming subjects through their individually verified exception URL", () => {
    // College Board drops "with" from the Business slug.
    expect(officialCollegeBoardUrl("business-with-personal-finance")).toBe(
      "https://apcentral.collegeboard.org/courses/ap-business-personal-finance/exam",
    );
    // The official page has no "-modern" suffix.
    expect(officialCollegeBoardUrl("world-history-modern")).toBe(
      "https://apcentral.collegeboard.org/courses/ap-world-history/exam",
    );
    // Portfolio-only Art & Design courses have /portfolio pages, not /exam.
    for (const id of ["2-d-art-and-design", "3-d-art-and-design", "drawing"]) {
      expect(officialCollegeBoardUrl(id)).toBe(
        `https://apcentral.collegeboard.org/courses/ap-${id}/portfolio`,
      );
    }
  });

  it("returns null for an unverified id — a link is omitted, never guessed", () => {
    expect(officialCollegeBoardUrl("not-a-real-subject")).toBeNull();
    expect(officialCollegeBoardUrl("")).toBeNull();
  });

  it("contains only real dataset ids — no stale entries, no id in both maps", () => {
    for (const id of VERIFIED_PATTERN_IDS) {
      expect(shippedIds.has(id), `stale pattern id "${id}"`).toBe(true);
      expect(
        id in OFFICIAL_PAGE_EXCEPTIONS,
        `"${id}" is in both the pattern set and the exception map`,
      ).toBe(false);
    }
    for (const id of Object.keys(OFFICIAL_PAGE_EXCEPTIONS)) {
      expect(shippedIds.has(id), `stale exception id "${id}"`).toBe(true);
    }
  });
});
