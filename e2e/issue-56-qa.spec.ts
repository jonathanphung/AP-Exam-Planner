import { test, expect, type Download } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * QA acceptance drive for issue #56 — designed per-week PNG cards.
 *
 * Independent Tester verification (super-board QA lane): drives the REAL app
 * (real dataset, real download pipeline) and saves the ACTUAL downloaded files
 * into the QA evidence folder for the AC-required matrix — a 1-week, a 2-week,
 * and a full 3-week export (with a moved-to-late exam), light + dark.
 *
 * Covers: AC1 (one designed PNG per non-empty week, chronological order),
 * AC4 (effective/moved-to-late slots — the 3-week case bumps Latin to its late
 * window), AC7 (both themes), AC8 (pixelRatio ≥ 2 → a 680px card rasterizes
 * ≥ ~1360px wide; solid PNG), AC11 (the real downloaded files as evidence).
 * AC10 (other menu items untouched) is checked at runtime in the last test.
 *
 * Selections are seeded via the legacy localStorage keys the schedules store
 * migrates on first load, so the 3-week case gets its moved-to-late Latin exam
 * without driving the conflict dialog.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-56-qa-v1";

/** 680px designed card at pixelRatio 2 ⇒ ~1360px raster width. */
const MIN_RASTER_WIDTH = 1300;

interface Scenario {
  key: string;
  selection: string[];
  resolutions: unknown[];
  expected: string[];
}

const KEEP_BIOLOGY = {
  date: "2026-05-04",
  session: "AM",
  keeperId: "biology",
  memberIds: ["biology", "latin"],
};

const SCENARIOS: Scenario[] = [
  {
    key: "1week",
    selection: ["biology"],
    resolutions: [],
    expected: ["ap-exams-2026-week-1.png"],
  },
  {
    key: "2week",
    selection: ["biology", "seminar"],
    resolutions: [],
    expected: ["ap-exams-2026-week-1.png", "ap-exams-2026-week-2.png"],
  },
  {
    key: "3week",
    selection: ["biology", "latin", "seminar"],
    resolutions: [KEEP_BIOLOGY],
    expected: [
      "ap-exams-2026-week-1.png",
      "ap-exams-2026-week-2.png",
      "ap-exams-2026-late-testing.png",
    ],
  },
];

const THEMES = ["light", "dark"] as const;

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const scenario of SCENARIOS) {
  for (const theme of THEMES) {
    test(`${scenario.key} · ${theme} — emits exactly ${scenario.expected.length} designed week card(s)`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([sel, res, th]) => {
          try {
            localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
            localStorage.setItem("apx.resolutions.v1", JSON.stringify(res));
            localStorage.setItem("apx.theme.v1", th as string);
          } catch {}
        },
        [scenario.selection, scenario.resolutions, theme] as const,
      );

      await page.goto("/");
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.documentElement.classList.contains("dark"),
          ),
        )
        .toBe(theme === "dark");

      const trigger = page.getByTestId("export-menu-button");
      await expect(trigger).toBeEnabled();

      const downloads: Download[] = [];
      page.on("download", (d) => downloads.push(d));

      await trigger.click();
      await expect(page.getByTestId("export-menu")).toBeVisible();
      await page
        .getByRole("menuitem", { name: "Save as .png", exact: true })
        .click();

      await expect
        .poll(() => downloads.length, { timeout: 20000 })
        .toBe(scenario.expected.length);

      // AC1: exact set of emitted week files, in chronological week order.
      expect(downloads.map((d) => d.suggestedFilename())).toEqual(
        scenario.expected,
      );

      for (const download of downloads) {
        const buf = readFileSync(await download.path());
        // AC8: PNG signature (solid, real raster).
        expect([...buf.subarray(0, 8)]).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        // AC8: pixelRatio ≥ 2 ⇒ the 680px design width rasterizes ≥ ~1360px.
        expect(width).toBeGreaterThanOrEqual(MIN_RASTER_WIDTH);
        expect(height).toBeGreaterThan(0);
        writeFileSync(
          `${EVIDENCE_DIR}/${scenario.key}-${theme}-${download.suggestedFilename()}`,
          buf,
        );
      }
    });
  }
}

/**
 * AC10 (runtime): the .png change is isolated — .ics / .json / .txt still
 * download their single files unchanged. Byte-identical ics.ts is already
 * proven by git diff; this proves the three other menu items still function.
 */
test("other export menu items still download single files (AC10)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "apx.selection.v1",
        JSON.stringify(["biology", "seminar"]),
      );
      localStorage.setItem("apx.resolutions.v1", JSON.stringify([]));
      localStorage.setItem("apx.theme.v1", "light");
    } catch {}
  });

  await page.goto("/");
  const trigger = page.getByTestId("export-menu-button");
  await expect(trigger).toBeEnabled();

  for (const [item, expected] of [
    ["Save as .ics", "ap-exams-2026.ics"],
    ["Save as .json", "ap-exams-2026.json"],
    ["Save as .txt", "ap-exams-2026.txt"],
  ] as const) {
    await trigger.click();
    await expect(page.getByTestId("export-menu")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(expected);
  }
});
