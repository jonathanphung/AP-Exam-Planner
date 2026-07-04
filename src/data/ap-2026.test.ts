import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apDatasetSchema,
  parseApDataset,
  type ApDataset,
} from "./schema";

const raw: unknown = JSON.parse(
  readFileSync(join(__dirname, "ap-2026.json"), "utf-8"),
);

function clone(): ApDataset {
  return structuredClone(raw) as ApDataset;
}

describe("ap-2026.json dataset", () => {
  it("validates against the zod schema", () => {
    const result = apDatasetSchema.safeParse(raw);
    if (!result.success) {
      // Surface every issue in the failure output, not just "false".
      throw new Error(
        `dataset invalid:\n${result.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
      );
    }
    expect(result.success).toBe(true);
  });

  const dataset = parseApDataset(raw);
  const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

  it("covers the full College Board course list (42 subjects) with unique ids", () => {
    expect(dataset.subjects.length).toBe(42);
    expect(new Set(dataset.subjects.map((s) => s.id)).size).toBe(42);
  });

  it("carries May 2026 cycle metadata with published session start times", () => {
    expect(dataset.cycle).toBe("May 2026");
    expect(dataset.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.sessionStartTimes.AM).toBe("8 a.m. local time");
    expect(dataset.sessionStartTimes.PM).toBe("12 p.m. local time");
  });

  // Anchor checks from docs/PRD.md §8.
  it("anchor: AP Seminar, AP Research, and AP CSP portfolio deadline is 2026-04-30", () => {
    for (const id of ["seminar", "research", "computer-science-principles"]) {
      expect(byId.get(id)?.portfolio?.deadline, id).toBe("2026-04-30");
    }
  });

  it("anchor: the three AP Art & Design portfolio deadlines are 2026-05-08", () => {
    for (const id of ["2-d-art-and-design", "3-d-art-and-design", "drawing"]) {
      const subject = byId.get(id);
      expect(subject?.portfolio?.deadline, id).toBe("2026-05-08");
      // Portfolio-only: no timed exam, no late-testing slot.
      expect(subject?.exam, id).toBeNull();
      expect(subject?.lateTesting, id).toBeNull();
    }
  });

  it("every subject with a regular exam also has a late-testing slot", () => {
    for (const subject of dataset.subjects) {
      if (subject.exam !== null) {
        expect(subject.lateTesting, subject.id).not.toBeNull();
      }
    }
  });

  it("exam is null only for portfolio-only subjects or sourced no-2026-exam courses", () => {
    const noExam = dataset.subjects.filter((s) => s.exam === null);
    expect(noExam.map((s) => s.id).sort()).toEqual([
      "2-d-art-and-design",
      "3-d-art-and-design",
      "business-with-personal-finance",
      "cybersecurity",
      "drawing",
      "research",
    ]);
    for (const subject of noExam) {
      const portfolioOnly = subject.portfolio !== null;
      const sourcedReason =
        subject.category === "Career Kickstart" &&
        typeof subject.noExamReason === "string";
      expect(portfolioOnly || sourcedReason, subject.id).toBe(true);
    }
  });

  it("spot-checks sourced calendar facts", () => {
    expect(byId.get("biology")?.exam).toEqual({
      date: "2026-05-04",
      session: "AM",
    });
    expect(byId.get("computer-science-a")?.exam).toEqual({
      date: "2026-05-15",
      session: "PM",
    });
    expect(byId.get("world-history-modern")?.lateTesting).toEqual({
      date: "2026-05-18",
      session: "AM",
    });
    expect(byId.get("psychology")?.lateTesting).toEqual({
      date: "2026-05-22",
      session: "PM",
    });
  });
});

describe("ap-2026.json negative cases (validation must fail on broken data)", () => {
  it("rejects a duplicate subject id", () => {
    const broken = clone();
    broken.subjects.push(structuredClone(broken.subjects[0]));
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const broken = clone();
    // @ts-expect-error deliberately breaking the entry
    delete broken.subjects[0].passRate;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a malformed exam date", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam!.date = "May 4, 2026";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an exam date outside the published 2026 regular windows", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam!.date = "2026-05-09"; // Saturday between the two weeks
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a late-testing date outside the published 2026 late window", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.lateTesting!.date = "2026-05-25";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an estimated-looking value where only pending is allowed", () => {
    const broken = clone();
    const cyber = broken.subjects.find((s) => s.id === "cybersecurity");
    // @ts-expect-error deliberately breaking the entry
    cyber!.passRate = "unknown";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a null exam without portfolio or sourced reason", () => {
    const broken = clone();
    const biology = broken.subjects.find((s) => s.id === "biology");
    biology!.exam = null;
    biology!.lateTesting = null;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown extra field (strict schema)", () => {
    const broken = clone();
    // @ts-expect-error deliberately breaking the entry
    broken.subjects[0].examFee = 99;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });
});
