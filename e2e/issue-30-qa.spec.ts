import { test, expect, type Page, type Browser } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { REGULAR_WINDOWS, LATE_TESTING_WINDOW } from "../src/data/schema";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #30) — evidence spec.
 *
 * The Builder's e2e/issue-30-calendar-palette.spec.ts is the per-AC regression
 * guard (orange override, ⚠️ + worded label, resolve fallback, light-mode
 * distinctness, AA contrast in both themes). This QA spec adds the evidence
 * layer plus the checks the Builder spec does NOT cover:
 *
 *   - Standard-viewport screenshots (1920×1080 / 1024×768 / 375×667) of the
 *     unresolved-conflict state, with zero console / page error guards.
 *   - AC3 evidence: resolved state — keeper back to its pastel, mover at its
 *     late slot with the pre-existing "Moved to late testing" affordance
 *     UNCHANGED (the ticket requires the existing affordances to survive).
 *   - AC4 in DARK mode: the Builder measured pastel-vs-orange distinctness in
 *     light only; the AC demands it "in both light and dark themes". Measured
 *     here from composited rendered colours (canvas-normalised for oklch).
 *   - AC6 evidence: dark-mode conflict + resolved screenshots.
 *   - AC8: legend dots and off-grid list markers (incl. the two categories
 *     that never render grid blocks in these fixtures) carry the SAME pastel
 *     accent classes as the block scheme, light + dark variants.
 *
 * Screenshots land in docs/super-board/runs/issue-30-qa-v1/ and are committed
 * to the issue branch so they render inline on the issue / PR.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-30-qa-v1";
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

// Same fixture set as the Builder spec (cross-category conflict + one clean
// block per block-bearing category), plus two off-grid subjects for AC8.
const BIOLOGY = byId("biology"); // STEM — conflicts with Latin (05-04 AM)
const LATIN = byId("latin"); // Languages — conflicts with Biology
const CHEMISTRY = byId("chemistry"); // STEM, clean
const EURO_HISTORY = byId("european-history"); // Humanities, clean
const CHINESE = byId("chinese-language-and-culture"); // Languages, clean
const MUSIC_THEORY = byId("music-theory"); // Arts, clean
const DRAWING = byId("drawing"); // Arts — portfolio only → off-grid row
const CYBERSECURITY = byId("cybersecurity"); // Career Kickstart — undated → off-grid row

if (BIOLOGY.exam!.date !== LATIN.exam!.date || BIOLOGY.exam!.session !== LATIN.exam!.session)
  throw new Error("fixture drift: biology/latin no longer share a slot");
if (DRAWING.exam !== null || CYBERSECURITY.exam !== null)
  throw new Error("fixture drift: off-grid fixtures now have exam dates");
if (CYBERSECURITY.category !== "Career Kickstart")
  throw new Error("fixture drift: cybersecurity left Career Kickstart");

const CONFLICT_SET = [
  BIOLOGY.id,
  LATIN.id,
  CHEMISTRY.id,
  EURO_HISTORY.id,
  CHINESE.id,
  MUSIC_THEORY.id,
];

// ---- Week fixtures (mirror calendarWeeks(), never hardcoded) ---------------
const WINDOWS = [
  ...REGULAR_WINDOWS.map((w) => ({ ...w, late: false })),
  { ...LATE_TESTING_WINDOW, late: true },
];
function weekNumberOf(iso: string): number {
  const idx = WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);
  if (idx < 0) throw new Error(`no testing week contains ${iso}`);
  return idx + 1;
}

// ---- Locators / helpers -----------------------------------------------------
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
async function seedResolution(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      RESOLUTIONS_KEY,
      JSON.stringify([
        {
          date: BIOLOGY.exam!.date,
          session: BIOLOGY.exam!.session,
          keeperId: LATIN.id,
          memberIds: [BIOLOGY.id, LATIN.id],
        },
      ]),
    ] as const,
  );
}
async function openCalendar(page: Page) {
  await pressViewChip(page, "Calendar");
  await expect(calendarView(page)).toBeVisible();
  await calendarView(page).scrollIntoViewIfNeeded();
}
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

/** Composited background of a block button as "r,g,b" (oklch-safe). */
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

function collectErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return {
    assertClean: () => {
      const meaningful = consoleErrors.filter((t) => !/favicon/i.test(t));
      expect(pageErrors, `page errors: ${pageErrors.join(", ")}`).toEqual([]);
      expect(meaningful, `console errors: ${meaningful.join(", ")}`).toEqual([]);
    },
  };
}

// ---------------------------------------------------------------------------
// Standard-viewport evidence — unresolved conflict state (light), error-free.
// ---------------------------------------------------------------------------
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC1/AC2 evidence — conflict week renders orange ⚠️ blocks with no errors (${vp.name} ${vp.width}×${vp.height})`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedSelection(page, CONFLICT_SET);
    await page.goto("/");
    await openCalendar(page);
    await gotoWeek(page, weekNumberOf(BIOLOGY.exam!.date));

    for (const s of [BIOLOGY, LATIN]) {
      const cls = (await blockButton(page, s.id).getAttribute("class")) ?? "";
      expect(cls, `${s.id} must wear the orange conflict style`).toContain(
        "bg-[#FDBA74]",
      );
    }
    await expect(page.getByTestId("block-conflict-marker")).toHaveCount(2);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
    errors.assertClean();
  });
}

// ---------------------------------------------------------------------------
// AC3 evidence — resolved state: keeper pastel again; mover at its late slot
// with the pre-existing "Moved to late testing" affordance unchanged.
// ---------------------------------------------------------------------------
test("AC3 evidence — resolved conflict: keeper pastel, mover keeps the 'Moved to late testing' affordance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, CONFLICT_SET);
  await seedResolution(page);
  await page.goto("/");
  await openCalendar(page);

  // Regular week — Latin (keeper) is green (#C9E89B) again, zero markers.
  await gotoWeek(page, weekNumberOf(LATIN.exam!.date));
  const latinCls = (await blockButton(page, LATIN.id).getAttribute("class")) ?? "";
  expect(latinCls).toContain("bg-[#C9E89B]");
  expect(latinCls).not.toContain("bg-[#FDBA74]");
  await expect(
    calendarView(page).getByTestId("block-conflict-marker"),
  ).toHaveCount(0);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac3-resolved-keeper-desktop.png`,
    fullPage: true,
  });

  // Late-testing week — Biology moved: blue (#C7CEEA) pastel, NOT orange, and
  // the existing moved-to-late affordances (visible caption + accessible-name
  // wording) survive the restyle untouched.
  await gotoWeek(page, weekNumberOf(BIOLOGY.lateTesting!.date));
  const bioCls = (await blockButton(page, BIOLOGY.id).getAttribute("class")) ?? "";
  expect(bioCls).toContain("bg-[#C7CEEA]");
  expect(bioCls).not.toContain("bg-[#FDBA74]");
  await expect(
    page
      .locator(`[data-subject-id="${BIOLOGY.id}"]`)
      .getByText("Moved to late testing"),
  ).toBeVisible();
  await expect(blockButton(page, BIOLOGY.id)).toHaveAttribute(
    "aria-label",
    /moved to late testing/i,
  );
  await expect(blockButton(page, BIOLOGY.id)).not.toHaveAttribute(
    "aria-label",
    /time conflict/i,
  );
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac3-resolved-mover-late-desktop.png`,
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// AC4 (dark) + AC6 evidence — the Builder measured pastel-vs-orange
// distinctness in light only; the AC requires BOTH themes. Measured from the
// rendered dark colours, plus dark-mode screenshots (conflict + resolved).
// ---------------------------------------------------------------------------
test("AC4/AC6 — dark mode: category fills distinct from each other and from orange; conflict + resolved screenshots", async ({
  browser,
}: {
  browser: Browser;
}) => {
  // Dark conflict state.
  const darkCtx = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await darkCtx.newPage();
  const errors = collectErrors(page);
  await seedSelection(page, CONFLICT_SET);
  await page.goto("/");
  await openCalendar(page);

  const catalog: Record<string, string> = {};
  await gotoWeek(page, weekNumberOf(CHEMISTRY.exam!.date));
  catalog.STEM = await bgColor(page, CHEMISTRY.id);
  catalog.Humanities = await bgColor(page, EURO_HISTORY.id);
  catalog.Languages = await bgColor(page, CHINESE.id);
  const orange = await bgColor(page, LATIN.id); // conflicted → orange (dark)

  await gotoWeek(page, weekNumberOf(BIOLOGY.exam!.date));
  await expect(page.getByTestId("block-conflict-marker")).toHaveCount(2);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/dark-conflict-desktop.png`,
    fullPage: true,
  });

  await gotoWeek(page, weekNumberOf(MUSIC_THEORY.exam!.date));
  catalog.Arts = await bgColor(page, MUSIC_THEORY.id);

  const fills = Object.entries(catalog);
  for (let i = 0; i < fills.length; i += 1) {
    expect(
      fills[i][1],
      `dark ${fills[i][0]} fill must differ from the dark orange conflict fill`,
    ).not.toBe(orange);
    for (let j = i + 1; j < fills.length; j += 1)
      expect(
        fills[i][1],
        `dark ${fills[i][0]} vs ${fills[j][0]} fills must differ`,
      ).not.toBe(fills[j][1]);
  }
  errors.assertClean();
  await darkCtx.close();

  // Dark resolved state — orange gone, measured (not just class-asserted).
  const darkResolved = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1920, height: 1080 },
  });
  const page2 = await darkResolved.newPage();
  await seedSelection(page2, CONFLICT_SET);
  await seedResolution(page2);
  await page2.goto("/");
  await openCalendar(page2);
  await gotoWeek(page2, weekNumberOf(LATIN.exam!.date));
  expect(
    await bgColor(page2, LATIN.id),
    "resolved keeper must not render the dark orange conflict fill",
  ).not.toBe(orange);
  await expect(
    calendarView(page2).getByTestId("block-conflict-marker"),
  ).toHaveCount(0);
  await page2.screenshot({
    path: `${EVIDENCE_DIR}/dark-resolved-desktop.png`,
    fullPage: true,
  });
  await darkResolved.close();
});

// ---------------------------------------------------------------------------
// AC8 — legend dots + off-grid list markers carry the SAME pastel accents,
// including the two categories that render no grid block here (Arts portfolio
// row + Career Kickstart undated row), light and dark class variants.
// ---------------------------------------------------------------------------
test("AC8 — legend and off-grid markers use the pastel accent scheme (incl. Career Kickstart)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [
    CHEMISTRY.id,
    EURO_HISTORY.id,
    CHINESE.id,
    MUSIC_THEORY.id,
    DRAWING.id, // Arts portfolio deadline → off-grid row (pink dot)
    CYBERSECURITY.id, // Career Kickstart, no 2026 exam → off-grid row (lavender dot)
  ]);
  await page.goto("/");
  await openCalendar(page);

  // Legend: one pastel dot per block-bearing category — the SAME hex accent the
  // blocks use, with light + dark hex variants in the same class string.
  const legend = page.getByRole("list", { name: "Category color legend" });
  await expect(legend).toBeVisible();
  const expectedLegend: Array<[string, string, string]> = [
    ["STEM", "bg-[#5E74C0]", "dark:bg-[#8296DC]"],
    ["Humanities", "bg-[#CBA53A]", "dark:bg-[#E3C766]"],
    ["Languages", "bg-[#7EB84A]", "dark:bg-[#A0D172]"],
    ["Arts", "bg-[#EF5D6A]", "dark:bg-[#F98A93]"],
  ];
  for (const [label, lightDot, darkDot] of expectedLegend) {
    const dot = legend
      .locator("li", { hasText: label })
      .locator("span[aria-hidden]");
    const cls = (await dot.getAttribute("class")) ?? "";
    expect(cls, `${label} legend dot uses its pastel light accent`).toContain(
      lightDot,
    );
    expect(cls, `${label} legend dot has a dark pastel variant`).toContain(
      darkDot,
    );
  }

  // Off-grid rows: the portfolio (Arts) and undated (Career Kickstart) list
  // markers wear the same pastel accents as the legend/block scheme.
  const offGrid = page.getByTestId("calendar-off-grid");
  await expect(offGrid).toBeVisible();
  const offGridCases: Array<[string, string, string]> = [
    [DRAWING.name, "bg-[#EF5D6A]", "dark:bg-[#F98A93]"], // Arts (pink)
    [CYBERSECURITY.name, "bg-[#9866C0]", "dark:bg-[#B98FD8]"], // Career Kickstart (lavender)
  ];
  for (const [name, lightDot, darkDot] of offGridCases) {
    const dot = offGrid
      .locator("li", { hasText: name })
      .locator("span[aria-hidden]")
      .first();
    const cls = (await dot.getAttribute("class")) ?? "";
    expect(cls, `${name} off-grid marker uses its pastel light accent`).toContain(
      lightDot,
    );
    expect(cls, `${name} off-grid marker has a dark pastel variant`).toContain(
      darkDot,
    );
  }

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac8-legend-offgrid-desktop.png`,
    fullPage: true,
  });
});
