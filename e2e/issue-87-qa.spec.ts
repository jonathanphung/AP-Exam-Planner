import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";
import apData from "../src/data/ap-2027.json";

/**
 * super-board QA v1 — issue #87, "exam published, format unpublished".
 *
 * ## What this lane checks that the builder's suite does not
 *
 * `e2e/issue-87-unpublished-format.spec.ts` (builder) asserts the two halves
 * of the regression at the DOM: Networking grows the three rows, the four
 * portfolio-only subjects do not. Those are the right assertions and they
 * pass. This spec is deliberately NOT a second copy of them; it covers the
 * four things a lane that only proves "the rows appeared" cannot see:
 *
 *   1. **Losslessness, mechanically** (AC5). The builder's fact check is a
 *      list of seven regexes over `formatNote`. A regex list cannot notice a
 *      clause that was dropped between the facts it names, or a word quietly
 *      reworded. This spec pins the whole thing: `examNote + " " + formatNote`
 *      must equal, character for character, the 297-character note that
 *      shipped on `main` before this change. Nothing added, nothing lost,
 *      nothing paraphrased.
 *
 *   2. **The card at the widths students use** (AC4). Moving the note inside
 *      the Exam row's `<dd>` puts 65 characters into a cell that has held
 *      "May 7 · PM" since issue #37. The catalog is a fixed-column grid and
 *      this suite has already bounced two cards on chip overflow (#57, #74,
 *      #80), so the qualifier is measured — not eyeballed — for horizontal
 *      overflow and for clipping at 1920/1024/375, expanded and collapsed.
 *
 *   3. **Reading order** (AC2). "A short explanatory line WHERE THE SECTIONS
 *      TABLE WOULD BE" is a position claim, and `toBeVisible()` is true of a
 *      block rendered anywhere in the dialog. Asserted geometrically: the
 *      note's box sits above the first format row's box.
 *
 *   4. **The new markup is accessible.** A `<h3>` and a `<span>` inside a
 *      `<dd>` are new nodes on two surfaces that this project scans with axe
 *      (issue #8 AC2). Both are re-scanned here in the state that only exists
 *      on this branch.
 *
 * Everything is derived from the dataset; the only hardcoded string is the
 * pre-change note, which is the baseline being compared against and therefore
 * has to be literal.
 *
 * Evidence: `docs/super-board/runs/issue-87-qa-v1/` (via `QA_EVIDENCE_DIR`).
 */

const EVIDENCE_DIR = evidenceDir("issue-87-qa-v1");
const THEME_KEY = "apx.theme.v1";
const SELECTION_KEY = "apx.selection.v1";

/** The sr-only text that must travel with every not-published dash (#84). */
const NONE_PUBLISHED = "none published";

/** The three rows this card is about, in render order. */
const FORMAT_ROWS = ["Exam length", "Calculator", "Delivery"] as const;

/**
 * AP Networking's `examNote` exactly as it shipped on `main` at 2f737a3,
 * immediately before this branch — 297 characters, one paragraph, both claims.
 * The split under test must reproduce it verbatim from its two halves.
 */
const NOTE_BEFORE_SPLIT =
  "College Board schedules this exam for 2026-27 pilot schools only. AP Networking is in its third and final pilot in 2026-27 and the course launches in fall 2027, so College Board publishes no exam page for it yet and no section structure, duration, delivery mode, or calculator policy is published.";

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: string } | null;
  format: {
    sections: unknown[];
    totalMinutes?: number;
    calculator?: boolean;
    delivery?: string;
  };
  portfolio: unknown | null;
  examNote?: string;
  formatNote?: string;
};

const SUBJECTS = apData.subjects as unknown as Subject[];

/**
 * Both sets are derived, never listed: membership is the property this card
 * models, so a hardcoded list would still pass if the data stopped matching
 * the rule the code branches on.
 */
const UNPUBLISHED = SUBJECTS.filter(
  (s) =>
    s.exam !== null &&
    s.format.sections.length === 0 &&
    s.format.totalMinutes === undefined &&
    s.format.calculator === undefined &&
    s.format.delivery === undefined,
);
const PORTFOLIO_ONLY = SUBJECTS.filter(
  (s) => s.exam === null && s.portfolio !== null,
);

const dialog = (page: Page) => page.getByRole("dialog");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
const chipFor = (page: Page, name: string): Locator =>
  page
    .locator('section[aria-label="Subject catalog"]')
    .locator("ul > li")
    .filter({ hasText: name })
    .first();

async function expandChip(page: Page, name: string) {
  const button = expandButton(page, name);
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true")
      await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();
}

async function openInfo(page: Page, name: string) {
  if (!(await infoButton(page, name).isVisible())) await expandChip(page, name);
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeInfo(page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
}

async function seed(
  page: Page,
  opts: { theme?: "light" | "dark"; selection?: string[] } = {},
) {
  const entries: Array<[string, string]> = [];
  if (opts.theme) entries.push([THEME_KEY, opts.theme]);
  if (opts.selection)
    entries.push([SELECTION_KEY, JSON.stringify(opts.selection)]);
  if (entries.length === 0) return;
  await page.addInitScript((pairs) => {
    for (const [k, v] of pairs) window.localStorage.setItem(k, v);
  }, entries);
}

/** A metadata `<dl>` row's value cell, located by its label. */
const rowValue = (page: Page, label: string): Locator =>
  dialog(page)
    .locator("dl > div")
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator("dd");

/** #84's contract: a visible decorative glyph AND the sr-only label beside it. */
async function expectNotPublished(cell: Locator, why: string) {
  await expect(cell, `${why}: cell must be visible`).toBeVisible();
  await expect(
    cell.getByText(NONE_PUBLISHED),
    `${why}: sr-only label`,
  ).toHaveAttribute("class", /sr-only/);
  await expect(
    cell.locator("[aria-hidden='true']"),
    `${why}: decorative glyph`,
  ).toHaveText("—");
}

/**
 * Widest horizontal overflow among the PAINTED nodes under `root`, in CSS px
 * (0 = none).
 *
 * Boxes narrower or shorter than 2px are skipped, and that exclusion is the
 * whole reason this helper exists rather than a one-line `scrollWidth -
 * clientWidth`. Two kinds of node are legitimately 1px or 0px here:
 *
 *   - `sr-only` spans — the `NotPublishedDash` label ("none published") and
 *     the external-link hint ("opens in a new tab") clip ~130px of text into a
 *     1×1 box BY DESIGN, so the naive measure reports them as the worst
 *     overflow in the dialog. Measured on this branch before the filter went
 *     in: a constant 128px at every viewport, entirely from those spans.
 *   - the collapsed chip's disclosure panel, which is `hidden` — present in
 *     the DOM, zero-sized, and holding full-width content.
 *
 * Neither can push a pixel of the layout sideways, and counting them would
 * make the assertion permanently red on a page with no overflow at all.
 */
async function worstOverflow(root: Locator): Promise<number> {
  return root.evaluate((node) => {
    let worst = 0;
    const walk = (el: Element) => {
      if (el.clientWidth > 1 && el.clientHeight > 1)
        worst = Math.max(worst, el.scrollWidth - el.clientWidth);
      for (const child of el.children) walk(child);
    };
    walk(node as Element);
    return worst;
  });
}

test.describe("issue #87 QA — the third format state", () => {
  test("fixture — the dataset still carries both empty-sections states", () => {
    // Vacuous-pass guard: every assertion below iterates one of these.
    expect(UNPUBLISHED.map((s) => s.id)).toEqual(["networking"]);
    expect(PORTFOLIO_ONLY.map((s) => s.id).sort()).toEqual([
      "2-d-art-and-design",
      "3-d-art-and-design",
      "drawing",
      "research",
    ]);
  });

  test("AC5 — the split is lossless: the two halves rebuild the 297-character note verbatim", () => {
    for (const subject of UNPUBLISHED) {
      expect(subject.examNote, `${subject.id} examNote`).toBeTruthy();
      expect(subject.formatNote, `${subject.id} formatNote`).toBeTruthy();
    }
    const networking = UNPUBLISHED[0];
    expect(
      `${networking.examNote} ${networking.formatNote}`,
      "a fact was added, dropped or reworded in the split",
    ).toBe(NOTE_BEFORE_SPLIT);
    // …and the half that stayed on the card is the DATE half, not an excerpt
    // of the format half.
    expect(NOTE_BEFORE_SPLIT.startsWith(networking.examNote!)).toBe(true);
    expect(NOTE_BEFORE_SPLIT.endsWith(networking.formatNote!)).toBe(true);
  });

  for (const vp of VIEWPORTS) {
    test(`AC1/AC2 — the unpublished-format dialog renders three visible rows under a sourced reason, with no table (${vp.name} ${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      for (const subject of UNPUBLISHED) {
        await openInfo(page, subject.name);

        // AC1 — the three rows exist and each one says the true thing. Before
        // this change the dialog's only `dt` was "Pass rate".
        await expect(dialog(page).locator("dt")).toHaveText([
          ...FORMAT_ROWS,
          "Pass rate",
        ]);
        for (const label of FORMAT_ROWS)
          await expectNotPublished(rowValue(page, label), `${subject.id} ${label}`);

        // AC2 — prose stands where the table would be. Position, not mere
        // presence: a block rendered below the rows explains nothing.
        const note = dialog(page).getByTestId("unpublished-format-note");
        await expect(note).toBeVisible();
        await expect(note).toContainText(subject.formatNote!);
        const noteBox = await note.boundingBox();
        const firstRowBox = await rowValue(page, FORMAT_ROWS[0]).boundingBox();
        expect(
          noteBox!.y + noteBox!.height,
          "the explanation must sit above the rows it explains",
        ).toBeLessThanOrEqual(firstRowBox!.y + 1);

        // Nothing was fabricated to fill the hole.
        await expect(dialog(page).locator("table")).toHaveCount(0);
        await expect(dialog(page).locator("tbody tr")).toHaveCount(0);
        await expect(dialog(page)).not.toContainText(/\bmin\b/i);
        await expect(dialog(page)).not.toContainText(
          /Permitted|Not permitted|Digital|Paper|Hybrid/,
        );

        // …and the dialog is no longer a near-empty surface: heading + reason
        // + three rows + pass rate.
        await expect(
          note.getByRole("heading", { name: "Exam format not published yet" }),
        ).toBeVisible();

        // The dialog itself must not scroll sideways at any width.
        expect(
          await worstOverflow(dialog(page)),
          `${subject.id} dialog overflows horizontally at ${vp.name}`,
        ).toBeLessThanOrEqual(0);

        await closeInfo(page);
      }
    });
  }

  test("AC3 — all four portfolio-only dialogs keep their exact pre-change shape", async ({
    page,
  }) => {
    await page.goto("/");
    for (const subject of PORTFOLIO_ONLY) {
      await openInfo(page, subject.name);

      // The full ordered signature of the dialog's metadata: Pass rate from
      // the main list, then the portfolio block's own two rows — no more, no
      // fewer, same order. A format row leaking in anywhere fails here.
      await expect(
        dialog(page).locator("dt"),
        `${subject.id} grew or lost a row`,
      ).toHaveText(["Pass rate", "Weight", "Deadline"]);
      for (const label of FORMAT_ROWS)
        await expect(
          dialog(page).getByText(label, { exact: true }),
          `${subject.id} must not render a ${label} row`,
        ).toHaveCount(0);

      // No dash may appear where a row used to be absent entirely.
      await expect(
        dialog(page).getByText(NONE_PUBLISHED),
        `${subject.id} must not grow an unpublished cell`,
      ).toHaveCount(0);
      await expect(dialog(page).locator("table")).toHaveCount(0);
      await expect(
        dialog(page).getByTestId("unpublished-format-note"),
        `${subject.id} has no exam to describe`,
      ).toHaveCount(0);

      // The portfolio block is still the one that tells the story.
      await expect(dialog(page)).toContainText("Portfolio component");
      await closeInfo(page);
    }
  });

  for (const vp of VIEWPORTS) {
    test(`AC4 — the card's qualifier is a caveat on the Exam row and fits the column (${vp.name} ${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const subject = UNPUBLISHED[0];
      const chip = chipFor(page, subject.name);

      // Collapsed: the qualifier lives inside the disclosure panel, which is
      // `hidden` until the card is expanded — so a 43-card catalog shows no
      // prose at all until asked. (Present in the DOM, invisible to sighted
      // users and to assistive tech alike; `hidden` removes it from the
      // accessibility tree.)
      await expect(chip.getByTestId("chip-exam-note")).toBeHidden();
      expect(
        await worstOverflow(chip),
        `collapsed chip overflows at ${vp.name}`,
      ).toBeLessThanOrEqual(0);

      await expandChip(page, subject.name);

      // It belongs to the Exam row: same `<dd>`, so assistive tech reads it as
      // part of that value rather than as loose text after the list.
      const examRow = chip.locator("dl > div").filter({ hasText: /^Exam/ });
      const note = examRow.locator("dd").getByTestId("chip-exam-note");
      await expect(note).toBeVisible();
      await expect(note).toHaveText(subject.examNote!);

      // It is a qualifier, not the paragraph it replaced.
      expect(subject.examNote!.length).toBeLessThan(120);
      await expect(chip).not.toContainText(subject.formatNote!);

      // And it fits: no sideways scroll and no clipped text anywhere in the
      // expanded chip, at the three viewports this project ships.
      expect(
        await worstOverflow(chip),
        `expanded chip overflows at ${vp.name}`,
      ).toBeLessThanOrEqual(0);
      const clipped = await note.evaluate(
        (el) => el.scrollHeight - el.clientHeight,
      );
      expect(clipped, `the qualifier is clipped at ${vp.name}`).toBeLessThanOrEqual(0);

      // The page as a whole still has no horizontal scrollbar (issue #8 AC4).
      const docOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(docOverflow, `document scrolls sideways at ${vp.name}`).toBeLessThanOrEqual(0);
    });
  }

  test("AC6 — the qualifier still reaches the dialog, the list row and the calendar block", async ({
    page,
  }) => {
    const subject = UNPUBLISHED[0];
    await seed(page, { selection: [subject.id] });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    // Surface 1 — the details dialog.
    await openInfo(page, subject.name);
    await expect(dialog(page)).toContainText(subject.examNote!);
    await closeInfo(page);

    // Surface 2 — the schedule list row.
    await pressViewChip(page, "List");
    const listNote = page
      .locator('section[aria-label="My schedule"]')
      .getByTestId("schedule-exam-note");
    await expect(listNote).toBeVisible();
    await expect(listNote).toContainText(subject.examNote!);

    // Surface 3 — the calendar block (marker on the face, verbatim text in the
    // accessible name).
    await pressViewChip(page, "Calendar");
    const block = page
      .getByTestId("calendar-block")
      .filter({ has: page.getByTestId("block-exam-note") });
    await expect(block).toHaveCount(1);
    await expect(block.getByRole("button")).toHaveAccessibleName(
      new RegExp(subject.examNote!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // …and the format half is on none of them — it explains the dialog's rows.
    await expect(page.locator("body")).not.toContainText(subject.formatNote!);
  });

  test("a11y — the new markup adds no serious/critical axe violation on either surface", async ({
    page,
  }) => {
    const subject = UNPUBLISHED[0];
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    // The chip's new `<span>` inside the Exam row's `<dd>`.
    await expandChip(page, subject.name);
    const chipScan = await new AxeBuilder({ page })
      .include('section[aria-label="Subject catalog"]')
      .analyze();
    expect(
      chipScan.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);

    // The dialog's new `<h3>` + prose block.
    await openInfo(page, subject.name);
    const dialogScan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(
      dialogScan.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test.describe("evidence", () => {
    for (const vp of VIEWPORTS) {
      for (const theme of ["light", "dark"] as const) {
        test(`capture — networking dialog + card (${vp.name}, ${theme})`, async ({
          page,
        }) => {
          const subject = UNPUBLISHED[0];
          await seed(page, { theme });
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto("/");

          await expandChip(page, subject.name);
          await chipFor(page, subject.name).screenshot({
            path: `${EVIDENCE_DIR}/card-networking-${vp.name}-${theme}.png`,
          });

          await openInfo(page, subject.name);
          await page.screenshot({
            path: `${EVIDENCE_DIR}/dialog-networking-${vp.name}-${theme}.png`,
          });
          await closeInfo(page);
        });
      }
    }

    test("capture — the four portfolio-only dialogs (desktop, light)", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/");
      for (const subject of PORTFOLIO_ONLY) {
        await openInfo(page, subject.name);
        await page.screenshot({
          path: `${EVIDENCE_DIR}/dialog-portfolio-${subject.id}-desktop-light.png`,
        });
        await closeInfo(page);
      }
    });

    test("capture — a published-format control (Calculus AB, desktop, light)", async ({
      page,
    }) => {
      // The state this card must not have disturbed: a normal exam still
      // renders its sections table and published values.
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/");
      const control = SUBJECTS.find((s) => s.id === "calculus-ab")!;
      await openInfo(page, control.name);
      await expect(dialog(page).locator("table")).toHaveCount(1);
      await expect(
        dialog(page).getByTestId("unpublished-format-note"),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/dialog-control-calculus-ab-desktop-light.png`,
      });
    });
  });
});
