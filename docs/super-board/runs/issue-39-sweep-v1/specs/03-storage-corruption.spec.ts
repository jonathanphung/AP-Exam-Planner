import { test, expect } from "@playwright/test";
import {
  watchConsole,
  seed,
  record,
  expectAlive,
  evidencePath,
  SELECTION_KEY,
  RESOLUTIONS_KEY,
  SCHEDULES_KEY,
  THEME_KEY,
} from "./helpers";

/**
 * Sweep 03 — persistence abuse: corrupted / hand-edited storage, unknown
 * ids, nonexistent active schedule, disabled localStorage, quota-full,
 * multi-tab sync. The app must degrade gracefully, never white-screen.
 */

const CORRUPT_CASES: Array<{ name: string; raw: Record<string, string> }> = [
  { name: "selection malformed JSON", raw: { [SELECTION_KEY]: "{not json" } },
  { name: "selection wrong type", raw: { [SELECTION_KEY]: '{"a":1}' } },
  {
    name: "selection unknown ids",
    raw: { [SELECTION_KEY]: '["ghost-subject","biology","", null]' },
  },
  { name: "resolutions malformed", raw: { [RESOLUTIONS_KEY]: "[[[" } },
  {
    name: "resolutions unknown ids",
    raw: {
      [SELECTION_KEY]: '["biology","latin"]',
      [RESOLUTIONS_KEY]: '{"ghost-a":"ghost-b"}',
    },
  },
  { name: "schedules malformed", raw: { [SCHEDULES_KEY]: "☃︎ not json" } },
  {
    name: "schedules active id missing",
    raw: {
      [SCHEDULES_KEY]:
        '{"version":1,"activeId":"does-not-exist","schedules":[]}',
    },
  },
  { name: "theme garbage", raw: { [THEME_KEY]: '"neon-vaporwave"' } },
];

for (const c of CORRUPT_CASES) {
  test(`corrupted storage: ${c.name}`, async ({ page }) => {
    const con = watchConsole(page, "storage");
    await seed(page, { raw: c.raw });
    await page.goto("/");
    await expectAlive(page, c.name);
    if (con.pageErrors.length) {
      record({
        kind: "bug",
        area: "persistence",
        summary: `page error with corrupted storage (${c.name})`,
        detail: { raw: c.raw, pageErrors: con.pageErrors },
      });
    }
    con.assertClean(c.name);
  });
}

test("localStorage disabled: app still renders", async ({ page }) => {
  const con = watchConsole(page, "storage-disabled");
  await page.addInitScript(() => {
    const deny = () => {
      throw new DOMException("denied", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", {
      get: deny,
      configurable: true,
    });
  });
  await page.goto("/");
  await expectAlive(page, "localStorage disabled");
  await page.screenshot({ path: evidencePath("03-storage-disabled.png") });
  if (con.pageErrors.length) {
    record({
      kind: "bug",
      area: "persistence",
      summary: "page error when localStorage getter throws SecurityError",
      detail: con.pageErrors,
    });
  }
  con.assertClean("localStorage disabled");
});

test("localStorage quota full: selection clicks do not crash", async ({
  page,
}) => {
  const con = watchConsole(page, "storage-full");
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.startsWith("apx."))
        throw new DOMException("quota", "QuotaExceededError");
      return orig.call(this, k, v);
    };
  });
  await page.goto("/");
  await expectAlive(page, "quota full");
  const chip = page
    .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
    .filter({ hasText: "AP Biology" })
    .first();
  await chip.click();
  await expectAlive(page, "quota full after click");
  if (con.pageErrors.length) {
    record({
      kind: "bug",
      area: "persistence",
      summary: "unhandled error when setItem throws QuotaExceededError",
      detail: con.pageErrors,
    });
  }
  con.assertClean("quota full");
});

test("multi-tab: selection made in tab A appears in tab B", async ({
  context,
}) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const conA = watchConsole(a, "tabA");
  const conB = watchConsole(b, "tabB");
  await a.goto("/");
  await b.goto("/");
  const chipA = a
    .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
    .filter({ hasText: "AP Statistics" })
    .first();
  await chipA.click();
  const chipB = b
    .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
    .filter({ hasText: "AP Statistics" })
    .first();
  try {
    await expect(chipB).toHaveAttribute("aria-pressed", "true", {
      timeout: 5000,
    });
    record({
      kind: "clean",
      area: "persistence",
      summary: "multi-tab storage sync works (selection mirrors across tabs)",
    });
  } catch {
    record({
      kind: "bug",
      area: "persistence",
      summary:
        "multi-tab sync: selecting in tab A does not update tab B within 5s",
    });
    expect.soft(false, "multi-tab sync failed").toBe(true);
  }
  conA.assertClean("multi-tab A");
  conB.assertClean("multi-tab B");
});
