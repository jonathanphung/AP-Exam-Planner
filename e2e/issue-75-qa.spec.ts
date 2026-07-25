import { test, expect, type Page, type Locator } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #75) — the desktop sidebar must not move when a dialog
 * opens while the page is scrolled.
 *
 * The bug: every dialog locks background scroll through `useModalDialog`
 * (`src/lib/modal.ts`), which set `overflow: hidden` on the root element.
 * `hidden` establishes a SCROLL CONTAINER, so `position: sticky`
 * (`Sidebar.tsx:200`) stopped resolving against the viewport and the sidebar
 * snapped back to its static position — above the top of the screen once the
 * page was scrolled. At scrollY 1200 the entire left column was laid out
 * off-screen (`top: -1160`, 0px visible). Not a paint or z-index problem.
 *
 * The fix: lock with `overflow: clip`, which blocks user scrolling just as
 * completely but establishes no scroll container, so `sticky` keeps working.
 *
 * Second, related symptom, same hook: `initial?.focus()` (`modal.ts:118`) was
 * called without `preventScroll`, so focusing into the dialog scrolled the
 * document — programmatic scrolls are NOT blocked by either lock value. The
 * page jumped to the top on open and stayed there after close.
 *
 * Why this shipped at all: every pre-existing dialog spec opens its dialog at
 * `scrollY: 0`, where the bug is invisible. Each test here scrolls FIRST.
 */

const EVIDENCE_DIR = evidenceDir("issue-75-qa-v1");

const DESKTOP = { width: 1440, height: 900 };
const SIDEBAR = "aside[data-testid='resources-sidebar']";
const SCHEDULES_KEY = "apx.schedules.v1";

type Subject = { id: string; name: string };
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const BIOLOGY = SUBJECTS.find((s) => s.id === "biology")!;

/** Two schedules — the last remaining one cannot be deleted (#29). */
async function seedTwoSchedules(page: Page) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [
      SCHEDULES_KEY,
      JSON.stringify({
        activeId: "sched-1",
        schedules: [
          { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
          { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
        ],
      }),
    ] as const,
  );
}

/**
 * Reveal + return the exam-details opener (the #22/#24 grouped-chip IA puts it
 * inside the chip's expanded Tier-1 panel). Retried for hydration safety.
 */
async function examDetailsOpener(page: Page): Promise<Locator> {
  const opener = page.getByRole("button", {
    name: `View exam details for ${BIOLOGY.name}`,
  });
  await expect(async () => {
    if ((await opener.count()) === 0)
      await page
        .getByRole("button", { name: `Show exam dates for ${BIOLOGY.name}` })
        .click();
    await expect(opener).toBeVisible({ timeout: 1000 });
  }).toPass();
  return opener;
}

/**
 * Scroll the window to `y`, or as deep as the page allows, and return where it
 * actually landed. Clamped rather than asserted-exact because the catalog's
 * height depends on the dataset: a hardcoded depth silently becomes
 * unreachable when the subject list changes, and the resulting failure looks
 * like a sidebar regression rather than a stale test constant.
 *
 * The depth still has to be non-trivial — at scrollY 0 this bug is invisible,
 * which is exactly why it shipped — so callers get the real value back and
 * assert on it.
 */
async function scrollTo(page: Page, y: number): Promise<number> {
  const landed = await page.evaluate((target) => {
    window.scrollTo(0, target);
    return Math.round(window.scrollY);
  }, y);
  expect(
    landed,
    "precondition: the page must scroll far enough for sticky to engage",
  ).toBeGreaterThan(200);
  return landed;
}

/** The sidebar's viewport-relative box, rounded to sub-pixel tolerance. */
async function sidebarBox(page: Page) {
  return page.locator(SIDEBAR).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
}

// ── AC1 — the sidebar holds its pixel through open/close, while scrolled ─────

/**
 * `prepare` runs BEFORE the scroll and returns the opener. That ordering is
 * deliberate: the exam-details opener only exists inside an expanded Tier-1
 * chip panel, and expanding that panel is itself a layout change that moves
 * the page. Doing it after the scroll would fold a chip-expand into the
 * measurement and report it as a dialog regression. The only thing that may
 * happen between the two measurements is the dialog opening.
 */
const DIALOG_CASES = [
  {
    name: "delete-schedule confirm (MySchedules)",
    seed: seedTwoSchedules,
    prepare: async (page: Page) =>
      page.getByRole("button", { name: "Delete Schedule 2" }),
    dialog: (page: Page) =>
      page.getByRole("dialog", { name: /Delete .Schedule 2./ }),
  },
  {
    name: "exam details popup (InfoPanel)",
    seed: async () => {},
    prepare: (page: Page) => examDetailsOpener(page),
    dialog: (page: Page) => page.getByRole("dialog"),
  },
] as const;

for (const scrollY of [400, 1200]) {
  for (const c of DIALOG_CASES) {
    test(`AC1 — ${c.name}: the sidebar box is unchanged across open/close at scrollY ${scrollY}`, async ({
      page,
    }) => {
      await c.seed(page);
      await page.setViewportSize(DESKTOP);
      await page.goto("/");
      await page.locator(SIDEBAR).waitFor();

      const opener = await c.prepare(page);
      await scrollTo(page, scrollY);
      const before = await sidebarBox(page);
      // Guard the guard: at these depths the sticky panel must actually be
      // pinned, otherwise the test would pass vacuously against the static
      // layout it is meant to distinguish from.
      expect(
        before.height,
        "precondition: the sidebar must be visible before the dialog opens",
      ).toBeGreaterThan(100);

      await opener.click();
      await expect(c.dialog(page)).toBeVisible();

      const during = await sidebarBox(page);
      expect(
        Math.abs(during.top - before.top),
        "sidebar moved vertically while the dialog was open",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(during.height - before.height),
        "sidebar changed height while the dialog was open",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(during.left - before.left),
        "sidebar moved horizontally while the dialog was open",
      ).toBeLessThanOrEqual(1);

      await page.keyboard.press("Escape");
      await expect(c.dialog(page)).toBeHidden();

      const after = await sidebarBox(page);
      expect(
        Math.abs(after.top - before.top),
        "sidebar did not return to its exact position after close",
      ).toBeLessThanOrEqual(1);
    });
  }
}

// ── AC2 — the lock still locks: wheel AND keyboard ───────────────────────────

test("AC2 — background scroll stays locked while a dialog is open (wheel + keyboard)", async ({
  page,
}) => {
  await seedTwoSchedules(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.locator(SIDEBAR).waitFor();
  await scrollTo(page, 600);

  await page.getByRole("button", { name: "Delete Schedule 2" }).click();
  await expect(
    page.getByRole("dialog", { name: /Delete .Schedule 2./ }),
  ).toBeVisible();

  const locked = await page.evaluate(() => Math.round(window.scrollY));

  // Real wheel input over the background, not a programmatic scroll — the lock
  // is only supposed to stop user input.
  await page.mouse.move(200, 700);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBe(locked);

  // Keyboard is the half a `hidden` → `clip` change could plausibly regress,
  // and no pre-existing spec covered it.
  for (const key of ["PageDown", "ArrowDown", "End"]) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() => Math.round(window.scrollY)),
      `background scrolled on ${key} while the dialog was open`,
    ).toBe(locked);
  }
});

// ── AC3 — opening a dialog must not move the page (the focus() path) ─────────

/**
 * Opened from the delete control in the sticky sidebar, NOT from the catalog's
 * exam-details opener. That is a measurement requirement, not a preference:
 * `locator.click()` scrolls its target into view first, so opening from a
 * control that has scrolled off-screen moves the page before any app code
 * runs, and the test would report Playwright's own scroll as a product bug.
 * The sidebar control is pinned and on-screen at every scroll depth, so the
 * only thing that can move the page here is the dialog.
 */
test("AC3 — opening and closing a dialog leaves window.scrollY untouched", async ({
  page,
}) => {
  await seedTwoSchedules(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.locator(SIDEBAR).waitFor();
  const before = await scrollTo(page, 1200);

  const deleteBtn = page.getByRole("button", { name: "Delete Schedule 2" });
  await expect(deleteBtn).toBeInViewport();
  await deleteBtn.click();
  const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
  await expect(dialog).toBeVisible();

  // Pre-fix, focus() scrolled the dialog's first focusable into view and the
  // page never came back.
  expect(
    await page.evaluate(() => Math.round(window.scrollY)),
    "opening the dialog moved the page",
  ).toBe(before);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The close half is a separate defect from the open half: the cleanup
  // restores focus to the opener, and without `preventScroll` that call scrolls
  // the page to wherever the opener now is.
  expect(
    await page.evaluate(() => Math.round(window.scrollY)),
    "closing the dialog moved the page",
  ).toBe(before);
});

/**
 * The close-side focus restore, isolated with an opener that IS off-screen at
 * the scrolled position — the case the sidebar control cannot exercise, and the
 * one the cleanup's `preventScroll` exists for. The dialog is opened before
 * scrolling so no click has to scroll anything; then we scroll away and close.
 */
test("AC3b — closing a dialog does not scroll the page to a now-off-screen opener", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.locator(SIDEBAR).waitFor();

  const opener = await examDetailsOpener(page);
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Scroll well past the opener while the dialog is open. The lock blocks user
  // input, not programmatic movement, which is exactly how a real student ends
  // up here (deep link, in-dialog anchor, or a resize reflow).
  await page.evaluate(() => window.scrollTo(0, 1200));
  const before = await page.evaluate(() => Math.round(window.scrollY));
  expect(before).toBeGreaterThan(200);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  expect(
    await page.evaluate(() => Math.round(window.scrollY)),
    "closing scrolled the page back to the opener",
  ).toBe(before);
});

// ── Evidence ────────────────────────────────────────────────────────────────

for (const theme of ["light", "dark"] as const) {
  test(`evidence — delete-schedule dialog open while scrolled (${theme})`, async ({
    page,
  }) => {
    await seedTwoSchedules(page);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await page.locator(SIDEBAR).waitFor();
    await scrollTo(page, 1200);
    await page.getByRole("button", { name: "Delete Schedule 2" }).click();
    await expect(
      page.getByRole("dialog", { name: /Delete .Schedule 2./ }),
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/delete-schedule-scrolled-${theme}.png`,
    });
  });

  test(`evidence — exam-details dialog open while scrolled (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await page.locator(SIDEBAR).waitFor();
    const opener = await examDetailsOpener(page);
    await scrollTo(page, 1200);
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/exam-details-scrolled-${theme}.png`,
    });
  });
}
