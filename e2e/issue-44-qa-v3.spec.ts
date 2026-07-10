import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * super-board QA v3 (issue #44, Jon's PR #48 design bounce, pass 2) —
 * independent verification of the two-line left-aligned section blocks.
 *
 * Jon-approved spec under test (bounce-2 comment, approved 2026-07-09):
 *   - Line 1: section name, medium weight, NEVER truncated — long College
 *     Board names wrap harmlessly because nothing shares the line.
 *   - Line 2: stats, LEFT-aligned, muted, `whitespace-nowrap` per stat
 *     phrase — the line wraps only BETWEEN `·`-separated phrases, never
 *     inside one ("50% of / score" must be impossible).
 *   - `pending` badge renders inline in its stat slot; notes stay as a
 *     third muted line; omission ≠ pending.
 *   - Sections group reads as a distinct zone from the metadata rows
 *     (divider + larger gap).
 *   - Multi-part exams keep the table, byte-untouched.
 *
 * This suite deliberately does NOT reuse the builder's rect-separation wrap
 * detector. It brings its own single-line detector (bounding-box height vs
 * font size) and SELF-TESTS it in-page against a forced wrap before trusting
 * it — an assertion mechanism the builder's suite cannot share a blind spot
 * with. It also covers gaps the builder's revision left:
 *   1. detector-independent no-mid-phrase-wrap at 1920 / 375 / 320 for BOTH
 *      of Jon's judged fixtures (Biology, AAS);
 *   2. the never-truncated guarantee for the longest section name in the
 *      dataset (AAS Section IB) — wrapped, not clipped;
 *   3. the pending badge inline in its stat slot inside the partless layout
 *      (AAS "Individual Student Project": minutes pending, questions
 *      OMITTED — exactly 2 stat phrases, no "questions" text);
 *   4. the zone divider is present in the partless case and absent in the
 *      table case (it must not leak into the byte-untouched table layout);
 *   5. stats line is left-aligned by computed style in light AND dark, and
 *      the muted-vs-name hierarchy holds in dark;
 *   6. axe serious/critical clean with the partless dialog open (Biology
 *      light, AAS dark) — the #8 bar.
 *
 * Evidence (Jon's mandated set: Biology + AAS, light+dark, desktop+mobile,
 * plus Calc AB unchanged) is captured to docs/super-board/runs/issue-44-qa-v3/.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-44-qa-v3";
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

/** A section block / metadata row of the dialog's <dl>, by its dt text. */
const summaryRow = (page: Page, name: string | RegExp): Locator =>
  dialog(page).locator("dl > div").filter({ hasText: name });

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
 * Single-line cap: an unwrapped inline phrase's bounding-box height stays
 * within ~1 line box (text-sm line-height 20px, pending badge ≈22px); a
 * mid-phrase wrap adds a whole second line (+20px). 2.05 × font-size
 * (≈28.7px at 14px) cleanly separates the two — see the detector self-test.
 */
const SINGLE_LINE_CAP = 2.05;

async function expectNoMidPhraseWrap(page: Page, label: string) {
  const phrases = await dialog(page)
    .getByTestId("stat-phrase")
    .evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent ?? "",
        height: el.getBoundingClientRect().height,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      })),
    );
  expect(phrases.length, `${label}: dialog must have stat phrases`).toBeGreaterThan(0);
  for (const p of phrases) {
    expect(
      p.height,
      `${label}: stat phrase "${p.text.trim()}" occupies more than one line — mid-phrase wrap`,
    ).toBeLessThanOrEqual(SINGLE_LINE_CAP * p.fontSize);
  }
}

test.describe("issue #44 QA v3 — bounce pass 2 (two-line left-aligned blocks), independent checks", () => {
  test("detector self-test, then no stat phrase ever wraps mid-phrase at 1920 / 375 / 320 for Biology AND AAS, with no horizontal page scroll", async ({
    page,
  }) => {
    await page.goto("/");

    // Prove the height-based detector actually fires on a forced wrap and
    // stays quiet on a nowrap phrase, in this exact rendering engine.
    const probe = await page.evaluate(() => {
      const measure = (whiteSpace: string) => {
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;top:0;left:0;width:40px;";
        const span = document.createElement("span");
        span.textContent = "50% of score";
        span.style.cssText = `white-space:${whiteSpace};font-size:14px;line-height:20px;`;
        host.appendChild(span);
        document.body.appendChild(host);
        const height = span.getBoundingClientRect().height;
        host.remove();
        return height;
      };
      return { wrapped: measure("normal"), nowrap: measure("nowrap") };
    });
    expect(probe.wrapped, "detector must fire on a forced wrap").toBeGreaterThan(
      SINGLE_LINE_CAP * 14,
    );
    expect(probe.nowrap, "detector must stay quiet on nowrap").toBeLessThanOrEqual(
      SINGLE_LINE_CAP * 14,
    );

    for (const width of [1920, 375, 320] as const) {
      await page.setViewportSize({ width, height: width >= 1024 ? 1080 : 667 });
      for (const subject of ["AP Biology", "AP African American Studies"] as const) {
        await page.goto("/");
        await openInfo(page, subject);
        await expectNoMidPhraseWrap(page, `${subject} @ ${width}px`);
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

    const name = summaryRow(
      page,
      /Section IB: Individual Student Project/,
    ).locator("dt");
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

  test("pending badge renders INLINE in its stat slot (AAS Individual Student Project), and its omitted question count stays omitted — 2 phrases, no 'questions' text", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP African American Studies");

    const stats = summaryRow(page, /^Individual Student Project/)
      .first()
      .locator("dd");
    const phrases = stats.getByTestId("stat-phrase");
    // minutes (pending) + weight — question count is OMITTED by College
    // Board (a project, not a question set): omission ≠ pending.
    await expect(phrases).toHaveCount(2);
    await expect(stats).not.toContainText("question");
    await expect(stats).toContainText("8.5% of score");
    // The badge lives INSIDE the first stat phrase, on the same line as the
    // weight phrase that follows it — inline in its slot, not a block.
    const badge = phrases.first().getByText("pending", { exact: true });
    await expect(badge).toBeVisible();
    const badgeBox = (await badge.boundingBox())!;
    const weightBox = (await phrases.nth(1).boundingBox())!;
    const badgeMidY = badgeBox.y + badgeBox.height / 2;
    expect(badgeMidY).toBeGreaterThanOrEqual(weightBox.y);
    expect(badgeMidY).toBeLessThanOrEqual(weightBox.y + weightBox.height);
  });

  test("zone divider: present above the metadata group in the partless case (Biology), ABSENT in the table case (Calc AB) — the divider must not leak into the byte-untouched table layout", async ({
    page,
  }) => {
    await page.goto("/");
    await openInfo(page, "AP Biology");
    const borderTop = (loc: Locator) =>
      loc.evaluate((el) => getComputedStyle(el).borderTopWidth);
    // Partless: the metadata <dl> (the one holding "Exam length") carries
    // the divider that separates the two zones.
    const bioMetaDl = dialog(page)
      .locator("dl")
      .filter({ hasText: "Exam length" });
    expect(await borderTop(bioMetaDl)).toBe("1px");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await openInfo(page, "AP Calculus AB");
    await expect(sectionsTable(page)).toBeVisible();
    const calcMetaDl = dialog(page)
      .locator("dl")
      .filter({ hasText: "Exam length" });
    expect(await borderTop(calcMetaDl)).toBe("0px");
  });

  test("stats line is left-aligned by computed style and the muted-vs-name hierarchy holds — light AND dark (Biology)", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await seedDarkTheme(page);
      await page.goto("/");
      if (theme === "dark") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      }
      await openInfo(page, "AP Biology");
      const block = summaryRow(page, "Multiple Choice");
      const styles = async (loc: Locator) =>
        loc.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { textAlign: cs.textAlign, color: cs.color };
        });
      const name = await styles(block.locator("dt"));
      const stats = await styles(block.locator("dd"));
      // Jon's bounce-1 complaint was right-aligned values; the approved spec
      // is left-aligned. "start" === left in LTR.
      expect(["left", "start"], `${theme}: stats must be left-aligned`).toContain(
        stats.textAlign,
      );
      expect(
        stats.color,
        `${theme}: stats line must be muted relative to the name line`,
      ).not.toBe(name.color);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test("axe: no serious/critical violations with the partless dialog open — Biology (light)", async ({
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

  test("axe: no serious/critical violations with the 5-section partless dialog open — AAS (dark)", async ({
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

  test("calendar event popup (third surface) renders the two-line blocks — name line above left-aligned stats, no table", async ({
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
    await expect(sectionsTable(page)).toHaveCount(0);

    const mc = summaryRow(page, "Multiple Choice");
    const nameBox = (await mc.locator("dt").boundingBox())!;
    const statsBox = (await mc.locator("dd").boundingBox())!;
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(statsBox.y + 1);
    expect(Math.abs(nameBox.x - statsBox.x)).toBeLessThanOrEqual(1);
    await expectNoMidPhraseWrap(page, "calendar popup (Biology)");
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
    await expect(summaryRow(page, "Multiple Choice").locator("dd")).toBeVisible();
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
