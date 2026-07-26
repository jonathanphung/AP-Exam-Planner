import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseApDataset } from "./schema";

/**
 * Issue #44 — sections[] round-trip against the committed provenance.
 *
 * Every subject's format.sections must be derivable, value for value, from
 * the adversarially verified re-source at
 * docs/super-board/research/collegeboard-2027/<id>.json (fetched 2026-07-09,
 * patched at 171cb15) using the normalization rules documented in
 * src/data/sources.md. This test re-applies those rules to the provenance and
 * deep-equals the result with the dataset, so no section value can be edited
 * by hand — or fabricated — without the diff showing up here.
 *
 * Hard data rule (PRD §7.5/§8/§11): nothing is estimated, back-computed, or
 * summed into an aggregate College Board does not print. A value the page
 * prints nothing for is OMITTED, and the surfaces render it as the
 * not-published dash.
 *
 * Issue #84 removed the third state this suite used to police — the literal
 * "pending", for a figure College Board publishes that the capture had missed.
 * All 33 of them were re-verified against the live pages on 2026-07-25 and
 * none was published anywhere, so the provenance records now carry `null`
 * (with a `pendingResolved2026_07_25` field naming the page and the quote) and
 * the normalizer below turns that into an omitted field.
 */

const PROVENANCE_DIR = join(
  __dirname,
  "../../docs/super-board/research/collegeboard-2027",
);

const dataset = parseApDataset(
  JSON.parse(readFileSync(join(__dirname, "ap-2027.json"), "utf-8")),
);
const byId = new Map(dataset.subjects.map((s) => [s.id, s]));

interface ProvenancePart {
  name: string;
  questionCount?: string;
  /** Absent when College Board prints no length for the part (issue #73). */
  minutes?: number | string | null;
  /** Exam-denominated published weight (issue #73). */
  weightPercent?: number | string;
  /** Verbatim published weight on any other denominator (issue #73). */
  weightPrinted?: string;
  toolNote?: string | null;
  quote?: string;
}
interface ProvenanceSection {
  name: string;
  questionCount?: string;
  /** `null` where College Board prints no length for the section (issue #84). */
  minutes?: number | string | null;
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

/** "42" → 42; "55–75"/"55-75" → "55–75"; "n/a" → omitted;
 *  descriptive text → omitted, carried into the note. */
function normalizeQuestionCount(raw: string | undefined): {
  value?: number | string;
  extraNote?: string;
} {
  if (raw === undefined || raw === null) return {};
  const s = String(raw).trim();
  if (s === "n/a" || s === "") return {};
  // Issue #84 retired the "pending" state; a record that reintroduces one
  // fails here rather than silently becoming a note that reads "pending".
  if (s === "pending") {
    throw new Error(
      'provenance questionCount "pending": the state was removed in issue #84 — omit the field, or record the published count',
    );
  }
  if (/^\d+$/.test(s)) return { value: Number(s) };
  const range = s.match(/^(\d+)\s*[–-]\s*(\d+)$/);
  if (range) return { value: `${range[1]}–${range[2]}` };
  return { extraNote: s };
}

function normalizeMinutes(raw: number | string): number | string {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  const range = s.match(/^(\d+)\s*[–-]\s*(\d+)$/);
  if (range) return `${range[1]}–${range[2]}`;
  // "pending" lands here on purpose (issue #84): a record that reintroduces it
  // fails loudly instead of quietly shipping a fourth state.
  throw new Error(`unparseable provenance minutes: ${JSON.stringify(raw)}`);
}

function normalizeNote(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "" || s === "n/a" || s === "none") return undefined;
  return s;
}

/**
 * Issue #73 — the per-part weight College Board prints, carried through with
 * its denominator intact. `weightPercent` is exam-denominated and stays a
 * number; `weightPrinted` is verbatim for the section-relative and nested
 * forms. The two are mutually exclusive (the schema refuses both) and neither
 * is ever derived from the other: converting "50% of section score" into an
 * exam-denominated 16.5 is the back-computation this suite exists to catch.
 *
 * Before #73 four language-exam MC part records smuggled "…; 25% of Score"
 * through `toolNote` and this normalizer had to scrape it back out of the
 * quote. The weight now has a field, so that hack is gone.
 */
function normalizePartWeight(p: ProvenancePart) {
  if (p.weightPercent !== undefined) {
    return { weightPercent: Number(p.weightPercent) };
  }
  if (p.weightPrinted !== undefined) return { weightPrinted: p.weightPrinted };
  return {};
}

function normalizePart(p: ProvenancePart) {
  const qc = normalizeQuestionCount(p.questionCount);
  const tool = normalizeNote(p.toolNote ?? undefined);
  const note =
    qc.extraNote && tool ? `${qc.extraNote}; ${tool}` : (qc.extraNote ?? tool);
  return {
    name: p.name,
    ...(qc.value !== undefined ? { questionCount: qc.value } : {}),
    ...(p.minutes === undefined || p.minutes === null
      ? {}
      : { minutes: normalizeMinutes(p.minutes) }),
    ...normalizePartWeight(p),
    ...(note !== undefined ? { note } : {}),
  };
}

function normalizeSection(s: ProvenanceSection) {
  const qc = normalizeQuestionCount(s.questionCount);
  return {
    name: s.name,
    ...(qc.value !== undefined ? { questionCount: qc.value } : {}),
    ...(s.minutes === undefined || s.minutes === null
      ? {}
      : { minutes: normalizeMinutes(s.minutes) }),
    weightPercent: Number(s.weightPercent),
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

describe("ap-2027.json sections[] (issue #44)", () => {
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

  it("every subject with a sit-down 2027 exam has at least one published section — unless College Board publishes no format at all", () => {
    // AP Networking is the single 2027 exception: the exam is on the published
    // May 2027 schedule (pilot schools only) but the course has no AP Central
    // exam page yet, so there is nothing to publish. That state is not a licence
    // to guess — every other format field must be absent too (issue #84
    // replaced the literal "pending" with omission), and no other subject may
    // take this branch.
    const noFormat: string[] = [];
    for (const subject of dataset.subjects) {
      if (subject.exam === null) continue;
      if (subject.format.sections.length > 0) continue;
      noFormat.push(subject.id);
      expect(
        subject.format.totalMinutes,
        `${subject.id} totalMinutes`,
      ).toBeUndefined();
      expect(subject.format.delivery, `${subject.id} delivery`).toBeUndefined();
      expect(
        subject.format.calculator,
        `${subject.id} calculator`,
      ).toBeUndefined();
      expect(subject.examNote, `${subject.id} examNote`).toBeTruthy();
    }
    expect(noFormat).toEqual(["networking"]);
  });

  it("AP Seminar lacks a multiple-choice section entirely — omitted, never zeroed", () => {
    // Issue #73: the two back-computed "End-of-Course Exam – …Section" rows
    // (13.5% / 31.5% — 30%/70% of 45%, multiplied out) were replaced with the
    // three components College Board's Assessment Format actually prints, each
    // carrying its printed nested weight verbatim. Still no multiple choice.
    const sections = byId.get("seminar")?.format.sections ?? [];
    expect(sections.map((s) => [s.name, s.weightPercent])).toEqual([
      ["Performance Task 1: Team Project and Presentation", 20],
      ["Performance Task 2: Individual Research-Based Essay and Presentation", 35],
      ["End-of-Course Exam", 45],
    ]);
    expect(
      sections.some((s) => /multiple.?choice/i.test(s.name)),
      "seminar must not grow a multiple-choice section",
    ).toBe(false);
    // The multiplied-out figures must never come back.
    expect(sections.map((s) => s.weightPercent)).not.toContain(13.5);
    expect(sections.map((s) => s.weightPercent)).not.toContain(31.5);
  });

  it("pins the eight 3+-section subjects the flat model could not express", () => {
    const EXPECTED_SECTION_COUNTS: Record<string, number> = {
      // Issue #73 collapsed AAS's two invented sibling "Section II:" rows into
      // the single "Section II: Free Response" College Board prints, with the
      // SAQ and DBQ as its parts — 5 sections → 4.
      "african-american-studies": 4,
      seminar: 3,
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
    expect(aas.map((s) => s.questionCount)).toEqual([60, 1, 4, undefined]);
    // Section II's published 4 is College Board's own printed total for the
    // section ("4 Questions | 1hr 25mins | 30% of Score"), not 3 + 1 summed
    // from its part rows — the parts print their own 3 and 1 beneath it.
    const aasFr = aas.find((s) => s.name === "Section II: Free Response");
    expect(aasFr?.parts?.map((p) => [p.name, p.questionCount, p.weightPercent])).toEqual([
      ["Short-Answer Questions", 3, 18],
      ["Document-Based Question", 1, 12],
    ]);
  });

  it("nests Calculus AB's published no-calculator vs. calculator halves as parts (re-sourced for 2027)", () => {
    // 2027 change, verified 2026-07-24 on the AP Central exam page: Section I
    // went 45 → 42 questions and 1hr45 → 1hr40, with both part splits re-cut
    // (30q/60min + 15q/45min → 29q/62min + 13q/38min). Calculus BC matches.
    const sections = byId.get("calculus-ab")?.format.sections ?? [];
    const mc = sections.find((s) => /multiple.?choice/i.test(s.name));
    expect(mc?.questionCount).toBe(42);
    expect(mc?.parts?.map((p) => [p.name, p.questionCount, p.minutes])).toEqual(
      [
        ["Part A", 29, 62],
        ["Part B", 13, 38],
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

  it("pins the four false 'pending' values the 2026-07-09 builder spot-check corrected", () => {
    // The provenance fetch had recorded these as "pending", but the live
    // apcentral exam pages print all four (raw-HTML verified, records patched
    // with spotCheckPatch2026_07_09 notes) — "never write 'pending' over a
    // number" (research README lesson 1).
    const jp = byId.get("japanese-language-and-culture")?.format.sections ?? [];
    expect(jp.map((s) => s.minutes)).toEqual(["40–45", 65]);
    const it_ = byId.get("italian-language-and-culture")?.format.sections ?? [];
    expect(it_.find((s) => /free.?response/i.test(s.name))?.minutes).toBe(
      "65–70",
    );
    const frFR = byId
      .get("french-language-and-culture")
      ?.format.sections.find((s) => /free.?response/i.test(s.name));
    expect(
      frFR?.parts?.find((p) => /argumentative essay/i.test(p.name))?.minutes,
    ).toBe(55);
  });

  it("omits durations College Board does not publish — never invented, never split from a combined figure (issue #84)", () => {
    // AAS's Individual Student Project prints a weight but no duration —
    // it is completed during the course, and the page prints no minutes.
    // (Exact-name match: "Section IB: Individual Student Project—Exam Day
    // Validation Question" is a separate, timed section — 10 published
    // minutes — and must not shadow the untimed project itself.)
    const aas =
      byId.get("african-american-studies")?.format.sections ?? [];
    expect(
      aas.find((s) => s.name === "Individual Student Project")?.minutes,
    ).toBeUndefined();
    // Psychology's AAQ/EBQ parts have no printed times — only the section's
    // 70 minutes is published, and it is never divided between them.
    const psychFr = byId
      .get("psychology")
      ?.format.sections.find((s) => /free.?response/i.test(s.name));
    expect(psychFr?.minutes).toBe(70);
    expect(psychFr?.parts?.map((p) => p.minutes)).toEqual([
      undefined,
      undefined,
    ]);
    // Chinese prints "30 minutes to complete both writing tasks (Questions 3
    // and 4)" — a combined figure that is never split 15/15 across the parts.
    // The combined figure is not lost with the Length cell: it ships verbatim
    // in each row's note, which is what makes the omission honest instead of
    // lossy.
    const cnFr = byId
      .get("chinese-language-and-culture")
      ?.format.sections.find((s) => /free.?response/i.test(s.name));
    const cnWriting =
      cnFr?.parts?.filter((p) =>
        /story narration|email response/i.test(p.name),
      ) ?? [];
    expect(cnWriting.map((p) => p.minutes)).toEqual([undefined, undefined]);
    expect(cnWriting.map((p) => p.note)).toEqual([
      "Questions 3 & 4 combined 30 minutes",
      "Questions 3 & 4 combined 30 minutes",
    ]);
    // AP Seminar's two through-course performance tasks have no exam-day time
    // allocation at all; only the End-of-Course Exam is timed.
    const seminar = byId.get("seminar")?.format.sections ?? [];
    expect(seminar.map((s) => s.minutes)).toEqual([undefined, undefined, 120]);
  });

  it("'Total Length' stays the published totalMinutes, independent of section sums", () => {
    // Chinese publishes a 120-minute total; its printed sections are
    // "40–45" + 65 — the total is never recomputed from sections.
    expect(
      byId.get("chinese-language-and-culture")?.format.totalMinutes,
    ).toBe(120);
    // Japanese's printed sections are "40–45" + 65, yet the published total
    // (120, from the apstudents assessment page) stands untouched — sections
    // exclude the between-section break, so the two must never be reconciled
    // by arithmetic.
    expect(
      byId.get("japanese-language-and-culture")?.format.totalMinutes,
    ).toBe(120);
  });

  it("weights are published numbers, and 2-section exams' printed weights are 0–100", () => {
    for (const subject of dataset.subjects) {
      for (const section of subject.format.sections) {
        const w = section.weightPercent;
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

  it("traces EVERY populated part weight back to a printed value in the committed capture (issue #73)", () => {
    // The strongest available anti-fabrication check: the provenance JSON is
    // hand-maintained and could in principle be edited to match a wrong
    // dataset, but pages/<id>.txt is the raw extracted page text. Every
    // per-part weight that ships must appear IN THAT TEXT, in the printed
    // form the schema says it is:
    //   - weightPercent  → "<n>% of score" / "<n>% of exam score" (the exam
    //                      denominator; anything else belongs in weightPrinted)
    //   - weightPrinted  → the exact string, character for character
    // A weight that cannot be found in the capture fails here, whatever the
    // provenance record claims.
    const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let checkedPercent = 0;
    let checkedPrinted = 0;
    for (const subject of dataset.subjects) {
      const parts = subject.format.sections.flatMap((s) => s.parts ?? []);
      if (parts.length === 0) continue;
      const page = readFileSync(
        join(PROVENANCE_DIR, "pages", `${subject.id}.txt`),
        "utf-8",
      );
      for (const part of parts) {
        if (typeof part.weightPercent === "number") {
          // "of score" / "of exam score" only — a bare "35%" elsewhere on the
          // page (a content-mix percentage) must not satisfy this.
          const printed = new RegExp(
            `(?<![\\d.])${escape(String(part.weightPercent))}%\\s*of\\s+(exam\\s+)?score`,
            "i",
          );
          expect(
            printed.test(page),
            `${subject.id} "${part.name}": ${part.weightPercent}% is not printed as an exam-denominated weight in pages/${subject.id}.txt`,
          ).toBe(true);
          checkedPercent++;
        }
        if (part.weightPrinted !== undefined) {
          expect(
            page.includes(part.weightPrinted),
            `${subject.id} "${part.name}": "${part.weightPrinted}" does not appear verbatim in pages/${subject.id}.txt`,
          ).toBe(true);
          // A verbatim weight is used precisely BECAUSE its denominator is not
          // the exam score — it must never be a bare exam-denominated share.
          expect(
            part.weightPrinted,
            `${subject.id} "${part.name}": exam-denominated weights belong in weightPercent`,
          ).not.toMatch(/^\d+(\.\d+)?%\s*(of\s+(exam\s+)?score)?$/i);
          checkedPrinted++;
        }
      }
    }
    // Guards against the check silently covering nothing if the fields are
    // dropped: 17 subjects publish per-part weights (see issue #73's audit).
    expect(checkedPercent).toBeGreaterThanOrEqual(40);
    expect(checkedPrinted).toBeGreaterThanOrEqual(11);
  });

  it("keeps a part's minutes OMITTED where the page prints no length (issue #73, single-stated by #84)", () => {
    const artHistoryFr = byId
      .get("art-history")
      ?.format.sections.find((s) => s.name === "Section II: Free Response");
    // Six printed question rows, no printed per-question length or weight —
    // Section II's 50% is never divided by six.
    expect(artHistoryFr?.parts).toHaveLength(6);
    for (const part of artHistoryFr?.parts ?? []) {
      expect(part.minutes, `${part.name} minutes`).toBeUndefined();
      expect(part.weightPercent, `${part.name} weightPercent`).toBeUndefined();
      expect(part.weightPrinted, `${part.name} weightPrinted`).toBeUndefined();
    }
    // AP Psychology's AAQ/EBQ halves reach the same state by a different
    // route: a length exists for the SECTION (70 minutes) but College Board
    // publishes no per-part figure, and #84 confirmed against the live page
    // that there is nothing to publish. Both are omission now.
    const psychFr = byId
      .get("psychology")
      ?.format.sections.find((s) => /free.?response/i.test(s.name));
    expect(psychFr?.parts?.map((p) => p.minutes)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("carries College Board's printed 'Section <roman>:' prefix on every sit-down subject's sections (issue #73, D2)", () => {
    // Every section name must be one College Board prints. The check that
    // scales across 38 subjects: no section may be a bare "Multiple Choice" /
    // "Free Response" / "Written Response" — the un-prefixed forms 24 subjects
    // shipped before #73 — and the Arabic "Section 1:" form the AP Students
    // block uses is never adopted.
    const bare = new Set(["Multiple Choice", "Free Response", "Written Response"]);
    const offenders: Array<[string, string]> = [];
    for (const subject of dataset.subjects) {
      for (const section of subject.format.sections) {
        if (bare.has(section.name) || /^Section \d/.test(section.name)) {
          offenders.push([subject.id, section.name]);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Spot-check the headline pair from the ticket: structurally identical
    // exams now title their sections identically.
    for (const id of ["art-history", "calculus-bc"]) {
      expect(byId.get(id)?.format.sections.map((s) => s.name), id).toEqual([
        "Section I: Multiple Choice",
        "Section II: Free Response",
      ]);
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
    // Three sections print no question count, all of them projects rather
    // than question sets: the AAS Individual Student Project and AP Seminar's
    // two through-course performance tasks (issue #73).
    expect(omitted).toEqual([
      ["african-american-studies", "Individual Student Project"],
      ["seminar", "Performance Task 1: Team Project and Presentation"],
      [
        "seminar",
        "Performance Task 2: Individual Research-Based Essay and Presentation",
      ],
    ]);
  });
});
