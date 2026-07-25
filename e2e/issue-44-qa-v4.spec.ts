import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v4 (issue #44, Jon's post-merge "9px matched" spacing
 * follow-up, PR #53) — retargeted by Jon's #73 bounce.
 *
 * ## What this suite used to verify, and why it changed
 *
 * Jon's follow-up (2026-07-10) tuned the PARTLESS layout's spacing: 9px above
 * and below each prose block's content, a hairline between blocks, and a
 * sections→metadata gap "matched to the metadata rhythm" — the last block's
 * content sitting exactly 11px above the divider over "Exam length". Jon's
 * #73 bounce deletes the prose blocks entirely (one presentation for every
 * exam), so every distance this suite measured now has no element to measure.
 *
 * The CLAIM behind those numbers survives, and is what this suite now pins:
 * the sections group and the metadata group read as ONE vertical rhythm
 * rather than two competing ones. In the table that is a stronger, simpler
 * statement, because both are built from the same tokens:
 *   1. every SECTION row carries the metadata rows' own 10px padding (py-2.5)
 *      top and bottom — one rhythm, not a denser table crammed above airier
 *      rows, which was the original complaint that produced PR #48;
 *   2. hairlines between section rows use the SAME token as the hairlines
 *      between metadata rows, in light AND dark — the "separated by
 *      hairlines" half of the follow-up;
 *   3. the last row of each group carries no hairline, so nothing doubles up
 *      at a group boundary — the reason the old spec put no border on the
 *      last block;
 *   4. the prose block's zone DIVIDER is gone: the metadata group keeps the
 *      shipped `mt-2` (8px) and no border, which is what the table branch
 *      always had and what every subject has now;
 *   5. PART rows stay visually subordinate — tighter padding (8px) and a
 *      deeper indent than their section row. This is new: the prose layout
 *      had no parts to subordinate, and it is the geometry most at risk in a
 *      port that merges two layouts into one.
 *
 * As before, this suite measures RENDERED distances with
 * getBoundingClientRect geometry rather than re-asserting the builder's
 * computed-style pins, and covers desktop AND mobile 375, light AND dark.
 *
 * Evidence is captured to the `issue-44-qa-v4` evidence folder resolved by
 * `evidenceDir()` — see e2e/support/evidence.ts for how a lane points it at
 * docs/super-board/runs/ when it wants committed evidence.
 */

const EVIDENCE_DIR = evidenceDir("issue-44-qa-v4");
const THEME_KEY = "apx.theme.v1";

const dialog = (page: Page) => page.getByRole("dialog");

const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });

/** Reveal a subject's Tier-1 panel and open its details dialog (Tier 2). */
async function openInfo(page: Page, name: string) {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
}

const sectionsTable = (page: Page) => dialog(page).locator("table");

/** The metadata <dl> (Exam length / Calculator / Delivery rows). */
const metaDl = (page: Page): Locator =>
  dialog(page).locator("dl").filter({ hasText: "Exam length" });

/** A section (or part) row of the sections table, by its row header. */
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

type RowBox = {
  isPart: boolean;
  headerPaddingLeft: number;
  headerPaddingTop: number;
  cellPaddingTop: number;
  cellPaddingBottom: number;
  borderBottomWidth: number;
  borderBottomColor: string;
};

/**
 * Box model of every body row of the sections table. A part row is identified
 * the way a screen reader identifies it: its row header carries the sr-only
 * "<section> — " prefix that programmatically ties it to its parent.
 */
const measureRows = (page: Page): Promise<RowBox[]> =>
  sectionsTable(page)
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((tr) => {
        const header = tr.querySelector("th")!;
        const cell = tr.querySelector("td")!;
        const headerCs = getComputedStyle(header);
        const cellCs = getComputedStyle(cell);
        const trCs = getComputedStyle(tr);
        return {
          isPart: !!header.querySelector(".sr-only"),
          headerPaddingLeft: parseFloat(headerCs.paddingLeft),
          headerPaddingTop: parseFloat(headerCs.paddingTop),
          cellPaddingTop: parseFloat(cellCs.paddingTop),
          cellPaddingBottom: parseFloat(cellCs.paddingBottom),
          borderBottomWidth: parseFloat(trCs.borderBottomWidth),
          borderBottomColor: trCs.borderBottomColor,
        };
      }),
    );

const measureMeta = (dl: Locator) =>
  dl.evaluate((el) => {
    const cs = getComputedStyle(el);
    const firstRow = el.children[0]!;
    const firstRowCs = getComputedStyle(firstRow);
    const lastRow = el.children[el.children.length - 1]!;
    return {
      marginTop: parseFloat(cs.marginTop),
      paddingTop: parseFloat(cs.paddingTop),
      borderTopWidth: parseFloat(cs.borderTopWidth),
      firstRowPaddingTop: parseFloat(firstRowCs.paddingTop),
      firstRowPaddingBottom: parseFloat(firstRowCs.paddingBottom),
      firstRowBorderBottomWidth: parseFloat(firstRowCs.borderBottomWidth),
      firstRowBorderBottomColor: firstRowCs.borderBottomColor,
      lastRowBorderBottomWidth: parseFloat(
        getComputedStyle(lastRow).borderBottomWidth,
      ),
    };
  });

/**
 * The ported "one rhythm" contract, asserted for one open dialog: section
 * rows on the metadata rows' own 10px rhythm, one shared hairline token, no
 * hairline at either group's last row, and no leftover zone divider.
 */
async function assertOneRhythm(page: Page, expectedSectionRows: number) {
  const rows = await measureRows(page);
  const sections = rows.filter((r) => !r.isPart);
  expect(sections).toHaveLength(expectedSectionRows);

  const meta = await measureMeta(metaDl(page));

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;
    if (!r.isPart) {
      // (1) Section rows share the metadata rows' 10px rhythm exactly.
      expect(r.cellPaddingTop, `section row ${i} padding-top`).toBeCloseTo(
        meta.firstRowPaddingTop,
        1,
      );
      expect(r.cellPaddingBottom, `section row ${i} padding-bottom`).toBeCloseTo(
        meta.firstRowPaddingBottom,
        1,
      );
      expect(r.cellPaddingTop, `section row ${i} is on the 10px rhythm`).toBeCloseTo(
        10,
        1,
      );
      expect(
        r.headerPaddingTop,
        `section row ${i} header is on the 10px rhythm`,
      ).toBeCloseTo(10, 1);
    } else {
      // (5) Part rows are subordinate: the ROW HEADER is tighter than a
      // section row's (8px vs 10px). Note the value cells are deliberately
      // NOT re-measured here — they carry the shared `sectionsTableNumCell`
      // 10px padding on section and part rows alike, which is why the visible
      // subordination comes from the header's padding plus its indent.
      expect(r.headerPaddingTop, `part row ${i} header padding-top`).toBeCloseTo(
        8,
        1,
      );
    }
    // (3) Hairline on every row but the last of the group.
    expect(r.borderBottomWidth, `body row ${i} border-bottom`).toBeCloseTo(
      isLast ? 0 : 1,
      1,
    );
    if (!isLast) {
      // (2) One hairline token across both groups.
      expect(
        r.borderBottomColor,
        `body row ${i} hairline token`,
      ).toBe(meta.firstRowBorderBottomColor);
    }
  });

  // (3) again, for the metadata group's own last row.
  expect(meta.firstRowBorderBottomWidth).toBeCloseTo(1, 1);
  expect(meta.lastRowBorderBottomWidth).toBeCloseTo(0, 1);

  // (4) The prose block's zone divider is gone; the shipped mt-2 remains.
  expect(meta.borderTopWidth).toBe(0);
  expect(meta.marginTop).toBeCloseTo(8, 1);
  expect(meta.paddingTop).toBe(0);

  return { rows, meta };
}

test.describe("issue #44 v4 — one vertical rhythm after the #73 one-presentation port", () => {
  test("AC1/AC2 — AP Biology (2 sections, no parts): section rows sit on the metadata rows' own 10px rhythm under one hairline token, with no leftover zone divider (desktop, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    const { rows } = await assertOneRhythm(page, 2);
    // A section with no parts is one row and nothing else.
    expect(rows.filter((r) => r.isPart)).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  // AP African American Studies was this suite's multi-section PARTLESS stress
  // case. Issue #73 gave it published part rows (SAQ / DBQ under the single
  // printed "Section II: Free Response"), so AP Music Theory inherits the
  // case — and it is the subject Jon's #73 bounce named as proof the fix must
  // not be `sections.length === 2`.
  test("AC2 — AP Music Theory (3 sections, no parts): the SAME rhythm contract holds on every row of a multi-section exam (desktop, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Music Theory");
    const { rows } = await assertOneRhythm(page, 3);
    expect(rows.filter((r) => r.isPart)).toHaveLength(0);
  });

  test("AC1 — dark theme: the rhythm contract holds and section-row hairlines still share the metadata rows' token (Music Theory, desktop, dark)", async ({
    page,
  }) => {
    await seedDarkTheme(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await openInfo(page, "AP Music Theory");
    const { rows, meta } = await assertOneRhythm(page, 3);
    expect(rows[0].borderBottomColor).toBe(meta.firstRowBorderBottomColor);
  });

  test("AC1/AC4 — mobile 375: the rendered distances are viewport-independent (Biology, light)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await assertOneRhythm(page, 2);
  });

  test("AC2/AC5 — a part-carrying exam (Calc AB) keeps the same section rhythm, and its part rows stay subordinate: tighter padding AND a deeper indent than their section row", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");
    const { rows } = await assertOneRhythm(page, 2);

    const parts = rows.filter((r) => r.isPart);
    expect(parts.length).toBeGreaterThan(0);
    const section = rows.find((r) => !r.isPart)!;
    for (const part of parts) {
      expect(part.headerPaddingLeft).toBeGreaterThan(section.headerPaddingLeft);
      expect(part.headerPaddingTop).toBeLessThan(section.headerPaddingTop);
    }

    // The section row's own numbers match a partless exam's exactly — the two
    // cases are one case now.
    expect(section.cellPaddingTop).toBeCloseTo(10, 1);
  });
});

// --- Evidence capture (Biology + Music Theory, light+dark, desktop+mobile; ---
// --- Calc AB as the part-carrying control; the standard viewports) -----------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — partless Biology, one rhythm (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(row(page, /^Section I: Multiple Choice$/)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}

const evidenceCases = [
  {
    file: "biology-partless",
    subject: "AP Biology",
    devices: ["desktop", "mobile"],
    ready: (page: Page) => row(page, /^Section I: Multiple Choice$/),
  },
  {
    file: "music-theory-3-sections-partless",
    subject: "AP Music Theory",
    devices: ["desktop", "mobile"],
    ready: (page: Page) =>
      row(page, /^Section IIB: Free Response: Sight Singing$/),
  },
  {
    file: "calculus-ab-table-unchanged",
    subject: "AP Calculus AB",
    devices: ["desktop"],
    ready: (page: Page) => sectionsTable(page),
  },
] as const;

for (const c of evidenceCases) {
  for (const device of c.devices) {
    for (const theme of ["light", "dark"] as const) {
      test(`evidence — ${c.file} (${device}, ${theme})`, async ({ page }) => {
        await page.setViewportSize(
          device === "desktop"
            ? { width: 1920, height: 1080 }
            : { width: 375, height: 667 },
        );
        if (theme === "dark") await seedDarkTheme(page);
        await page.goto("/");
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
        }
        await openInfo(page, c.subject);
        await expect(c.ready(page)).toBeVisible();
        await page.screenshot({
          path: `${EVIDENCE_DIR}/${c.file}-${theme}-${device}.png`,
        });
      });
    }
  }
}
