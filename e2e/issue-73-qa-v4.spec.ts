import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * super-board QA v4 (issue #73, Jon's SECOND Done → Ready bounce, 2026-07-25)
 * — the shared sections table budgets its columns.
 *
 * The defect Jon reported: a long grey `section.note` claimed the width, so
 * Questions / Length / Weight collapsed into a cramped strip at the right edge
 * (`4 · 1 h 30 min · 50%` jammed together on AP Comparative Government). The
 * builder's fix declares a `<colgroup>` under `table-fixed`.
 *
 * This lane's gate is deliberately NOT a re-run of the builder's
 * `issue-73-column-budget.spec.ts`. Three differences, each chosen because it
 * closes a way that suite could pass while the product is still wrong:
 *
 *   1. **The budget is attacked with content that does not exist in the
 *      dataset.** The builder compares two subjects: the longest note today
 *      vs a subject with none. That passes as long as today's longest note
 *      happens to fit — it does not establish that the column stops
 *      negotiating. Here the rendered note (and, for AC5, the rendered printed
 *      weight) is grown in the DOM by several hundred characters after the
 *      dialog is open, and the four column widths must not move by a pixel.
 *      Under the auto layout this branch replaces, that mutation is exactly
 *      what widened the Section column.
 *   2. **"Visually separated" is measured, not inferred from overflow.** The
 *      builder asserts no cell overflows its box. A cell can sit entirely
 *      inside its box and still have its digits touching the neighbour's —
 *      which is the crunch Jon actually saw. Every adjacent pair of rendered
 *      values in every row of every subject with sections is measured with a
 *      text Range (sr-only nodes excluded), and the gap must hold the declared
 *      gutter.
 *   3. **The seam the fix introduced is swept.** The budget switches from
 *      percentages to fixed rem at a 400px *viewport* media query, while the
 *      table's width follows the *dialog* — two different things. 399 / 400 /
 *      401 and the `sm` dialog seam at 639 / 640 / 641 are the widths where a
 *      mis-tuned step shows up, and none of them is in the builder's
 *      320 / 375 / 1024 / 1920 sweep.
 *
 * Honest degradation (AC6) is checked as assistive-tech output rather than
 * pixels, same discipline as QA v2: a width budget's most plausible regression
 * is a value silently squeezed to nothing, and a blank cell reads as "College
 * Board publishes nothing here" — a wrong claim, not a visible glitch.
 *
 * **No test title here carries a literal subject count**, per the #71 AC5
 * guard in `src/data/doc-freshness.test.ts` (it bounced QA v2). The counts that
 * matter are `expect()`ed inside the sweeps, where they can fail.
 */

const EVIDENCE_DIR = evidenceDir("issue-73-qa-v4");
const THEME_KEY = "apx.theme.v1";

/** The sr-only label the not-published dash carries. */
const NONE_PUBLISHED = "none published";

type Part = {
  name: string;
  weightPercent?: number | string;
  weightPrinted?: string;
};
type Section = {
  name: string;
  note?: string;
  minutes: number | string;
  parts?: Part[];
};
type Subject = { id: string; name: string; format: { sections: Section[] } };

const SUBJECTS = apData.subjects as unknown as Subject[];
const WITH_SECTIONS = SUBJECTS.filter((s) => s.format.sections.length > 0);
const byId = (id: string): Subject => {
  const subject = SUBJECTS.find((s) => s.id === id);
  if (!subject) throw new Error(`unknown subject id in spec fixture: ${id}`);
  return subject;
};

/** The subject Jon reported: the dataset's longest `section.note`. */
const REPORTED = byId("comparative-government-and-politics");
/** No note at all — the control the reported subject must match. */
const NO_NOTE = byId("calculus-bc");
/** Carries the longest printed part weight (AC5). */
const PRINTED_WEIGHT = byId("macroeconomics");
/** Carries the dataset's longest section/part name — the Section column's worst case. */
const LONGEST_NAME = byId("business-with-personal-finance");
/** Puts an unwrappable `pending` pill next to an omission dash (AC6). */
const PENDING_PILL = byId("african-american-studies");
/** Publishes a verbatim minute range (AC6). */
const RANGE = byId("french-language-and-culture");

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

/** The four column widths, read off the header row. */
async function columnWidths(page: Page): Promise<number[]> {
  return dialog(page).evaluate((el) =>
    [...el.querySelectorAll("table thead th")].map(
      (th) => Math.round(th.getBoundingClientRect().width * 100) / 100,
    ),
  );
}

/**
 * Per-row gaps between the *rendered text* of adjacent cells.
 *
 * Not `cell.getBoundingClientRect()` — a right-aligned value sits at the right
 * edge of a box that may be much wider, so box gaps say nothing about whether
 * the numbers are crowding each other. The tight box comes from a Range over
 * each cell's visible text nodes; `sr-only` nodes are excluded because they are
 * absolutely positioned 1px clips whose rects land nowhere near the cell.
 *
 * A wrapped multi-line value (the note, a printed weight) yields the union of
 * its lines, i.e. the full content width — so the reported gap collapses to
 * exactly the declared gutter. That is the conservative direction: the number
 * this returns is the guaranteed minimum separation, never a flattering one.
 */
async function valueGaps(page: Page) {
  return dialog(page).evaluate((el) => {
    const tightBox = (cell: Element) => {
      let left = Infinity;
      let right = -Infinity;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const parent = (node as Text).parentElement;
        if (parent?.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0.5 || rect.height <= 0.5) continue;
          left = Math.min(left, rect.left);
          right = Math.max(right, rect.right);
        }
      }
      return left === Infinity ? null : { left, right };
    };

    const out: { row: string; pair: string; gap: number }[] = [];
    for (const row of el.querySelectorAll("table tbody tr")) {
      const cells = [...row.children];
      const label = (cells[0]?.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      const boxes = cells.map(tightBox);
      for (let i = 0; i < boxes.length - 1; i++) {
        const a = boxes[i];
        const b = boxes[i + 1];
        if (!a || !b) continue;
        out.push({
          row: label,
          pair: `${i}→${i + 1}`,
          gap: Math.round((b.left - a.right) * 100) / 100,
        });
      }
    }
    return out;
  });
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

async function dialogFits(page: Page) {
  return dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
}

/** The gutter the component declares: 8px below the 400px step, 12px at and above it. */
const declaredGutter = (viewportWidth: number) => (viewportWidth >= 400 ? 12 : 8);

test.describe("issue #73 second bounce — QA v4: the column budget holds", () => {
  test("AC1 — the table declares its widths in CSS and the declaration is honored: fixed layout, four budgeted columns, and not the equal-quarters fallback", async ({
    page,
  }) => {
    // The failure the builder hit while writing the fix was silent: Chrome
    // ignores `width: min(5.5rem, 27%)` on a <col> and falls back to dividing
    // the table into four equal parts. The markup still looks budgeted, so
    // "there is a colgroup" is not evidence — the widths have to disagree
    // with each other.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await openInfo(page, REPORTED.name);

    const layout = await dialog(page).evaluate((el) => {
      const table = el.querySelector("table")!;
      return {
        tableLayout: getComputedStyle(table).tableLayout,
        cols: table.querySelectorAll("colgroup col").length,
      };
    });
    expect(layout.tableLayout, "the table still auto-sizes from its content").toBe(
      "fixed",
    );
    expect(layout.cols, "no per-column budget is declared").toBe(4);

    const widths = await columnWidths(page);
    expect(widths).toHaveLength(4);
    const quarters = widths.every((w) => Math.abs(w - widths[0]) < 1);
    expect(
      quarters,
      `all four columns are the same width (${widths.join("/")}) — the colgroup was ignored and the browser divided the table equally`,
    ).toBe(false);
    // The section names get the remainder, so the Section column is the widest
    // one — and every numeric column still has real room.
    for (const [i, w] of widths.slice(1).entries()) {
      expect(w, `numeric column ${i} has no room`).toBeGreaterThan(48);
      expect(widths[0], `numeric column ${i} outgrew the Section column`).toBeGreaterThan(w);
    }
    await closeInfo(page);
  });

  test("AC1 + AC2 — content cannot buy width: growing the rendered note by several hundred characters moves no column, and the note wraps inside its budget", async ({
    page,
  }) => {
    // The strongest form of "column widths must not depend on note length" is
    // not "today's longest note fits" — it is "no note can widen the column".
    // Mutating the already-rendered text is the only way to state that: it
    // feeds the layout content the dataset does not contain, and it is exactly
    // the mutation that widened the Section column under the auto layout.
    for (const width of [1920, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      await openInfo(page, NO_NOTE.name);
      const control = await columnWidths(page);
      await closeInfo(page);

      await openInfo(page, REPORTED.name);
      const note = REPORTED.format.sections.find((s) => s.note)!.note!;
      expect(
        note.length,
        "fixture drifted — the reported subject's note is short now",
      ).toBeGreaterThan(80);

      const before = await columnWidths(page);
      for (const [i, w] of before.entries()) {
        expect(
          w,
          `${width}px: column ${i} moved with the shipped note (${before.join("/")} vs control ${control.join("/")})`,
        ).toBeCloseTo(control[i], 1);
      }

      // Grow it. React is not re-rendering an open dialog, so the mutation
      // stands and the layout has to absorb it.
      const grown = await dialog(page).evaluate((el) => {
        const span = [...el.querySelectorAll("table tbody th span")].find(
          (s) => !s.classList.contains("sr-only") && s.textContent!.length > 40,
        );
        if (!span) return null;
        span.textContent =
          span.textContent +
          " " +
          "supplementary explanatory material of the kind College Board sometimes prints beneath a section heading".repeat(
            4,
          );
        return true;
      });
      expect(grown, "no note span found to grow — fixture drifted").toBe(true);

      const after = await columnWidths(page);
      for (const [i, w] of after.entries()) {
        expect(
          w,
          `${width}px: column ${i} widened for longer prose (${after.join("/")} vs ${before.join("/")}) — the columns are still negotiated, not budgeted`,
        ).toBeCloseTo(before[i], 1);
      }
      expect(
        await clippedCells(page),
        `${width}px: the grown note spilled out of its column instead of wrapping`,
      ).toEqual([]);
      expect(await dialogFits(page), `${width}px: the dialog scrolls sideways`).toBe(
        true,
      );
      await closeInfo(page);
    }
  });

  test("AC5 — same rule in the Weight column: a printed weight grown past its budget wraps inside it and moves nothing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    await openInfo(page, NO_NOTE.name);
    const control = await columnWidths(page);
    await closeInfo(page);

    await openInfo(page, PRINTED_WEIGHT.name);
    const printed = dialog(page).getByText("each worth 25% of section score");
    await expect(printed).toBeVisible();

    const before = await columnWidths(page);
    for (const [i, w] of before.entries()) {
      expect(
        w,
        `column ${i} widened for the shipped printed weight (${before.join("/")} vs ${control.join("/")})`,
      ).toBeCloseTo(control[i], 1);
    }

    const grown = await dialog(page).evaluate((el) => {
      const cells = [...el.querySelectorAll("table tbody tr")].map(
        (row) => row.children[3],
      );
      const cell = cells.find((c) => c?.textContent?.includes("of section score"));
      const span = cell?.querySelector("span");
      if (!span) return null;
      span.textContent = `${span.textContent} of the total examination score as printed by the College Board`;
      return true;
    });
    expect(grown, "no printed-weight span found to grow — fixture drifted").toBe(true);

    const after = await columnWidths(page);
    for (const [i, w] of after.entries()) {
      expect(
        w,
        `column ${i} widened for a longer printed weight (${after.join("/")} vs ${before.join("/")})`,
      ).toBeCloseTo(before[i], 1);
    }
    expect(
      await clippedCells(page),
      "the grown printed weight spilled out of the Weight column",
    ).toEqual([]);

    // And it really wrapped rather than being clipped away: taller than one line.
    const lines = await printed.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Math.round(rect.height / parseFloat(getComputedStyle(el).lineHeight));
    });
    expect(lines, "the printed weight did not wrap").toBeGreaterThan(1);
    await closeInfo(page);
  });

  test("AC3 — the numbers are never crowded: every adjacent pair of rendered values keeps the declared gutter, in every row of every subject that has a table", async ({
    page,
  }) => {
    test.slow();
    expect(
      WITH_SECTIONS.length,
      "the sweep must cover every subject that renders a table",
    ).toBe(38);

    const problems: string[] = [];
    for (const width of [320, 1920]) {
      const floor = declaredGutter(width) - 0.5;
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      for (const subject of WITH_SECTIONS) {
        await openInfo(page, subject.name);
        for (const gap of await valueGaps(page)) {
          if (gap.gap >= floor) continue;
          problems.push(
            `${width}px ${subject.id} "${gap.row}" cells ${gap.pair}: ${gap.gap}px < ${floor}px`,
          );
        }
        await closeInfo(page);
      }
    }
    expect(
      problems,
      "rendered values are crowding their neighbour — the crunch this bounce exists to remove",
    ).toEqual([]);
  });

  test("AC3 + AC4 — the reported crunch is gone on the subject Jon named, and the same budget applies to a subject with no note at all", async ({
    page,
  }) => {
    // Jon's report: `4 · 1 h 30 min · 50%` jammed together in AP Comparative
    // Government's Section II row. Asserted here on that exact row, at the
    // desktop width the report was made at, against the same row of a
    // note-free subject — the rule is the shared component's, not one card's.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    for (const subject of [REPORTED, NO_NOTE]) {
      await openInfo(page, subject.name);
      const gaps = await valueGaps(page);
      expect(gaps.length, `${subject.id}: no rows measured`).toBeGreaterThan(1);
      const worst = Math.min(...gaps.map((g) => g.gap));
      expect(
        worst,
        `${subject.id}: tightest pair ${JSON.stringify(gaps.find((g) => g.gap === worst))}`,
      ).toBeGreaterThanOrEqual(11.5);
      await closeInfo(page);
    }

    // The reported row itself, spelled out.
    await openInfo(page, REPORTED.name);
    const row = dialog(page)
      .getByRole("row")
      .filter({ hasText: "Section II" })
      .first();
    await expect(row.getByRole("cell").nth(0)).toHaveText("4");
    await expect(row.getByRole("cell").nth(1)).toHaveText("1 h 30 min");
    await expect(row.getByRole("cell").nth(2)).toHaveText("50%");
    await closeInfo(page);
  });

  test("AC6 — no cell is blank, and pending / verbatim / not-published stay three distinguishable states under the budget", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");

    // A width budget's most plausible regression is a value squeezed out of
    // existence, and a blank cell is a claim ("nothing published here") rather
    // than a glitch. Swept across every subject that renders a table.
    const blanks: string[] = [];
    for (const subject of WITH_SECTIONS) {
      await openInfo(page, subject.name);
      const empty = await dialog(page).evaluate((el) =>
        [...el.querySelectorAll("table tbody th, table tbody td")]
          .map((cell, i) => ({ i, text: cell.textContent!.trim() }))
          .filter((c) => c.text === ""),
      );
      for (const cell of empty) blanks.push(`${subject.id} cell ${cell.i}`);
      await closeInfo(page);
    }
    expect(blanks, "blank cells").toEqual([]);

    // The one row carrying an omission and a pending side by side.
    await openInfo(page, PENDING_PILL.name);
    const project = dialog(page)
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", {
          name: "Individual Student Project",
          exact: true,
        }),
      });
    await expect(project.getByRole("cell").nth(0)).toContainText(NONE_PUBLISHED);
    await expect(project.getByRole("cell").nth(1)).toHaveText("pending");
    await expect(project.getByRole("cell").nth(1)).not.toContainText(NONE_PUBLISHED);
    // The pill cannot wrap; the column it lives in has to actually hold it.
    const pill = await project
      .getByRole("cell")
      .nth(1)
      .locator("span")
      .first()
      .evaluate((el) => {
        const cell = el.closest("td")!;
        const style = getComputedStyle(cell);
        return {
          pillWidth: el.getBoundingClientRect().width,
          content:
            cell.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        };
      });
    expect(
      pill.pillWidth,
      `the pending pill (${pill.pillWidth}px) does not fit its budgeted column (${pill.content}px of content box)`,
    ).toBeLessThanOrEqual(pill.content + 1);
    expect(await clippedCells(page), "clipped cells (pending pill)").toEqual([]);
    await closeInfo(page);

    // A published range is verbatim and unsplittable — "65–" over "70 min"
    // would read as a different published value.
    await openInfo(page, RANGE.name);
    const rangeCell = dialog(page)
      .getByRole("row")
      .filter({ hasText: "Section I: Free-Response" })
      .first()
      .getByRole("cell")
      .nth(1);
    await expect(rangeCell).toHaveText("65–70 min");
    const groups = await rangeCell.locator("span").evaluateAll((spans) =>
      spans.map((s) => ({
        text: s.textContent,
        nowrap: getComputedStyle(s).whiteSpace === "nowrap",
      })),
    );
    expect(groups[0]?.text).toBe("65–70");
    expect(groups.every((g) => g.nowrap)).toBe(true);
    await closeInfo(page);
  });

  test("AC1 + AC3 — the seam the budget introduces holds: the widths step from percentages to fixed units at a viewport the table width does not follow", async ({
    page,
  }) => {
    test.slow();
    // `min-[400px]:` is a VIEWPORT media query; the table's width comes from
    // the dialog. Either side of that step, and either side of the `sm` seam
    // where the dialog stops growing, is where a mis-tuned budget shows up —
    // and none of these widths is in the builder's sweep.
    const problems: string[] = [];
    const subjects = [REPORTED, PRINTED_WEIGHT, LONGEST_NAME, PENDING_PILL];
    for (const width of [399, 400, 401, 639, 640, 641]) {
      const floor = declaredGutter(width) - 0.5;
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      for (const subject of subjects) {
        await openInfo(page, subject.name);
        for (const cell of await clippedCells(page)) {
          problems.push(`${width}px ${subject.id}: +${cell.overflow}px "${cell.text}"`);
        }
        for (const gap of await valueGaps(page)) {
          if (gap.gap < floor) {
            problems.push(
              `${width}px ${subject.id} "${gap.row}" ${gap.pair}: ${gap.gap}px < ${floor}px`,
            );
          }
        }
        if (!(await dialogFits(page))) {
          problems.push(`${width}px ${subject.id}: dialog scrolls sideways`);
        }
        const pageFits = await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        );
        if (!pageFits) problems.push(`${width}px ${subject.id}: page scrolls sideways`);
        await closeInfo(page);
      }
    }
    expect(problems, "the budget breaks down at its own breakpoints").toEqual([]);
  });

  test("AC1 — the dataset's longest section name survives the narrowest Section column, which is where the remainder is smallest", async ({
    page,
  }) => {
    // The Section column takes what the three budgeted columns leave, so the
    // narrowest supported width is where a long College Board title is most
    // likely to spill. The longest name in the dataset is 89 characters.
    const longest = LONGEST_NAME.format.sections
      .flatMap((s) => [s.name, ...(s.parts ?? []).map((p) => p.name)])
      .reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length, "fixture drifted — this subject's names are short now").toBeGreaterThan(
      70,
    );

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    await openInfo(page, LONGEST_NAME.name);
    await expect(dialog(page).getByText(longest, { exact: false })).toBeVisible();
    expect(await clippedCells(page), "clipped cells (longest name at 320px)").toEqual([]);
    expect(await dialogFits(page), "the dialog scrolls sideways at 320px").toBe(true);
    await closeInfo(page);
  });

  test("the port to a budgeted table did not cost accessibility: scoped row headers, one section prefix per part row, and no serious axe violation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");

    for (const subject of [REPORTED, PRINTED_WEIGHT, PENDING_PILL]) {
      await openInfo(page, subject.name);
      const structure = await dialog(page).evaluate((el) => {
        const rows = [...el.querySelectorAll("table tbody tr")];
        return {
          rows: rows.length,
          scoped: rows.filter(
            (r) => r.querySelector("th")?.getAttribute("scope") === "row",
          ).length,
          headers: el.querySelectorAll("table thead th[scope='col']").length,
          captions: el.querySelectorAll("table caption.sr-only").length,
          extraPrefixes: rows.filter(
            (r) => r.querySelectorAll("th .sr-only").length > 1,
          ).length,
        };
      });
      expect(structure.rows, `${subject.id}: no body rows`).toBeGreaterThan(1);
      expect(structure.scoped, `${subject.id}: a body row lost its row header`).toBe(
        structure.rows,
      );
      expect(structure.headers, `${subject.id}: column headers`).toBe(4);
      expect(structure.captions, `${subject.id}: the sr-only caption is gone`).toBe(1);
      expect(
        structure.extraPrefixes,
        `${subject.id}: a row header carries more than one sr-only span`,
      ).toBe(0);
      await closeInfo(page);
    }

    await openInfo(page, REPORTED.name);
    const light = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(
      light.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
      "axe serious/critical (light)",
    ).toEqual([]);
    await closeInfo(page);

    await seedDarkTheme(page);
    await page.goto("/");
    await openInfo(page, PRINTED_WEIGHT.name);
    const dark = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(
      dark.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
      "axe serious/critical (dark)",
    ).toEqual([]);
    await closeInfo(page);
  });

  test("AC7 — evidence at the extremes: the longest note and the longest printed weight, light and dark, plus the narrowest supported width", async ({
    page,
  }, testInfo) => {
    test.slow();
    const viewports = [
      { label: "desktop", width: 1920, height: 1080 },
      { label: "tablet", width: 1024, height: 768 },
      { label: "mobile", width: 375, height: 667 },
      { label: "narrow", width: 320, height: 640 },
    ];
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await seedDarkTheme(page);
      for (const subject of [REPORTED, PRINTED_WEIGHT]) {
        for (const vp of viewports) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto("/");
          await openInfo(page, subject.name);
          expect(
            await clippedCells(page),
            `${subject.id} ${theme} ${vp.label}`,
          ).toEqual([]);
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
