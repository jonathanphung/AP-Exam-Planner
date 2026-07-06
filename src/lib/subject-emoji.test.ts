import { describe, expect, it } from "vitest";
import apData from "../data/ap-2026.json";
import { CATEGORIES, parseApDataset } from "../data/schema";
import {
  CATEGORY_EMOJI,
  FALLBACK_EMOJI,
  SUBJECT_EMOJI,
  emojiForSubject,
} from "./subject-emoji";

/**
 * Unit tests for the decorative subject-emoji lookup (issue #20).
 *
 * The load-bearing guarantee (AC1/AC5): the mapping resolves a non-empty emoji
 * for EVERY subject id shipped in `ap-2026.json`, so a future subject added
 * without an emoji fails CI here instead of rendering blank in the UI.
 */

// Validate against the real shipped dataset — this is the coverage contract.
const dataset = parseApDataset(apData);

describe("subject-emoji", () => {
  it("resolves a non-empty emoji for every shipped subject id (AC1/AC5)", () => {
    for (const subject of dataset.subjects) {
      const emoji = emojiForSubject(subject);
      expect(emoji, `no emoji resolved for "${subject.id}"`).toBeTruthy();
      expect(emoji.length, `empty emoji for "${subject.id}"`).toBeGreaterThan(0);
    }
  });

  it("has a hand-picked (id-level) emoji for every shipped subject — no subject relies on the category fallback (AC1)", () => {
    for (const subject of dataset.subjects) {
      expect(
        SUBJECT_EMOJI[subject.id],
        `missing hand-picked emoji for "${subject.id}"`,
      ).toBeTruthy();
    }
  });

  it("maps only real subject ids — no stale entries from a removed subject", () => {
    const shipped = new Set(dataset.subjects.map((s) => s.id));
    for (const id of Object.keys(SUBJECT_EMOJI)) {
      expect(shipped.has(id), `SUBJECT_EMOJI has stale id "${id}"`).toBe(true);
    }
  });

  it("provides a fallback emoji for every category (AC1)", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_EMOJI[category], `no fallback for "${category}"`).toBeTruthy();
    }
  });

  it("falls back to the category emoji for an unmapped subject id (AC1)", () => {
    expect(
      emojiForSubject({ id: "future-unmapped-subject", category: "STEM" }),
    ).toBe(CATEGORY_EMOJI.STEM);
  });

  it("falls back to the generic emoji when neither id nor category is known", () => {
    expect(emojiForSubject({ id: "totally-unknown" })).toBe(FALLBACK_EMOJI);
  });
});
