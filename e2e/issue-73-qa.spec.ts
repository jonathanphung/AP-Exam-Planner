import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * super-board QA (issue #73) — standardized subject-card exam format +
 * published per-part score weights.
 *
 * This is the QA lane's own gate, written independently of the builder's
 * specs. It exercises the four rendering states the ticket's D1 decision
 * created, on the five subjects the ticket names, and it proves the two
 * things a student could actually be harmed by:
 *
 *   1. A section-denominated weight must NEVER surface as a bare `N%`.
 *      AP Macroeconomics' long free-response question is 50% *of Section II*,
 *      and Section II is 33% of the exam. Rendering `50%` in the same column
 *      the section row uses for exam share would tell a student one question
 *      is half their grade.
 *   2. A nested weight must NEVER be multiplied out. AP Seminar shipped
 *      `13.5%` / `31.5%` on main — those are `30% of 45%` and `70% of 45%`
 *      multiplied, i.e. numbers College Board prints nowhere.
 *
 * Both are asserted as absences, because a regression here reintroduces a
 * plausible number rather than an obvious blank.
 *
 * **Issue #83 (2026-07-25) amends #2, and only #2.** Multiplying a part weight
 * by its own section's published share is now what these cells do: 16.5%,
 * 8.25% each, 10%, 24.5%, 13.5%, 31.5%. Rule #1 is untouched and still
 * asserted — relabelling the printed 50 as an exam share is a different
 * operation from multiplying it by 33, and it is still the thing that would
 * tell a student one question is half their grade. AP Seminar's 13.5/31.5 come
 * back as PART rows under College Board's own 45% End-of-Course Exam section,
 * never as the two invented sections that carried them before #73.
 *
 * Subjects under test, one per rendering state:
 *   AP Calculus BC     — exam-denominated part weights (35% / 15% / 16.7% / 33.3%)
 *   AP Macroeconomics  — section-denominated, converted ("50% of section score" → 16.5%)
 *   AP Seminar         — nested, converted ("50% of 20%" → 10% … "70% of 45%" → 31.5%)
 *   AP Japanese        — D3 un-merge: Q3/Q4 are separate 7.5% rows, like AP Chinese
 *   AP Art History     — parts present, weights honestly dashed (CB prints none)
 *
 * Locator note: a part row's `<th scope="row">` carries an sr-only
 * `"<section name> — "` prefix, so a part rowheader's accessible name is
 * `"Section I: Multiple Choice — Part A none published"`-shaped. Part matchers
 * here are therefore unanchored substrings, and the not-published affordance is
 * asserted through its sr-only label (`none published`) rather than the
 * aria-hidden em-dash glyph.
 */

const EVIDENCE_DIR = evidenceDir("issue-73-qa-v1");
const SELECTION_KEY = "apx.selection.v1";
const THEME_KEY = "apx.theme.v1";

/** The sr-only label the not-published dash carries. */
const NONE_PUBLISHED = "none published";

const dialog = (page: Page) => page.getByRole("dialog");

const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

async function openInfo(page: Page, name: string) {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeInfo(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
}

const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

type Part = {
  name: string;
  weightPercent?: number | string;
  weightPrinted?: string;
};
type Section = { name: string; parts?: Part[] };
type Subject = { id: string; name: string; format?: { sections?: Section[] } };

const subjects = apData.subjects as unknown as Subject[];

test.describe("issue #73 — printed section titles + per-part weights", () => {
  test("AC2 — exam-denominated part weights render as N% on AP Calculus BC; the hardcoded dash is gone", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus BC");

    // Printed section titles carry College Board's Roman prefix (AC5 / D2).
    await expect(row(page, /^Section I: Multiple Choice$/)).toHaveCount(1);
    await expect(row(page, /^Section II: Free Response$/)).toHaveCount(1);

    // Section I: Part A 35%, Part B 15%. Section II: Part A 16.7%, Part B 33.3%.
    const partRows = dialog(page)
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: /— Part [AB]/ }) });
    await expect(partRows).toHaveCount(4);

    const texts = await partRows.allInnerTexts();
    const joined = texts.join("\n");
    for (const weight of ["35%", "15%", "16.7%", "33.3%"]) {
      expect(joined, `part weight ${weight} must render`).toContain(weight);
    }

    // No part row still shows the pre-#73 unconditional not-published cell.
    for (const [i, text] of texts.entries()) {
      expect(text, `part row ${i} still unpublished: ${text}`).not.toContain(
        NONE_PUBLISHED,
      );
    }
  });

  test("AC2 (as amended by #83) — a section-denominated weight is multiplied by its section's share, and the printed numerator is never relabelled (AP Macroeconomics)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Macroeconomics");

    // 50% of a Section II worth 33% of the exam is 16.5% of the exam.
    await expect(row(page, /Long free-response question/)).toContainText(
      "16.5%",
    );
    // 25% of the same section is 8.25% — PER QUESTION, on a 2-question row.
    const shortFrqs = row(page, /Short free-response questions/);
    await expect(shortFrqs).toContainText("8.25%");
    await expect(shortFrqs).toContainText("each");

    const body = (await dialog(page).innerText()).replace(/\s+/g, " ");
    // The relative phrasing is what the conversion replaces …
    expect(body).not.toMatch(/of section score/);
    // … and the failure mode #73 named is still forbidden: the printed 50 and
    // 25 must never appear as this exam's part weights, which is exactly what
    // relabelling (rather than multiplying) would produce. The lookbehind-free
    // guard skips the "25" inside "8.25%".
    const partRowText = (
      await dialog(page)
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: /free-response q/ }) })
        .allInnerTexts()
    ).join(" | ");
    expect(partRowText, "the printed 50 was relabelled as an exam share").not.toMatch(
      /(^|[^\d.])50%/,
    );
    expect(partRowText, "the printed 25 was relabelled as an exam share").not.toMatch(
      /(^|[^\d.])25%/,
    );
  });

  test("AC10 (as amended by #83) — AP Seminar's nested weights are multiplied out at PART level; the sections are still College Board's own three", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Seminar");

    const expected: [RegExp, string][] = [
      [/Individual research report \(1,200 words\)/, "10%"],
      [/Team multimedia presentation and defense/, "10%"],
      [/Individual written argument \(2,000 words\)/, "24.5%"],
      [/Individual multimedia presentation/, "7%"],
      [/Oral defense/, "3.5%"],
      [/Understanding and analyzing an argument/, "13.5%"],
      [/Evidence-Based argument essay/, "31.5%"],
    ];
    for (const [name, weight] of expected) {
      await expect(row(page, name), `${name} → ${weight}`).toContainText(weight);
    }

    const body = await dialog(page).innerText();
    // No arithmetic is left for the reader to do.
    expect(body).not.toMatch(/% of \d+%/);
    // 13.5 / 31.5 are back — but as PART rows under a 45% End-of-Course Exam,
    // never as the two invented SECTIONS main used to carry in their place.
    await expect(row(page, /^End-of-Course Exam$/)).toContainText("45%");
    await expect(row(page, /Short-Answer/)).toHaveCount(0);
  });

  test("D3 — AP Japanese and AP Chinese model Questions 3 and 4 identically: two 7.5% rows, no summed 15%", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Japanese Language and Culture");

    await expect(row(page, /Question 3: Story Narration/)).toContainText("7.5%");
    await expect(row(page, /Question 4: Email Response/)).toContainText("7.5%");
    // The merged row main shipped is gone, and its 15% sum was never invented.
    await expect(
      dialog(page).getByText(/Story Narration \+ Question 4/),
    ).toHaveCount(0);
    // The joint printed length survives as prose, not as a fabricated split.
    await expect(row(page, /Question 3: Story Narration/)).toContainText(
      "Questions 3 & 4 combined 30 minutes",
    );

    await closeInfo(page);
    await openInfo(page, "AP Chinese Language and Culture");
    await expect(row(page, /Question 3: Story Narration/)).toContainText("7.5%");
    await expect(row(page, /Question 4: Email Response/)).toContainText("7.5%");
  });

  test("AC8 — AP Art History reaches structural parity with Calculus BC but keeps six honest dashes: its Section II 50% is never divided by six", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Art History");

    // Structural parity: printed Roman titles + question rows under Section II.
    await expect(row(page, /^Section I: Multiple Choice$/)).toHaveCount(1);
    await expect(row(page, /^Section II: Free Response$/)).toHaveCount(1);

    const questionRows = dialog(page)
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: /— Question [1-6]:/ }) });
    await expect(questionRows).toHaveCount(6);

    // Content parity is impossible: CB prints no per-question weight, so every
    // one of the six weight cells is not-published — and 8.3% (50/6) is absent.
    for (const text of await questionRows.allInnerTexts()) {
      expect(text, `"${text}" should carry the not-published affordance`).toContain(
        NONE_PUBLISHED,
      );
    }
    const body = await dialog(page).innerText();
    expect(body).not.toMatch(/8\.3\s*%/);
  });

  test("AC5 — no subject uses a bare 'Multiple Choice' / 'Free Response' title or the Arabic 'Section 1:' form", async ({
    page,
  }) => {
    const offenders: string[] = [];
    for (const s of subjects) {
      for (const sec of s.format?.sections ?? []) {
        if (
          /^(Multiple[- ]Choice|Free[- ]Response|Written Response)$/i.test(
            sec.name,
          )
        ) {
          offenders.push(`${s.id} → bare "${sec.name}"`);
        }
        if (/^Section \d/.test(sec.name)) {
          offenders.push(`${s.id} → Arabic "${sec.name}"`);
        }
      }
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);

    // Spot-check that a formerly-bare subject paints the printed form.
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(dialog(page)).toContainText("Section I: Multiple Choice");
    await expect(dialog(page)).toContainText("Section II: Free Response");
  });

  test("AC15 — every populated part weight traces to a printed value in the committed capture (no invented weights)", async () => {
    const unverified: string[] = [];
    for (const s of subjects) {
      const sections = s.format?.sections ?? [];
      if (sections.length === 0) continue;
      const lines = readFileSync(
        `docs/super-board/research/collegeboard-2027/pages/${s.id}.txt`,
        "utf8",
      ).split("\n");
      for (const sec of sections) {
        for (const part of sec.parts ?? []) {
          if (typeof part.weightPercent === "number") {
            const printed = String(part.weightPercent).replace(".", "\\.");
            const numberOnLine = new RegExp(`(?<![\\d.])${printed}\\s*%`);
            // The capture must print this number as a percent on a line whose
            // denominator is the EXAM score — never "of section score".
            const ok = lines.some(
              (line) =>
                numberOnLine.test(line) &&
                !/of\s+section\s+score/i.test(line) &&
                /%\s*of\s+(the\s+)?(AP\s+[\w\s]+?\s+)?(Exam\s+)?Score/i.test(
                  line,
                ),
            );
            if (!ok) {
              unverified.push(
                `${s.id} / ${part.name}: ${part.weightPercent}% is not printed as an exam-denominated weight`,
              );
            }
          }
          if (part.weightPrinted !== undefined) {
            const found = lines.some((line) =>
              line.toLowerCase().includes(part.weightPrinted!.toLowerCase()),
            );
            if (!found) {
              unverified.push(
                `${s.id} / ${part.name}: "${part.weightPrinted}" is not printed verbatim`,
              );
            }
          }
        }
      }
    }
    expect(unverified, unverified.join("\n")).toHaveLength(0);
  });

  test("AC3 — the .ics DESCRIPTION carries part weights in the same third slot the section row uses", async ({
    page,
  }) => {
    await seedSelection(page, ["calculus-bc", "macroeconomics", "art-history"]);
    await page.goto("/");

    await page.getByTestId("export-menu-button").click();
    const item = page.getByRole("menuitem", { name: "Save as .ics" });
    await expect(item).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await item.click();
    const download = await downloadPromise;
    const file = await download.path();
    // Unfold RFC 5545 continuation lines before matching.
    const ics = readFileSync(file!, "utf8").replace(/\r?\n[ \t]/g, "");

    // Exam-denominated part → "35% of Score", matching the section convention.
    expect(ics).toMatch(/Part A[^\\]{0,60}35% of Score/);
    // Section-denominated part → multiplied into an exam share by #83, so the
    // flat text says what it means: 50% of a 33% section is 16.5% of the exam,
    // and the two short FRQs are 8.25% EACH (dropping "each" would understate
    // that row by a factor of two).
    expect(ics).toContain("Long free-response question: 1 Question | 16.5% of Score");
    expect(ics).toContain(
      "Short free-response questions: 2 Questions | 8.25% of Score each",
    );
    // No relative phrasing survives into a plain-text row that has no room to
    // qualify it — the reason #73 printed these verbatim in the first place.
    expect(ics).not.toContain("of section score");
    // Art History publishes no per-question weight: the segment is dropped, not
    // filled with a number or the word "pending".
    expect(ics).not.toMatch(/Long Essay.{0,40}% of Score/);
    expect(ics).not.toMatch(/Long Essay.{0,40}Weight pending/);
  });

  test.describe("visual evidence — the four weight states, light and dark", () => {
    const cases: [string, string][] = [
      ["AP Calculus BC", "calculus-bc"],
      ["AP Macroeconomics", "macroeconomics"],
      ["AP Seminar", "seminar"],
      ["AP Japanese Language and Culture", "japanese"],
      ["AP Art History", "art-history"],
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const [name, slug] of cases) {
        test(`evidence — ${slug} exam details (${theme})`, async ({ page }) => {
          if (theme === "dark") await seedDarkTheme(page);
          await page.setViewportSize({ width: 1920, height: 1080 });
          await page.goto("/");
          await openInfo(page, name);
          await dialog(page).screenshot({
            path: `${EVIDENCE_DIR}/${slug}-${theme}-desktop.png`,
          });
        });
      }
    }

    for (const [label, width, height] of [
      ["desktop", 1920, 1080],
      ["tablet", 1024, 768],
      ["mobile", 375, 667],
    ] as const) {
      test(`evidence — AP Calculus BC part weights at ${label} ${width}x${height}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        await openInfo(page, "AP Calculus BC");
        const fits = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        );
        expect(fits, `${label} must not scroll horizontally`).toBe(true);
        await page.screenshot({ path: `${EVIDENCE_DIR}/${label}.png` });
      });
    }
  });
});
