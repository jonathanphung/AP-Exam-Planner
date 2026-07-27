import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apDatasetSchema,
  parseApDataset,
  type ApDataset,
} from "./schema";

/**
 * super-board QA suite for issue #2 (Tester lane, v1).
 *
 * Independent per-AC verification layered on top of the Builder's
 * `ap-2027.test.ts`. One describe block per acceptance criterion so a
 * failure names the AC it breaks. Runs under `pnpm test:data`.
 */

const raw: unknown = JSON.parse(
  readFileSync(join(__dirname, "ap-2027.json"), "utf-8"),
);
const dataset = parseApDataset(raw);
const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

function clone(): ApDataset {
  return structuredClone(raw) as ApDataset;
}

/**
 * College Board's current AP course list (43 subjects: the 42 that sat or were
 * listed for May 2026, plus AP Networking), per apcentral.collegeboard.org/courses
 * — cross-checked against src/data/sources.md. Kebab-case per the AC. No 2026
 * course was removed or renamed for 2027.
 */
const EXPECTED_IDS = [
  "2-d-art-and-design",
  "3-d-art-and-design",
  "african-american-studies",
  "art-history",
  "biology",
  "business-with-personal-finance",
  "calculus-ab",
  "calculus-bc",
  "chemistry",
  "chinese-language-and-culture",
  "comparative-government-and-politics",
  "computer-science-a",
  "computer-science-principles",
  "cybersecurity",
  "drawing",
  "english-language-and-composition",
  "english-literature-and-composition",
  "environmental-science",
  "european-history",
  "french-language-and-culture",
  "german-language-and-culture",
  "human-geography",
  "italian-language-and-culture",
  "japanese-language-and-culture",
  "latin",
  "macroeconomics",
  "microeconomics",
  "music-theory",
  "networking",
  "physics-1",
  "physics-2",
  "physics-c-electricity-and-magnetism",
  "physics-c-mechanics",
  "precalculus",
  "psychology",
  "research",
  "seminar",
  "spanish-language-and-culture",
  "spanish-literature-and-culture",
  "statistics",
  "united-states-government-and-politics",
  "united-states-history",
  "world-history-modern",
] as const;

describe("QA AC1 — full course list with the specified entry shape", () => {
  it("contains exactly the 43 subjects on College Board's current course list", () => {
    expect([...dataset.subjects.map((s) => s.id)].sort()).toEqual([
      ...EXPECTED_IDS,
    ]);
  });

  it("subject names are unique and prefixed 'AP '", () => {
    const names = dataset.subjects.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toMatch(/^AP /);
    }
  });

  it("exam/lateTesting are null only for portfolio-only subjects or courses with a sourced noExamReason", () => {
    for (const s of dataset.subjects) {
      if (s.exam === null) {
        const portfolioOnly = s.portfolio !== null;
        const sourcedNoExam =
          typeof s.noExamReason === "string" && s.noExamReason.length > 0;
        expect(portfolioOnly || sourcedNoExam, s.id).toBe(true);
        expect(s.lateTesting, s.id).toBeNull();
      } else {
        expect(s.lateTesting, s.id).not.toBeNull();
      }
    }
  });

  it("the three Career Kickstart courses sit their first published exam in May 2027 with no published pass rate", () => {
    // In May 2026 the two launched Career Kickstart courses had no exam at all.
    // The 2027 schedule lists all three — and no administration has happened,
    // so no score distribution exists for any of them. Issue #84 replaced the
    // "pending" badge with omission + the not-published dash, and each carries
    // a sourced `passRateNote` saying why.
    for (const id of [
      "business-with-personal-finance",
      "cybersecurity",
      "networking",
    ]) {
      const s = byId.get(id);
      expect(s?.category, id).toBe("Career Kickstart");
      expect(s?.exam, id).not.toBeNull();
      expect(s?.lateTesting, id).not.toBeNull();
      expect(s?.noExamReason, id).toBeUndefined();
      expect(s?.passRate, id).toBeUndefined();
      expect(s?.passRateNote, id).toBeTruthy();
    }
  });
});

describe("QA AC2 — sourcing discipline (sources.md + no estimated values)", () => {
  const sourcesPath = join(__dirname, "sources.md");

  it("sources.md exists and cites a collegeboard.org URL for each of the four data classes", () => {
    expect(existsSync(sourcesPath)).toBe(true);
    const sources = readFileSync(sourcesPath, "utf-8");
    for (const dataClass of [
      /exam calendar/i,
      /late-testing calendar/i,
      /portfolio deadlines/i,
      /score distributions/i,
    ]) {
      expect(sources, String(dataClass)).toMatch(dataClass);
    }
    const urls = sources.match(/https:\/\/[^\s>)]+/g) ?? [];
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const url of urls) {
      expect(url, url).toMatch(/collegeboard\.org/);
    }
  });

  it("no estimated/placeholder value anywhere — unpublished fields are OMITTED", () => {
    // "pending" joined this list in issue #84: it was the last placeholder
    // string in the file, and it is now as forbidden as "TBD". The positive
    // form of the rule (33 values omitted, 0 filled from an unsourced number)
    // is pinned in ap-2027.test.ts.
    const forbidden = /"(TBD|TBA|N\/A|unknown|estimated|pending|\?\?\?)"/i;
    expect(readFileSync(join(__dirname, "ap-2027.json"), "utf-8")).not.toMatch(
      forbidden,
    );
  });
});

describe("QA AC3 — PRD §8 anchor checks", () => {
  it("AP Seminar, AP Research, AP CSP portfolio deadline is 2027-04-30", () => {
    for (const id of ["seminar", "research", "computer-science-principles"]) {
      expect(byId.get(id)?.portfolio?.deadline, id).toBe("2027-04-30");
    }
  });

  it("all three AP Art & Design portfolios: deadline 2027-05-07, no timed exam", () => {
    for (const id of ["2-d-art-and-design", "3-d-art-and-design", "drawing"]) {
      const s = byId.get(id);
      expect(s?.portfolio?.deadline, id).toBe("2027-05-07");
      expect(s?.exam, id).toBeNull();
      expect(s?.lateTesting, id).toBeNull();
    }
  });
});

describe("QA AC4 — top-level metadata", () => {
  it("carries cycle 'May 2027', a real lastVerified date, and published session start times", () => {
    expect(dataset.cycle).toBe("May 2027");
    expect(dataset.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      Number.isNaN(Date.parse(`${dataset.lastVerified}T00:00:00Z`)),
    ).toBe(false);
    // Published 2027 text: "For most schools ... exams still begin at 8 a.m.
    // local time and 12 p.m. local time." (Session 1 / Session 2 replace the
    // former Morning / Afternoon labels; the app's AM/PM slots map onto them.)
    expect(dataset.sessionStartTimes.AM).toMatch(/8 a\.m\./);
    expect(dataset.sessionStartTimes.PM).toMatch(/12 p\.m\./);
  });
});

describe("QA AC5 — schema rejects malformed data (independent negative cases)", () => {
  it("rejects a missing required field (name)", () => {
    const broken = clone();
    // @ts-expect-error deliberately breaking the entry
    delete broken.subjects[0].name;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a malformed session value", () => {
    const broken = clone();
    const chem = broken.subjects.find((s) => s.id === "chemistry");
    // @ts-expect-error deliberately breaking the entry
    chem!.exam!.session = "EVENING";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a duplicate subject id", () => {
    const broken = clone();
    broken.subjects[1].id = broken.subjects[0].id;
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a regular exam date inside the late-testing window (outside regular windows)", () => {
    const broken = clone();
    const stats = broken.subjects.find((s) => s.id === "statistics");
    stats!.exam!.date = "2027-05-18";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a late-testing date before the published late window", () => {
    const broken = clone();
    const stats = broken.subjects.find((s) => s.id === "statistics");
    stats!.lateTesting!.date = "2027-05-12";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a non-kebab-case id", () => {
    const broken = clone();
    broken.subjects[0].id = "Biology_2027";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects malformed top-level metadata (bad cycle label)", () => {
    const broken = clone();
    broken.cycle = "2027";
    expect(apDatasetSchema.safeParse(broken).success).toBe(false);
  });
});

describe("QA AC6 — the shipped dataset itself is valid", () => {
  it("apDatasetSchema.safeParse(raw) succeeds, so `pnpm test:data` exits 0", () => {
    const result = apDatasetSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("every exam date falls inside a published 2027 window (belt-and-braces sweep)", () => {
    const inWindow = (d: string, w: { start: string; end: string }) =>
      d >= w.start && d <= w.end;
    for (const s of dataset.subjects) {
      if (s.exam !== null) {
        expect(
          inWindow(s.exam.date, { start: "2027-05-03", end: "2027-05-07" }) ||
            inWindow(s.exam.date, { start: "2027-05-10", end: "2027-05-14" }),
          `${s.id} exam ${s.exam.date}`,
        ).toBe(true);
      }
      if (s.lateTesting !== null) {
        expect(
          inWindow(s.lateTesting.date, {
            start: "2027-05-17",
            end: "2027-05-21",
          }),
          `${s.id} late ${s.lateTesting.date}`,
        ).toBe(true);
      }
    }
  });
});
