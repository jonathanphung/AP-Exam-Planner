import { describe, expect, it } from "vitest";

import raw from "./ap-2027.json";
import { apDatasetSchema, hasUnpublishedFormat, parseApDataset } from "./schema";

/**
 * Issue #87 — "exam published, format unpublished" is a third state, and it is
 * derived from the data rather than from a subject id.
 *
 * `e2e/issue-87-unpublished-format.spec.ts` asserts what the student sees.
 * This file asserts the rule underneath it: which subjects are in the state,
 * that the schema refuses every other shape of it, and that splitting AP
 * Networking's 297-character `examNote` in two lost none of its sourced facts.
 */

const dataset = parseApDataset(raw);
const byId = new Map(dataset.subjects.map((s) => [s.id, s]));
const clone = () => structuredClone(raw) as typeof raw;

/** The four subjects with no sit-down exam — the OTHER empty-`sections` set. */
const PORTFOLIO_ONLY = [
  "research",
  "2-d-art-and-design",
  "3-d-art-and-design",
  "drawing",
] as const;

describe("hasUnpublishedFormat — the third state, keyed off the data", () => {
  it("holds for exactly the subjects whose exam exists and whose format does not", () => {
    const matched = dataset.subjects
      .filter((s) => hasUnpublishedFormat(s))
      .map((s) => s.id);
    expect(matched).toEqual(["networking"]);
  });

  it("does NOT hold for the four portfolio-only subjects, which share the empty sections array", () => {
    // The whole bug: one boolean over `sections.length` could not tell these
    // apart from AP Networking, so all five took the same branch.
    for (const id of PORTFOLIO_ONLY) {
      const subject = byId.get(id);
      expect(subject?.format.sections, `${id} sections`).toEqual([]);
      expect(hasUnpublishedFormat(subject!), `${id}`).toBe(false);
    }
  });

  it("does NOT hold for any subject with published sections", () => {
    for (const subject of dataset.subjects) {
      if (subject.format.sections.length === 0) continue;
      expect(hasUnpublishedFormat(subject), subject.id).toBe(false);
    }
  });

  it("is not satisfied by a partially published format", () => {
    // A subject with SOME format data and no sections is a capture bug, not
    // this state — the schema rejects it outright (below), and the predicate
    // must not quietly wave it through if that check is ever relaxed.
    const networking = byId.get("networking")!;
    expect(
      hasUnpublishedFormat({
        ...networking,
        format: { ...networking.format, delivery: "digital" },
      }),
    ).toBe(false);
  });

  it("does NOT hold for an exam-less subject, however empty its format", () => {
    // "No exam at all" and "an exam we cannot describe" are different states;
    // only the second one has rows to render.
    expect(
      hasUnpublishedFormat({ exam: null, format: { sections: [] } }),
    ).toBe(false);
  });
});

describe("schema invariants for the unpublished-format state (issue #87)", () => {
  it("requires a sourced formatNote in the state", () => {
    const broken = clone();
    const networking = broken.subjects.find((s) => s.id === "networking")!;
    delete networking.formatNote;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("refuses a formatNote on a subject whose format IS published", () => {
    const broken = clone();
    const chem = broken.subjects.find((s) => s.id === "chemistry")!;
    chem.formatNote = "College Board publishes nothing about this exam.";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("refuses a formatNote on a portfolio-only subject", () => {
    const broken = clone();
    const drawing = broken.subjects.find((s) => s.id === "drawing")!;
    drawing.formatNote = "College Board publishes nothing about this exam.";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("refuses an examNote on a subject with no exam in this cycle", () => {
    // Every surface renders examNote against a printed date; on an exam-less
    // subject it would silently vanish.
    const broken = clone();
    const drawing = broken.subjects.find((s) => s.id === "drawing")!;
    drawing.examNote = "2026-27 pilot schools only.";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("still refuses a partially published format under an empty sections array", () => {
    const broken = clone();
    const networking = broken.subjects.find((s) => s.id === "networking")!;
    networking.format.calculator = true;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("the shipped dataset itself still parses", () => {
    expect(apDatasetSchema.safeParse(raw).success).toBe(true);
  });
});

describe("AP Networking's note split lost no sourced fact (issue #87 AC5)", () => {
  const networking = () => byId.get("networking")!;

  it("examNote keeps the published restriction on the DATE, and only that", () => {
    const note = networking().examNote!;
    expect(note).toMatch(/pilot schools only/i);
    // The format story moved out; if it comes back, the card is a text dump
    // again (297 characters beside 42 cards that carry no prose at all).
    expect(note.length).toBeLessThan(120);
    expect(note).not.toMatch(/exam page/i);
  });

  it("formatNote carries every fact the old paragraph's second half carried", () => {
    const note = networking().formatNote!;
    for (const fact of [
      /third and final pilot/i,
      /fall 2027/i,
      /no exam page/i,
      /section structure/i,
      /duration/i,
      /delivery mode/i,
      /calculator policy/i,
    ]) {
      expect(note, `formatNote lost ${fact}`).toMatch(fact);
    }
  });

  it("nothing was invented: the format fields are still absent", () => {
    // This card is presentation only. Issue #84 verified live that
    // /courses/ap-networking/exam 404s; filling any of these is out of scope
    // and would be a fabrication.
    const { format } = networking();
    expect(format.sections).toEqual([]);
    expect(format.totalMinutes).toBeUndefined();
    expect(format.calculator).toBeUndefined();
    expect(format.delivery).toBeUndefined();
  });
});
