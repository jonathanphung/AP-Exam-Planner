import { test, expect, type Page } from "@playwright/test";

/**
 * super-board QA (issue #60) — pin the support pair ("Send us Feedback" + the
 * GitHub mark) to the bottom of the sidebar column on desktop, and move it out
 * of the sidebar card into the site footer below `lg`.
 *
 * Builder's change (PR #61):
 *   • `src/components/SupportLinks.tsx` — the pair extracted into ONE
 *     `"use client"` island that owns its own `feedbackOpen` state and mounts
 *     its own `FeedbackDialog`. Rendered from BOTH `Sidebar.tsx`
 *     (`hidden … lg:flex` + `lg:mt-auto`, `data-testid="sidebar-footer"`) and
 *     `Footer.tsx` (`flex … lg:hidden`, `data-testid="footer-support-links"`).
 *     Complementary CSS visibility ⇒ `display: none` keeps exactly one copy of
 *     each control in the accessibility tree at any viewport.
 *   • `Sidebar.tsx` — the sticky `<aside>` went `lg:max-h-[calc(100vh-5rem)]`
 *     → `lg:h-[calc(100vh-5rem)]`. A max-height capped the column without
 *     giving it one, so with short content the box shrank to fit and the row
 *     floated up under the last RESOURCES link. With a real height the
 *     `lg:flex-1` sections region absorbs the slack and `mt-auto` lands the row
 *     on the bottom edge.
 *
 * One observable browser-level assertion per acceptance criterion. Role queries
 * for the pair are deliberately UNSCOPED: only one copy is in the a11y tree per
 * viewport, and Playwright strict mode fails loudly if a second one ever leaks
 * in — which is exactly AC5's contract.
 *
 * Evidence (committed to the issue branch, embedded on the issue + PR):
 *   desktop.png / tablet.png / mobile.png             — standard super-board viewports
 *   ac1-desktop-row-pinned-bottom.png                 — short content, row on the bottom edge
 *   ac2-desktop-tall-content-internal-scroll.png      — sections scrolled, row still pinned
 *   ac3-collapsed-rail-desktop.png                    — icon-only GitHub mark in the rail
 *   ac4-mobile-support-in-site-footer.png             — pair in the site footer @375
 *   ac4-tablet-support-in-site-footer.png             — pair in the site footer @768
 *   ac6-feedback-dialog-mobile.png / -desktop.png     — dialog opens from both mount points
 *   note-desktop-page-bottom-nudge.png                — the disclosed sticky/footer trade-off
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-60-qa-v1";

const DESKTOP = { width: 1440, height: 900 };
const DESKTOP_WIDE = { width: 1920, height: 1080 };
const TABLET = { width: 1024, height: 768 };
const TABLET_768 = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 667 };

const STICKY_TOP_PX = 40; // layout's lg:py-10
const BOTTOM_GAP_PX = 40; // the matching bottom half of `calc(100vh - 5rem)`
const TOUCH_FLOOR = 44;

const SIDEBAR = "aside[data-testid='resources-sidebar']";
const SIDEBAR_ROW = "[data-testid='sidebar-footer']"; // desktop placement
const FOOTER_ROW = "[data-testid='footer-support-links']"; // mobile placement
const SITE_FOOTER = "footer[data-testid='site-footer']";
const SECTIONS = "#sidebar-sections";

const SCHEDULES_KEY = "apx.schedules.v1";

const feedbackButton = (page: Page) =>
  page.getByRole("button", { name: /Send us Feedback/ });
const githubLink = (page: Page) =>
  page.getByRole("link", { name: /GitHub repository/ });
const collapseToggle = (page: Page) =>
  page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
const dialog = (page: Page) => page.getByTestId("feedback-dialog");

/** Hydration-safe collapse-toggle press (the issue-29-qa pattern). */
async function pressToggle(page: Page, expectExpanded: "true" | "false") {
  await expect(async () => {
    await collapseToggle(page).click();
    await expect(collapseToggle(page)).toHaveAttribute(
      "aria-expanded",
      expectExpanded,
      { timeout: 1000 },
    );
  }).toPass();
}

/**
 * Seed enough named schedules that MY SCHEDULES overflows the column — the
 * "tall content" case of AC2. Must be installed before `goto`.
 */
async function seedManySchedules(page: Page, n = 25) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [
      SCHEDULES_KEY,
      JSON.stringify({
        activeId: "s0",
        schedules: Array.from({ length: n }, (_, i) => ({
          id: `s${i}`,
          name: `Schedule number ${i + 1}`,
          selection: [],
          resolutions: [],
        })),
      }),
    ] as const,
  );
}

// ── AC1 — desktop, short content: the row is flush with the bottom edge ──────

test("AC1 — desktop (short content): the support row is flush with the bottom of the sidebar column, at the bottom of the viewport — not under the last RESOURCES link", async ({
  page,
}) => {
  // A tall viewport guarantees the panel's content cannot fill the column: this
  // is exactly the "short content" case the card is about. Pre-#60 the row sat
  // directly beneath the last resource link.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");

  const column = (await page.locator(SIDEBAR).boundingBox())!;
  const row = (await page.locator(SIDEBAR_ROW).boundingBox())!;
  const lastLink = (await page
    .locator(`${SECTIONS} #resources-panel a`)
    .last()
    .boundingBox())!;

  // The row is flush with the column's bottom edge …
  expect(
    Math.abs(row.y + row.height - (column.y + column.height)),
    "support row is not flush with the bottom of the sidebar column",
  ).toBeLessThanOrEqual(2);

  // … and the column itself reaches the bottom of the viewport (minus the
  // layout's own 40px bottom gap, the other half of calc(100vh - 5rem)).
  expect(
    Math.abs(column.y + column.height - (1400 - BOTTOM_GAP_PX)),
    "sidebar column does not reach the bottom of the viewport",
  ).toBeLessThanOrEqual(2);

  // … which means a real gap now separates it from the last RESOURCES link
  // (the regression this issue is about).
  expect(
    row.y - (lastLink.y + lastLink.height),
    "support row is still hugging the last RESOURCES link",
  ).toBeGreaterThan(100);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac1-desktop-row-pinned-bottom.png`,
  });
});

// ── AC2 — desktop, tall content: internal scroll, row stays pinned ───────────

test("AC2 — desktop (tall content): the sections region scrolls internally, the support row stays pinned to the bottom, and nothing shifts the page", async ({
  page,
}) => {
  await seedManySchedules(page);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/");

  const sections = page.locator(SECTIONS);
  await page.getByRole("button", { name: /^Collapse sidebar$/ }).waitFor();

  // The sections region — not the page, not the aside — is what overflows.
  const overflow = await sections.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(overflow.overflowY).toBe("auto");
  expect(
    overflow.scrollHeight,
    "precondition: sidebar content must overflow the column",
  ).toBeGreaterThan(overflow.clientHeight);

  const before = (await page.locator(SIDEBAR_ROW).boundingBox())!;
  const pageWidthBefore = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );

  // Row is pinned to the column's bottom edge before the internal scroll …
  expect(
    Math.abs(before.y + before.height - (800 - BOTTOM_GAP_PX)),
  ).toBeLessThanOrEqual(2);

  // … scroll the internal region to its end …
  await sections.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect
    .poll(() => sections.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);

  // … and it has not moved a pixel (it is outside the scroller, not in it).
  const after = (await page.locator(SIDEBAR_ROW).boundingBox())!;
  expect(after.y, "support row moved when the sections scrolled").toBe(
    before.y,
  );
  await expect(page.locator(SIDEBAR_ROW)).toBeVisible();
  await expect(feedbackButton(page)).toBeVisible();

  // No page-level layout shift / horizontal overflow from the taller column.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBe(pageWidthBefore);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
    "column height change introduced horizontal overflow",
  ).toBe(0);

  // Focus outlines are not clipped: the row sits OUTSIDE the overflow:auto
  // scroller, so its focus ring cannot be cut off by it.
  expect(
    await page
      .locator(SIDEBAR_ROW)
      .evaluate((el) => el.closest("#sidebar-sections") !== null),
    "support row must not live inside the internal scroller",
  ).toBe(false);
  await feedbackButton(page).focus();
  const ring = (await feedbackButton(page).boundingBox())!;
  expect(ring.y, "focused control clipped at the top of the viewport").toBeGreaterThanOrEqual(0);
  expect(
    ring.y + ring.height,
    "focused control clipped at the bottom of the viewport",
  ).toBeLessThanOrEqual(800);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac2-desktop-tall-content-internal-scroll.png`,
  });
});

test("AC2 — desktop: the column stays pinned at the layout offset through the whole scroll and never overlaps the site footer", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const aside = page.locator(SIDEBAR);
  await expect(aside).toHaveCSS("position", "sticky");

  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const footerHeight = await page
    .locator(SITE_FOOTER)
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(maxScroll, "precondition: page must scroll").toBeGreaterThan(400);

  // Mid-scroll and deep-scroll (up to where the site footer starts entering the
  // viewport): pinned at exactly top-10, and the row rides the bottom edge.
  for (const y of [300, Math.round(maxScroll - footerHeight)]) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForFunction((to) => window.scrollY >= to - 1, y);
    const box = (await aside.boundingBox())!;
    expect(Math.abs(box.y - STICKY_TOP_PX), `pinned offset at scrollY=${y}`).toBeLessThanOrEqual(1);
    const row = (await page.locator(SIDEBAR_ROW).boundingBox())!;
    expect(
      Math.abs(row.y + row.height - (DESKTOP.height - BOTTOM_GAP_PX)),
      `row on the bottom edge at scrollY=${y}`,
    ).toBeLessThanOrEqual(2);
  }

  // At the ABSOLUTE bottom of the page the viewport-tall sticky column yields
  // to the site footer rather than painting over it (a sticky box may never
  // leave its containing block, and the page shell's content box ends where the
  // footer begins). Assert the real contract: nudged UP, never DOWN, by at most
  // the footer's height, and NEVER overlapping the footer.
  await page.evaluate((to) => window.scrollTo(0, to), maxScroll);
  await page.waitForFunction((to) => window.scrollY >= to - 1, maxScroll);
  const atBottom = (await aside.boundingBox())!;
  const footer = (await page.locator(SITE_FOOTER).boundingBox())!;
  expect(atBottom.y).toBeLessThanOrEqual(STICKY_TOP_PX + 1);
  expect(atBottom.y).toBeGreaterThanOrEqual(
    STICKY_TOP_PX - footer.height - 1,
  );
  expect(
    atBottom.y + atBottom.height,
    "sidebar column paints over the site footer",
  ).toBeLessThanOrEqual(footer.y + 1);
  await expect(page.locator(SIDEBAR_ROW)).toBeVisible();
  await expect(feedbackButton(page)).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/note-desktop-page-bottom-nudge.png`,
  });
});

// ── AC3 — desktop collapsed rail ────────────────────────────────────────────

test("AC3 — desktop collapsed rail: the GitHub mark stays present, centered and reachable; the 'Send us Feedback' label stays hidden", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await pressToggle(page, "false");

  const rail = (await page.locator(SIDEBAR).boundingBox())!;
  const github = githubLink(page);
  await expect(github).toBeVisible();
  await expect(feedbackButton(page)).toBeHidden();

  // Still on the bottom edge of the rail (mt-auto carries the collapsed case,
  // where #sidebar-sections is lg:hidden and there is no flex-1 child).
  const row = (await page.locator(SIDEBAR_ROW).boundingBox())!;
  expect(
    Math.abs(row.y + row.height - (rail.y + rail.height)),
  ).toBeLessThanOrEqual(2);

  // Centered in the rail (±2px) and actually clickable — not overlapped.
  const gh = (await github.boundingBox())!;
  expect(
    Math.abs(gh.x + gh.width / 2 - (rail.x + rail.width / 2)),
    "GitHub mark is not centered in the collapsed rail",
  ).toBeLessThanOrEqual(2);
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(github).toHaveAttribute("rel", /noopener/);
  expect(
    await github.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document
        .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)!
        .closest("a") === el;
    }),
    "GitHub mark is not hit-testable in the collapsed rail",
  ).toBe(true);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac3-collapsed-rail-desktop.png`,
  });

  // Re-expanding restores the label.
  await pressToggle(page, "true");
  await expect(feedbackButton(page)).toBeVisible();
});

// ── AC4 — mobile/tablet: out of the card, into the site footer ───────────────

for (const [label, vp] of [
  ["mobile", MOBILE],
  ["tablet", TABLET_768],
] as const) {
  test(`AC4 — ${label} (${vp.width}px): the sidebar card ends after RESOURCES; the pair renders inside the site footer with ≥44px touch targets`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.goto("/");

    // Both disclosures stay closed — the pair must not depend on opening one.
    const schedulesTrigger = page.getByRole("button", { name: "My schedules" });
    const resourcesTrigger = page.getByRole("button", { name: "Resources" });
    await expect(schedulesTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(resourcesTrigger).toHaveAttribute("aria-expanded", "false");

    const feedback = feedbackButton(page);
    const github = githubLink(page);
    await expect(feedback).toBeVisible();
    await expect(github).toBeVisible();

    // The sidebar's copy is gone from the card; the footer's copy is live.
    await expect(page.locator(`${SIDEBAR} ${SIDEBAR_ROW}`)).toBeHidden();
    await expect(
      page.locator(`${SITE_FOOTER} ${FOOTER_ROW}`),
      "support pair is not inside the site footer",
    ).toBeVisible();

    // Neither control is anywhere inside the <aside>; both are in the <footer>.
    for (const control of [feedback, github]) {
      expect(
        await control.evaluate((el) => el.closest("aside") !== null),
        "support control is still inside the sidebar card",
      ).toBe(false);
      expect(
        await control.evaluate(
          (el) => el.closest("footer[data-testid='site-footer']") !== null,
        ),
        "support control is not inside the site footer",
      ).toBe(true);
    }

    // Geometrically below the whole card — visually distinct from the two
    // disclosures, which is what "no longer reads as a third section" means.
    const card = (await page.locator(SIDEBAR).boundingBox())!;
    const fb = (await feedback.boundingBox())!;
    const gh = (await github.boundingBox())!;
    expect(
      fb.y,
      "support row is not below the bottom edge of the sidebar card",
    ).toBeGreaterThan(card.y + card.height);

    // One row, feedback left of the GitHub mark, ≥44px touch targets.
    expect(
      Math.abs(fb.y + fb.height / 2 - (gh.y + gh.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(fb.x + fb.width).toBeLessThanOrEqual(gh.x);
    expect(fb.height).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    expect(gh.height).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    expect(gh.width).toBeGreaterThanOrEqual(TOUCH_FLOOR);

    // No horizontal overflow at this width.
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);

    await page.locator(SITE_FOOTER).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac4-${label}-support-in-site-footer.png`,
    });
  });
}

// ── AC5 — exactly one of each control in the a11y tree, at every viewport ────

test("AC5 — exactly ONE 'Send us Feedback' button and ONE GitHub link are exposed to assistive tech at every viewport", async ({
  page,
}) => {
  for (const vp of [MOBILE, TABLET_768, TABLET, DESKTOP, DESKTOP_WIDE]) {
    await page.setViewportSize(vp);
    await page.goto("/");

    // getByRole only matches the accessibility tree, so the `display:none` twin
    // is excluded by construction. Count, not visibility.
    await expect(
      feedbackButton(page),
      `feedback buttons in the a11y tree at ${vp.width}px`,
    ).toHaveCount(1);
    await expect(
      githubLink(page),
      `GitHub links in the a11y tree at ${vp.width}px`,
    ).toHaveCount(1);

    // Both copies exist in the DOM — this is what makes the count above a real
    // assertion about `display:none` and not a trivially-true one.
    expect(
      await page.locator(`${SIDEBAR_ROW}, ${FOOTER_ROW}`).count(),
      `both placements must be in the DOM at ${vp.width}px`,
    ).toBe(2);

    // The single exposed copy is in the placement the viewport calls for.
    const inFooter = vp.width < 1024;
    expect(
      await feedbackButton(page).evaluate(
        (el) => el.closest("footer[data-testid='site-footer']") !== null,
      ),
      `at ${vp.width}px the live feedback button should be in the ${inFooter ? "site footer" : "sidebar"}`,
    ).toBe(inFooter);
    expect(
      await githubLink(page).evaluate((el) => el.closest("aside") !== null),
      `at ${vp.width}px the live GitHub link should be in the ${inFooter ? "site footer" : "sidebar"}`,
    ).toBe(!inFooter);

    // The hidden twin is really display:none (the a11y-removal mechanism).
    const hidden = inFooter ? SIDEBAR_ROW : FOOTER_ROW;
    await expect(page.locator(hidden)).toHaveCSS("display", "none");
  }
});

// ── AC6 — the dialog still opens from the new mount points ──────────────────

for (const [label, vp] of [
  ["mobile", MOBILE],
  ["desktop", DESKTOP],
] as const) {
  test(`AC6 — ${label}: the feedback dialog opens from its new location, traps focus, closes on Escape, and restores focus to the trigger`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.goto("/");

    const trigger = feedbackButton(page);
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    // Hydration-safe open (a pre-hydration click is a no-op).
    await expect(async () => {
      if ((await dialog(page).count()) === 0) await trigger.click();
      await expect(dialog(page)).toBeVisible({ timeout: 1000 });
    }).toPass();

    await expect(dialog(page)).toHaveAttribute("aria-modal", "true");
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-feedback-dialog-${label}.png`,
    });

    // Focus is INSIDE the dialog and the trap holds it there: tabbing all the
    // way around never escapes to the page behind.
    const focusInDialog = () =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest("[data-testid='feedback-dialog']"),
      );
    expect(await focusInDialog(), "focus did not move into the dialog").toBe(
      true,
    );
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      expect(await focusInDialog(), `focus escaped the trap on Tab #${i + 1}`).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await focusInDialog(), "focus escaped the trap on Shift+Tab").toBe(
      true,
    );

    // Escape closes and focus returns to the button that opened it — from the
    // new mount point (the site footer on mobile, the pinned row on desktop).
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.textContent?.includes("Send us Feedback") ??
          false,
      ),
      "focus was not restored to the 'Send us Feedback' trigger",
    ).toBe(true);
    await expect(trigger).toBeFocused();
  });
}

// ── AC8 — standard super-board viewport evidence ────────────────────────────

test("AC8 — evidence: standard super-board viewports", async ({ page }) => {
  for (const [name, vp] of [
    ["desktop", DESKTOP_WIDE],
    ["tablet", TABLET],
    ["mobile", MOBILE],
  ] as const) {
    await page.setViewportSize(vp);
    await page.goto("/");
    await expect(feedbackButton(page)).toHaveCount(1);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/${name}.png`,
      fullPage: name !== "desktop",
    });
  }
});
