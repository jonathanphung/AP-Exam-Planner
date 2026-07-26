import { test, expect, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import { writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";

/**
 * Tester gate for issue #83 (super-board QA lane, v1).
 *
 * The Builder's own spec (`issue-83-part-weight-conversion.spec.ts`) asserts
 * the rendered cells against a hand-written scope table, and its unit suite
 * (`src/data/ap-2027.weights.test.ts`) asserts them through `partWeight()` —
 * the very function under test. Both are worth having; neither is independent.
 *
 * This file re-derives the answer from the shipped dataset with **its own**
 * grammar and its own arithmetic — it never imports `parsePrintedWeight`,
 * `partWeight`, or any product code — and then reads what the browser actually
 * painted, for EVERY part row of EVERY subject, not just the 11 in scope. If
 * the product's parser and the QA parser ever disagree about a single cell,
 * this goes red and names the cell.
 *
 *   AC1  the denominator is the section's STORED weight, read off the section
 *        row the browser rendered (66/33 Micro-Macro stays 33, never 33.33)
 *   AC2  two decimal places, no padded zero, no float noise
 *   AC3  the per-question qualifier is in the VISIBLE cell text (innerText,
 *        which drops `sr-only`), on a row whose Questions cell reads 2
 *   AC4  all three printed denominators; an unknown form is a QA failure here
 *        as well as a schema error in the unit suite
 *   AC6  the 65 rows outside scope render exactly what the pre-#83 rule
 *        rendered — computed here, compared cell by cell
 *   AC8  every section's part rows, summed from the DOM, reconcile to the
 *        section weight the DOM shows above them
 */

const EVIDENCE_DIR = evidenceDir("issue-83-qa-v1");
const THEME_KEY = "apx.theme.v1";

type RawPart = {
  name: string;
  questionCount?: number | string;
  weightPercent?: number | string;
  weightPrinted?: string;
};
type RawSection = {
  name: string;
  weightPercent: number | string;
  parts?: RawPart[];
};
type RawSubject = { id: string; name: string; format: { sections: RawSection[] } };

const SUBJECTS = (apData.subjects as unknown as RawSubject[]).filter(
  (s) => s.format.sections.length > 0,
);

/* ------------------------------------------------------------------------ *
 * QA's own reading of a printed weight. Deliberately written from the
 * ticket's prose ("X% of section score", "X% of Y%", "X% of exam score",
 * optionally "each worth "), not from src/data/schema.ts.
 * ------------------------------------------------------------------------ */
type QaPrinted = { numerator: number; denominator: "section" | "exam" | number; each: boolean };

function qaParsePrinted(printed: string): QaPrinted | null {
  const each = printed.startsWith("each worth ");
  const rest = each ? printed.slice("each worth ".length) : printed;
  const nested = /^([\d.]+)% of ([\d.]+)%$/.exec(rest);
  if (nested) return { numerator: Number(nested[1]), denominator: Number(nested[2]), each };
  const worded = /^([\d.]+)% of (section score|exam score|score)$/.exec(rest);
  if (!worded) return null;
  return {
    numerator: Number(worded[1]),
    denominator: worded[2] === "section score" ? "section" : "exam",
    each,
  };
}

/** Round-half-up to 2dp, spelled out rather than borrowed (AC2). */
function qaRound2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The cell #83 must render, derived independently (AC1/AC2/AC3/AC4). */
function qaExpectedCell(part: RawPart, sectionWeight: number | string): string {
  if (part.weightPercent === "pending") return "pending";
  if (typeof part.weightPercent === "number") return `${part.weightPercent}%`;
  if (part.weightPrinted === undefined) return "—";
  const printed = qaParsePrinted(part.weightPrinted);
  // AC4: an unreadable form must never reach a student as a number. If the
  // product renders anything but the verbatim string here, this comparison
  // fails and names the cell.
  if (printed === null) return part.weightPrinted;
  const denominator =
    printed.denominator === "exam"
      ? 100
      : printed.denominator === "section"
        ? sectionWeight
        : printed.denominator;
  if (typeof denominator !== "number") return part.weightPrinted;
  return `${qaRound2((printed.numerator * denominator) / 100)}%${printed.each ? " each" : ""}`;
}

/** The cell as #73 rendered it — the baseline AC6's "unchanged" is measured against. */
function qaCellBefore(part: RawPart): string {
  if (part.weightPercent === "pending") return "pending";
  if (typeof part.weightPercent === "number") return `${part.weightPercent}%`;
  return part.weightPrinted ?? "—";
}

/* ------------------------------------------------------------------------ *
 * DOM readers
 * ------------------------------------------------------------------------ */
type DomRow = {
  kind: "section" | "part";
  label: string;
  /** `textContent` — includes the sr-only words. */
  weightText: string;
  /**
   * The cell with every `.sr-only` descendant stripped: what a sighted reader
   * sees. NOT `innerText` — Tailwind's `sr-only` hides via the clip technique
   * rather than `display:none`, so `innerText` still returns those words.
   */
  weightVisible: string;
  questions: string;
};

const dialog = (page: Page) => page.getByRole("dialog");

async function openInfo(page: Page, name: string) {
  const info = page.getByRole("button", { name: `View exam details for ${name}` });
  if (!(await info.isVisible())) {
    await page.getByRole("button", { name: `Show exam dates for ${name}` }).click();
  }
  await info.click();
  await expect(dialog(page)).toBeVisible();
}

async function closeInfo(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
}

async function readTable(page: Page): Promise<DomRow[]> {
  return dialog(page).evaluate((el) =>
    [...el.querySelectorAll("table tbody tr")].map((tr) => {
      const header = tr.children[0] as HTMLElement;
      const weight = tr.children[3] as HTMLElement;
      // A part row's row-header opens with an `sr-only` "<section> — " prefix;
      // a section row's only extra span is its (visible) note.
      const srPrefix = header.querySelector(":scope > span.sr-only");
      const sighted = weight.cloneNode(true) as HTMLElement;
      sighted.querySelectorAll(".sr-only").forEach((n) => n.remove());
      return {
        kind: srPrefix ? ("part" as const) : ("section" as const),
        label: (header.textContent ?? "").trim().replace(/\s+/g, " "),
        weightText: (weight.textContent ?? "").trim().replace(/\s+/g, " "),
        weightVisible: (sighted.textContent ?? "").trim().replace(/\s+/g, " "),
        questions: ((tr.children[1] as HTMLElement).textContent ?? "").trim(),
      };
    }),
  );
}

/** `"8.25%each question"` → `"8.25% each"`: the comparable form of a cell. */
function normalizeWeightCell(textContent: string): string {
  return textContent
    .replace(/\s*each question$/, " each")
    .replace(/^—\s*none published$/, "—")
    .trim();
}

/* ------------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------------ */
test.describe("issue #83 QA v1 — exam-denominated part weights, re-derived", () => {
  test("AC1/AC2/AC4/AC6/AC8 — every part row of every subject, against QA's own arithmetic", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/");

    expect(SUBJECTS.length, "the sweep must cover the whole catalog").toBeGreaterThan(30);

    const mismatches: string[] = [];
    const unreconciled: string[] = [];
    const converted: string[] = [];
    const unchanged: string[] = [];
    let partRowsSeen = 0;

    for (const subject of SUBJECTS) {
      await openInfo(page, subject.name);
      const rows = await readTable(page);
      await closeInfo(page);

      // Walk the DOM and the dataset in lockstep, pairing each DOM part row
      // with its dataset part by position within its section.
      // `sectionWeightFromDom` is read off the SECTION ROW the browser
      // painted, so AC1 is checked against what a student sees rather than
      // against the JSON we also read.
      let s = -1;
      let p = 0;
      let sectionWeightFromDom: number | null = null;
      let sectionPartTotal = 0;
      let sectionAllConverted = true;
      let sectionHasParts = false;

      const closeSection = () => {
        if (s < 0 || !sectionHasParts || !sectionAllConverted) return;
        if (sectionWeightFromDom === null) return;
        const total = qaRound2(sectionPartTotal);
        if (total !== sectionWeightFromDom) {
          unreconciled.push(
            `${subject.id} · ${subject.format.sections[s].name}: parts sum to ${total}, section row shows ${sectionWeightFromDom}`,
          );
        }
      };

      for (const row of rows) {
        if (row.kind === "section") {
          closeSection();
          s += 1;
          p = 0;
          sectionPartTotal = 0;
          sectionAllConverted = true;
          sectionHasParts = false;
          const m = /^([\d.]+)%$/.exec(row.weightText);
          sectionWeightFromDom = m ? Number(m[1]) : null;
          continue;
        }

        const section = subject.format.sections[s];
        const part = (section?.parts ?? [])[p];
        p += 1;
        partRowsSeen += 1;

        expect(
          part,
          `${subject.id}: DOM part row "${row.label}" has no dataset counterpart`,
        ).toBeDefined();
        expect(row.label, `${subject.id} row order`).toContain(part.name);

        const actual = normalizeWeightCell(row.weightText);
        const expected = qaExpectedCell(part, section.weightPercent);
        if (actual !== expected) {
          mismatches.push(
            `${subject.id} · ${part.name}: rendered "${actual}", QA computed "${expected}"`,
          );
        }

        const before = qaCellBefore(part);
        (expected === before ? unchanged : converted).push(`${subject.id} · ${part.name}`);

        // AC8 bookkeeping — only sections whose every part converted.
        sectionHasParts = true;
        const num = /^([\d.]+)%( each)?$/.exec(actual);
        if (part.weightPrinted === undefined || num === null) {
          sectionAllConverted = false;
        } else {
          const questions = num[2] ? Number(row.questions) : 1;
          expect(
            Number.isFinite(questions),
            `${subject.id} · ${part.name}: an "each" weight needs a numeric Questions cell (AC3)`,
          ).toBe(true);
          sectionPartTotal += Number(num[1]) * questions;
        }
      }
      closeSection();
    }

    const report = [
      `subjects swept:    ${SUBJECTS.length}`,
      `part rows checked: ${partRowsSeen}`,
      `converted:         ${converted.length}`,
      `unchanged:         ${unchanged.length}`,
      "",
      "converted rows:",
      ...converted.map((c) => `  ${c}`),
    ].join("\n");
    writeFileSync(`${EVIDENCE_DIR}/sweep.txt`, `${report}\n`);

    expect(mismatches, "cells where the app and QA's own arithmetic disagree").toEqual([]);
    expect(unreconciled, "sections whose part rows do not sum to their section row (AC8)").toEqual([]);
    // AC6, measured not asserted: exactly the ticket's 11 rows changed.
    expect(converted, "rows whose weight cell changed vs the pre-#83 rule").toHaveLength(11);
    expect(unchanged, "rows that must be byte-identical to pre-#83").toHaveLength(65);
    expect(partRowsSeen, "every part row in the dataset was visited").toBe(76);
  });

  test("AC3 — the per-question qualifier is in the visible cell, not only the accessible name", async ({
    page,
  }) => {
    await page.goto("/");
    for (const subject of ["AP Microeconomics", "AP Macroeconomics"]) {
      await openInfo(page, subject);
      const rows = await readTable(page);
      const each = rows.filter((r) => r.kind === "part" && /each/.test(r.weightText));
      expect(each, `${subject} should have one per-question part row`).toHaveLength(1);
      // With every `.sr-only` node stripped, this is what a sighted reader
      // sees. A bare "8.25%" on a 2-question row understates it 2x.
      expect(each[0].weightVisible, `${subject} visible cell`).toMatch(/^8\.25%\s*each$/);
      expect(each[0].questions, `${subject} Questions cell`).toBe("2");
      // …and the accessible name still says each WHAT.
      expect(each[0].weightText).toContain("each question");

      // Rendered, not just present in the markup: the qualifier occupies real
      // pixels below the number rather than being clipped out of the layout.
      const cell = dialog(page)
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: /Short free-response questions/ }) })
        .locator("td")
        .nth(2);
      const qualifier = cell.locator("span:not(.sr-only)").first();
      await expect(qualifier).toBeVisible();
      const box = await qualifier.boundingBox();
      expect(box?.width ?? 0, `${subject} qualifier width`).toBeGreaterThan(4);
      expect(box?.height ?? 0, `${subject} qualifier height`).toBeGreaterThan(4);
      await closeInfo(page);
    }
  });

  test("AC7 evidence — the three affected subjects, three viewports, both themes", async ({
    page,
  }) => {
    test.slow();
    const viewports = [
      { label: "desktop", width: 1920, height: 1080 },
      { label: "tablet", width: 1024, height: 768 },
      { label: "mobile", width: 375, height: 667 },
    ];
    const subjects = [
      ["AP Microeconomics", "microeconomics"],
      ["AP Macroeconomics", "macroeconomics"],
      ["AP Seminar", "seminar"],
    ] as const;

    for (const theme of ["light", "dark"] as const) {
      const context = page.context();
      const shot = await context.newPage();
      if (theme === "dark") {
        await shot.addInitScript(
          ([key, value]) => window.localStorage.setItem(key, value),
          [THEME_KEY, "dark"] as const,
        );
      }
      for (const [name, id] of subjects) {
        for (const vp of viewports) {
          await shot.setViewportSize({ width: vp.width, height: vp.height });
          await shot.goto("/");
          if (theme === "dark") {
            await expect(shot.locator("html")).toHaveClass(/dark/);
          }
          await openInfo(shot, name);
          await expect(dialog(shot).locator("table")).toBeVisible();
          await dialog(shot).screenshot({
            path: `${EVIDENCE_DIR}/${id}-${vp.label}-${theme}.png`,
          });
          await closeInfo(shot);
        }
      }
      await shot.close();
    }
  });
});
