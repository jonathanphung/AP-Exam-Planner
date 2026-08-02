import { describe, expect, it } from "vitest";
import apData from "../data/ap-2027.json";
import { CYCLE } from "../data/cycle";
import {
  LATE_TESTING_WINDOW,
  REGULAR_WINDOWS,
  type ApDataset,
} from "../data/schema";
import { faqItems, faqJsonLd, formatWindowLabel } from "./faq";
import { formatDateLabel } from "./schedule";

const dataset = apData as unknown as ApDataset;

/**
 * Issue #116 — the FAQ copy is dataset-derived and the FAQPage JSON-LD is the
 * verbatim mirror of it. Assertions recompute expectations from the dataset /
 * window constants rather than hand-writing dates, so they survive the annual
 * swap.
 */
describe("issue #116 — FAQ copy", () => {
  it("formats a same-month window compactly and a cross-month window as two full labels", () => {
    // Synthetic inputs: this is a formatter contract, not a dataset fact.
    expect(formatWindowLabel({ start: "2030-01-05", end: "2030-01-09" })).toBe(
      "January 5–9, 2030",
    );
    const crossMonth = formatWindowLabel({
      start: "2030-01-30",
      end: "2030-02-02",
    });
    expect(crossMonth).toContain(formatDateLabel("2030-01-30"));
    expect(crossMonth).toContain(formatDateLabel("2030-02-02"));
  });

  it("ships 5–8 items, each a non-empty question ending in ? with a non-empty answer", () => {
    const items = faqItems();
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.length).toBeLessThanOrEqual(8);
    expect(new Set(items.map((i) => i.question)).size).toBe(items.length);
    for (const item of items) {
      expect(item.question).toMatch(/\?$/);
      expect(item.answer.length).toBeGreaterThan(0);
    }
  });

  it("states the exam windows from the schema constants, never a hand-written date", () => {
    const [windows] = faqItems();
    for (const window of REGULAR_WINDOWS) {
      expect(windows.answer).toContain(formatWindowLabel(window));
    }
    expect(windows.answer).toContain(formatWindowLabel(LATE_TESTING_WINDOW));
    expect(windows.question).toContain(CYCLE);
  });

  it("states session start times verbatim from the dataset", () => {
    const answer = faqItems().find((i) =>
      i.question.includes("What time"),
    )?.answer;
    expect(answer).toContain(dataset.sessionStartTimes.AM);
    expect(answer).toContain(dataset.sessionStartTimes.PM);
  });

  it("derives the portfolio answer's count and date bracket from the dataset", () => {
    const deadlines = dataset.subjects
      .flatMap((s) => (s.portfolio ? [s.portfolio.deadline] : []))
      .sort();
    const answer = faqItems().find((i) =>
      i.question.includes("portfolio"),
    )?.answer;
    expect(answer).toBeDefined();
    expect(answer).toContain(`${deadlines.length} AP subjects`);
    expect(answer).toContain(formatDateLabel(deadlines[0]));
    expect(answer).toContain(formatDateLabel(deadlines[deadlines.length - 1]));
  });

  it("mirrors the items into FAQPage JSON-LD verbatim", () => {
    const items = faqItems();
    const jsonLd = faqJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("FAQPage");
    const entities = jsonLd.mainEntity as Array<{
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }>;
    expect(entities.map((e) => e.name)).toEqual(items.map((i) => i.question));
    expect(entities.map((e) => e.acceptedAnswer.text)).toEqual(
      items.map((i) => i.answer),
    );
    for (const entity of entities) {
      expect(entity["@type"]).toBe("Question");
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
    }
  });

  it("never leaks an unpublished or unresolved state into the copy", () => {
    const copy = JSON.stringify(faqJsonLd());
    expect(copy).not.toContain("pending");
    expect(copy).not.toContain("undefined");
  });
});
