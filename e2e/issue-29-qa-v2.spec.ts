import { test, expect, type Page } from "@playwright/test";

/**
 * super-board QA v2 (issue #29) — re-verification of Jon's post-approval
 * bounce (PR #35 revision R1–R4), covering the gaps the builder's
 * issue-29-revision.spec.ts leaves open:
 *
 *   R1 — sticky sidebar:
 *        • the panel pins at the layout's top offset (lg:top-10 = 40px)
 *          mid-scroll, not merely "somewhere on screen" at the bottom;
 *        • when the panel is taller than the viewport, the sections scroll
 *          INTERNALLY while the footer row stays pinned inside the visible
 *          panel (no page scroll needed to reach it).
 *   R2 — panel-collapse glyph survives a reload in the remembered state
 *        (outline-only when collapsed, filled column when expanded).
 *   R3 — footer links carry their accessible names (screen-reader parity
 *        with the visual row the builder's spec checks geometrically).
 *   R4 — the footer row is present in BOTH presentations without any user
 *        setup: at the lg boundary (1024px desktop column) and on mobile
 *        with both disclosures still closed (default state).
 *
 * Previously-approved #29 behavior stays covered by e2e/issue-29-qa.spec.ts;
 * the bounce deltas the builder already tests stay covered by
 * e2e/issue-29-revision.spec.ts. This file only adds the QA gap coverage +
 * fresh evidence screenshots for the v2 run.
 */

const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-29-qa-v2";

const DESKTOP = { width: 1920, height: 1080 };
/** Short desktop viewport: guarantees the panel overflows and must scroll internally. */
const DESKTOP_SHORT = { width: 1280, height: 600 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 375, height: 667 };

/** lg:top-10 on the aside + lg:py-10 on the layout container. */
const STICKY_TOP_PX = 40;

const SIDEBAR = "aside[data-testid='resources-sidebar']";
const SECTIONS = "#sidebar-sections";
const FOOTER = "[data-testid='sidebar-footer']";
const SITE_FOOTER = "footer[data-testid='site-footer']";

const collapseToggle = (page: Page) =>
  page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
// Issue #42: the feedback control is now a <button> that opens the in-app
// FeedbackDialog (no navigation); its own contract lives in
// e2e/issue-42-feedback-dialog.spec.ts.
//
// Issue #60: the pair is rendered twice with complementary CSS visibility —
// `sidebar-footer` (desktop, pinned to the bottom of the column) and
// `footer-support-links` (mobile/tablet, inside the site footer). Exactly one
// is in the a11y tree per viewport, so these role queries are UNSCOPED on
// purpose: Playwright's role engine skips `display:none` subtrees, and strict
// mode fails loudly if a second copy ever leaks in.
const feedbackButton = (page: Page) =>
  page.getByRole("button", { name: /Send us Feedback/ });
const githubLink = (page: Page) =>
  page.getByRole("link", { name: /GitHub repository/ });

/** Hydration-safe collapse-toggle press (issue-29-qa pattern). */
async function pressToggle(page: Page, expectExpanded: "true" | "false") {
  const toggle = collapseToggle(page);
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", expectExpanded, {
      timeout: 1000,
    });
  }).toPass();
}

/** Rendered height of the site footer — the exact amount by which the sticky
 *  column yields at the very bottom of the page (issue #60; see R1). */
function siteFooterHeight(page: Page): Promise<number> {
  return page
    .locator(SITE_FOOTER)
    .evaluate((el) => el.getBoundingClientRect().height);
}

// ── R1: sticky pins at the layout offset (not just "visible at the bottom") ─

test("R1 — sidebar pins at top-10 (40px) mid-scroll and tracks the viewport", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const aside = page.locator(SIDEBAR);
  const initial = (await aside.boundingBox())!;
  // Before any scroll the panel sits at the container's natural offset.
  expect(initial.y).toBeGreaterThanOrEqual(STICKY_TOP_PX - 1);

  // The page must be meaningfully scrollable for the sticky check to prove
  // anything (catalog + schedule views make it tall at 1920).
  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(maxScroll).toBeGreaterThan(400);

  // Mid-scroll (well past the header but not the page bottom): the panel's
  // top edge must sit exactly at the sticky offset.
  const mid = Math.min(800, Math.floor(maxScroll / 2));
  await page.evaluate((y) => window.scrollTo(0, y), mid);
  await page.waitForFunction((y) => window.scrollY >= y - 1, mid);
  const midBox = (await aside.boundingBox())!;
  expect(Math.abs(midBox.y - STICKY_TOP_PX)).toBeLessThanOrEqual(1);

  // Deeper still, but stopping just before the site footer enters the
  // viewport: same pinned offset (constant while scrolling = sticky, not
  // merely tall).
  const beforeFooter = maxScroll - (await siteFooterHeight(page));
  await page.evaluate((y) => window.scrollTo(0, y), beforeFooter);
  await page.waitForFunction((y) => window.scrollY >= y - 1, beforeFooter);
  const deep = (await aside.boundingBox())!;
  expect(Math.abs(deep.y - STICKY_TOP_PX)).toBeLessThanOrEqual(1);

  // Issue #60: at the ABSOLUTE bottom of the page the column yields to the
  // site footer instead of painting over it. The column is now viewport-tall
  // (`lg:h-[calc(100vh-5rem)]`, so the support row can pin to the bottom
  // edge), and a sticky box may never leave its containing block — the page
  // shell's content box ends where the site footer begins. So the column is
  // nudged UP by at most the footer's height in the last stretch of scroll.
  // That is the correct outcome (no overlap), and it is bounded: assert the
  // nudge direction, its bound, and the no-overlap invariant rather than a
  // pinning that CSS cannot deliver here.
  await page.evaluate((y) => window.scrollTo(0, y), maxScroll);
  await page.waitForFunction((y) => window.scrollY >= y - 1, maxScroll);
  const atBottom = (await aside.boundingBox())!;
  const footer = (await page.locator(SITE_FOOTER).boundingBox())!;
  expect(atBottom.y).toBeLessThanOrEqual(STICKY_TOP_PX + 1); // never pushed down
  expect(atBottom.y).toBeGreaterThanOrEqual(
    STICKY_TOP_PX - footer.height - 1, // nudge bounded by the footer's height
  );
  expect(atBottom.y + atBottom.height).toBeLessThanOrEqual(footer.y + 1); // no overlap

  // Evidence: pinned panel beside deep-scrolled content.
  await page.screenshot({
    path: `${EVIDENCE_DIR}/desktop-sticky-midscroll.png`,
  });
});

test("R1 — panel taller than the viewport: sections scroll internally, footer stays pinned in view", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_SHORT);
  await page.goto("/");

  // The viewport is short enough that the full panel content cannot fit:
  // the sections container must be the thing that overflows...
  const sections = page.locator(SECTIONS);
  const overflow = await sections.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(overflow.overflowY).toBe("auto");
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

  // ...while the footer row is visible WITHOUT scrolling the page (pinned
  // below the internal scroller, inside the viewport-capped panel).
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const fb = (await feedbackButton(page).boundingBox())!;
  expect(fb.y).toBeGreaterThanOrEqual(0);
  expect(fb.y + fb.height).toBeLessThanOrEqual(DESKTOP_SHORT.height);

  // And the internal scroller actually scrolls (last resource link reachable
  // without any page scroll).
  await sections.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const scrolled = await sections.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  const lastLink = page.locator(`${SECTIONS} #resources-panel a`).last();
  await expect(lastLink).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/desktop-short-internal-scroll.png`,
  });
});

// ── R2: remembered state restores the matching glyph after reload ───────────

test("R2 — collapsed state + outline glyph survive a reload; expanded restores the filled column", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const toggle = collapseToggle(page);
  // Expanded default: filled column (rect + divider path + fill path).
  await expect(toggle.locator("svg rect")).toHaveCount(1);
  await expect(toggle.locator("svg path")).toHaveCount(2);

  await pressToggle(page, "false");
  await page.reload();

  // The stored choice applies after hydration: collapsed, outline-only glyph.
  await expect(toggle).toHaveAttribute("aria-expanded", "false", {
    timeout: 5000,
  });
  await expect(toggle.locator("svg rect")).toHaveCount(1);
  await expect(toggle.locator("svg path")).toHaveCount(1);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/desktop-collapsed-reload-glyph.png`,
  });

  // Expand again: filled column returns and the state re-persists.
  await pressToggle(page, "true");
  await expect(toggle.locator("svg path")).toHaveCount(2);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "true", {
    timeout: 5000,
  });
});

// ── R3: accessible names on the footer controls ─────────────────────────────

test("R3 — footer controls expose complete accessible names (new-tab disclosure where applicable)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Issue #42: the feedback control opens a dialog (aria-haspopup="dialog"),
  // it no longer navigates — so no "(opens in a new tab)" disclosure on it.
  // The GitHub link keeps its complete name.
  await expect(feedbackButton(page)).toHaveAccessibleName("Send us Feedback");
  await expect(feedbackButton(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(githubLink(page)).toHaveAccessibleName(
    /GitHub repository\s*\(opens in a new tab\)/,
  );
});

// ── R4: footer present in both presentations with zero user setup ───────────

test("R4 — lg boundary (1024px): desktop column presentation with the footer row, no horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize(TABLET);
  await page.goto("/");

  // Desktop presentation at the boundary: collapse toggle exists...
  await expect(collapseToggle(page)).toBeVisible();
  // ...and the footer row is part of the column.
  await feedbackButton(page).scrollIntoViewIfNeeded();
  await expect(feedbackButton(page)).toBeVisible();
  await expect(githubLink(page)).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("R4 — mobile: support row visible in the SITE FOOTER while BOTH disclosures stay closed (default state)", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  // Default state: both disclosures closed — the support pair must not depend
  // on opening either one (it never did; issue #60 just moved where it lives).
  const schedulesTrigger = page.getByRole("button", { name: "My schedules" });
  const resourcesTrigger = page.getByRole("button", { name: "Resources" });
  await expect(schedulesTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(resourcesTrigger).toHaveAttribute("aria-expanded", "false");

  const feedback = feedbackButton(page);
  await feedback.scrollIntoViewIfNeeded();
  await expect(feedback).toBeVisible();
  await expect(githubLink(page)).toBeVisible();

  // Issue #60: the sidebar card ENDS after RESOURCES — the pair now renders
  // inside the site footer, below the whole card.
  await expect(page.locator(`${SIDEBAR} ${FOOTER}`)).toBeHidden();
  await expect(page.locator(`${SITE_FOOTER} [data-testid='footer-support-links']`)).toBeVisible();

  const card = (await page.locator(SIDEBAR).boundingBox())!;
  const resTrigger = (await resourcesTrigger.boundingBox())!;
  const fb = (await feedback.boundingBox())!;
  expect(fb.y).toBeGreaterThanOrEqual(resTrigger.y + resTrigger.height - 1);
  expect(fb.y).toBeGreaterThan(card.y + card.height);

  await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-footer.png` });
});
