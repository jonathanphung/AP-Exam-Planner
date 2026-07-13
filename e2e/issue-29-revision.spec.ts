import { test, expect, type Page } from "@playwright/test";

/**
 * Issue #29 — post-approval revision (Jon's human bounce on PR #35):
 *
 *   1. Sticky sidebar: on desktop the panel pins while the main content
 *      scrolls and stays fully usable at any scroll depth.
 *   2. Collapse icon: the toggle uses the panel-collapse glyph (rectangle
 *      with a left column) instead of the old chevron arrow.
 *   3. Footer row: "Send us Feedback" (left) + GitHub icon (right) on one
 *      row, pinned below the content, in both presentations. House link
 *      rules: text underlines on hover, the icon never does; ≥44px touch
 *      targets on mobile.
 *
 * All previously-approved #29 behavior is covered by e2e/issue-29-qa.spec.ts
 * and stays binding; this file covers only the bounce deltas.
 *
 * UPDATED for issue #42: "Send us Feedback" is now a <button> that opens the
 * in-app FeedbackDialog — it no longer navigates, so the old link-target /
 * new-tab / trailing-↗ assertions are superseded (the dialog's own contract
 * lives in e2e/issue-42-feedback-dialog.spec.ts). The row geometry, hover
 * underline, and touch-target rules here are unchanged and stay binding.
 *
 * UPDATED for issue #60: the support pair (Feedback + GitHub) is rendered
 * twice with complementary CSS visibility — `[data-testid='sidebar-footer']`
 * (desktop, pinned to the bottom of the sticky column) and
 * `[data-testid='footer-support-links']` (mobile/tablet, inside the site
 * footer). Only ONE is in the accessibility tree per viewport, so the role
 * queries below are deliberately UNSCOPED: Playwright's role engine skips
 * `display:none` subtrees, and strict mode then fails if a second copy ever
 * leaks into the a11y tree. The mobile row's placement assertions moved from
 * the sidebar card to the site footer.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 667 };

const SIDEBAR = "aside[data-testid='resources-sidebar']";
const FOOTER = "[data-testid='sidebar-footer']";
const REPO_URL = "https://github.com/jonathanphung/AP-Exam-Planner";

const collapseToggle = (page: Page) =>
  page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
// Issue #42: the feedback control is a <button> (opens the in-app dialog).
// Issue #60: unscoped by design — see the header note.
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

// ── 1. Sticky sidebar ───────────────────────────────────────────────────────

test("desktop sidebar is sticky: pinned and usable while the main content scrolls", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const aside = page.locator(SIDEBAR);
  await expect(aside).toHaveCSS("position", "sticky");

  // Scroll deep into the page (catalog + schedule views make it tall), stopping
  // where the site footer starts to enter the viewport.
  //
  // Issue #60: the column is now viewport-tall so the support row can pin to
  // the bottom edge — and a sticky box may never leave its containing block,
  // whose content box ends where the site footer begins. So in the LAST
  // footer-height of scroll the column yields upward rather than painting over
  // the footer; everywhere before that it is exactly pinned and fully in view.
  // That final band is asserted separately (below, and in issue-29-qa-v2 R1).
  const deepButAboveFooter = await page.evaluate(() => {
    const footer = document.querySelector("footer[data-testid='site-footer']")!;
    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    return maxScroll - footer.getBoundingClientRect().height;
  });
  await page.evaluate((y) => window.scrollTo(0, y), deepButAboveFooter);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  // The panel is still fully on screen: branding row + toggle within the
  // viewport (nothing clipped at either edge).
  const toggle = collapseToggle(page);
  await expect(toggle).toBeVisible();
  const box = (await toggle.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(DESKTOP.height);

  // ...and still usable at this scroll depth: collapse + re-expand works.
  await pressToggle(page, "false");
  await pressToggle(page, "true");

  // The support row is also reachable (panel scrolls internally if needed).
  await feedbackButton(page).scrollIntoViewIfNeeded();
  await expect(feedbackButton(page)).toBeVisible();

  // At the ABSOLUTE page bottom the column stops at the site footer's top edge
  // — it never paints over it, and it is never pushed BELOW the sticky offset.
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const column = (await aside.boundingBox())!;
  const siteFooter = (await page
    .locator("footer[data-testid='site-footer']")
    .boundingBox())!;
  expect(column.y).toBeLessThanOrEqual(41);
  expect(column.y + column.height).toBeLessThanOrEqual(siteFooter.y + 1);
});

// ── 2. Panel-collapse glyph ─────────────────────────────────────────────────

test("collapse toggle uses the panel glyph (rect + column divider), not a chevron, in both states", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const toggle = collapseToggle(page);
  // Expanded state: rectangle outline + column divider present.
  await expect(toggle.locator("svg rect")).toHaveCount(1);
  await expect(toggle.locator("svg path")).toHaveCount(2); // divider + filled column

  // Collapsed state keeps the same glyph family (outline only).
  await pressToggle(page, "false");
  await expect(toggle.locator("svg rect")).toHaveCount(1);
  await expect(toggle.locator("svg path")).toHaveCount(1); // divider only

  // Accessible behavior unchanged.
  await expect(toggle).toHaveAccessibleName("Expand sidebar");
  await pressToggle(page, "true");
  await expect(toggle).toHaveAccessibleName("Collapse sidebar");
});

// ── 3. Footer row ───────────────────────────────────────────────────────────

test("desktop footer row: Send us Feedback left, GitHub icon right, same row, correct targets", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const feedback = feedbackButton(page);
  const github = githubLink(page);
  await expect(feedback).toBeVisible();
  await expect(github).toBeVisible();

  // Issue #42: feedback is a real <button> that opens the in-app dialog (no
  // navigation); the GitHub mark keeps its safe new-tab link to the repo.
  await expect(feedback).toHaveJSProperty("tagName", "BUTTON");
  await expect(feedback).toHaveAttribute("aria-haspopup", "dialog");
  await expect(github).toHaveAttribute("href", REPO_URL);
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(github).toHaveAttribute("rel", "noopener noreferrer");

  // Same row, feedback left of the GitHub icon.
  const fb = (await feedback.boundingBox())!;
  const gh = (await github.boundingBox())!;
  const fbMid = fb.y + fb.height / 2;
  const ghMid = gh.y + gh.height / 2;
  expect(Math.abs(fbMid - ghMid)).toBeLessThanOrEqual(2);
  expect(fb.x + fb.width).toBeLessThanOrEqual(gh.x);

  // Footer sits below the sections content (last row of the panel).
  const sections = (await page.locator("#sidebar-sections").boundingBox())!;
  expect(fb.y).toBeGreaterThanOrEqual(sections.y + sections.height - 1);

  // Issue #60: ...and the row is flush with the BOTTOM of the sidebar column,
  // which itself now reaches the bottom of the viewport (minus the layout's
  // 40px bottom gap). Before #60 the column shrank to its content, so this row
  // floated up under the last RESOURCES link.
  const column = (await page.locator(SIDEBAR).boundingBox())!;
  const row = (await page.locator(FOOTER).boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(column.y + column.height + 1);
  expect(row.y + row.height).toBeGreaterThanOrEqual(
    column.y + column.height - 2,
  );
  expect(column.y + column.height).toBeGreaterThanOrEqual(DESKTOP.height - 60);

  // Collapsing the desktop column hides the "Send us Feedback" label, but the
  // GitHub mark stays reachable in the rail (issue #41 bounce, Jon 2026-07-09:
  // "the GitHub mark must still be reachable in the rail"). Pre-#41 the whole
  // footer was lg:hidden when collapsed; that assertion is now stale.
  await pressToggle(page, "false");
  await expect(feedback).toBeHidden();
  await expect(github).toBeVisible();
});

test("footer hover: feedback text underlines, the GitHub icon does not", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const feedback = feedbackButton(page);
  await feedback.hover();

  const textDecoration = (locator: ReturnType<Page["locator"]>) =>
    locator.evaluate((el) => getComputedStyle(el).textDecorationLine);

  // Issue #42: the trailing ↗ is gone (the control opens a dialog, not a
  // tab), so only the label's hover underline is asserted now.
  const label = feedback.locator("span", { hasText: "Send us Feedback" });
  expect(await textDecoration(label)).toContain("underline");

  const github = githubLink(page);
  await github.hover();
  expect(await textDecoration(github)).not.toContain("underline");
});

test("mobile support row: lives in the SITE FOOTER (not the sidebar card) with ≥44px touch targets", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  const feedback = feedbackButton(page);
  const github = githubLink(page);
  await feedback.scrollIntoViewIfNeeded();
  await expect(feedback).toBeVisible();
  await expect(github).toBeVisible();

  // Issue #60: the pair is OUT of the sidebar card and INSIDE the site footer.
  for (const control of [feedback, github]) {
    expect(
      await control.evaluate((el) => el.closest("aside") !== null),
      "support control must not be inside the sidebar card on mobile",
    ).toBe(false);
    expect(
      await control.evaluate(
        (el) => el.closest("footer[data-testid='site-footer']") !== null,
      ),
      "support control must be inside the site footer on mobile",
    ).toBe(true);
  }

  // The sidebar card now ends after RESOURCES — nothing of the pair below it.
  const card = (await page.locator(SIDEBAR).boundingBox())!;
  const fb = (await feedback.boundingBox())!;
  const gh = (await github.boundingBox())!;
  expect(fb.y).toBeGreaterThan(card.y + card.height);

  // Still one row, feedback left of the GitHub mark.
  expect(
    Math.abs(fb.y + fb.height / 2 - (gh.y + gh.height / 2)),
  ).toBeLessThanOrEqual(2);
  expect(fb.x + fb.width).toBeLessThanOrEqual(gh.x);

  // ≥44px touch targets.
  expect(fb.height).toBeGreaterThanOrEqual(44);
  expect(gh.height).toBeGreaterThanOrEqual(44);
  expect(gh.width).toBeGreaterThanOrEqual(44);

  // No horizontal overflow introduced at 375px.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

// ── 5. Issue #60: exactly one of each control in the a11y tree ───────────────

test("#60 — exactly one Send-us-Feedback button and one GitHub link are exposed to assistive tech at every viewport", async ({
  page,
}) => {
  for (const vp of [MOBILE, { width: 768, height: 1024 }, DESKTOP]) {
    await page.setViewportSize(vp);
    await page.goto("/");
    // getByRole only matches elements in the accessibility tree, so the
    // `display:none` twin is excluded by construction. Counts, not visibility.
    await expect(
      feedbackButton(page),
      `feedback buttons at ${vp.width}px`,
    ).toHaveCount(1);
    await expect(
      githubLink(page),
      `GitHub links at ${vp.width}px`,
    ).toHaveCount(1);
  }
});

test("#60 — desktop with a tall viewport: the support row pins to the bottom edge, far below the last RESOURCES link", async ({
  page,
}) => {
  // Tall enough that the panel's content cannot fill the column: this is the
  // "short content" case the card is about. Pre-#60 the row sat directly under
  // the last resource link; now the flex-1 sections region eats the slack.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");

  const row = (await page.locator(FOOTER).boundingBox())!;
  const lastLink = (await page
    .locator("#sidebar-sections #resources-panel a")
    .last()
    .boundingBox())!;

  // A real gap opens up between the last link and the pinned row.
  expect(row.y - (lastLink.y + lastLink.height)).toBeGreaterThan(100);

  // The row is flush with the bottom of the column, near the viewport bottom.
  const column = (await page.locator(SIDEBAR).boundingBox())!;
  expect(row.y + row.height).toBeGreaterThanOrEqual(
    column.y + column.height - 2,
  );
  expect(column.y + column.height).toBeGreaterThanOrEqual(1400 - 60);
});

// ── 4. R6: delete-dialog backdrop dims the catalog filter bar ────────────────

/** Hydration-safe "New schedule" press (revision-spec local copy). */
async function createSchedule(page: Page) {
  const radios = page
    .getByRole("radiogroup", { name: "My schedules" })
    .getByRole("radio");
  const before = await radios.count();
  const button = page.getByRole("button", { name: "New schedule" });
  await expect(async () => {
    await button.click();
    await expect(radios).toHaveCount(before + 1, { timeout: 1000 });
  }).toPass();
}

test("R6: the delete-schedule dialog is portaled to <body> and its backdrop dims the sticky catalog filter bar", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Need a second schedule so the delete button is enabled.
  await createSchedule(page);

  // Open the delete confirm dialog for "Schedule 2".
  await page.getByRole("button", { name: "Delete Schedule 2" }).click();
  const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
  await expect(dialog).toBeVisible();

  // (a) The dialog must live outside the sticky sidebar's stacking context —
  //     i.e. portaled to <body>, with no <aside> ancestor. Inline in the
  //     sidebar it would inherit the aside's stacking context (QA v3 R6).
  const hasAsideAncestor = await dialog.evaluate(
    (node) => node.closest("aside") !== null,
  );
  expect(hasAsideAncestor, "delete dialog must be portaled out of <aside>").toBe(
    false,
  );

  // (b) The backdrop must paint over the sticky `z-30` filter bar: the topmost
  //     element at a filter chip's center is the overlay, not the chip. With
  //     the bug, the chip stayed hittable ("lit up") above the dim.
  const chip = page
    .locator("nav[aria-label='Jump to category']")
    .getByRole("button", { name: "STEM" });
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const topmostIsChip = await page.evaluate(
    ({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      const chipButton = document
        .querySelector("nav[aria-label='Jump to category']")
        ?.querySelector("button");
      // `contains` also catches the case where the point lands on the chip's
      // inner text node/span.
      return top !== null && chipButton !== null && chipButton!.contains(top);
    },
    { x: cx, y: cy },
  );
  expect(
    topmostIsChip,
    "filter chip must be covered by the dialog backdrop, not on top of it",
  ).toBe(false);
});
