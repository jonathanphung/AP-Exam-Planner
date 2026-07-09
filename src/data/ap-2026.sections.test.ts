import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseApDataset } from "./schema";

/**
 * Issue #44 — sections[] round-trip against the committed provenance.
 *
 * Every subject's format.sections must be derivable, value for value, from
 * the adversarially verified re-source at
 * docs/super-board/research/collegeboard-2026/<id>.json (fetched 2026-07-09,
 * patched at 171cb15) using the normalization rules documented in
 * src/data/sources.md. This test re-applies those rules to the provenance and
 * deep-equals the result with the dataset, so no section value can be edited
 * by hand — or fabricated — without the diff showing up here.
 *
 * Hard data rule (PRD §7.5/§8/§11): nothing is estimated, back-computed, or
 * summed into an aggregate College Board does not print. A genuinely
 * unpublished value is the literal "pending"; a value the page prints nothing
 * for (a project component's question count) is OMITTED — the two states are
 * never conflated.
 */

const PROVENANCE_DIR = join(
  __dirname,
  "../../docs/super-board/research/collegeboard-2026",
);

const dataset = parseApDataset(
  JSON.parse(readFileSync(join(__dirname, "ap-2026.json"), "utf-8")),
);
const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

interface ProvenancePart {
  name: string;
  questionCount?: string;
  minutes: number | string;
  toolNote?: string;
  quote?: string;
}
interface ProvenanceSection {
  name: string;
  questionCount?: string;
  minutes: number | string;
  weightPercent: number | string;
  parts?: ProvenancePart[];
}
interface ProvenanceRecord {
  id: string;
  noSitDownExam: boolean;
  sections: ProvenanceSection[];
}

// ---------------------------------------------------------------------------
// Normalization rules (mirrors src/data/sources.md "sections[] populate").
// ---------------------------------------------------------------------------

/** "42" → 42; "55–75"/"55-75" → "55–75"; "pending" → "pending";
 *  "n/a" → omitted; descriptive text → omitted, carried into the note. */
function normalizeQuestionCount(raw: string | undefined): {
  value?: number | string;
  extraNote?: string;
} {
  if (raw === undefined || raw === null) return {};
  const s = String(raw).trim();
  if (s === "n/a" || s === "") return {};
  if (s === "pending") return { value: "pending" };
  if (/^\d+$/.test(s)) return { value: Number(s) };
  const range = s.match(/^(\d+)\s*[–-]\s*(\d+)$/);
  if (range) return { value: `${range[1]}–${range[2]}` };
  return { extraNote: s };
}

function normalizeMinutes(raw: number | string): number | string {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  if (s === "pending") return "pending";
  const range = s.match(/^(\d+)\s*[–-]\s*(\d+)$/);
  if (range) return `${range[1]}–${range[2]}`;
  throw new Error(`unparseable provenance minutes: ${JSON.stringify(raw)}`);
}

function normalizeNote(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "" || s === "n/a" || s === "none") return undefined;
  return s;
}

/**
 * Spot-check finding (sources.md): four language-exam MC part records carry
 * fetcher commentary as toolNote while their own verbatim quotes print
 * "…; 25% of Score" — the printed weight share is used instead.
 */
const COMMENTARY_TOOLNOTES = new Set([
  "listening/audio, no calculator (world language exam)",
  "reading, no calculator (world language exam)",
  "digital exam via Bluebook",
]);

function normalizePart(p: ProvenancePart) {
  const qc = normalizeQuestionCount(p.questionCount);
  let rawTool: string | undefined = p.toolNote;
  if (rawTool !== undefined && COMMENTARY_TOOLNOTES.has(rawTool)) {
    const printedShare =
      typeof p.quote === "string"
        ? p.quote.match(/\d+(?:\.\d+)?% of Score/)
        : null;
    rawTool = printedShare ? printedShare[0] : undefined;
  }
  const tool = normalizeNote(rawTool);
  const note =
    qc.extraNote && tool ? `${qc.extraNote}; ${tool}` : (qc.extraNote ?? tool);
  return {
    name: p.name,
    ...(qc.value !== undefined ? { questionCount: qc.value } : {}),
    minutes: normalizeMinutes(p.minutes),
    ...(note !== undefined ? { note } : {}),
  };
}

function normalizeSection(s: ProvenanceSection) {
  const qc = normalizeQuestionCount(s.questionCount);
  return {
    name: s.name,
    ...(qc.value !== undefined ? { questionCount: qc.value } : {}),
    minutes: normalizeMinutes(s.minutes),
    weightPercent:
      s.weightPercent === "pending" ? "pending" : Number(s.weightPercent),
    ...(qc.extraNote !== undefined ? { note: qc.extraNote } : {}),
    ...(s.parts && s.parts.length > 0
      ? { parts: s.parts.map(normalizePart) }
      : {}),
  };
}

/** Restore College Board's printed Section I/II order where every section
 *  name carries a parseable "Section <roman>" prefix (two provenance records
 *  listed Section II before Section I in fetch order). */
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
function sectionSortKey(name: string): [number, number] | null {
  const m = name.match(/^Section\s+([IVX]+)([AB])?/);
  if (!m || !(m[1] in ROMAN)) return null;
  const letter = m[2] ?? name.match(/^Section\s+[IVX]+,\s*Part\s+([AB])/)?.[1];
  return [ROMAN[m[1]], letter ? letter.charCodeAt(0) : 0];
}
function orderSections<T extends { name: string }>(sections: T[]): T[] {
  const keys = sections.map((s) => sectionSortKey(s.name));
  if (keys.some((k) => k === null)) return sections;
  return sections
    .map((s, i) => ({ s, k: keys[i] as [number, number], i }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.s);
}

/**
 * The old flat frqType strings (sourced in issues #2/#45) carried over as the
 * free-response section's note for plain two-section exams (sources.md rule:
 * exactly one section named like a free-response section, no parts anywhere).
 * Where parts or 3+ published sections exist, the structure supersedes the
 * aggregate description — several of those old aggregates were fabricated
 * sums (music-theory's "9", AAS's "5") and must NOT reappear.
 */
const CARRIED_FR_NOTES: Record<string, string> = {
  "art-history": "6 essay questions (2 long, 4 short)",
  biology: "6 free-response questions (2 long, 4 short)",
  chemistry: "7 free-response questions (3 long, 4 short)",
  "comparative-government-and-politics":
    "4 free-response questions (concept application, quantitative analysis, comparative analysis, argument essay)",
  "computer-science-a": "4 code-writing free-response questions",
  "computer-science-principles":
    "2 written-response questions about the student's Create performance task",
  cybersecurity: "1 multi-source analysis free-response question",
  "english-language-and-composition":
    "3 essays (synthesis, rhetorical analysis, argument)",
  "english-literature-and-composition":
    "3 essays (poetry analysis, prose fiction analysis, thematic analysis)",
  "environmental-science": "3 free-response questions",
  "human-geography": "3 free-response questions",
  latin: "translation, short-answer, and short-essay questions (5 questions)",
  macroeconomics: "3 free-response questions (1 long, 2 short)",
  microeconomics: "3 free-response questions (1 long, 2 short)",
  "physics-1": "4 free-response questions",
  "physics-2": "4 free-response questions",
  "physics-c-electricity-and-magnetism": "4 free-response questions",
  "physics-c-mechanics": "4 free-response questions",
  statistics:
    "3 multi-part questions + 1 inference question (hypothesis test or confidence interval)",
  "united-states-government-and-politics":
    "4 free-response questions (concept application, quantitative analysis, SCOTUS comparison, argument essay)",
};
const FR_NAME = /free.?response|written response/i;

function expectedSections(record: ProvenanceRecord) {
  const sections = orderSections(record.sections.map(normalizeSection));
  const carried = CARRIED_FR_NOTES[record.id];
  if (carried) {
    const frSections = sections.filter((s) => FR_NAME.test(s.name));
    expect(
      frSections.length,
      `${record.id}: carried note requires exactly one FR-named section`,
    ).toBe(1);
    expect(
      sections.length,
      `${record.id}: carried note allowed only on two-section exams`,
    ).toBe(2);
    expect(
      sections.some((s) => "parts" in s),
      `${record.id}: carried note not allowed where parts exist`,
    ).toBe(false);
    (frSections[0] as { note?: string }).note = carried;
  }
  return sections;
}

// ---------------------------------------------------------------------------

describe("ap-2026.json sections[] (issue #44)", () => {
  it("round-trips every subject's sections from the committed provenance", () => {
    for (const subject of dataset.subjects) {
      const record = JSON.parse(
        readFileSync(join(PROVENANCE_DIR, `${subject.id}.json`), "utf-8"),
      ) as ProvenanceRecord;
      expect(
        subject.format.sections,
        `${subject.id} sections must match normalized provenance`,
      ).toEqual(expectedSections(record));
    }
  });

  it("portfolio-only subjects have NO sections (omission, not zeroed rows or 'pending')", () => {
    for (const id of [
      "research",
      "drawing",
      "2-d-art-and-design",
      "3-d-art-and-design",
    ]) {
      const subject = byId.get(id);
      expect(subject?.exam, `${id} exam`).toBeNull();
      expect(subject?.portfolio, `${id} portfolio`).not.toBeNull();
      expect(subject?.format.sections, `${id} sections`).toEqual([]);
    }
  });

  it("every subject with a sit-down 2026 exam has at least one published section", () => {
    for (const subject of dataset.subjects) {
      if (subject.exam !== null) {
        expect(
          subject.format.sections.length,
          `${subject.id} sections`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("AP Seminar lacks a multiple-choice section entirely — omitted, never 'pending'", () => {
    const sections = byId.get("seminar")?.format.sections ?? [];
    expect(sections.length).toBe(2);
    expect(
      sections.some((s) => /multiple.?choice/i.test(s.name)),
      "seminar must not grow a multiple-choice section",
    ).toBe(false);
  });

  it("pins the seven 3+-section subjects the flat model could not express", () => {
    const EXPECTED_SECTION_COUNTS: Record<string, number> = {
      "african-american-studies": 5,
      "world-history-modern": 3,
      "united-states-history": 3,
      "spanish-literature-and-culture": 3,
      "music-theory": 3,
      "european-history": 3,
      "business-with-personal-finance": 3,
    };
    for (const [id, count] of Object.entries(EXPECTED_SECTION_COUNTS)) {
      expect(byId.get(id)?.format.sections.length, id).toBe(count);
    }
  });

  it("never re-fabricates the aggregates the skeptics rejected (music-theory '9', AAS '5')", () => {
    // AP Music Theory prints 7 (Written) and 2 (Sight Singing) in separate
    // sections; 9 appears nowhere on the page and must never be emitted.
    const music = byId.get("music-theory")?.format.sections ?? [];
    expect(music.map((s) => s.questionCount)).toEqual([75, 7, 2]);
    expect(
      music.some((s) => s.questionCount === 9),
      "music-theory must not contain a fabricated frq total of 9",
    ).toBe(false);
    // Same class of error for AP African American Studies' "5".
    const aas = byId.get("african-american-studies")?.format.sections ?? [];
    expect(aas.map((s) => s.questionCount)).toEqual([60, 1, 3, 1, undefined]);
  });

  it("nests Calculus AB's published no-calculator vs. calculator halves as parts", () => {
    const sections = byId.get("calculus-ab")?.format.sections ?? [];
    const mc = sections.find((s) => /multiple.?choice/i.test(s.name));
    expect(mc?.questionCount).toBe(45);
    expect(mc?.parts?.map((p) => [p.name, p.questionCount, p.minutes])).toEqual(
      [
        ["Part A", 30, 60],
        ["Part B", 15, 45],
      ],
    );
    expect(mc?.parts?.[0].note).toMatch(/calculator not permitted/i);
    expect(mc?.parts?.[1].note).toMatch(/graphing calculator required/i);
  });

  it("renders published duration ranges verbatim (AP Chinese Section I: 40–45 minutes)", () => {
    const sections =
      byId.get("chinese-language-and-culture")?.format.sections ?? [];
    expect(sections[0]?.minutes).toBe("40–45");
  });

  it("keeps genuinely unpublished section durations as the literal 'pending' (AP Japanese)", () => {
    const sections =
      byId.get("japanese-language-and-culture")?.format.sections ?? [];
    expect(sections.map((s) => s.minutes)).toEqual(["pending", "pending"]);
    // …while its published part times stay real numbers — no back-computing
    // the section total from them (25 + 40 = 65 appears nowhere on the page).
    const mc = sections.find((s) => /multiple.?choice/i.test(s.name));
    expect(mc?.parts?.map((p) => p.minutes)).toEqual([25, 40]);
  });

  it("'Total Length' stays the published totalMinutes, independent of section sums", () => {
    // Chinese publishes a 120-minute total; its printed sections are
    // "40–45" + 65 — the total is never recomputed from sections.
    expect(
      byId.get("chinese-language-and-culture")?.format.totalMinutes,
    ).toBe(120);
    // Japanese's sections are both "pending" yet the published total stands.
    expect(
      byId.get("japanese-language-and-culture")?.format.totalMinutes,
    ).toBe(120);
  });

  it("weights are published numbers (or 'pending'), and 2-section exams' printed weights are 0–100", () => {
    for (const subject of dataset.subjects) {
      for (const section of subject.format.sections) {
        const w = section.weightPercent;
        if (w === "pending") continue;
        expect(typeof w, `${subject.id} "${section.name}" weight`).toBe(
          "number",
        );
        expect(w, `${subject.id} "${section.name}" weight`).toBeGreaterThan(0);
        expect(
          w,
          `${subject.id} "${section.name}" weight`,
        ).toBeLessThanOrEqual(100);
      }
    }
  });

  it("sections omit a question count only where the page prints none (never the string 'n/a')", () => {
    const omitted: Array<[string, string]> = [];
    for (const subject of dataset.subjects) {
      for (const section of subject.format.sections) {
        expect(section.questionCount).not.toBe("n/a");
        if (section.questionCount === undefined) {
          omitted.push([subject.id, section.name]);
        }
      }
    }
    // Exactly one section in the 2026 cycle prints no question count: the
    // AAS Individual Student Project (a project, not a question set).
    expect(omitted).toEqual([
      ["african-american-studies", "Individual Student Project"],
    ]);
  });
});
