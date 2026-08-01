import { test, expect, type Page, type Locator } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";

/**
 * Independent Tester verification (super-board QA lane) — issue #111, the
 * conflict prompt's destination bullet list folded INTO the Move buttons.
 *
 * Written against the ACs, not against the builder's spec. The builder's
 * `issue-111-merged-move-actions.spec.ts` already pins: the absent `<ul>`, the
 * once-only subject/destination counts, the accessible name, the
 * dataset-derived destination string, the N≥3 midway shape, the absent
 * no-late-slot row, the calendar host and the ≥44px/axe pass. This suite
 * covers what that spec does NOT observe:
 *
 *   1. **The button must not lie (AC2/AC3, end to end).** Every existing
 *      assertion rebuilds the expected destination from `ap-2027.json` — which
 *      proves the string is dataset-derived but NOT that it is the slot the
 *      exam actually lands on. Here the destination is read OFF the rendered
 *      button, parsed, and then checked against where the schedule actually
 *      puts that exam after the click: same date group heading, same AM/PM
 *      session chip. A button promising the wrong subject's slot (or a stale
 *      one) passes the builder's spec and fails this one.
 *   2. **The INLINE host (AC6).** The builder covered modal + calendar; the
 *      ScheduleView *inline* presentation (post-dismiss, issue #5's section)
 *      is only reached incidentally through `.first()`. Asserted explicitly
 *      here — no `<ul>`, same two-line buttons, same destinations.
 *   3. **The moving indicator's NEW second line's contrast (AC4 + AC7).**
 *      `a11y.spec.ts` measures both lines of the red *button*; nothing
 *      measures the destination line issue #111 added to the N≥3 moving
 *      indicator, which sits on the prompt's own red-50/red-950 fill instead.
 *   4. **AC1 in the N≥3 midway state.** "No visible text states any subject's
 *      slot twice" is asserted at rest; midway (indicator + two buttons) is
 *      the state where a duplicated destination would actually be likely.
 *   5. **The issue's evidence requirement (AC9)** — modal + inline at
 *      1920×1080 / 1024×768 / 375×667, light + dark, plus an N≥3 conflict
 *      captured midway showing indicator-with-destination.
 *
 * AC5's inert no-late-slot row stays pinned at the unit layer
 * (`src/lib/conflict-rows.test.ts`) — the shipped dataset's schema guarantees
 * a late-testing slot for every examined subject, so no browser fixture can
 * reach it.
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";
const EVIDENCE_DIR = evidenceDir("issue-111-qa-v1");

// Fixture ids only — every expected string in this suite is read from the
// rendered UI, never rebuilt from the dataset (see docstring point 1).
const BIOLOGY = "biology";
const ITALIAN = "italian-language-and-culture";
const TRIO = ["french-language-and-culture", "physics-2", "world-history-modern"];

const prompt = (page: Page) => page.getByTestId("conflict-prompt").first();
const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const moveButtons = (page: Page) =>
  prompt(page).getByRole("button", { name: /^Move .+ to late testing/ });
const movingIndicator = (page: Page) =>
  page.getByTestId("conflict-moving-indicator");

async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

async function storedResolutions(page: Page): Promise<unknown[]> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "[]"),
    RESOLUTIONS_KEY,
  );
}

interface Promise_ {
  /** Subject as the button names it, e.g. "AP Biology". */
  subject: string;
  /** Date label as the button prints it, e.g. "Wednesday, May 19, 2027". */
  dateLabel: string;
  /** "AM" | "PM", as the button prints it. */
  session: string;
}

/**
 * Read a row's promise straight out of the DOM: the subject from the primary
 * line, the destination date + session from the second line. Nothing here is
 * derived from `ap-2027.json` — that is the point.
 */
async function readPromise(row: Locator): Promise<Promise_> {
  const lines = (await row.innerText())
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  expect(lines, "a merged row renders exactly two lines").toHaveLength(2);

  const primary = /^(?:✓\s*Moving|Move) (.+) to late testing$/.exec(lines[0]);
  expect(
    primary,
    `unparsable primary line: ${JSON.stringify(lines[0])}`,
  ).not.toBeNull();
  // Drop the decorative leading emoji SubjectName injects (aria-hidden, so it
  // is not part of the accessible name either).
  const subject = primary![1].replace(/^[^A-Za-z]+\s*/u, "");

  const dest = /^(?:→\s*)?(.+) · (AM|PM) session$/.exec(lines[1]);
  expect(
    dest,
    `unparsable destination line: ${JSON.stringify(lines[1])}`,
  ).not.toBeNull();

  return { subject, dateLabel: dest![1], session: dest![2] };
}

/** The schedule's date group whose heading is exactly `dateLabel`. */
const dateGroupByLabel = (page: Page, dateLabel: string) =>
  schedule(page)
    .locator("ol > li")
    .filter({ has: page.locator("h3", { hasText: dateLabel }) });

/**
 * Assert the app actually honored a row's promise: the named subject now sits
 * in the date group the row named, carrying that row's AM/PM session chip and
 * the "Moved to late testing" tag.
 */
async function expectPromiseHonored(page: Page, p: Promise_) {
  const group = dateGroupByLabel(page, p.dateLabel);
  await expect(
    group,
    `schedule has a "${p.dateLabel}" group (promised for ${p.subject})`,
  ).toHaveCount(1);

  const row = group.locator("ul > li").filter({ hasText: p.subject });
  await expect(
    row,
    `${p.subject} sits under the date its Move action promised`,
  ).toHaveCount(1);
  await expect(row, `${p.subject}: promised ${p.session} session`).toContainText(
    p.session,
  );
  await expect(row).toContainText("Moved to late testing");
}

/** Canvas-composited contrast ratio — same helper shape as a11y.spec.ts AC3. */
async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const parse = (css: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillStyle = css;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const layers: RGBA[] = [];
    let node: Element | null = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) {
        layers.unshift(bg);
        if (bg[3] >= 1) break;
      }
      node = node.parentElement;
    }
    let base: RGBA = [255, 255, 255, 1];
    for (const layer of layers) {
      const a = layer[3];
      base = [
        layer[0] * a + base[0] * (1 - a),
        layer[1] * a + base[1] * (1 - a),
        layer[2] * a + base[2] * (1 - a),
        1,
      ];
    }
    const fgRaw = parse(getComputedStyle(el).color);
    const a = fgRaw[3];
    const fg: RGBA = [
      fgRaw[0] * a + base[0] * (1 - a),
      fgRaw[1] * a + base[1] * (1 - a),
      fgRaw[2] * a + base[2] * (1 - a),
      1,
    ];
    const lum = (c: RGBA) => {
      const chan = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
    };
    const l1 = lum(fg);
    const l2 = lum(base);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
}

test.describe("issue #111 QA — merged Move actions, independent verification", () => {
  test("AC2/AC3 — the destination printed ON the button is where the exam actually lands (read from the DOM, verified against the schedule)", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY, ITALIAN]);
    await page.goto("/");
    await openList(page);
    await expect(moveButtons(page)).toHaveCount(2);

    // Read BOTH promises before touching anything: each button must carry its
    // OWN subject's slot, so the two destinations must differ.
    const first = await readPromise(moveButtons(page).nth(0));
    const second = await readPromise(moveButtons(page).nth(1));
    expect(
      `${first.dateLabel} ${first.session}`,
      "the two members promise different late-testing slots",
    ).not.toBe(`${second.dateLabel} ${second.session}`);

    // Click the first button and hold it to its promise.
    await moveButtons(page).nth(0).click();
    await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
    await expectPromiseHonored(page, first);

    // The keeper stayed put — it did NOT also go to its promised slot.
    await expect(
      dateGroupByLabel(page, second.dateLabel).locator("ul > li").filter({
        hasText: second.subject,
      }),
      `${second.subject} (the keeper) did not move`,
    ).toHaveCount(0);
    expect(await storedResolutions(page)).toHaveLength(1);
  });

  test("AC1/AC6 — the INLINE (non-modal) prompt shows the identical merged stack: no bullet list, one two-line action per member", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY, ITALIAN]);
    await page.goto("/");
    await openList(page);

    // Capture the modal's shape, then dismiss to the inline presentation.
    const modalRows = [
      await readPromise(moveButtons(page).nth(0)),
      await readPromise(moveButtons(page).nth(1)),
    ];
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(prompt(page)).toBeVisible();

    // Same merged design inline: no list markup, same two actions, same
    // destinations, in the same order.
    await expect(prompt(page).locator("ul")).toHaveCount(0);
    await expect(prompt(page).locator("li")).toHaveCount(0);
    await expect(moveButtons(page)).toHaveCount(2);
    expect([
      await readPromise(moveButtons(page).nth(0)),
      await readPromise(moveButtons(page).nth(1)),
    ]).toEqual(modalRows);

    // Inline still resolves through the same pathway, to the same slot.
    await moveButtons(page).nth(1).click();
    await expectPromiseHonored(page, modalRows[1]);
  });

  test("AC1/AC4 — N≥3 midway: the indicator keeps its own destination, no slot is printed twice, and both movers land where their rows promised", async ({
    page,
  }) => {
    await seedSelection(page, TRIO);
    await page.goto("/");
    await openList(page);
    await expect(moveButtons(page)).toHaveCount(3);

    const promises = [
      await readPromise(moveButtons(page).nth(0)),
      await readPromise(moveButtons(page).nth(1)),
      await readPromise(moveButtons(page).nth(2)),
    ];

    await moveButtons(page).nth(0).click();
    await expect(movingIndicator(page)).toHaveCount(1);
    expect(await storedResolutions(page)).toHaveLength(0);

    // The clicked row kept its identity AND its destination verbatim.
    expect(await readPromise(movingIndicator(page))).toEqual(promises[0]);

    // AC1 in the state where duplication would actually be likely: midway,
    // every member's slot still appears exactly once in the whole prompt.
    const promptText = await prompt(page).innerText();
    for (const p of promises) {
      const needle = `${p.dateLabel} · ${p.session} session`;
      expect(
        promptText.split(needle).length - 1,
        `${p.subject}: its late-testing slot is printed exactly once midway`,
      ).toBe(1);
    }

    // Finish the flow: the second click leaves one member, so it resolves.
    await moveButtons(page).nth(0).click();
    await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
    await expectPromiseHonored(page, promises[0]);
    await expectPromiseHonored(page, promises[1]);
    expect(await storedResolutions(page)).toHaveLength(1);
  });

  test("AC4/AC7 — the destination line issue #111 added to the moving indicator measures ≥ 4.5:1, light and dark", async ({
    browser,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await seedSelection(page, TRIO);
      await page.goto("/");
      await openList(page);
      await moveButtons(page).nth(0).click();
      await expect(movingIndicator(page)).toHaveCount(1);

      // Direct child only — the row's own second line, not the arrow/emoji
      // spans nested inside it.
      const line = movingIndicator(page).locator("> span:last-child");
      await expect(line).toBeVisible();
      await expect(line).toContainText(" session");
      const ratio = await contrastRatio(line);
      expect(
        ratio,
        `moving-indicator destination line (${scheme}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
      await ctx.close();
    }
  });

  // -------------------------------------------------------------------------
  // Evidence (AC9) — modal + inline at the three standard viewports, light +
  // dark, plus the N≥3 conflict captured midway.
  // -------------------------------------------------------------------------
  for (const vp of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    test(`evidence — merged Move actions, modal + inline, light + dark at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, [BIOLOGY, ITALIAN]);
      await page.goto("/");
      await openList(page);

      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await expect(moveButtons(page)).toHaveCount(2);
      await expect(prompt(page).locator("ul")).toHaveCount(0);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/modal-${vp.name}-light.png`,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: `${EVIDENCE_DIR}/modal-${vp.name}-dark.png`,
      });

      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(prompt(page)).toBeVisible();
      await prompt(page).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/inline-${vp.name}-dark.png`,
      });
      await page.emulateMedia({ colorScheme: "light" });
      await page.screenshot({
        path: `${EVIDENCE_DIR}/inline-${vp.name}-light.png`,
      });
    });
  }

  test("evidence — N≥3 conflict captured MIDWAY: one subject moving (with its destination), two Move buttons left", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(page, TRIO);
    await page.goto("/");
    await openList(page);
    await moveButtons(page).nth(0).click();

    await expect(movingIndicator(page)).toHaveCount(1);
    await expect(moveButtons(page)).toHaveCount(2);
    expect(await storedResolutions(page)).toHaveLength(0);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/n3-midway-desktop-light.png`,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `${EVIDENCE_DIR}/n3-midway-desktop-dark.png`,
    });

    // Mobile too — the two-line rows are tightest at 375px.
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(movingIndicator(page)).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/n3-midway-mobile-light.png`,
    });
  });
});
