import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";
import { SCROLL_LOCK_OVERFLOW } from "../src/lib/modal";
import {
  BIOLOGY,
  ITALIAN,
  RESOLUTIONS_KEY,
  SCHEDULES_KEY,
  SELECTION_KEY,
  blockFor,
  gotoWeek,
  seedKey,
  weekIndexOf,
} from "./support/scroll-shift";

/**
 * Issue #75 — the desktop sidebar must not move when a dialog opens while the
 * page is scrolled.
 *
 * ## The bug
 *
 * The sidebar is `position: sticky` (`Sidebar.tsx`, `lg:sticky lg:top-10`) and
 * every dialog locked background scroll with `overflow: hidden` on `<html>`
 * (`src/lib/modal.ts`, issue #49). `hidden` makes the root a SCROLL CONTAINER,
 * and a sticky element resolves against its nearest scroll container — so on
 * every dialog open the sidebar stopped resolving against the viewport and
 * snapped back to its static offset, which after any real scroll is above the
 * top of the screen. Measured at 1440×900 / scrollY 1064: sidebar `rect.top`
 * −45 unlocked → −1024 locked, 775px visible → 0.
 *
 * The fix is `overflow: clip`, which blocks user scrolling just as well but
 * does not establish a scroll container. Plus `focus({ preventScroll: true })`,
 * because the lock does not stop *programmatic* scrolls and the dialog's
 * initial focus was yanking the document back to the top.
 *
 * ## Why this spec exists at all
 *
 * Every pre-existing dialog spec opens its dialog at `scrollY: 0`, where this
 * bug is invisible by construction. The regression assertion that would have
 * caught it is the one below: the sidebar's bounding box, WHILE SCROLLED,
 * identical (within 1px) across open → close. All five `useModalDialog`
 * consumers are covered, because the hook is shared and the blast radius is
 * every modal surface in the app.
 *
 * Companion spec: `issue-49-scrollbar-gutter.spec.ts` still owns the horizontal
 * half of the contract (the centered shell must not shift sideways under
 * classic scrollbars). Both must stay green — the two constraints pull in
 * opposite directions and that tension is the whole story of this fix.
 */

const DESKTOP = { width: 1440, height: 900 };
const SIDEBAR = "[data-testid='resources-sidebar']";
const EVIDENCE_DIR = evidenceDir("issue-75-build-v1");

/** Deep enough that the sticky panel is pinned, not sitting at its static
 *  offset — this is the depth at which the old lock erased the column. */
const DEEP_SCROLL = 1200;

type Box = { x: number; y: number; width: number; height: number };

const sidebarBox = async (page: Page): Promise<Box> =>
  (await page.locator(SIDEBAR).boundingBox())!;

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

const bodyOverflow = (page: Page) =>
  page.evaluate(() => document.body.style.overflow);

/** Scroll as deep as the page allows, capped at `wanted`; returns where it
 *  landed so a caller can assert the precondition actually held. */
async function scrollDeep(page: Page, wanted = DEEP_SCROLL): Promise<number> {
  return page.evaluate((w) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.min(w, max)));
    return window.scrollY;
  }, wanted);
}

/**
 * Scroll deep, then make sure the opener is on screen — and return where the
 * page actually ended up.
 *
 * This second step is not cosmetic. Playwright's `click()` scrolls its target
 * into view first, so for an opener that lives in the page flow (a catalog
 * chip, a calendar block) the click itself moves the document, and a scroll
 * position sampled before it is stale — the spec would then report a scroll
 * jump that the product never caused. Doing the scrolling here, before the
 * baseline is measured, leaves `click()` with nothing to scroll. Openers that
 * ride in the sticky sidebar are visible at every depth, so this is a no-op
 * for them and they keep the full `wanted` depth.
 */
async function scrollDeepWithOpenerVisible(
  page: Page,
  opener: Locator,
  wanted = DEEP_SCROLL,
): Promise<number> {
  await scrollDeep(page, wanted);
  await opener.scrollIntoViewIfNeeded();
  return scrollY(page);
}

/**
 * Reveal the exam-details opener on the LAST subject chip in the catalog.
 *
 * `openExamDetailsOpener` (support/scroll-shift.ts) targets AP Biology, which
 * sits in the first screenful — Playwright centres an off-screen target when it
 * scrolls to it, so a chip that high in the document pins the page back to
 * scrollY 0 and this spec's whole premise ("while scrolled") evaporates. The
 * last chip in the catalog is deep by construction, whatever the dataset holds.
 */
async function openDeepExamDetailsOpener(page: Page): Promise<Locator> {
  const expander = page
    .getByRole("button", { name: /^Show exam dates for / })
    .last();
  await expect(expander).toBeVisible();
  const label = (await expander.getAttribute("aria-label")) ?? "";
  const subject = label.replace(/^Show exam dates for /, "");
  expect(subject, "could not read the subject name off the last chip").not.toBe(
    "",
  );
  const opener = page.getByRole("button", {
    name: `View exam details for ${subject}`,
  });
  // Retry-until-visible: a pre-hydration click on the expander is a no-op.
  await expect(async () => {
    if ((await opener.count()) === 0) await expander.click();
    await expect(opener).toBeVisible({ timeout: 1000 });
  }).toPass();
  return opener;
}

function expectSameBox(actual: Box, expected: Box, what: string) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${what}: sidebar ${key} moved (${expected[key]} → ${actual[key]})`,
    ).toBeLessThanOrEqual(1);
  }
}

// ── The five `useModalDialog` consumers ─────────────────────────────────────

type DialogCase = {
  slug: string;
  label: string;
  /** Seed storage + navigate; leaves the page on the right view. */
  arrive: (page: Page) => Promise<void>;
  /** The control that opens the dialog, and the dialog itself. */
  targets: (page: Page) => Promise<{ opener: Locator; dialog: Locator }>;
};

const CASES: DialogCase[] = [
  {
    slug: "delete-schedule",
    label: "delete-schedule confirm (MySchedules)",
    arrive: async (page) => {
      // Two schedules — the last remaining one cannot be deleted (#29).
      await seedKey(page, SCHEDULES_KEY, {
        activeId: "sched-1",
        schedules: [
          { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
          { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
        ],
      });
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Delete Schedule 2" }),
      ).toBeVisible();
    },
    targets: async (page) => ({
      opener: page.getByRole("button", { name: "Delete Schedule 2" }),
      dialog: page.getByRole("dialog", { name: /Delete .Schedule 2./ }),
    }),
  },
  {
    slug: "exam-details",
    label: "exam details popup (InfoPanel)",
    arrive: async (page) => {
      await page.goto("/");
    },
    targets: async (page) => ({
      opener: await openDeepExamDetailsOpener(page),
      dialog: page.getByRole("dialog"),
    }),
  },
  {
    slug: "feedback",
    label: "feedback dialog (FeedbackDialog)",
    arrive: async (page) => {
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Send us Feedback" }),
      ).toBeVisible();
    },
    targets: async (page) => ({
      opener: page.getByRole("button", { name: "Send us Feedback" }),
      dialog: page.getByTestId("feedback-dialog"),
    }),
  },
  {
    slug: "conflict",
    label: "conflict resolution (ConflictDialog)",
    arrive: async (page) => {
      await seedKey(page, SELECTION_KEY, [BIOLOGY.id, ITALIAN.id]);
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      await expect(blockFor(page, BIOLOGY.id)).toBeVisible();
    },
    targets: async (page) => ({
      opener: blockFor(page, BIOLOGY.id).locator("button"),
      dialog: page.getByTestId("conflict-prompt"),
    }),
  },
  {
    slug: "late-testing",
    label: "moved-to-late block details (CalendarView)",
    arrive: async (page) => {
      await seedKey(page, SELECTION_KEY, [BIOLOGY.id, ITALIAN.id]);
      await seedKey(page, RESOLUTIONS_KEY, [
        {
          date: BIOLOGY.exam!.date,
          session: BIOLOGY.exam!.session,
          keeperId: ITALIAN.id,
          memberIds: [BIOLOGY.id, ITALIAN.id],
        },
      ]);
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      await gotoWeek(page, weekIndexOf(BIOLOGY.lateTesting!.date) + 1);
      await expect(blockFor(page, BIOLOGY.id)).toContainText(
        "Moved to late testing",
      );
    },
    targets: async (page) => ({
      opener: blockFor(page, BIOLOGY.id).locator("button"),
      dialog: page.getByTestId("late-testing-dialog"),
    }),
  },
];

// ── AC1 + AC3 — the sidebar does not move; the page does not jump ───────────

for (const testCase of CASES) {
  test(`AC1/AC3 — ${testCase.label}: opening it while scrolled leaves the sidebar and the scroll position untouched`, async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await testCase.arrive(page);

    const { opener, dialog } = await testCase.targets(page);
    const landedAt = await scrollDeepWithOpenerVisible(page, opener);
    expect(
      landedAt,
      "precondition: the page must actually be scrolled — at scrollY 0 this bug is invisible",
    ).toBeGreaterThan(200);

    const before = await sidebarBox(page);
    expect(
      before.y + before.height,
      "precondition: the sticky sidebar must be on screen before the dialog opens",
    ).toBeGreaterThan(0);

    await expect(async () => {
      if ((await dialog.count()) === 0) await opener.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();

    // The lock is on and it is `clip`, not `hidden` — the keyword IS the fix.
    expect(await bodyOverflow(page)).toBe(SCROLL_LOCK_OVERFLOW);
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
      "the lock must land on the ROOT element (issue #49's pairing contract)",
    ).toBe(SCROLL_LOCK_OVERFLOW);

    // AC1 — same top, same visible height, no reflow.
    const during = await sidebarBox(page);
    expectSameBox(during, before, "while the dialog is open");
    await expect(page.locator(SIDEBAR)).toBeVisible();

    // AC3 — opening did not move the document.
    expect(await scrollY(page), "opening the dialog scrolled the page").toBe(
      landedAt,
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    expectSameBox(await sidebarBox(page), before, "after the dialog closed");
    expect(await scrollY(page), "closing the dialog scrolled the page").toBe(
      landedAt,
    );
    expect(await bodyOverflow(page)).toBe("");
    await expect(opener).toBeFocused();
  });
}

// ── AC1 — several scroll depths, including hard against the page bottom ─────

/** `lg` (1024px) is where the sticky column starts existing, so that width is
 *  the boundary case; 1920 is the standard super-board desktop viewport. */
const DEPTH_CASES = [
  { viewport: { width: 1024, height: 768 }, depth: 1200 },
  { viewport: DESKTOP, depth: 400 },
  { viewport: DESKTOP, depth: 1200 },
  { viewport: DESKTOP, depth: Number.MAX_SAFE_INTEGER },
  { viewport: { width: 1920, height: 1080 }, depth: 1200 },
] as const;

for (const { viewport, depth } of DEPTH_CASES) {
  const name = `${viewport.width}px @ ${
    depth === Number.MAX_SAFE_INTEGER ? "page bottom" : `${depth}px`
  }`;
  test(`AC1 — sidebar is pixel-identical through an open/close cycle at ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seedKey(page, SCHEDULES_KEY, {
      activeId: "sched-1",
      schedules: [
        { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
        { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
      ],
    });
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Delete Schedule 2" });
    await expect(opener).toBeVisible();

    const landedAt = await scrollDeep(page, depth);
    expect(landedAt).toBeGreaterThan(200);

    const before = await sidebarBox(page);
    const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
    await expect(async () => {
      if ((await dialog.count()) === 0) await opener.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();

    expectSameBox(await sidebarBox(page), before, `open at ${name}`);
    expect(await scrollY(page)).toBe(landedAt);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expectSameBox(await sidebarBox(page), before, `closed at ${name}`);
    expect(await scrollY(page)).toBe(landedAt);
  });
}

// ── AC2 — the background stays locked: wheel, keyboard, touch ───────────────

test.describe("AC2 — the lock still blocks every input path", () => {
  // `hasTouch` so the synthesised touch fling below is delivered as a real
  // touch gesture; Desktop Chrome's default device profile has touch off, and
  // CDP silently drops touch input then (the control assertion caught it).
  test.use({ hasTouch: true });

  test("AC2 — background scroll is locked while a dialog is open (wheel, keyboard, touch), and released after", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedKey(page, SCHEDULES_KEY, {
      activeId: "sched-1",
      schedules: [
        { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
        { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
      ],
    });
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Delete Schedule 2" });
    await expect(opener).toBeVisible();

    const cdp = await page.context().newCDPSession(page);

    /**
     * One finger-drag scroll, synthesised through CDP.
     *
     * Playwright's `touchscreen` API can only tap, and a wheel event is not a
     * touch scroll — touch is its own input path and the whole point of this
     * assertion is that the lock covers it. `Input.synthesizeScrollGesture`
     * with `gestureSourceType: "touch"` is silently a no-op on a desktop
     * Chromium profile (measured: 0px moved), so this dispatches the raw
     * touchStart / touchMove* / touchEnd sequence instead, which the
     * compositor turns into a real scroll (measured: 305px on the unlocked
     * page — the control loop below fails loudly if that ever stops holding).
     */
    const touchScroll = async () => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 700, y: 700 }],
      });
      for (let y = 680; y >= 400; y -= 40) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 700, y }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };

    const gestures: [string, () => Promise<void>][] = [
      [
        "wheel",
        async () => {
          await page.mouse.move(700, 500);
          await page.mouse.wheel(0, 400);
        },
      ],
      ["PageDown", async () => void (await page.keyboard.press("PageDown"))],
      ["Space", async () => void (await page.keyboard.press("Space"))],
      ["ArrowDown", async () => void (await page.keyboard.press("ArrowDown"))],
      ["touch", touchScroll],
    ];

    // Control: with no dialog open, every one of these gestures really does move
    // the page — otherwise the locked assertions below would pass vacuously.
    for (const [label, gesture] of gestures) {
      await page.evaluate(() => window.scrollTo(0, 600));
      // Keyboard scrolling needs focus on the document, not on a control.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      const from = await scrollY(page);
      await gesture();
      await expect
        .poll(() => scrollY(page), {
          message: `control: ${label} did not scroll the unlocked page`,
        })
        .not.toBe(from);
    }

    // Locked: the same gestures, with the dialog open.
    const landedAt = await scrollDeep(page);
    expect(landedAt).toBeGreaterThan(200);
    const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
    await expect(async () => {
      if ((await dialog.count()) === 0) await opener.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();

    for (const [label, gesture] of gestures) {
      await gesture();
      await page.waitForTimeout(120);
      expect(
        await scrollY(page),
        `${label} scrolled the background while the dialog was open`,
      ).toBe(landedAt);
    }

    // …and the lock is released on close: the page scrolls again. Upward —
    // `scrollDeep` may already be resting on the page's last scrollable pixel,
    // where a downward wheel legitimately does nothing.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, -200);
    await expect
      .poll(() => scrollY(page), {
        message: "the page did not scroll again after the dialog closed",
      })
      .not.toBe(landedAt);
  });
});

// ── AC3 — the initial focus must not scroll the document ────────────────────

test("AC3 — the dialog's initial focus does not scroll the document (preventScroll)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const opener = await openDeepExamDetailsOpener(page);
  const landedAt = await scrollDeepWithOpenerVisible(page, opener);
  expect(landedAt).toBeGreaterThan(200);

  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();

  // Focus really did move into the dialog (the behaviour we must not lose) …
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    "focus did not move into the dialog",
  ).toBe(true);
  // … without dragging the document anywhere.
  expect(await scrollY(page)).toBe(landedAt);

  // Now the return trip, which is where a plain focus() is genuinely
  // dangerous. The lock does NOT stop programmatic scrolls (measured: under
  // `hidden` and under `clip` alike, `window.scrollTo` still moves the page),
  // so move the document while the dialog is up — the opener is now far off
  // screen. On close, `useModalDialog` restores focus to it, and the lock is
  // already released by that point: without `preventScroll` the browser
  // scrolls the opener back into view and the reader loses their place. This
  // is the assertion that fails against pre-#75 modal.ts.
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await scrollY(page)).toBe(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener, "focus was not returned to the opener").toBeFocused();
  expect(
    await scrollY(page),
    "restoring focus on close scrolled the page back to the opener",
  ).toBe(0);
});

// ── Evidence — scrolled, dialog open, light + dark ──────────────────────────

test("evidence — sidebar present with a dialog open while scrolled (light + dark, desktop + tablet)", async ({
  page,
}) => {
  await seedKey(page, SCHEDULES_KEY, {
    activeId: "sched-1",
    schedules: [
      { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
      { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
    ],
  });

  for (const [vpLabel, vp] of [
    ["desktop", { width: 1920, height: 1080 }],
    ["tablet", { width: 1024, height: 768 }],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(vp);
      await page.goto("/");
      const opener = page.getByRole("button", { name: "Delete Schedule 2" });
      await expect(opener).toBeVisible();
      await scrollDeep(page);

      const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
      await expect(async () => {
        if ((await dialog.count()) === 0) await opener.click();
        await expect(dialog).toBeVisible({ timeout: 1000 });
      }).toPass();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vpLabel}-${scheme}-scrolled-delete-dialog.png`,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      // …and the same viewport/scheme with the exam-details dialog, the other
      // surface issue #75 names explicitly.
      const examOpener = await openDeepExamDetailsOpener(page);
      await scrollDeepWithOpenerVisible(page, examOpener);
      const examDialog = page.getByRole("dialog");
      await expect(async () => {
        if ((await examDialog.count()) === 0) await examOpener.click();
        await expect(examDialog).toBeVisible({ timeout: 1000 });
      }).toPass();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vpLabel}-${scheme}-scrolled-exam-details-dialog.png`,
      });
      await page.keyboard.press("Escape");
      await expect(examDialog).toBeHidden();
    }
  }
});
