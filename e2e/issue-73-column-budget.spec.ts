import { test, expect, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * Builder gate for Jon's SECOND #73 bounce (2026-07-25) — the shared sections
 * table budgets its columns.
 *
 * ## What was wrong
 *
 * `SectionsTable` rendered `<table class="w-full border-collapse">` with no
 * width control, so the browser's auto layout negotiated every column from its
 * content. The Section cell holds `section.note` — free prose, up to 108
 * characters on AP Comparative Government — and a long note simply won that
 * negotiation: Questions / Length / Weight collapsed into a cramped strip at
 * the right edge (`4 · 1 h 30 min · 50%` jammed together). It was never a
 * Comparative Government bug; it was a property of the shared table, and every
 * subject's layout was one dataset edit away from it.
 *
 * ## What this suite pins, and why in this form
 *
 * The fix is a `<colgroup>` under `table-fixed`, so the honest statement of
 * "column widths must not depend on note length" is a COMPARISON, not a
 * pixel: the subject with the longest note must produce the same four column
 * widths as a subject with no note at all, at the same viewport. That holds on
 * any machine, in any font, at any dialog width — an exact-px assertion would
 * pass here and rot on the next font change.
 *
 * Two column contents can still exceed their budget, and the interesting claim
 * is that they wrap INSIDE it rather than widening it: a published length
 * ("1 h 30 min") and a part's printed weight ("each worth 25% of section
 * score", AC5's "same defect class in a different column"). Both are asserted
 * against the same control widths.
 *
 * Overflow is measured as `scrollWidth > clientWidth` per cell rather than by
 * eye, and swept across every subject that has sections at four widths, since
 * a budget that fits the five subjects a human would check and clips the sixth
 * is worse than no budget at all.
 *
 * No test title here carries a literal roster count — see the note in
 * `e2e/issue-73-qa-v2.spec.ts` and the #71 AC5 guard in
 * `src/data/doc-freshness.test.ts`. The counts that matter are `expect()`ed
 * inside the sweeps, where they can actually fail.
 */

const EVIDENCE_DIR = evidenceDir("issue-73-column-budget");
const THEME_KEY = "apx.theme.v1";

type Section = { name: string; note?: string };
type Subject = { id: string; name: string; format: { sections: Section[] } };

const SUBJECTS = apData.subjects as unknown as Subject[];
const WITH_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length > 0);
const byId = (id: string): Subject => {
  const subject = SUBJECTS.find((s) => s.id === id);
  if (!subject) throw new Error(`unknown subject id in spec fixture: ${id}`);
  return subject;
};

/** The subject whose Section cell holds the most prose — the reported case. */
const LONGEST_NOTE = byId("comparative-government-and-politics");
/** Publishes no section note at all: the control the budget must match. */
const NO_NOTE = byId("calculus-bc");
/** The longest printed part weight in the dataset (AC5). */
const LONGEST_PRINTED_WEIGHT = byId("macroeconomics");

const dialog = (page: Page) => page.getByRole("dialog");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

async function openInfo(page: Page, name: string) {
  if (!(await infoButton(page, name).isVisible())) {
    await expandButton(page, name).click();
  }
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeInfo(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
}

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

/** The four column widths, read off the header row the columns actually size. */
async function columnWidths(page: Page): Promise<number[]> {
  return dialog(page).evaluate((el) =>
    [...el.querySelectorAll("table thead th")].map(
      (th) => Math.round(th.getBoundingClientRect().width * 100) / 100,
    ),
  );
}

/** Every cell whose content is wider than the box it was given. */
async function clippedCells(page: Page) {
  return dialog(page).evaluate((el) =>
    [...el.querySelectorAll("table th, table td")]
      .map((cell) => ({
        text: cell.textContent!.trim().replace(/\s+/g, " ").slice(0, 48),
        overflow: cell.scrollWidth - cell.clientWidth,
      }))
      .filter((c) => c.overflow > 1),
  );
}

test.describe("issue #73 second bounce — the sections table budgets its columns", () => {
  test("AC1 — the longest section note produces the same four column widths as a subject with no note: the budget is declared, not negotiated with the content", async ({
    page,
  }) => {
    // Both dialogs are the same width (`max-w-lg`), so equal column widths can
    // only come from a declared budget. Under the auto layout this branch
    // replaces, the note-carrying subject's Section column was wider and its
    // three numeric columns correspondingly narrower — that difference IS the
    // reported defect, and its absence is the fix.
    for (const width of [1920, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      await openInfo(page, NO_NOTE.name);
      const control = await columnWidths(page);
      await closeInfo(page);

      await openInfo(page, LONGEST_NOTE.name);
      const longNote = await columnWidths(page);
      await closeInfo(page);

      expect(control, `${width}px: four columns`).toHaveLength(4);
      for (const [i, w] of longNote.entries()) {
        expect(
          w,
          `${width}px: column ${i} moved with the note (${longNote.join("/")} vs control ${control.join("/")})`,
        ).toBeCloseTo(control[i], 1);
      }

      // And the budget is a real split, not four equal quarters: the section
      // names get the remainder, which is what the numeric columns stopped
      // taking.
      const [section, ...numeric] = longNote;
      for (const [i, w] of numeric.entries()) {
        expect(w, `${width}px: numeric column ${i} has no room`).toBeGreaterThan(
          48,
        );
        expect(section, `${width}px: section column starved`).toBeGreaterThan(w);
      }
    }
  });

  test("AC1 + AC4 — every subject with sections gets the identical budget at a given width, so no dataset edit can re-open the defect in one card", async ({
    page,
  }) => {
    test.slow();
    expect(
      WITH_SECTIONS.length,
      "the sweep must cover every subject that renders a table",
    ).toBeGreaterThan(30);

    for (const width of [1920, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const signatures = new Map<string, string[]>();
      for (const subject of WITH_SECTIONS) {
        await openInfo(page, subject.name);
        const signature = (await columnWidths(page)).join("/");
        signatures.set(signature, [
          ...(signatures.get(signature) ?? []),
          subject.id,
        ]);
        await closeInfo(page);
      }
      expect(
        [...signatures.keys()],
        `${width}px: subjects disagree on column widths — ${[...signatures.entries()]
          .map(([sig, ids]) => `${sig} (${ids.length})`)
          .join(", ")}`,
      ).toHaveLength(1);
    }
  });

  test("AC2 + AC5 — the two contents that can exceed their budget wrap inside it: a long note in the Section column and a printed weight in the Weight column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/");

    await openInfo(page, NO_NOTE.name);
    const control = await columnWidths(page);
    await closeInfo(page);

    // AC2 — the note wraps: more than one line tall, and no wider than the
    // column that holds it.
    await openInfo(page, LONGEST_NOTE.name);
    const note = LONGEST_NOTE.format.sections.find((s) => s.note)!.note!;
    expect(note.length, "fixture drifted — this subject's note is short now").toBeGreaterThan(
      80,
    );
    const noteBox = await dialog(page)
      .locator("table th span", { hasText: note })
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(el).lineHeight);
        return { width: r.width, lines: Math.round(r.height / line) };
      });
    expect(noteBox.lines, "the note is on one line — it did not wrap").toBeGreaterThan(1);
    expect(
      noteBox.width,
      "the note is wider than the Section column it lives in",
    ).toBeLessThanOrEqual(control[0] + 1);
    expect(await clippedCells(page), "clipped cells (long note)").toEqual([]);
    await closeInfo(page);

    // AC5 — same rule, different column: the printed weight is verbatim text
    // in a cell, and it must wrap rather than widen the Weight column.
    await openInfo(page, LONGEST_PRINTED_WEIGHT.name);
    const withPrinted = await columnWidths(page);
    for (const [i, w] of withPrinted.entries()) {
      expect(
        w,
        `column ${i} widened for a printed weight (${withPrinted.join("/")} vs ${control.join("/")})`,
      ).toBeCloseTo(control[i], 1);
    }
    const printed = dialog(page).getByText("each worth 25% of section score");
    await expect(printed).toBeVisible();
    const printedBox = await printed.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(el).lineHeight);
      return { width: r.width, lines: Math.round(r.height / line) };
    });
    expect(printedBox.lines, "the printed weight did not wrap").toBeGreaterThan(1);
    expect(
      printedBox.width,
      "the printed weight is wider than the Weight column",
    ).toBeLessThanOrEqual(withPrinted[3] + 1);
    expect(await clippedCells(page), "clipped cells (printed weight)").toEqual([]);
    await closeInfo(page);
  });

  test("AC3 — nothing is crunched: no cell in any subject's table overflows its budgeted column, from the narrowest supported width up", async ({
    page,
  }) => {
    test.slow();
    const problems: string[] = [];
    for (const width of [320, 375, 1024, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      for (const subject of WITH_SECTIONS) {
        await openInfo(page, subject.name);
        for (const cell of await clippedCells(page)) {
          problems.push(
            `${width}px ${subject.id}: +${cell.overflow}px "${cell.text}"`,
          );
        }
        const fits = await dialog(page).evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        );
        if (!fits) problems.push(`${width}px ${subject.id}: dialog scrolls sideways`);
        await closeInfo(page);
      }
    }
    expect(problems, "cells overflowing their budgeted column").toEqual([]);
  });

  test("AC3 — a published duration breaks only between its units, so a narrow Length column never shows a half-read number", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    await openInfo(page, LONGEST_NOTE.name);

    // The text a screen reader and every existing spec see is unchanged...
    const lengthCell = dialog(page)
      .getByRole("row")
      .filter({ hasText: "Section II" })
      .getByRole("cell")
      .nth(1);
    await expect(lengthCell).toHaveText("1 h 30 min");

    // ...while on screen the only breakable space is the one between "1 h"
    // and "30 min": each group is nowrap, so the column can be narrower than
    // the whole phrase without ever rendering "1 h 30" / "min".
    const groups = await lengthCell.locator("span").evaluateAll((spans) =>
      spans.map((s) => ({
        text: s.textContent,
        nowrap: getComputedStyle(s).whiteSpace === "nowrap",
      })),
    );
    expect(groups.map((g) => g.text)).toEqual(["1 h", "30 min"]);
    expect(groups.every((g) => g.nowrap)).toBe(true);
    await closeInfo(page);
  });

  test("AC6 — the budget did not flatten the honest-degradation states: the pending pill, the not-published dash and a verbatim range stay three distinct things", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");

    // AAS's Individual Student Project carries an omission and a pending side
    // by side — the row most at risk from a column that got too narrow to
    // hold the pill.
    await openInfo(page, byId("african-american-studies").name);
    const project = dialog(page)
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: "Individual Student Project", exact: true }) });
    await expect(project.getByRole("cell").nth(0)).toContainText("none published");
    await expect(project.getByRole("cell").nth(1)).toHaveText("pending");
    await expect(project.getByRole("cell").nth(1)).not.toContainText(
      "none published",
    );
    expect(await clippedCells(page), "clipped cells (pending pill)").toEqual([]);
    await closeInfo(page);

    // A published range is verbatim AND unsplittable — "65–" on one line and
    // "70 min" on the next would read as a different published value.
    await openInfo(page, byId("french-language-and-culture").name);
    const range = dialog(page)
      .getByRole("row")
      .filter({ hasText: "Section I: Free-Response" })
      .first()
      .getByRole("cell")
      .nth(1);
    await expect(range).toHaveText("65–70 min");
    const rangeGroups = await range.locator("span").evaluateAll((spans) =>
      spans.map((s) => ({
        text: s.textContent,
        nowrap: getComputedStyle(s).whiteSpace === "nowrap",
      })),
    );
    expect(rangeGroups[0].text).toBe("65–70");
    expect(rangeGroups[0].nowrap).toBe(true);
    await closeInfo(page);
  });

  test("AC7 — evidence at the extremes: the longest note and the longest printed weight, light and dark", async ({
    page,
  }, testInfo) => {
    const viewports = [
      { label: "desktop", width: 1920, height: 1080 },
      { label: "tablet", width: 1024, height: 768 },
      { label: "mobile", width: 375, height: 667 },
    ];
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await seedDarkTheme(page);
      for (const subject of [LONGEST_NOTE, LONGEST_PRINTED_WEIGHT]) {
        for (const vp of viewports) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto("/");
          await openInfo(page, subject.name);
          expect(
            await clippedCells(page),
            `${subject.id} ${theme} ${vp.label}`,
          ).toEqual([]);
          const pageFits = await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          );
          expect(pageFits, `${subject.id} ${theme} ${vp.label}: page scrolls`).toBe(
            true,
          );
          await dialog(page).screenshot({
            path: `${EVIDENCE_DIR}/${subject.id}-${theme}-${vp.label}.png`,
          });
          await closeInfo(page);
        }
      }
    }
    testInfo.annotations.push({ type: "evidence", description: EVIDENCE_DIR });
  });
});
