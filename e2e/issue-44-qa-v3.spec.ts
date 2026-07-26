import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v3 (issue #44, Jon's PR #48 design bounce, pass 2) —
 * retargeted by Jon's #73 bounce onto the single presentation.
 *
 * ## What this suite used to verify, and why it changed
 *
 * Bounce-2's approved spec (2026-07-09) gave a partless exam two-line
 * left-aligned section blocks: a never-truncated name line, then a muted
 * stats line whose `·`-separated phrases were each `whitespace-nowrap`, so
 * "50% of / score" was impossible by construction. Jon's #73 bounce
 * supersedes it — every exam with sections renders the table now — and the
 * stat phrases those checks measured no longer exist.
 *
 * What was actually at stake survives the port and is what this suite now
 * pins, because a table gives none of it for free:
 *   1. nothing CLIPS at 1920 / 375 / 320 for Biology AND Music Theory, and
 *      the page never scrolls horizontally (bounce-2's no-mid-phrase-wrap
 *      guarantee, in the form a table can hold: long text wraps in its cell);
 *   2. the never-truncated guarantee for the longest section name in the
 *      dataset — wrapped, not clipped;
 *   3. pending vs omission stay DISTINCT states (AAS "Individual Student
 *      Project": minutes pending, questions omitted) — the semantics Jon's
 *      #73 bounce called the one most at risk in a mechanical port;
 *   4. the prose block's zone divider does NOT survive anywhere — it existed
 *      only to separate the blocks from the metadata rows;
 *   5. the name-vs-value hierarchy still reads in light AND dark;
 *   6. axe serious/critical clean with the dialog open (Biology light, AAS
 *      dark) — the #8 bar.
 *
 * This suite keeps its own, self-tested detector rather than reusing the
 * builder's: the wrap detector became a CLIP detector, and it still proves
 * itself in-page against a forced positive and a forced negative before any
 * assertion trusts it.
 *
 * Evidence is captured to the `issue-44-qa-v3` evidence folder resolved by
 * `evidenceDir()` (e2e/support/evidence.ts).
 */

const EVIDENCE_DIR = evidenceDir("issue-44-qa-v3");
const SELECTION_KEY = "apx.selection.v1";
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

/**
 * A section (or part) row of the sections table, by its row header.
 *
 * Replaces this suite's `summaryRow` (`dl > div` filtered by dt text), which
 * read the PR #48 prose blocks — a `dl` that no longer carries sections.
 */
const row = (page: Page, name: string | RegExp): Locator =>
  dialog(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

async function seedDarkTheme(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, "dark"] as const,
  );
}

async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const done = Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  });
}

/**
 * Clip detector: an element whose text wraps inside its box has
 * `scrollWidth == clientWidth` and `scrollHeight == clientHeight` (±1 for
 * sub-pixel rounding); an element whose text is cut off overflows one of
 * them. This replaces bounce-2's single-line height cap, which measured the
 * prose stats line's `whitespace-nowrap` phrases — a construct the table has
 * no equivalent of. Self-tested in-page below before it is trusted.
 */
async function expectNoClippedCells(page: Page, label: string) {
  const cells = await dialog(page)
    .locator("table th, table td")
    .evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 60),
        horizontal: el.scrollWidth - el.clientWidth,
        vertical: el.scrollHeight - el.clientHeight,
      })),
    );
  expect(cells.length, `${label}: dialog must have table cells`).toBeGreaterThan(
    0,
  );
  for (const c of cells) {
    expect(
      c.horizontal,
      `${label}: cell "${c.text}" is clipped horizontally`,
    ).toBeLessThanOrEqual(1);
    expect(
      c.vertical,
      `${label}: cell "${c.text}" is clipped vertically`,
    ).toBeLessThanOrEqual(1);
  }
}

test.describe("issue #44 QA v3 — one presentation (#73 bounce, superseding PR #48), independent checks", () => {
  // AAS gained published part rows in #73 (SAQ 18% / DBQ 12% under the single
  // printed "Section II: Free Response"). AP Music Theory is the remaining
  // multi-section exam with NO parts and carries the longest partless section
  // name, so it inherits the stress case alongside Biology.
  test("clip-detector self-test, then no table cell is clipped at 1920 / 375 / 320 for Biology AND Music Theory, with no horizontal page scroll", async ({
    page,
  }) => {
    await page.goto("/");

    // Prove the overflow-based detector actually fires on forced clipping and
    // stays quiet on wrapped text, in this exact rendering engine.
    const probe = await page.evaluate(() => {
      const measure = (extra: string) => {
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;top:0;left:0;width:40px;";
        const cell = document.createElement("div");
        cell.textContent = "Section IIB: Free Response: Sight Singing";
        cell.style.cssText = `font-size:14px;line-height:20px;${extra}`;
        host.appendChild(cell);
        document.body.appendChild(host);
        const overflow = cell.scrollWidth - cell.clientWidth;
        host.remove();
        return overflow;
      };
      return {
        clipped: measure("white-space:nowrap;overflow:hidden;"),
        wrapped: measure("overflow-wrap:break-word;"),
      };
    });
    expect(probe.clipped, "detector must fire on forced clipping").toBeGreaterThan(1);
    expect(probe.wrapped, "detector must stay quiet on wrapped text").toBeLessThanOrEqual(1);

    for (const width of [1920, 375, 320] as const) {
      await page.setViewportSize({ width, height: width >= 1024 ? 1080 : 667 });
      for (const subject of ["AP Biology", "AP Music Theory"] as const) {
        await page.goto("/");
        await openInfo(page, subject);
        await expectNoClippedCells(page, `${subject} @ ${width}px`);
        // #8 bar: never a horizontal page scroll, dialog open included.
        const overflow = await page.evaluate(() => {
          const el = document.scrollingElement!;
          return el.scrollWidth - el.clientWidth;
        });
        expect(overflow, `${subject} @ ${width}px: horizontal page scroll`).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toHaveCount(0);
      }
    }
  });

  test("the longest section name in the dataset (AAS Section IB) is wrapped, never truncated — full text rendered, nothing clipped", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    // Issue #73: AAS renders the table now (its Section II has published SAQ /
    // DBQ part rows), so the longest name is a table row header rather than a
    // block's dt. The wrapping contract is identical.
    const name = sectionsTable(page)
      .locator("tbody th[scope='row']")
      .filter({ hasText: /Section IB: Individual Student Project/ });
    // Full College Board title, verbatim — not shortened, not elided.
    await expect(name).toHaveText(
      "Section IB: Individual Student Project—Exam Day Validation Question",
    );
    const clip = await name.evaluate((el) => ({
      horizontal: el.scrollWidth - el.clientWidth,
      vertical: el.scrollHeight - el.clientHeight,
    }));
    expect(clip.horizontal, "dt clips horizontally").toBeLessThanOrEqual(1);
    expect(clip.vertical, "dt clips vertically").toBeLessThanOrEqual(1);
  });

  test("every unpublished cell in AAS's table is the SAME not-published dash (issue #73 shape, #84 single state)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    // Issue #73: AAS's printed "Section II: Free Response" carries published
    // SAQ / DBQ part rows, so the whole subject renders the 4-column table.
    // This test used to pin TWO honest-degradation states apart (the dash for
    // an omitted question count, the pending badge for an unpublished
    // duration). Issue #84 re-verified the Individual Student Project against
    // the live College Board page — it prints a weight and a description but
    // NO time allocation — so both cells are the same not-published dash now,
    // and the badge is gone from the component. What the test still guards is
    // that neither cell is blank and neither invents a number.
    const isp = sectionsTable(page)
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", {
          name: /^Individual Student Project$/,
        }),
      });
    await expect(isp).toHaveCount(1);
    const cells = isp.getByRole("cell");
    await expect(cells).toHaveCount(3);
    // Questions: College Board prints NO count (a project, not a question
    // set) → the not-published dash.
    await expect(cells.nth(0)).toContainText("—");
    await expect(cells.nth(0).getByText("none published")).toHaveCount(1);
    // Length: College Board prints no time allocation for the project either
    // → the SAME dash, with the same sr-only text. One style, not two.
    await expect(cells.nth(1)).toContainText("—");
    await expect(cells.nth(1).getByText("none published")).toHaveCount(1);
    // Weight: the published 8.5% renders as a number.
    await expect(cells.nth(2)).toHaveText("8.5%");
    // The retired badge must not come back anywhere in the dialog.
    await expect(dialog(page).getByText("pending", { exact: true })).toHaveCount(
      0,
    );
  });

  test("the prose block's zone divider does not survive anywhere: a formerly-partless exam (Biology) and a part-carrying one (Calc AB) get the same table-branch metadata spacing", async ({
    page,
  }) => {
    // The divider existed only to separate the PR #48 prose blocks from the
    // metadata rows; with one presentation there are no two zones to divide.
    // Both subjects must now show the table branch's shipped mt-2 and no
    // border — i.e. Biology moved onto Calc AB's spacing, not the reverse.
    for (const subject of ["AP Biology", "AP Calculus AB"] as const) {
      await page.goto("/");
      await openInfo(page, subject);
      await expect(sectionsTable(page)).toBeVisible();
      const meta = await dialog(page)
        .locator("dl")
        .filter({ hasText: "Exam length" })
        .evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            borderTopWidth: cs.borderTopWidth,
            marginTop: cs.marginTop,
            paddingTop: cs.paddingTop,
          };
        });
      expect(meta.borderTopWidth, `${subject} zone divider`).toBe("0px");
      expect(meta.marginTop, `${subject} metadata margin`).toBe("8px");
      expect(meta.paddingTop, `${subject} metadata padding`).toBe("0px");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test("the name-vs-value hierarchy still reads in the table — section name left-aligned at full strength, values right-aligned, column headers muted — light AND dark (Biology)", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await seedDarkTheme(page);
      await page.goto("/");
      if (theme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      }
      await openInfo(page, "AP Biology");
      const styles = async (loc: Locator) =>
        loc.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { textAlign: cs.textAlign, color: cs.color };
        });
      const mc = row(page, /^Section I: Multiple Choice$/);
      const name = await styles(mc.getByRole("rowheader"));
      const value = await styles(mc.getByRole("cell").first());
      const columnHeader = await styles(
        sectionsTable(page).locator("thead th").first(),
      );
      // "start" === left in LTR. The section name reads as the row's label…
      expect(["left", "start"], `${theme}: section name must be left-aligned`).toContain(
        name.textAlign,
      );
      // …and the numbers align on their own edge, which is what a table buys
      // over the prose block's single left-aligned stats line.
      expect(["right", "end"], `${theme}: values must be right-aligned`).toContain(
        value.textAlign,
      );
      expect(
        columnHeader.color,
        `${theme}: column header must be muted relative to the section name`,
      ).not.toBe(name.color);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test("axe: no serious/critical violations with a partless exam's table open — Biology (light)", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    await settleAnimations(page);
    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    const severe = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(severe, "axe serious/critical (Biology light)").toEqual([]);
  });

  test("axe: no serious/critical violations with the 4-component AAS dialog open (dark)", async ({
    page,
  }) => {
    await seedDarkTheme(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await openInfo(page, "AP African American Studies");
    await settleAnimations(page);
    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    const severe = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(severe, "axe serious/critical (AAS dark)").toEqual([]);
  });

  test("calendar event popup (third surface) renders a partless exam's table — one row per section, nothing clipped", async ({
    page,
  }) => {
    await seedSelection(page, ["biology"]);
    await page.goto("/");

    const block = page.locator(
      '[data-testid="calendar-block"][data-subject-id="biology"]',
    );
    await block.scrollIntoViewIfNeeded();
    await block.click();
    await expect(dialog(page)).toBeVisible();
    await expect(sectionsTable(page)).toHaveCount(1);
    await expect(sectionsTable(page).locator("tbody tr")).toHaveCount(2);

    await expect(
      row(page, /^Section I: Multiple Choice$/).getByRole("cell"),
    ).toHaveText(["60", "1 h 30 min", "50%"]);
    await expectNoClippedCells(page, "calendar popup (Biology)");
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
  test(`evidence — partless Biology (${vp.name} ${vp.width}x${vp.height}, light)`, async ({
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
