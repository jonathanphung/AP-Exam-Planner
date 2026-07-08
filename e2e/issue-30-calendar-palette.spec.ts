import { test, expect, type Page, type Browser } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { REGULAR_WINDOWS, LATE_TESTING_WINDOW } from "../src/data/schema";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board Builder assertions for issue #30 — calendar conflict blocks +
 * pastel category palette.
 *
 * One observable, browser-level check per acceptance criterion:
 *
 *   Conflict coloring
 *   - AC1: two cross-category exams in an UNRESOLVED same-slot conflict both
 *          render in the shared ORANGE style (category hue overridden).
 *   - AC2: each conflict block carries a decorative ⚠️ marker AND spells the
 *          conflict out in words in its accessible name (colour is never the
 *          only signal) + a visible "Time conflict" caption.
 *   - AC3: once the conflict is RESOLVED (a member moved to late testing) both
 *          blocks return to their pastel category styling — orange strictly
 *          means "unresolved conflict, action needed".
 *
 *   Pastel palette + contrast
 *   - AC4: the five category block styles are a soft pastel scheme; the four
 *          categories that render as grid blocks are measured, distinct from
 *          one another and from the orange conflict tone.
 *   - AC5: block text on every pastel fill (and on the orange conflict fill)
 *          clears WCAG AA (>=4.5:1) in BOTH light and dark themes — measured
 *          live from the rendered colours (not hard-coded hexes) and logged.
 *
 * Fixtures are asserted from the shipped dataset (never hard-coded beyond
 * ids) so a dataset edit fails loudly here instead of silently weakening a
 * check. The QA lane owns the screenshot + contrast-table evidence; this spec
 * is the durable regression guard on classes, labels and measured ratios.
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
};
const DATASET = apData as { subjects: Subject[] };
const byId = (id: string): Subject => {
  const s = DATASET.subjects.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};

// Conflict pair — CROSS-category so "both go orange regardless of category"
// is actually exercised (STEM Biology + Languages Latin share 05-04 AM).
const BIOLOGY = byId("biology"); // STEM, 05-04 AM (conflicts w/ Latin → orange)
const LATIN = byId("latin"); // Languages, 05-04 AM (conflicts w/ Biology → orange)
// Conflict-free per-category blocks (Career Kickstart has no exam-bearing
// subject, so it never renders a grid block — it appears only as a legend /
// off-grid dot, which carries no block text and no AA-for-text obligation).
const CHEMISTRY = byId("chemistry"); // STEM, 05-05 AM — a clean blue block
const EURO_HISTORY = byId("european-history"); // Humanities, 05-04 PM
const CHINESE = byId("chinese-language-and-culture"); // Languages, 05-08 PM
const MUSIC_THEORY = byId("music-theory"); // Arts, 05-11 PM

// ---- Guard fixture assumptions against dataset drift -----------------------
if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");
if (BIOLOGY.category === LATIN.category)
  throw new Error("fixture drift: biology/latin now share a category");
if (BIOLOGY.category !== "STEM" || LATIN.category !== "Languages")
  throw new Error("fixture drift: biology/latin categories moved");
if (!BIOLOGY.lateTesting)
  throw new Error("fixture drift: biology has no late-testing slot");
{
  const clean = [CHEMISTRY, EURO_HISTORY, CHINESE, MUSIC_THEORY];
  if (new Set(clean.map((s) => s.category)).size !== 4)
    throw new Error("fixture drift: pastel set no longer spans 4 categories");
  const conflictSlot = `${BIOLOGY.exam!.date}:${BIOLOGY.exam!.session}`;
  const cleanSlots = clean.map((s) => `${s.exam!.date}:${s.exam!.session}`);
  // The four clean blocks must be mutually distinct AND clear of the
  // Biology/Latin conflict slot — otherwise one would itself render orange.
  if (new Set(cleanSlots).size !== clean.length)
    throw new Error("fixture drift: pastel set now has a same-slot collision");
  if (cleanSlots.includes(conflictSlot))
    throw new Error("fixture drift: a clean category block now shares the conflict slot");
  if (
    CHEMISTRY.category !== "STEM" ||
    EURO_HISTORY.category !== "Humanities" ||
    CHINESE.category !== "Languages" ||
    MUSIC_THEORY.category !== "Arts"
  )
    throw new Error("fixture drift: pastel-set categories moved");
}

// ---- Schema-derived week fixtures (mirror calendarWeeks(), never hardcoded)-
const WINDOWS = [
  ...REGULAR_WINDOWS.map((w) => ({ ...w, late: false })),
  { ...LATE_TESTING_WINDOW, late: true },
];
/** 1-based week number of the window containing an ISO date. */
function weekNumberOf(iso: string): number {
  const idx = WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);
  if (idx < 0) throw new Error(`no testing week contains ${iso}`);
  return idx + 1;
}

// ---- Locators / helpers ----------------------------------------------------
const calendarView = (page: Page) => page.getByTestId("calendar-view");
const blockButton = (page: Page, subjectId: string) =>
  page
    .locator(`[data-testid="calendar-block"][data-subject-id="${subjectId}"]`)
    .locator("button");
const indicator = (page: Page) => page.getByTestId("calendar-week-indicator");

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}
async function seedResolutions(
  page: Page,
  resolutions: Array<{
    date: string;
    session: "AM" | "PM";
    keeperId: string;
    memberIds: string[];
  }>,
) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RESOLUTIONS_KEY, JSON.stringify(resolutions)] as const,
  );
}
async function openCalendar(page: Page) {
  await pressViewChip(page, "Calendar");
  await expect(calendarView(page)).toBeVisible();
  await calendarView(page).scrollIntoViewIfNeeded();
}
/** Page the visible week until the indicator reads "Week <n> of ...". */
async function gotoWeek(page: Page, n: number) {
  const prev = page.getByRole("button", { name: /^Previous week/ });
  const next = page.getByRole("button", { name: /^Next week/ });
  for (let guard = 0; guard < 12; guard += 1) {
    const text = (await indicator(page).textContent()) ?? "";
    const match = /Week (\d+) of/.exec(text);
    if (!match) throw new Error(`no week indicator: "${text}"`);
    const current = Number(match[1]);
    if (current === n) return;
    await (current < n ? next : prev).click();
  }
  throw new Error(`could not reach week ${n}`);
}

/**
 * WCAG relative-luminance contrast of an element's text over its composited
 * background — same canvas-compositing technique as e2e/issue-8-qa.spec.ts,
 * so a foreground alpha or a translucent fill is handled correctly.
 */
async function contrastRatio(page: Page, subjectId: string): Promise<number> {
  return blockButton(page, subjectId).evaluate((el) => {
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

/**
 * Composited background colour of a block button as a stable "r,g,b" string
 * (for distinctness comparisons). Uses the same canvas normalisation as
 * `contrastRatio` — `getComputedStyle` returns Tailwind v4 **oklch()** strings,
 * which a plain regex can't read, so we let the canvas convert any CSS colour
 * (oklch, rgb, hex, …) to concrete channels and alpha-composite the stack.
 */
async function bgColor(page: Page, subjectId: string): Promise<string> {
  return blockButton(page, subjectId).evaluate((el) => {
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
    return base.slice(0, 3).map(Math.round).join(",");
  });
}

// ---------------------------------------------------------------------------
// AC1 + AC2 — unresolved cross-category conflict: both blocks orange, both
//             carry the ⚠️ marker + word "conflict" in the accessible name.
// ---------------------------------------------------------------------------
test("AC1/AC2 — unresolved conflict paints both blocks orange with a caution marker and worded label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  await page.goto("/");
  await openCalendar(page);
  await gotoWeek(page, weekNumberOf(BIOLOGY.exam!.date));

  const bio = blockButton(page, BIOLOGY.id);
  const latin = blockButton(page, LATIN.id);
  await expect(bio).toBeVisible();
  await expect(latin).toBeVisible();

  // Both wear the shared orange conflict style, NOT their category hues
  // (STEM blue #C7CEEA / Languages green #C9E89B) — category is overridden.
  for (const btn of [bio, latin]) {
    const cls = (await btn.getAttribute("class")) ?? "";
    expect(cls).toContain("bg-[#FDBA74]");
    expect(cls).toContain("border-[#EA580C]");
    expect(cls).not.toContain("bg-[#C7CEEA]");
    expect(cls).not.toContain("bg-[#C9E89B]");
  }

  // ⚠️ marker present on both; it is decorative (aria-hidden), so the conflict
  // is ALSO carried in words in the accessible name and a visible caption.
  await expect(page.getByTestId("block-conflict-marker")).toHaveCount(2);
  for (const s of [BIOLOGY, LATIN]) {
    await expect(blockButton(page, s.id)).toHaveAttribute(
      "aria-label",
      /unresolved time conflict/i,
    );
    const marker = page
      .locator(`[data-subject-id="${s.id}"]`)
      .getByTestId("block-conflict-marker");
    await expect(marker).toHaveAttribute("aria-hidden", "true");
    await expect(
      page.locator(`[data-subject-id="${s.id}"]`).getByText("Time conflict"),
    ).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// AC3 — resolving the conflict returns both blocks to category styling.
// ---------------------------------------------------------------------------
test("AC3 — resolved conflict drops the orange: keeper returns to its pastel category, mover shows late (no marker)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  // Keep Latin at the regular time; Biology moves to its published late slot.
  await seedResolutions(page, [
    {
      date: BIOLOGY.exam!.date,
      session: BIOLOGY.exam!.session,
      keeperId: LATIN.id,
      memberIds: [BIOLOGY.id, LATIN.id],
    },
  ]);
  await page.goto("/");
  await openCalendar(page);

  // Regular week: Latin is back to its Languages (green #C9E89B) pastel — no
  // orange, no ⚠️, and the accessible name no longer mentions a conflict.
  await gotoWeek(page, weekNumberOf(LATIN.exam!.date));
  const latinCls = (await blockButton(page, LATIN.id).getAttribute("class")) ?? "";
  expect(latinCls).toContain("bg-[#C9E89B]");
  expect(latinCls).not.toContain("bg-[#FDBA74]");
  await expect(blockButton(page, LATIN.id)).toHaveAttribute(
    "aria-label",
    /Languages|Latin/i,
  );
  await expect(blockButton(page, LATIN.id)).not.toHaveAttribute(
    "aria-label",
    /time conflict/i,
  );
  await expect(
    calendarView(page).getByTestId("block-conflict-marker"),
  ).toHaveCount(0);

  // Late-testing week: Biology sits at its late slot in its STEM (blue
  // #C7CEEA) pastel — moved, but NOT orange (resolved).
  await gotoWeek(page, weekNumberOf(BIOLOGY.lateTesting!.date));
  const bioCls = (await blockButton(page, BIOLOGY.id).getAttribute("class")) ?? "";
  expect(bioCls).toContain("bg-[#C7CEEA]");
  expect(bioCls).not.toContain("bg-[#FDBA74]");
  await expect(
    calendarView(page).getByTestId("block-conflict-marker"),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// AC4 — pastel category blocks are distinct from each other and from orange.
// ---------------------------------------------------------------------------
test("AC4 — the four block-bearing categories render distinct pastel fills, none equal to the orange conflict tone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [
    CHEMISTRY.id, // clean STEM (blue)
    EURO_HISTORY.id, // Humanities (yellow)
    CHINESE.id, // Languages (green)
    MUSIC_THEORY.id, // Arts (pink)
    BIOLOGY.id,
    LATIN.id, // Biology+Latin collide → an orange block exists to compare
  ]);
  await page.goto("/");
  await openCalendar(page);

  const catalog: Record<string, string> = {};
  await gotoWeek(page, weekNumberOf(CHEMISTRY.exam!.date)); // week with STEM/Hum/Lang
  catalog.STEM = await bgColor(page, CHEMISTRY.id);
  catalog.Humanities = await bgColor(page, EURO_HISTORY.id);
  catalog.Languages = await bgColor(page, CHINESE.id);
  const orange = await bgColor(page, LATIN.id); // Latin conflicts w/ Biology → orange
  await gotoWeek(page, weekNumberOf(MUSIC_THEORY.exam!.date));
  catalog.Arts = await bgColor(page, MUSIC_THEORY.id);

  const fills = Object.entries(catalog);
  // Each category pastel is distinct from every other, and from orange.
  for (let i = 0; i < fills.length; i += 1) {
    expect(fills[i][1], `${fills[i][0]} must differ from orange`).not.toBe(
      orange,
    );
    for (let j = i + 1; j < fills.length; j += 1)
      expect(
        fills[i][1],
        `${fills[i][0]} vs ${fills[j][0]} fills must differ`,
      ).not.toBe(fills[j][1]);
  }
});

// ---------------------------------------------------------------------------
// AC5 — measured WCAG AA (>=4.5:1) block-text contrast in BOTH themes, for
//       every category that renders a block AND for the orange conflict block.
// ---------------------------------------------------------------------------
async function measureAllContrast(
  page: Page,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await gotoWeek(page, weekNumberOf(CHEMISTRY.exam!.date));
  out["STEM (blue)"] = await contrastRatio(page, CHEMISTRY.id);
  out["Humanities (yellow)"] = await contrastRatio(page, EURO_HISTORY.id);
  out["Languages (green)"] = await contrastRatio(page, CHINESE.id);
  out["Conflict (orange)"] = await contrastRatio(page, LATIN.id);
  await gotoWeek(page, weekNumberOf(MUSIC_THEORY.exam!.date));
  out["Arts (pink)"] = await contrastRatio(page, MUSIC_THEORY.id);
  return out;
}

for (const scheme of ["light", "dark"] as const) {
  test(`AC5 — block text clears WCAG AA on every fill in ${scheme} mode`, async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const context = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    // Biology + Latin collide → both orange; Chemistry/Euro/Chinese/Music are
    // the four conflict-free category blocks we measure the pastel text on.
    await seedSelection(page, [
      CHEMISTRY.id,
      BIOLOGY.id,
      LATIN.id,
      EURO_HISTORY.id,
      CHINESE.id,
      MUSIC_THEORY.id,
    ]);
    await page.goto("/");
    await openCalendar(page);

    const ratios = await measureAllContrast(page);
    // Logged so the value shows up in the test output the QA lane copies into
    // the contrast-ratios evidence file.
    console.log(
      `issue-30 contrast (${scheme}): ` +
        Object.entries(ratios)
          .map(([k, v]) => `${k}=${v.toFixed(2)}:1`)
          .join("  "),
    );
    for (const [label, ratio] of Object.entries(ratios))
      expect(ratio, `${label} @ ${scheme} must be >= 4.5:1`).toBeGreaterThanOrEqual(
        4.5,
      );
    await context.close();
  });
}
