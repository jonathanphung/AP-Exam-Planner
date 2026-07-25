import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import apData from "./ap-2027.json";
import { CYCLE_YEAR } from "./cycle";
import { parseApDataset } from "./schema";

/**
 * super-board QA (issue #71 AC1–AC5, AC7) — a regression guard for the class of
 * staleness this issue cleaned up, not a re-statement of the cleanup.
 *
 * #37 swapped the dataset to May 2027 and added AP Networking (42 → 43
 * subjects). Five separate places kept asserting the old world in prose:
 * README's "42-subject AP catalog", `sources.md`'s "all 42 subjects", the
 * `examSectionSchema` provenance pointer at the superseded
 * `collegeboard-2026/` folder, a fixture comment naming Latin after the fixture
 * moved to AP Italian, and test titles counting to 42. None of it was a defect
 * in shipped behaviour, which is exactly why nothing caught it — no test reads
 * prose.
 *
 * The fix for the five instances is text. The fix for the *class* is this file:
 * each check below is derived from the dataset, so the NEXT annual swap fails
 * here instead of shipping another year of confidently wrong documentation.
 *
 * Deliberately narrow: it asserts only claims the dataset can settle. Nothing
 * here polices wording style, and a legitimate historical statement ("37 of the
 * 42 subjects returned 200 on 2026-07-07") is left alone — the checks are
 * scoped to the specific sentences that make a present-tense roster claim.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const read = (relative: string) =>
  readFileSync(join(REPO_ROOT, relative), "utf8");

const dataset = parseApDataset(apData);
const ROSTER_SIZE = dataset.subjects.length;

describe("issue #71 — documentation cannot silently outlive the dataset", () => {
  it("AC1 — README does not hardcode a subject count in its catalog claim", () => {
    const readme = read("README.md");
    // A count in prose is a maintenance trap: it is right for one cycle and
    // wrong from the next swap onward, with nothing to fail.
    const hardcoded = readme.match(/\b\d{2}[- ]subject\b/gi);
    expect(
      hardcoded,
      "README claims a fixed subject count — prefer cycle-derived wording (issue #71 AC1)",
    ).toBeNull();
  });

  it("AC2 — the examSectionSchema provenance pointer names the SHIPPED cycle's folder", () => {
    const schema = read("src/data/schema.ts");
    const docBlockEnd = schema.indexOf("export const examSectionSchema");
    expect(docBlockEnd).toBeGreaterThan(-1);
    const docBlock = schema.slice(0, docBlockEnd);
    const provenance = docBlock.slice(docBlock.lastIndexOf("/**"));
    // Seven subjects' sections changed in the 2027 swap, so a reader sent to
    // the prior-cycle folder to verify a shipped value lands on a stale number.
    expect(
      provenance,
      `examSectionSchema provenance must point at collegeboard-${CYCLE_YEAR}/`,
    ).toContain(`docs/super-board/research/collegeboard-${CYCLE_YEAR}/`);
    // The prior cycle may still be MENTIONED (audit trail) but not as the
    // place the shipped values come from.
    const shippedPointerAt = provenance.indexOf(
      `collegeboard-${CYCLE_YEAR}/`,
    );
    const priorPointerAt = provenance.indexOf(
      `collegeboard-${Number(CYCLE_YEAR) - 1}/`,
    );
    if (priorPointerAt > -1) {
      expect(
        priorPointerAt,
        "the prior-cycle folder is cited BEFORE the shipped one — a reader will follow the wrong pointer",
      ).toBeGreaterThan(shippedPointerAt);
    }
  });

  it("AC2 — every subject the schema cites has a capture in the shipped cycle's research folder", () => {
    const folder = join(
      REPO_ROOT,
      "docs/super-board/research",
      `collegeboard-${CYCLE_YEAR}`,
    );
    const captured = new Set(
      readdirSync(folder)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    const missing = dataset.subjects
      .map((s) => s.id)
      .filter((id) => !captured.has(id));
    expect(
      missing,
      `subjects with no verbatim capture in collegeboard-${CYCLE_YEAR}/`,
    ).toEqual([]);
    expect(captured.size).toBe(ROSTER_SIZE);
  });

  it("AC3 — sources.md's roster claim states the dataset's actual subject count", () => {
    const sources = read("src/data/sources.md");
    const claim = /Verbatim page text for all (\d+) subjects/.exec(sources);
    expect(
      claim,
      "sources.md no longer makes the 'Verbatim page text for all N subjects' claim — update this guard if the sentence moved",
    ).toBeTruthy();
    expect(
      Number(claim![1]),
      "sources.md's subject count drifted from the dataset (issue #71 AC3)",
    ).toBe(ROSTER_SIZE);
  });

  it("AC4 — the scroll-shift fixture comment names the subject the fixture actually seeds", () => {
    const support = read("e2e/support/scroll-shift.ts");
    const seeded = /const ITALIAN = byId\("([^"]+)"\)/.exec(support);
    expect(seeded, "the ITALIAN fixture is gone — re-point this guard").toBeTruthy();
    const marker = "// Resolution keeps";
    const at = support.indexOf(marker);
    expect(at, "the resolution comment is gone — re-point this guard").toBeGreaterThan(-1);
    const comment = support.slice(at, support.indexOf("\n", at));
    // #37 re-pointed the fixture to AP Italian but left the comment naming
    // Latin, so the comment described a collision that no longer exists.
    expect(comment).toContain("Italian");
    expect(
      comment,
      "the comment still names Latin, which no longer shares Biology's slot (issue #71 AC4)",
    ).not.toContain("Latin");
  });

  it("AC5 — no test title counts the roster to a number the dataset disagrees with", () => {
    // A count in a title is not wrong per se — `ap-2027.test.ts` pinning "43
    // subjects" IS the dataset assertion. What broke on #37 is a title naming a
    // count that no longer matches anything real. So the guard is equality, not
    // prohibition: every roster/category count in a title must be a number the
    // dataset actually produces.
    const allowed = new Set<number>([ROSTER_SIZE]);
    for (const category of new Set(dataset.subjects.map((s) => s.category))) {
      allowed.add(dataset.subjects.filter((s) => s.category === category).length);
    }

    const offenders: string[] = [];
    // Test/describe titles only — the thing a CI reader sees. `all 42` and
    // `42 subjects` / `42 catalog cards` are roster claims; `#42` (issue ref)
    // and `42 Questions` (a published question count) are not.
    const titleLiteral =
      /\b(?:it|test|test\.describe|describe)\(\s*(?:`([^`]*)`|"([^"]*)")/g;
    const rosterClaim = /\ball (\d{2})\b|\b(\d{2})[-\s](?:subjects?|catalog cards?)\b/gi;

    for (const file of walk(join(REPO_ROOT, "e2e")).concat(
      walk(join(REPO_ROOT, "src")),
    )) {
      if (!/\.(?:test|spec)\.tsx?$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(titleLiteral)) {
        const title = match[1] ?? match[2] ?? "";
        for (const claim of title.matchAll(rosterClaim)) {
          const count = Number(claim[1] ?? claim[2]);
          if (allowed.has(count)) continue;
          offenders.push(
            `${file.slice(REPO_ROOT.length + 1)} — "${title}" claims ${count}`,
          );
        }
      }
    }
    expect(
      offenders,
      `a title counts the roster to a number the dataset does not produce (allowed: ${[...allowed].sort((a, b) => a - b).join(", ")}) — derive it from dataset.subjects.length (issue #71 AC5)`,
    ).toEqual([]);
  });

  it("AC7 — no spec hardcodes a committed evidence folder as its write target", () => {
    const offenders: string[] = [];
    for (const file of walk(join(REPO_ROOT, "e2e"))) {
      if (file.endsWith(join("support", "evidence.ts"))) continue;
      const text = readFileSync(file, "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        const trimmed = line.trim();
        // The same path inside a comment is documentation, not a write target.
        if (/^(?:\*|\/\/|\/\*)/.test(trimmed)) continue;
        if (!/["'`]docs\/super-board\/runs\//.test(line)) continue;
        offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${index + 1}`);
      }
    }
    expect(
      offenders,
      "a spec writing straight into docs/super-board/runs/ rewrites the historical PNGs older issue/PR comments embed — resolve the path through evidenceDir() instead (issue #71 AC7)",
    ).toEqual([]);
  });

  it("AC7 — the default evidence root is gitignored", () => {
    const gitignore = read(".gitignore");
    // evidenceDir()'s DEFAULT_EVIDENCE_ROOT lives under this prefix; if the
    // ignore rule goes away, a full suite run starts dirtying the tree again.
    const evidence = read("e2e/support/evidence.ts");
    const root = /DEFAULT_EVIDENCE_ROOT = "([^"]+)"/.exec(evidence);
    expect(root, "DEFAULT_EVIDENCE_ROOT is gone — re-point this guard").toBeTruthy();
    const topLevel = root![1].split("/")[0];
    expect(
      gitignore.split("\n").map((l) => l.trim()),
      `${topLevel}/ must stay gitignored or a full e2e run dirties the working tree (issue #71 AC7)`,
    ).toContain(`${topLevel}/`);
  });
});

/** Every .ts/.tsx file under `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}
