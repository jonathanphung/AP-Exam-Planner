import { test, expect, type Page, type Locator } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import {
  LATE_TESTING_WINDOW,
  REGULAR_WINDOWS,
} from "../src/data/schema";
import { pressViewChip } from "./support/view-chip";

/**
 * Issue #49 — custom scrollbar + stable gutter: opening a dialog must not
 * shift the page horizontally when scrollbars are classic (Windows/Linux).
 *
 * Reproduction trick (from the issue): Chromium on macOS uses zero-width
 * overlay scrollbars, so the Windows bug is invisible here by default —
 * injecting `::-webkit-scrollbar { width: 16px }` forces Chromium out of
 * overlay mode into classic, space-taking scrollbars, reproducing the
 * Windows layout exactly. Each test then opens one of the five
 * `useModalDialog` consumers and asserts a probe element's
 * `getBoundingClientRect().x` is identical before / while open / after close.
 *
 * These tests FAIL against pre-#49 main (verified during the build): without
 * `scrollbar-gutter: stable`, the body `overflow: hidden` scroll lock removed
 * the 16px scrollbar, the viewport widened, and the centered `max-w-7xl`
 * shell shifted right by 8px.
 *
 * The viewport must be wider than the shell's max-width (1280px) plus the
 * scrollbar: at exactly 1280px the container has no centering slack and the
 * bug hides. 1920×1080 matches the standard desktop evidence viewport.
 */

// Playwright's headless Chromium launches with `--hide-scrollbars`, which
// suppresses scrollbars entirely (zero width — even author-styled ones), so
// the classic-scrollbar reproduction below would be vacuous: the precondition
// assertion in expectNoShiftThroughDialog fails loudly in that mode. Dropping
// the flag for this file (worker-scoped => dedicated browser) restores real
// scrollbar layout.
test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";
const SCHEDULES_KEY = "apx.schedules.v1";

const DESKTOP = { width: 1920, height: 1080 };

// ── Dataset-driven fixtures (ids only, never hardcoded dates) ───────────────
type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
};
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const byId = (id: string): Subject => {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};
const BIOLOGY = byId("biology");
const LATIN = byId("latin");

if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");

// Week paging (mirrors e2e/issue-19-calendar-view.spec.ts): the calendar
// shows one week per page; a block moved to late testing lives on the
// late-testing week's page.
const WINDOWS = [...REGULAR_WINDOWS, LATE_TESTING_WINDOW];
function weekIndexOf(iso: string): number {
  return WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);
}
const pager = (page: Page) => page.getByTestId("calendar-pager");
const indicator = (page: Page) => page.getByTestId("calendar-week-indicator");
async function gotoWeek(page: Page, n: number) {
  for (let guard = 0; guard < 10; guard += 1) {
    const text = (await indicator(page).textContent()) ?? "";
    const match = /Week (\d+) of/.exec(text);
    if (!match) throw new Error(`no week indicator found: "${text}"`);
    const current = Number(match[1]);
    if (current === n) return;
    await pager(page)
      .getByRole("button", {
        name: current < n ? /^Next week/ : /^Previous week/,
      })
      .click();
  }
  throw new Error(`could not reach week ${n}`);
}
const blockFor = (page: Page, subjectId: string) =>
  page.locator(
    `[data-testid="calendar-block"][data-subject-id="${subjectId}"]`,
  );

// ── Seeding helpers (same addInitScript pattern as the other specs) ─────────
async function seedKey(page: Page, key: string, value: unknown) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, JSON.stringify(value)] as const,
  );
}

// ── The shift probe ─────────────────────────────────────────────────────────

/** Force classic (space-taking) scrollbars — the Windows reproduction. */
async function forceClassicScrollbars(page: Page) {
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 16px; }" });
}

/** The page h1 lives inside the centered `max-w-7xl` shell — when the
 *  viewport width changes under the scroll lock, its x moves. */
function probeX(page: Page): Promise<number> {
  return page
    .getByRole("heading", { level: 1 })
    .evaluate((el) => el.getBoundingClientRect().x);
}

/**
 * Open a dialog via `opener`, close it with Escape, and assert the probe
 * never moved. The open click is retried until the dialog reports visible
 * (hydration-safe, same rationale as e2e/support/view-chip.ts) but never
 * double-fired while the dialog is already up.
 */
async function expectNoShiftThroughDialog(
  page: Page,
  opener: Locator,
  dialog: Locator,
) {
  await forceClassicScrollbars(page);

  // Precondition: the classic scrollbar must actually occupy layout width,
  // otherwise this test would pass vacuously in overlay mode.
  const scrollbarWidth = await page.evaluate(
    () => window.innerWidth - document.documentElement.clientWidth,
  );
  expect(
    scrollbarWidth,
    "precondition: forced classic scrollbar must occupy layout width",
  ).toBeGreaterThan(0);

  const before = await probeX(page);

  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  const whileOpen = await probeX(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const after = await probeX(page);

  expect(whileOpen, "page content shifted while the dialog was open").toBe(
    before,
  );
  expect(after, "page content did not return to its exact position").toBe(
    before,
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
});

// ── One test per useModalDialog consumer (all five, issue #49 AC1/AC7) ──────

test("feedback dialog (FeedbackDialog) opens with zero horizontal shift under classic scrollbars", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoShiftThroughDialog(
    page,
    page
      .getByTestId("sidebar-footer")
      .getByRole("button", { name: "Send us Feedback" }),
    page.getByTestId("feedback-dialog"),
  );
});

test("exam details popup (InfoPanel) opens with zero horizontal shift under classic scrollbars", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoShiftThroughDialog(
    page,
    page.getByRole("button", { name: `View exam details for ${BIOLOGY.name}` }),
    page.getByRole("dialog"),
  );
});

test("conflict dialog (ConflictDialog) opens with zero horizontal shift under classic scrollbars", async ({
  page,
}) => {
  // Unresolved same-slot conflict; the calendar (default view) surfaces the
  // prompt on block activation, giving us a clean before-measurement (the
  // list view auto-opens it on load).
  await seedKey(page, SELECTION_KEY, [BIOLOGY.id, LATIN.id]);
  await page.goto("/");
  await pressViewChip(page, "Calendar");
  await expectNoShiftThroughDialog(
    page,
    blockFor(page, BIOLOGY.id).locator("button"),
    page.getByTestId("conflict-prompt"),
  );
});

test("moved-to-late action dialog (CalendarView) opens with zero horizontal shift under classic scrollbars", async ({
  page,
}) => {
  // Resolution keeps Latin → Biology sits on its late-testing week.
  await seedKey(page, SELECTION_KEY, [BIOLOGY.id, LATIN.id]);
  await seedKey(page, RESOLUTIONS_KEY, [
    {
      date: BIOLOGY.exam!.date,
      session: BIOLOGY.exam!.session,
      keeperId: LATIN.id,
      memberIds: [BIOLOGY.id, LATIN.id],
    },
  ]);
  await page.goto("/");
  await pressViewChip(page, "Calendar");
  await gotoWeek(page, weekIndexOf(BIOLOGY.lateTesting!.date) + 1);
  await expect(blockFor(page, BIOLOGY.id)).toContainText(
    "Moved to late testing",
  );
  await expectNoShiftThroughDialog(
    page,
    blockFor(page, BIOLOGY.id).locator("button"),
    page.getByTestId("late-testing-dialog"),
  );
});

test("delete-schedule confirm (MySchedules) opens with zero horizontal shift under classic scrollbars", async ({
  page,
}) => {
  // Two schedules — the last remaining schedule cannot be deleted (#29).
  await seedKey(page, SCHEDULES_KEY, {
    activeId: "sched-1",
    schedules: [
      { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
      { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
    ],
  });
  await page.goto("/");
  await expectNoShiftThroughDialog(
    page,
    page.getByRole("button", { name: "Delete Schedule 2" }),
    page.getByRole("dialog", { name: /Delete .Schedule 2./ }),
  );
});

// ── Reserved gutter must not leak horizontal overflow (issue #49 AC5) ───────

test("no horizontal overflow at 320 / 375 / 1024 / 1920 with the custom classic scrollbar active", async ({
  page,
}) => {
  await page.goto("/");
  await forceClassicScrollbars(page);
  for (const width of [320, 375, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px viewport`).toBe(0);
  }
});
