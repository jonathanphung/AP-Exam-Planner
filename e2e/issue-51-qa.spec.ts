import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #51) — the "Export" menu button.
 *
 * The one-shot "Export to Calendar" button (issue #7) became a WAI-ARIA menu
 * button. Since Jon's #56 bounce it carries FIVE "Save as …" items: list-view
 * .png / calendar-view .png / .ics / .json / .txt. This
 * spec is the browser-observable acceptance gate; the pure `.json` / `.txt`
 * builders are unit-tested in `src/lib/exports.test.ts`, and the `.ics` bytes
 * are additionally asserted by `e2e/issue-7-export-ics.spec.ts` (now driven
 * through the same menu item). Here we verify, end-to-end through the real app
 * and the real dataset:
 *
 *   AC1/AC2 — trigger reads "Export" at every width, carries menu-button
 *             semantics (aria-haspopup="menu" + aria-expanded), 32px pill,
 *             disabled at zero selected.
 *   AC3     — WAI-ARIA menu semantics: keyboard open → roving focus
 *             (ArrowUp/Down/Home/End) → Escape returns focus → click-outside.
 *   AC4     — five items in order (png-list, png-calendar, ics, json, txt).
 *   AC5     — NO body scroll lock: opening never shifts the page (#49 class).
 *   AC6     — stacking: the portaled menu paints above the sticky catalog
 *             quick-jump bar (`sticky top-0 z-30`) and every item is the
 *             top-most element at its own center → genuinely clickable
 *             (#42 R6 class).
 *   AC12    — no horizontal scroll at 320/375/1024/1920.
 *   AC13    — one real Playwright download per format: json parses + matches
 *             the selection; txt is CRLF + chronologically sorted; png has
 *             non-zero pixel dimensions; ics lands as ap-exams-2026.ics with a
 *             valid VCALENDAR (identical-to-pre-change is guaranteed by the
 *             zero-byte src/lib/ics.ts diff + the same buildIcsCalendar call).
 *
 * Evidence (light + dark, desktop + mobile menu-open shots, plus a real
 * exported PNG artifact and json/txt snippets) is committed to the run folder
 * by the `evidence — …` tests below.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-51-qa-v1";

const exportButton = (page: Page) => page.getByTestId("export-menu-button");
const exportMenu = (page: Page) => page.getByTestId("export-menu");
const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

async function select(page: Page, name: string) {
  const c = card(page, name);
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

/** Open the menu by clicking the trigger and wait for it to render. */
async function openMenu(page: Page) {
  await exportButton(page).click();
  await expect(exportMenu(page)).toBeVisible();
  await expect(exportButton(page)).toHaveAttribute("aria-expanded", "true");
}

/** Select Biology (exam) + Seminar (exam + portfolio) — the issue-#7 fixture
 *  selection, chosen because it exercises exam AND portfolio rows without a
 *  same-slot conflict. */
async function selectBiologyAndSeminar(page: Page) {
  await select(page, "AP Biology");
  await select(page, "AP Seminar");
  await expect(exportButton(page)).toBeEnabled();
}

/** Trigger a download for a format's menu item and return the Download. */
async function downloadVia(page: Page, itemName: string) {
  await openMenu(page);
  const item = page.getByRole("menuitem", { name: itemName, exact: true });
  await expect(item).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await item.click();
  return downloadPromise;
}

// ── AC1/AC2 — trigger label + menu-button semantics + disabled state ────────
test.describe("issue #51 — Export trigger button", () => {
  const widths = [320, 375, 1024, 1920];

  for (const width of widths) {
    test(`AC1/AC2 — trigger reads exactly "Export" with menu semantics at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");

      const btn = exportButton(page);
      await expect(btn).toBeVisible();
      // Label is just "Export" at EVERY width (the <360px shortening special
      // case is gone) and the accessible name is "Export".
      await expect(btn).toHaveText(/^Export$/);
      await expect(btn).toHaveAccessibleName("Export");
      // Menu-button ARIA contract.
      await expect(btn).toHaveAttribute("aria-haspopup", "menu");
      await expect(btn).toHaveAttribute("aria-expanded", "false");

      // 32px visible pill (issue #31 toolbar contract).
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeCloseTo(32, 0);

      // Disabled at zero selected → the menu cannot open.
      await expect(btn).toBeDisabled();
      await btn.click({ force: true }).catch(() => {});
      await expect(exportMenu(page)).toHaveCount(0);
    });
  }

  test("AC2 — trigger enables on selection and aria-expanded tracks open state", async ({
    page,
  }) => {
    await page.goto("/");
    const btn = exportButton(page);
    await expect(btn).toBeDisabled();

    await select(page, "AP Biology");
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveAttribute("aria-expanded", "false");

    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(exportMenu(page)).toBeVisible();

    // Clicking the trigger again closes it.
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(exportMenu(page)).toHaveCount(0);
  });
});

// ── AC4 — five items in order (Jon's #56 bounce) ────────────────────────────
const MENU_ITEM_NAMES = [
  "Save as list view .png",
  "Save as calendar view .png",
  "Save as .ics",
  "Save as .json",
  "Save as .txt",
] as const;

test.describe("issue #51 — menu items", () => {
  test("AC4 — exactly five menuitems in order: png-list, png-calendar, ics, json, txt", async ({
    page,
  }) => {
    await page.goto("/");
    await select(page, "AP Biology");
    await openMenu(page);

    const items = exportMenu(page).getByRole("menuitem");
    await expect(items).toHaveCount(5);
    await expect(items).toHaveText([
      /Save as list view \.png/,
      /Save as calendar view \.png/,
      /Save as \.ics/,
      /Save as \.json/,
      /Save as \.txt/,
    ]);
    // Each item's ACCESSIBLE NAME is exactly its label (the aria-hidden badge
    // glyphs must not leak into the row's accessible name).
    for (const name of MENU_ITEM_NAMES) {
      await expect(
        page.getByRole("menuitem", { name, exact: true }),
      ).toBeVisible();
    }
  });
});

// ── AC3 — WAI-ARIA menu keyboard semantics ─────────────────────────────────
test.describe("issue #51 — keyboard menu semantics", () => {
  test("AC3 — ArrowDown opens+focuses first, roving Down/Up/Home/End, Escape returns focus", async ({
    page,
  }) => {
    await page.goto("/");
    await select(page, "AP Biology");

    const btn = exportButton(page);
    await btn.focus();

    // ArrowDown opens the menu and focuses the FIRST item (png-list).
    await page.keyboard.press("ArrowDown");
    await expect(exportMenu(page)).toBeVisible();
    await expect(
      page.getByTestId("export-menu-item-png-list"),
    ).toBeFocused();

    // ArrowDown moves to the next item (png-calendar).
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByTestId("export-menu-item-png-calendar"),
    ).toBeFocused();

    // End jumps to the last item (txt); Home back to the first (png-list).
    await page.keyboard.press("End");
    await expect(page.getByTestId("export-menu-item-txt")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("export-menu-item-png-list")).toBeFocused();

    // ArrowUp from the first item wraps to the last (txt).
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("export-menu-item-txt")).toBeFocused();

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(exportMenu(page)).toHaveCount(0);
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  test("AC3 — ArrowUp on the trigger opens+focuses the LAST item", async ({
    page,
  }) => {
    await page.goto("/");
    await select(page, "AP Biology");
    await exportButton(page).focus();

    await page.keyboard.press("ArrowUp");
    await expect(exportMenu(page)).toBeVisible();
    await expect(page.getByTestId("export-menu-item-txt")).toBeFocused();
  });

  test("AC3 — click-outside closes the menu", async ({ page }) => {
    await page.goto("/");
    await select(page, "AP Biology");
    await openMenu(page);

    // Click the page heading — a point that is neither the trigger nor a menu
    // item — and the menu closes. exact:true so the schedule's "My Schedule"
    // heading is not confused with the sidebar's "My schedules" heading.
    await page
      .getByRole("heading", { name: "My Schedule", exact: true })
      .click();
    await expect(exportMenu(page)).toHaveCount(0);
    await expect(exportButton(page)).toHaveAttribute("aria-expanded", "false");
  });
});

// ── AC5 — no body scroll lock / no page shift ──────────────────────────────
test.describe("issue #51 — no scroll lock (#49 defect class)", () => {
  test("AC5 — opening the menu does not lock body scroll or shift the layout", async ({
    page,
  }) => {
    await page.goto("/");
    await select(page, "AP Biology");

    // Bring the trigger into view FIRST, so the act of clicking it to open the
    // menu can't itself scroll the page (Playwright auto-scrolls a click
    // target into view) — that would be a click artifact, not a menu-induced
    // shift. Now any scrollY change on open is the menu's doing.
    await exportButton(page).scrollIntoViewIfNeeded();

    const read = () =>
      page.evaluate(() => ({
        bodyOverflow: getComputedStyle(document.body).overflow,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
        bodyPaddingRight: getComputedStyle(document.body).paddingRight,
        clientWidth: document.documentElement.clientWidth,
        scrollY: window.scrollY,
      }));

    const before = await read();
    await openMenu(page);
    const after = await read();

    // A dialog-style scroll lock sets overflow:hidden on the scroll container
    // (body or html) and (to avoid a scrollbar-width jump) compensates with
    // padding-right. The #49 defect class is exactly that shift — none of it
    // may happen when a dropdown opens.
    expect(after.bodyOverflow).not.toBe("hidden");
    expect(after.htmlOverflow).not.toBe("hidden");
    expect(after.bodyOverflow).toBe(before.bodyOverflow);
    expect(after.htmlOverflow).toBe(before.htmlOverflow);
    expect(after.bodyPaddingRight).toBe(before.bodyPaddingRight);
    // The viewport content width is unchanged → the scrollbar was never
    // removed (no reflow), and the scroll position did not jump.
    expect(after.clientWidth).toBe(before.clientWidth);
    expect(after.scrollY).toBe(before.scrollY);

    // The page is STILL scrollable while the menu is open (proof it isn't
    // locked): programmatic scroll actually moves the window.
    await page.evaluate(() => window.scrollBy(0, 120));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before.scrollY);
  });
});

// ── AC6 — stacking above sticky chrome ─────────────────────────────────────
test.describe("issue #51 — stacking (#42 R6 defect class)", () => {
  test("AC6 — menu portals to <body> and every item is the top-most element at its center", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 640 });
    await page.goto("/");
    await selectBiologyAndSeminar(page);

    // Scroll so the catalog's sticky quick-jump bar (`sticky top-0 z-30`) is
    // pinned at the top of the viewport — the chrome the menu must beat.
    await page.evaluate(() => window.scrollTo(0, 240));
    await openMenu(page);

    // The menu is a direct child of <body> (portal), not nested inside the
    // toolbar's stacking context.
    const parentIsBody = await exportMenu(page).evaluate(
      (el) => el.parentElement === document.body,
    );
    expect(parentIsBody).toBe(true);

    // Every menu item is the element the browser hit-tests at its own center:
    // nothing (sticky bar included) paints over it, so it is genuinely
    // clickable where it overlaps other chrome.
    for (const id of [
      "png-list",
      "png-calendar",
      "ics",
      "json",
      "txt",
    ]) {
      const item = page.getByTestId(`export-menu-item-${id}`);
      const box = await item.boundingBox();
      expect(box, `item ${id} has a box`).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      const topMostIsItem = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          const menu = document.querySelector('[data-testid="export-menu"]');
          return !!(el && menu && menu.contains(el));
        },
        { x: cx, y: cy },
      );
      expect(topMostIsItem, `item ${id} is top-most at its center`).toBe(true);
    }
  });
});

// ── AC13 — one real download per format ────────────────────────────────────
test.describe("issue #51 — real downloads per format", () => {
  test("AC13/AC9 — .json downloads the versioned envelope matching the selection", async ({
    page,
  }) => {
    await page.goto("/");
    await selectBiologyAndSeminar(page);

    const download = await downloadVia(page, "Save as .json");
    expect(download.suggestedFilename()).toBe("ap-exams-2026.json");
    expect(download.url()).toMatch(/^blob:/);

    const raw = readFileSync(await download.path(), "utf8");
    expect(raw.endsWith("}\n")).toBe(true); // trailing newline
    const doc = JSON.parse(raw) as {
      format: string;
      version: number;
      exportedAt: string;
      schedule: { name: string; subjects: Array<{ id: string }> };
    };
    expect(doc.format).toBe("apx-schedule");
    expect(doc.version).toBe(1);
    expect(typeof doc.exportedAt).toBe("string");
    expect(new Date(doc.exportedAt).toISOString()).toBe(doc.exportedAt);
    // Round-trip: the exported subject ids ARE the live selection (order kept).
    expect(doc.schedule.subjects.map((s) => s.id)).toEqual([
      "biology",
      "seminar",
    ]);
    expect(doc.schedule.name).toBe("Schedule 1");
  });

  test("AC13/AC10 — .txt downloads a CRLF, chronologically-sorted schedule", async ({
    page,
  }) => {
    await page.goto("/");
    await selectBiologyAndSeminar(page);

    const download = await downloadVia(page, "Save as .txt");
    expect(download.suggestedFilename()).toBe("ap-exams-2026.txt");

    const raw = readFileSync(await download.path(), "utf8");
    // CRLF EOLs exclusively, trailing newline (Notepad-safe).
    expect(raw.endsWith("\r\n")).toBe(true);
    expect(raw.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);

    const lines = raw.split("\r\n");
    expect(lines[0]).toBe("Schedule 1 - AP Exams (May 2026 cycle)");
    expect(lines[1]).toBe("");

    const body = lines.slice(2).filter((l) => l !== "");
    // Seminar's portfolio deadline (Apr 30) precedes Biology's exam (May 4),
    // which precedes Seminar's exam (May 11) — chronological order.
    expect(body).toEqual([
      "Thursday, April 30, 2026 | Portfolio deadline | AP Seminar",
      "Monday, May 4, 2026 | AM session | AP Biology",
      "Monday, May 11, 2026 | PM session | AP Seminar",
    ]);
  });

  for (const { view, menuItem } of [
    { view: "list", menuItem: "Save as list view .png" },
    { view: "calendar", menuItem: "Save as calendar view .png" },
  ] as const) {
    test(`AC13/AC8 — ${view} .png downloads one designed card per non-empty testing week`, async ({
      page,
    }) => {
      await page.goto("/");
      await selectBiologyAndSeminar(page);

      // Since issue #56 (+ bounce) each .png item emits one designed PNG per
      // non-empty testing week. Biology (Week 1) + Seminar exam (Week 2) +
      // Seminar's Apr 30 portfolio deadline (rides Week 1) → exactly two week
      // files, in chronological week order. Collect every triggered download.
      const downloads: Download[] = [];
      page.on("download", (d) => downloads.push(d));

      await openMenu(page);
      await page
        .getByRole("menuitem", { name: menuItem, exact: true })
        .click();

      await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(2);
      expect(downloads.map((d) => d.suggestedFilename())).toEqual([
        `ap-exams-2026-week-1-${view}.png`,
        `ap-exams-2026-week-2-${view}.png`,
      ]);

      for (const download of downloads) {
        const buf = readFileSync(await download.path());
        // PNG 8-byte signature.
        expect([...buf.subarray(0, 8)]).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        // IHDR width/height are big-endian uint32 at byte offsets 16 and 20.
        expect(buf.readUInt32BE(16)).toBeGreaterThan(0);
        expect(buf.readUInt32BE(20)).toBeGreaterThan(0);
      }
    });
  }

  test("AC13/AC7 — .ics downloads the unchanged calendar file (blob, valid VCALENDAR)", async ({
    page,
  }) => {
    await page.goto("/");
    await selectBiologyAndSeminar(page);

    const download = await downloadVia(page, "Save as .ics");
    expect(download.suggestedFilename()).toBe("ap-exams-2026.ics");
    expect(download.url()).toMatch(/^blob:/);

    const ics = readFileSync(await download.path(), "utf8");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:AP Biology exam");
    expect(unfolded).toContain("SUMMARY:AP Seminar exam");
    expect(unfolded).toContain("SUMMARY:AP Seminar portfolio due");
    // 2 exams + 1 portfolio = 3 VEVENTs (identical to the pre-#51 export).
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
  });
});

// ── AC12 — no horizontal scroll ────────────────────────────────────────────
test.describe("issue #51 — no horizontal scroll (issue #8 bar)", () => {
  for (const width of [320, 375, 1024, 1920]) {
    test(`AC12 — no horizontal scroll at ${width}px with the menu open`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await select(page, "AP Biology");
      await openMenu(page);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      // Allow 1px for sub-pixel rounding.
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

// ── Evidence: menu-open screenshots (light + dark, desktop + mobile) ────────
const shots = [
  { name: "menu-desktop-light", width: 1920, height: 1080, dark: false },
  { name: "menu-desktop-dark", width: 1920, height: 1080, dark: true },
  { name: "menu-mobile-light", width: 375, height: 667, dark: false },
  { name: "menu-mobile-dark", width: 375, height: 667, dark: true },
] as const;

for (const shot of shots) {
  test(`evidence — Export menu open (${shot.name})`, async ({ page }) => {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    if (shot.dark) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("apx.theme.v1", "dark");
        } catch {}
      });
    }
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
      )
      .toBe(shot.dark);

    await selectBiologyAndSeminar(page);
    await openMenu(page);
    // All five items painted before the shot.
    await expect(exportMenu(page).getByRole("menuitem")).toHaveCount(5);
    await page.screenshot({ path: `${EVIDENCE_DIR}/${shot.name}.png` });
  });
}

// ── Evidence: real exported artifacts (png + json/txt snippets) ─────────────
test("evidence — export a real .png / .json / .txt and commit the artifacts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await selectBiologyAndSeminar(page);

  // Each .png variant now emits one designed card per week (issue #56 +
  // bounce); save every list + calendar week file.
  const pngDownloads: Download[] = [];
  page.on("download", (d) => pngDownloads.push(d));
  for (const menuItem of [
    "Save as list view .png",
    "Save as calendar view .png",
  ]) {
    await openMenu(page);
    await page.getByRole("menuitem", { name: menuItem, exact: true }).click();
  }
  await expect.poll(() => pngDownloads.length, { timeout: 15000 }).toBe(4);
  for (const download of pngDownloads) {
    writeFileSync(
      `${EVIDENCE_DIR}/${download.suggestedFilename()}`,
      readFileSync(await download.path()),
    );
  }

  const json = await downloadVia(page, "Save as .json");
  writeFileSync(
    `${EVIDENCE_DIR}/exported-schedule.json`,
    readFileSync(await json.path(), "utf8"),
  );

  const txt = await downloadVia(page, "Save as .txt");
  writeFileSync(
    `${EVIDENCE_DIR}/exported-schedule.txt`,
    readFileSync(await txt.path(), "utf8"),
  );

  // Sanity: every artifact is non-empty on disk.
  for (const f of [
    "ap-exams-2026-week-1-list.png",
    "ap-exams-2026-week-2-list.png",
    "ap-exams-2026-week-1-calendar.png",
    "ap-exams-2026-week-2-calendar.png",
    "exported-schedule.json",
    "exported-schedule.txt",
  ]) {
    expect(readFileSync(`${EVIDENCE_DIR}/${f}`).byteLength).toBeGreaterThan(0);
  }
});
