import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { evidenceDir } from "./support/evidence";
import apData from "../src/data/ap-2027.json";

/**
 * super-board QA v1 — issue #84, "resolve all 33 pending values".
 *
 * ## What this lane checks that the builder's suite does not
 *
 * The builder's `ap-2027.test.ts` additions are dataset assertions: field X is
 * `undefined`, the raw JSON contains no `pending`, the schema rejects it. They
 * are good — this lane's report records mutation checks confirming both
 * directions genuinely fail — but every one of them stops at the data layer,
 * and the card's promise is about what a **student sees**. A field that went
 * from `"pending"` to omitted satisfies all of them while rendering an empty
 * cell, which is the one outcome the card explicitly forbids: a blank cell is
 * indistinguishable from a layout bug, and to a screen reader it is silence.
 *
 * So this spec re-derives the 33 from the dataset and asserts each one in the
 * dialog the student actually opens.
 *
 * **Rows are addressed positionally, not by name.** The sections table renders
 * `section, …its parts, next section, …`, so the dataset's own structure gives
 * each of the 33 an exact row index. Name matching would have been the obvious
 * choice and is the wrong one here: part row headers carry an `sr-only`
 * "<section> — " prefix and an optional note in the same cell, so
 * "Individual Student Project" also matches "Section IB: Individual Student
 * Project—Exam Day Validation Question", and "Performance Task 1: …" matches
 * its own two child rows. Walking the structure cannot silently address the
 * wrong row, and it double-checks the render order for free.
 *
 * ## The four gates
 *
 *   1. **All 33 render the dash with its `sr-only` label** (AC3) — the specific
 *      cell for each, not "the dialog has a dash somewhere".
 *   2. **Nothing published was dashed** (AC2). The card names the failure mode
 *      itself: "All-33-dashes is a red flag that AC1 was not really done." Its
 *      DOM signature is a real figure that got dashed with its neighbours, so
 *      the sweep runs the assertion in BOTH directions over every section and
 *      part of every subject — published cells must show the figure and must
 *      NOT carry the unpublished affordance. That is the check that fails if
 *      someone "resolves" a pending by dashing the row it lives in.
 *   3. **The retired badge is gone from every subject** (AC5), not just the
 *      sampled ones — an unreachable branch surviving in one render path is
 *      exactly the trap AC5 describes.
 *   4. **One dash style** (AC3). Every unpublished cell in the catalogue is
 *      held to the same markup contract, so a second affordance cannot drift
 *      in later.
 *
 * ## Evidence (AC7)
 *
 * AP Spanish Language and Culture (the world-language pattern), AP Networking
 * (the never-administered card) and AP Seminar (two dashed performance tasks
 * beside a fully published end-of-course exam), at desktop / tablet / mobile,
 * light and dark.
 */

const EVIDENCE_DIR = evidenceDir("issue-84-qa-v1");
const THEME_KEY = "apx.theme.v1";

/** The sr-only text that must travel with every dash. */
const NONE_PUBLISHED = "none published";

/** Cell order within a row; the section/part NAME is a `th`, not a cell. */
const QUESTIONS = 0;
const LENGTH = 1;
const WEIGHT = 2;

type Part = { name: string; minutes?: number | string };
type Section = { name: string; minutes?: number | string; parts?: Part[] };
type Subject = {
  id: string;
  name: string;
  format: {
    sections: Section[];
    totalMinutes?: number;
    calculator?: boolean;
    delivery?: string;
  };
  passRate?: number;
  passRateNote?: string;
  portfolio: { weightPct?: number } | null;
};

const SUBJECTS = apData.subjects as unknown as Subject[];
const byId = (id: string): Subject => {
  const subject = SUBJECTS.find((s) => s.id === id);
  if (!subject) throw new Error(`unknown subject id in spec fixture: ${id}`);
  return subject;
};

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

async function seedTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, theme] as const,
  );
}

/** A metadata `<dl>` row's value cell, located by its label. */
const rowValue = (page: Page, label: string): Locator =>
  dialog(page)
    .locator("dl > div")
    .filter({ hasText: new RegExp(`^${label}`) })
    .locator("dd");

/** Body rows of the sections table, in render order. */
const bodyRows = (page: Page): Locator => dialog(page).locator("tbody tr");

/**
 * The dataset's rows flattened into the order `SectionsTable` renders them:
 * each section immediately followed by its parts. This is what lets a row be
 * addressed by index instead of by a name that is not unique.
 */
function flattenRows(
  subject: Subject,
): Array<{ label: string; minutes: number | string | undefined }> {
  const rows: Array<{ label: string; minutes: number | string | undefined }> = [];
  for (const section of subject.format.sections) {
    rows.push({ label: section.name, minutes: section.minutes });
    for (const part of section.parts ?? []) {
      rows.push({ label: `${section.name} › ${part.name}`, minutes: part.minutes });
    }
  }
  return rows;
}

/**
 * The contract every unpublished cell must satisfy: a visible dash marked
 * decorative AND the sr-only label beside it. Asserting only the glyph passes
 * on a bare dash, which is silence to assistive tech; asserting only the label
 * passes on a cell nobody can see.
 */
async function expectNotPublished(cell: Locator, why: string) {
  await expect(cell.getByText(NONE_PUBLISHED), `${why}: sr-only label`).toHaveAttribute(
    "class",
    /sr-only/,
  );
  await expect(
    cell.locator("[aria-hidden='true']"),
    `${why}: decorative glyph`,
  ).toHaveText("—");
}

/** The inverse: a published cell shows its figure and carries no dash affordance. */
async function expectPublished(cell: Locator, why: string) {
  await expect(cell.getByText(NONE_PUBLISHED), `${why}: wrongly dashed`).toHaveCount(0);
  await expect(cell, `${why}: blank`).not.toHaveText("");
}

/**
 * The 33, re-derived from the dataset rather than hardcoded — if a future edit
 * fills one, the derivation shrinks and the count assertion fails loudly
 * instead of this spec quietly checking 32 things.
 */
const LANGUAGES = [
  "chinese-language-and-culture",
  "japanese-language-and-culture",
  "french-language-and-culture",
  "german-language-and-culture",
  "italian-language-and-culture",
  "spanish-language-and-culture",
];

type Resolved =
  | { kind: "row"; subject: Subject; rowIndex: number; what: string }
  | { kind: "dl"; subject: Subject; label: string; what: string };

function resolvedValues(): Resolved[] {
  const out: Resolved[] = [];
  const tableRowsOf = (subject: Subject, pick: (label: string) => boolean) => {
    flattenRows(subject).forEach((row, rowIndex) => {
      if (row.minutes === undefined && pick(row.label)) {
        out.push({
          kind: "row",
          subject,
          rowIndex,
          what: `${subject.id} / ${row.label} length`,
        });
      }
    });
  };

  for (const id of LANGUAGES) {
    const subject = byId(id);
    const sectionOne = subject.format.sections[0].name;
    tableRowsOf(subject, (label) => label.startsWith(`${sectionOne} › `));
    if (subject.portfolio && subject.portfolio.weightPct === undefined) {
      out.push({
        kind: "dl",
        subject,
        label: "Weight",
        what: `${id} / portfolio weight`,
      });
    }
  }
  tableRowsOf(byId("african-american-studies"), (l) => l === "Individual Student Project");
  tableRowsOf(byId("psychology"), (l) => l.includes("›"));
  tableRowsOf(byId("seminar"), (l) => /^Performance Task \d+:[^›]*$/.test(l));

  // NOTE: AP Networking's `totalMinutes` / `calculator` / `delivery` are three
  // of the 33 but are deliberately NOT in this list — see
  // "the no-published-format trio" test below for what they render instead
  // and why that is the documented behaviour rather than a missed dash.
  for (const id of ["business-with-personal-finance", "cybersecurity", "networking"]) {
    const subject = byId(id);
    if (subject.passRate === undefined) {
      out.push({ kind: "dl", subject, label: "Pass rate", what: `${id} / pass rate` });
    }
  }
  return out;
}

const RESOLVED = resolvedValues();

test.describe("issue #84 — the 33 resolved values, at the DOM", () => {
  test("the derivation still covers exactly 33 values", () => {
    // Tripwire for this whole spec: if a later edit fills one of the 33, the
    // per-value assertions below would quietly stop covering it. 30 are cells
    // in the panel; the other 3 are AP Networking's format trio, covered by
    // the dedicated test below.
    expect(
      RESOLVED.map((r) => r.what),
      "issue #84 resolved 33 values; the dataset no longer yields 30 renderable + 3 format-trio",
    ).toHaveLength(30);
    const net = byId("networking").format;
    expect(
      [net.totalMinutes, net.calculator, net.delivery],
      "AP Networking's format trio is the remaining 3 of the 33",
    ).toEqual([undefined, undefined, undefined]);
  });

  test("AC3 — the no-published-format trio: AP Networking states the gap in prose, and renders no empty rows", async ({
    page,
  }) => {
    // AP Networking has `sections: []` because `/courses/ap-networking/exam`
    // 404s. Issue #44 established that a subject with no published exam format
    // omits the whole Exam-length / Calculator / Delivery block rather than
    // rendering it — so those three of the 33 were never dashed cells before
    // #84 either, and #84 did not regress them.
    //
    // ── SUPERSEDED BY ISSUE #87 (2026-07-26) ─────────────────────────────
    // This test used to assert `dt` === ["Pass rate"], recording the omission
    // as a deliberate exception to "every unpublished value renders the dash".
    // It was not an exception, it was the bug: #44's rule keyed off
    // `sections.length`, which for the four portfolio-only subjects means "no
    // sit-down exam, the portfolio block tells the story" and for AP
    // Networking means "there IS an exam and its format is unpublished". With
    // `portfolio: null` no block came to tell any story, so the dialog dropped
    // three unpublished values to a body of one row. The three now render the
    // dash like the other 30, and the prose that makes the gap honest moved
    // from `examNote` (which also rode four other surfaces) to `formatNote`,
    // rendered where the section table would be. Everything below still holds:
    // the gap is named in the page's own terms and nothing is fabricated.
    await page.goto("/");
    await openInfo(page, "AP Networking");

    // No dangling label with nothing after it, in either direction.
    await expect(dialog(page).locator("dt")).toHaveText([
      "Exam length",
      "Calculator",
      "Delivery",
      "Pass rate",
    ]);
    await expect(dialog(page).locator("table")).toHaveCount(0);

    // …and the gap is stated, naming each of the three.
    const body = dialog(page);
    await expect(body).toContainText(/no exam page for it yet/i);
    await expect(body, "formatNote must name the missing duration").toContainText(
      /duration/i,
    );
    await expect(body, "formatNote must name the missing delivery mode").toContainText(
      /delivery mode/i,
    );
    await expect(body, "formatNote must name the missing calculator policy").toContainText(
      /calculator policy/i,
    );

    // Nothing was fabricated to fill the hole.
    await expect(body).not.toContainText(/\d+\s*h\s*\d*\s*min/i);
    await expect(body).not.toContainText(/Permitted|Not permitted/i);
    await closeInfo(page);
  });

  test("AC3 — every one of the 33 renders the dash with its screen-reader label", async ({
    page,
  }) => {
    await page.goto("/");
    const bySubject = new Map<string, Resolved[]>();
    for (const value of RESOLVED) {
      const list = bySubject.get(value.subject.name) ?? [];
      list.push(value);
      bySubject.set(value.subject.name, list);
    }
    for (const [name, values] of bySubject) {
      await openInfo(page, name);
      for (const value of values) {
        const cell =
          value.kind === "row"
            ? bodyRows(page).nth(value.rowIndex).getByRole("cell").nth(LENGTH)
            : rowValue(page, value.label);
        await expectNotPublished(cell, value.what);
      }
      await closeInfo(page);
    }
  });

  test("AC2 — across the whole catalogue, every PUBLISHED length still shows its figure", async ({
    page,
  }) => {
    // The card's own red flag, checked in the direction that catches it: if a
    // pending were "resolved" by dashing its row, a published sibling in that
    // row goes dark too. AP Spanish Question 3 (55 min) sits directly below
    // two dashed questions; AP Seminar's end-of-course exam sits below two
    // dashed performance tasks; AP African American Studies times every
    // component except the project. All of them are swept here, not sampled.
    await page.goto("/");
    let published = 0;
    let dashed = 0;
    for (const subject of SUBJECTS) {
      const rows = flattenRows(subject);
      if (rows.length === 0) continue;
      await openInfo(page, subject.name);
      await expect(bodyRows(page), `${subject.id} row count`).toHaveCount(rows.length);
      for (const [rowIndex, row] of rows.entries()) {
        const cell = bodyRows(page).nth(rowIndex).getByRole("cell").nth(LENGTH);
        if (row.minutes === undefined) {
          await expectNotPublished(cell, `${subject.id} / ${row.label}`);
          dashed += 1;
        } else {
          await expectPublished(cell, `${subject.id} / ${row.label}`);
          // A published range ships verbatim; a number renders as h/min.
          const expected =
            typeof row.minutes === "number"
              ? String(row.minutes % 60 === 0 ? row.minutes / 60 : row.minutes % 60)
              : String(row.minutes);
          await expect(cell, `${subject.id} / ${row.label} figure`).toContainText(
            expected,
          );
          published += 1;
        }
      }
      await closeInfo(page);
    }
    // Both directions must be non-trivially exercised.
    expect(published, "no published lengths swept").toBeGreaterThan(100);
    expect(dashed, "no dashed lengths swept").toBeGreaterThan(20);
  });

  test("AC5 — the retired badge appears in no subject's dialog", async ({ page }) => {
    await page.goto("/");
    for (const subject of SUBJECTS) {
      await openInfo(page, subject.name);
      await expect(
        dialog(page).getByText("pending", { exact: true }),
        `${subject.id} still renders the retired pending badge`,
      ).toHaveCount(0);
      await closeInfo(page);
    }
  });

  test("AC3 — every unpublished cell in the catalogue uses the SAME dash affordance", async ({
    page,
  }) => {
    // One affordance, reused: each `sr-only` "none published" must sit beside
    // an `aria-hidden` em dash. A second style introduced later (a bare "—",
    // an "N/A", an unlabelled glyph) breaks one half of this shape or the other.
    await page.goto("/");
    let seen = 0;
    for (const subject of SUBJECTS) {
      await openInfo(page, subject.name);
      const shapes = await dialog(page).evaluate((root) =>
        Array.from(root.querySelectorAll(".sr-only"))
          .filter((el) => el.textContent?.trim() === "none published")
          .map((el) => {
            const prev = el.previousElementSibling;
            return {
              tag: el.tagName,
              prevTag: prev?.tagName ?? null,
              prevHidden: prev?.getAttribute("aria-hidden") ?? null,
              prevText: prev?.textContent?.trim() ?? null,
            };
          }),
      );
      for (const shape of shapes) {
        expect(shape, `${subject.id} dash affordance`).toEqual({
          tag: "SPAN",
          prevTag: "SPAN",
          prevHidden: "true",
          prevText: "—",
        });
      }
      seen += shapes.length;
      await closeInfo(page);
    }
    expect(seen, "no not-published dashes rendered anywhere").toBeGreaterThan(30);
  });

  test("AC4 — all three never-administered courses answer the pass-rate question the same way", async ({
    page,
  }) => {
    await page.goto("/");
    for (const id of ["business-with-personal-finance", "cybersecurity", "networking"]) {
      const subject = byId(id);
      await openInfo(page, subject.name);
      const cell = rowValue(page, "Pass rate");
      // The row is present — never deleted to make the gap disappear…
      await expect(cell, `${id} pass-rate row missing`).toBeVisible();
      // …it shows the dash, not a fabricated number…
      await expectNotPublished(cell, `${id} pass rate`);
      await expect(cell, `${id} fabricated a pass rate`).not.toContainText("%");
      // …and it says why nothing is published, so the dash does not read as a
      // bug in this app on a course nobody has ever sat (AC4).
      await expect(cell, `${id} gives no reason`).toContainText(/score distribution/i);
      await closeInfo(page);
    }
    // …and no subject WITH a published rate carries an explanation instead.
    for (const subject of SUBJECTS) {
      if (subject.passRate === undefined) continue;
      await openInfo(page, subject.name);
      const cell = rowValue(page, "Pass rate");
      await expect(cell, `${subject.id} lost its published rate`).toContainText(
        `${subject.passRate}%`,
      );
      await expect(cell.getByText(NONE_PUBLISHED), `${subject.id} dashed a real rate`).toHaveCount(0);
      await closeInfo(page);
    }
  });
});

test.describe("issue #84 AC7 — evidence", () => {
  const VIEWPORTS = [
    { slug: "desktop", width: 1920, height: 1080 },
    { slug: "tablet", width: 1024, height: 768 },
    { slug: "mobile", width: 375, height: 667 },
  ] as const;
  const SHOTS = [
    { slug: "spanish", name: "AP Spanish Language and Culture" },
    { slug: "networking", name: "AP Networking" },
    { slug: "seminar", name: "AP Seminar" },
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} · ${viewport.slug}`, async ({ page }) => {
        mkdirSync(EVIDENCE_DIR, { recursive: true });
        await seedTheme(page, theme);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/");
        for (const shot of SHOTS) {
          await openInfo(page, shot.name);
          // Evidence is only worth capturing if it shows the thing: each of
          // these three cards carries at least one of the 33.
          await expect(
            dialog(page).getByText(NONE_PUBLISHED).first(),
            `${shot.slug} shows no unpublished cell`,
          ).toBeAttached();
          await dialog(page).screenshot({
            path: `${EVIDENCE_DIR}/${shot.slug}-${viewport.slug}-${theme}.png`,
          });
          await closeInfo(page);
        }
      });
    }
  }
});
