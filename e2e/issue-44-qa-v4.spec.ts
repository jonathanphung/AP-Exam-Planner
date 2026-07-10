import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * super-board QA v4 (issue #44, Jon's post-merge "9px matched" spacing
 * follow-up, PR #53) — independent verification of the approved variant
 * "Reduced 9px + matched meta gap".
 *
 * Spec under test (Jon's follow-up comment on #44, 2026-07-10):
 *   1. Partless section block vertical padding → 9px above and below the
 *      block's content; the hairline between blocks stays.
 *   2. Sections→metadata gap matched to the metadata rhythm: the last
 *      block's content sits exactly 11px above the divider over
 *      "Exam length" (builder's documented call: 9px block padding + 2px
 *      group margin — the RENDERED distance is what's specified).
 *   Everything else stays as shipped: stats-line offset under the name,
 *   first block's 4px header offset (builder's documented call — the
 *   header gap was not one of the two changes), type sizes, pending chip,
 *   and the multi-part table byte-untouched.
 *
 * This suite deliberately does NOT re-assert the builder's computed-style
 * pins (e2e/issue-44-qa.spec.ts). It measures the RENDERED distances with
 * getBoundingClientRect geometry — the mechanism the spec's own
 * parenthetical names as authoritative — and it covers what the builder's
 * revision left unverified:
 *   1. EVERY block of a 5-section partless exam (AAS), not just Biology's
 *      two: 9px rhythm, hairline on each non-last block, none on the last;
 *   2. the 11px sections→divider distance and the 10px divider→first-row
 *      distance as geometry, cross-checked against the metadata rows' own
 *      10px rhythm (the "matched" claim), at desktop AND mobile 375;
 *   3. the hairline-token consistency claim: inter-block hairlines use the
 *      same color as the metadata rows' hairlines, and the zone divider
 *      stays a distinct, stronger token — in light AND dark;
 *   4. the table branch's runtime guard: Calc AB's metadata group keeps
 *      its shipped mt-2 (8px) with NO leaked zone divider or hairlines.
 *
 * Evidence (Jon's mandated set: Biology + AAS, light+dark, desktop+mobile,
 * plus Calc AB unchanged and the three standard viewports) is captured to
 * docs/super-board/runs/issue-44-qa-v4/.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-44-qa-v4";
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

/** The partless sections <dl> — the only dl that carries stat phrases. */
const sectionsDl = (page: Page): Locator =>
  dialog(page)
    .locator("dl")
    .filter({ has: page.getByTestId("stat-phrase") });

/** The metadata <dl> (Exam length / Calculator / Delivery rows). */
const metaDl = (page: Page): Locator =>
  dialog(page).locator("dl").filter({ hasText: "Exam length" });

/** A section/summary row by its dt/label text. */
const summaryRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: name });

const sectionsTable = (page: Page) => dialog(page).locator("table");

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

type BlockBox = {
  rectTop: number;
  rectBottom: number;
  paddingTop: number;
  paddingBottom: number;
  borderTopWidth: number;
  borderBottomWidth: number;
  borderBottomColor: string;
};

/** Geometry + box model of every child block of the partless sections dl. */
const measureBlocks = (dl: Locator): Promise<BlockBox[]> =>
  dl.evaluate((el) =>
    [...el.children].map((child) => {
      const rect = child.getBoundingClientRect();
      const cs = getComputedStyle(child);
      return {
        rectTop: rect.top,
        rectBottom: rect.bottom,
        paddingTop: parseFloat(cs.paddingTop),
        paddingBottom: parseFloat(cs.paddingBottom),
        borderTopWidth: parseFloat(cs.borderTopWidth),
        borderBottomWidth: parseFloat(cs.borderBottomWidth),
        borderBottomColor: cs.borderBottomColor,
      };
    }),
  );

const measureMeta = (dl: Locator) =>
  dl.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const firstRow = el.children[0]!;
    const firstRowCs = getComputedStyle(firstRow);
    const firstRowRect = firstRow.getBoundingClientRect();
    return {
      rectTop: rect.top,
      marginTop: parseFloat(cs.marginTop),
      paddingTop: parseFloat(cs.paddingTop),
      borderTopWidth: parseFloat(cs.borderTopWidth),
      borderTopColor: cs.borderTopColor,
      firstRowRectTop: firstRowRect.top,
      firstRowPaddingTop: parseFloat(firstRowCs.paddingTop),
      firstRowPaddingBottom: parseFloat(firstRowCs.paddingBottom),
      firstRowBorderBottomColor: firstRowCs.borderBottomColor,
    };
  });

/**
 * The core "9px matched" geometry contract, asserted for one open partless
 * dialog: 9px block rhythm, hairlines between blocks only, 11px rendered
 * distance from the last block's content to the zone divider, and the
 * metadata rows' own 10px rhythm immediately below it.
 */
async function assertNinePxMatched(page: Page, expectedBlocks: number) {
  const blocks = await measureBlocks(sectionsDl(page));
  expect(blocks).toHaveLength(expectedBlocks);

  blocks.forEach((b, i) => {
    const isFirst = i === 0;
    const isLast = i === blocks.length - 1;
    // 9px above and below each block's content — except the first block's
    // shipped 4px header offset (documented builder call, unchanged spec).
    expect(b.paddingTop, `block ${i} padding-top`).toBeCloseTo(
      isFirst ? 4 : 9,
      1,
    );
    expect(b.paddingBottom, `block ${i} padding-bottom`).toBeCloseTo(9, 1);
    // Hairline between blocks: bottom edge of every non-last block, never
    // the last (nothing may double up against the zone divider).
    expect(b.borderTopWidth, `block ${i} border-top`).toBe(0);
    expect(b.borderBottomWidth, `block ${i} border-bottom`).toBeCloseTo(
      isLast ? 0 : 1,
      1,
    );
  });

  // Rendered inter-block rhythm: content bottom of block N to content top of
  // block N+1 = 9px + 1px hairline + 9px = 19px, hairline centered.
  for (let i = 0; i + 1 < blocks.length; i++) {
    const contentBottom =
      blocks[i].rectBottom -
      blocks[i].paddingBottom -
      blocks[i].borderBottomWidth;
    const contentTop = blocks[i + 1].rectTop + blocks[i + 1].paddingTop;
    expect(contentTop - contentBottom, `gap between blocks ${i}/${i + 1}`)
      .toBeCloseTo(19, 1);
  }

  const meta = await measureMeta(metaDl(page));
  const last = blocks[blocks.length - 1];

  // THE specified rendered distance: last block's content sits exactly 11px
  // above the zone divider (metaDl's top border edge).
  expect(meta.rectTop - (last.rectBottom - last.paddingBottom)).toBeCloseTo(
    11,
    1,
  );
  expect(meta.borderTopWidth).toBeCloseTo(1, 1);

  // …and the first metadata row keeps its usual 10px below the divider —
  // the metadata rhythm the gap is matched to (10px on both sides of every
  // metadata hairline).
  expect(meta.paddingTop).toBe(0);
  expect(
    meta.firstRowRectTop + meta.firstRowPaddingTop -
      (meta.rectTop + meta.borderTopWidth),
  ).toBeCloseTo(10, 1);
  expect(meta.firstRowPaddingTop).toBeCloseTo(10, 1);
  expect(meta.firstRowPaddingBottom).toBeCloseTo(10, 1);

  return { blocks, meta };
}

test.describe("issue #44 v4 — '9px matched' spacing follow-up", () => {
  test("AC1/AC2 — AP Biology (2 partless blocks): 9px block rhythm with centered hairlines, 11px rendered gap to the zone divider, 10px metadata rhythm below it (desktop, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await assertNinePxMatched(page, 2);
  });

  test("AC2 — AP African American Studies (5 partless blocks, incl. pending badge + note rows): the SAME 9px/11px contract holds on every block of a 5-section exam (desktop, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");
    await assertNinePxMatched(page, 5);
  });

  test("AC1 — dark theme: the 9px/11px contract holds, inter-block hairlines share the metadata rows' hairline token, and the zone divider stays a distinct stronger token (AAS, desktop, dark)", async ({
    page,
  }) => {
    await seedDarkTheme(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await openInfo(page, "AP African American Studies");
    const { blocks, meta } = await assertNinePxMatched(page, 5);

    // "Separated by hairlines" means ONE rhythm across both zones: the
    // inter-block hairline color must equal the metadata rows' hairline
    // color, and the zone divider must differ from both (it marks the zone
    // boundary, not a row boundary).
    expect(blocks[0].borderBottomColor).toBe(meta.firstRowBorderBottomColor);
    expect(meta.borderTopColor).not.toBe(blocks[0].borderBottomColor);
  });

  test("AC1 — light theme hairline tokens: inter-block hairline = metadata hairline, zone divider distinct (Biology, desktop, light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    const { blocks, meta } = await assertNinePxMatched(page, 2);
    expect(blocks[0].borderBottomColor).toBe(meta.firstRowBorderBottomColor);
    expect(meta.borderTopColor).not.toBe(blocks[0].borderBottomColor);
  });

  test("AC1/AC4 — mobile 375: the rendered 9px/11px distances are viewport-independent (Biology, light)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await assertNinePxMatched(page, 2);
  });

  test("AC2 — table branch runtime guard: Calc AB keeps the table, and its metadata group keeps the shipped mt-2 with NO leaked zone divider or partless hairlines", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Calculus AB");

    await expect(sectionsTable(page)).toBeVisible();
    // The partless sections dl must not exist here at all.
    await expect(sectionsDl(page)).toHaveCount(0);

    const meta = await measureMeta(metaDl(page));
    expect(meta.marginTop).toBeCloseTo(8, 1); // shipped mt-2, untouched
    expect(meta.borderTopWidth).toBe(0); // the partless-only divider must not leak
    expect(meta.paddingTop).toBe(0);
    expect(meta.firstRowPaddingTop).toBeCloseTo(10, 1); // metadata rhythm untouched
  });
});

// --- Evidence capture (Jon's mandated set: Biology + AAS, light+dark, --------
// --- desktop+mobile; Calc AB unchanged; standard viewports) ------------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — partless Biology, 9px matched (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await expect(
      summaryRow(page, "Multiple Choice").locator("dd"),
    ).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
  });
}

const evidenceCases = [
  {
    file: "biology-partless",
    subject: "AP Biology",
    devices: ["desktop", "mobile"],
    ready: (page: Page) => summaryRow(page, "Multiple Choice").locator("dd"),
  },
  {
    file: "aas-5-sections-partless",
    subject: "AP African American Studies",
    devices: ["desktop", "mobile"],
    ready: (page: Page) =>
      summaryRow(page, "Section II: Document-Based Question").locator("dd"),
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
