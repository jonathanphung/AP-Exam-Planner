import { test, expect } from "@playwright/test";

/**
 * super-board Build (issue #60, Jon bounce pass 1) — the mobile support pair is
 * rebuilt as the **quiet meta row**.
 *
 * The first cut rendered the pair ABOVE the attribution copy, behind a
 * full-width hairline rule, as a bare `text-sm font-medium` link beside a 44×44
 * icon button. It read as two stray controls floating in the footer, and the
 * rule manufactured a section boundary the content doesn't earn ("super ugly").
 *
 * The bounce treatment: the pair recedes INTO the footer chrome — it is page
 * furniture, not a call to action.
 *
 *     Data: College Board AP calendar … — May 2026 cycle
 *     Not affiliated with College Board.
 *
 *          Send us Feedback  ·  ⌂ GitHub
 *
 *   • BELOW the attribution lines (it was above them).
 *   • No divider rule — separation comes from spacing alone.
 *   • One small muted centered line, in the footer's OWN type (`text-xs`,
 *     slate-600/400), not the sidebar's `text-sm font-medium`.
 *   • GitHub = the octocat mark + the visible word "GitHub", styled identically
 *     to the feedback link so the row reads as one line of meta — with ONE
 *     accessible name, not a doubled one.
 *   • ≥44px touch targets anyway: the hit area is grown with padding, never by
 *     shrinking the target. That tension is the whole design, so it is
 *     hit-tested (`elementFromPoint`), not merely asserted `visible`.
 *
 * Desktop (`lg`) and the collapsed rail are APPROVED AS SHIPPED and must not
 * regress — the pinned bordered row, text label left, icon-only mark right.
 * `issue-60-qa.spec.ts` AC1/AC2/AC3 own that contract and still pass untouched;
 * the desktop test here is a second, cheaper padlock on the *presentation* the
 * bounce forbids changing.
 *
 * Also locks the dual-render contract against a live RESIZE. Every other spec
 * only ever loads cold at a fixed width, so a regression that only shows up when
 * the viewport crosses `lg` (e.g. a JS-driven placement swap replacing the CSS
 * one, which would leave both copies — or neither — in the a11y tree) would ship
 * silently.
 */

const MOBILE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

const SIDEBAR_ROW = "[data-testid='sidebar-footer']"; // desktop placement
const FOOTER_ROW = "[data-testid='footer-support-links']"; // mobile placement
const SITE_FOOTER = "footer[data-testid='site-footer']";

const TOUCH_FLOOR = 44;
const GITHUB_NAME = "GitHub repository (opens in a new tab)";

const feedbackButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /Send us Feedback/ });
const githubLink = (page: import("@playwright/test").Page) =>
  page.getByRole("link", { name: /GitHub repository/ });

// ── The quiet meta row, at both widths below `lg` ────────────────────────────

for (const [label, vp] of [
  ["mobile", MOBILE],
  ["tablet", TABLET],
] as const) {
  test(`bounce1 — ${label}: the support pair renders as a quiet meta row below the attribution, with no rule and the footer's own muted type`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await page.goto("/");

    const row = page.locator(FOOTER_ROW);
    const feedback = feedbackButton(page);
    const github = githubLink(page);

    await expect(page.locator(`${SITE_FOOTER} ${FOOTER_ROW}`)).toBeVisible();

    // Bring the footer on-screen first: the hit-test below uses
    // `elementFromPoint`, which is viewport-relative and returns null for a
    // point below the fold. This is also the real user path — you scroll to the
    // footer to tap it.
    await page.locator(SITE_FOOTER).scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await page.locator(FOOTER_ROW).boundingBox())!.y)
      .toBeLessThan(vp.height);

    // 1 ── ORDER: the row sits BELOW the non-affiliation notice, which is the
    // last line of attribution copy. (It used to sit above both lines.)
    const notice = page.getByText("Not affiliated with College Board.");
    const noticeBox = (await notice.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(
      rowBox.y,
      "the meta row must render BELOW the attribution copy, not above it",
    ).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height);

    // 2 ── NO RULE: separation is carried by spacing alone. The old cut had a
    // `border-b` hairline under the row.
    const borders = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return [
        s.borderTopWidth,
        s.borderBottomWidth,
        s.borderLeftWidth,
        s.borderRightWidth,
      ];
    });
    expect(
      borders,
      "the meta row must not draw a divider rule of any kind",
    ).toEqual(["0px", "0px", "0px", "0px"]);

    // 3 ── QUIET TYPE: both controls use the footer's own small muted scale —
    // asserted against the attribution paragraph's OWN computed style, so this
    // tracks the footer if its type ever changes and cannot pass by luck.
    const copy = await notice.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, color: s.color };
    });
    expect(copy.fontSize, "precondition: footer copy is text-xs").toBe("12px");

    for (const [name, control] of [
      ["feedback", feedback],
      ["github", github],
    ] as const) {
      const style = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: s.color,
          background: s.backgroundColor,
          border: s.borderTopWidth,
        };
      });
      expect(style.fontSize, `${name} must use the footer's type scale`).toBe(
        copy.fontSize,
      );
      expect(style.color, `${name} must use the footer's muted colour`).toBe(
        copy.color,
      );
      // Not the sidebar's `text-sm font-medium`, and not a button chip.
      expect(
        Number(style.fontWeight),
        `${name} must not be emphasised like the sidebar row`,
      ).toBeLessThan(500);
      expect(
        style.background,
        `${name} must not read as a button (no filled background)`,
      ).toBe("rgba(0, 0, 0, 0)");
      expect(style.border, `${name} must not be a bordered chip`).toBe("0px");
    }

    // 4 ── ONE LINE, middot-separated, centred: feedback · GitHub.
    const fb = (await feedback.boundingBox())!;
    const gh = (await github.boundingBox())!;
    expect(
      Math.abs(fb.y + fb.height / 2 - (gh.y + gh.height / 2)),
      "the two items must sit on ONE line",
    ).toBeLessThanOrEqual(2);
    expect(fb.x + fb.width, "feedback must precede GitHub").toBeLessThanOrEqual(
      gh.x,
    );

    const sep = row.locator("span[aria-hidden='true']", { hasText: "·" });
    await expect(sep, "the middot separator must be present").toHaveCount(1);
    const sepBox = (await sep.boundingBox())!;
    expect(
      sepBox.x >= fb.x + fb.width - 1 && sepBox.x + sepBox.width <= gh.x + 1,
      "the middot must sit BETWEEN the two items",
    ).toBe(true);

    // Centred in the footer, within a pixel.
    const footerBox = (await page.locator(SITE_FOOTER).boundingBox())!;
    expect(
      Math.abs(
        rowBox.x + rowBox.width / 2 - (footerBox.x + footerBox.width / 2),
      ),
      "the meta row must be centred in the footer",
    ).toBeLessThanOrEqual(1);

    // 5 ── TOUCH TARGETS survive the small type — grown with padding, and
    // genuinely tappable at their centre point, not just `visible`.
    for (const [name, box, control] of [
      ["feedback", fb, feedback],
      ["github", gh, github],
    ] as const) {
      expect(box.height, `${name} touch target height`).toBeGreaterThanOrEqual(
        TOUCH_FLOOR,
      );
      expect(box.width, `${name} touch target width`).toBeGreaterThanOrEqual(
        TOUCH_FLOOR,
      );
      expect(
        await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          return hit === el || el.contains(hit);
        }),
        `${name} must be hit-testable at its centre, not merely visible`,
      ).toBe(true);
    }

    // 6 ── GITHUB: the mark AND the visible word, but exactly ONE accessible
    // name — `aria-label` overrides the contents, so "GitHub" never doubles it.
    await expect(github.locator("svg")).toHaveCount(1);
    await expect(
      github,
      "the meta row shows the word 'GitHub' beside the mark",
    ).toContainText("GitHub");
    await expect(
      github,
      "the visible word must not double or replace the accessible name",
    ).toHaveAccessibleName(GITHUB_NAME);

    // No horizontal overflow from the row at this width.
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);

    await page.screenshot({
      path: `docs/super-board/runs/issue-60-build-bounce1/${label}-quiet-meta-row.png`,
    });
  });
}

// ── Desktop is APPROVED AS SHIPPED — the restyle must not reach it ───────────

test("bounce1 — desktop: the pinned sidebar row keeps its approved presentation (bordered row, text label left, icon-only mark right)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const row = page.locator(SIDEBAR_ROW);
  await expect(row).toBeVisible();

  // Still a bordered row pinned to the bottom edge of the sidebar column.
  await expect(row).toHaveCSS("border-top-width", "1px");
  const rowBox = (await row.boundingBox())!;
  const aside = (await page
    .locator("aside[data-testid='resources-sidebar']")
    .boundingBox())!;
  expect(
    Math.abs(rowBox.y + rowBox.height - (aside.y + aside.height)),
    "the desktop row must stay flush with the bottom of the sidebar column",
  ).toBeLessThanOrEqual(2);

  // The label keeps the sidebar's emphasis — NOT the footer's muted meta type.
  const fb = await feedbackButton(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: Number(s.fontWeight) };
  });
  expect(fb.fontSize, "desktop label must stay text-sm").toBe("14px");
  expect(fb.fontWeight, "desktop label must stay font-medium").toBe(500);

  // The mark stays ICON-ONLY on desktop: no visible "GitHub" word leaked in.
  const github = githubLink(page);
  await expect(github.locator("svg")).toHaveCount(1);
  expect(
    (await github.innerText()).trim(),
    "the desktop mark must stay icon-only — the word 'GitHub' is a meta-row-only affordance",
  ).toBe("");
  await expect(github).toHaveAccessibleName(GITHUB_NAME);

  // No middot on desktop — that separator belongs to the meta row.
  await expect(row.locator("span[aria-hidden='true']")).toHaveCount(0);
});

// ── The dual-render contract holds across a live resize, not just cold loads ──

test("bounce1 — resizing desktop → mobile flips the placement with exactly one control of each kind still in the a11y tree", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Desktop: the sidebar copy is live, the footer copy is display:none.
  await expect(page.locator(SIDEBAR_ROW)).toBeVisible();
  await expect(page.locator(FOOTER_ROW)).toHaveCSS("display", "none");
  await expect(feedbackButton(page)).toHaveCount(1);
  await expect(githubLink(page)).toHaveCount(1);
  expect(
    await feedbackButton(page).evaluate((el) => el.closest("aside") !== null),
    "at 1440 the live feedback button must be in the sidebar",
  ).toBe(true);

  // Resize WITHOUT reloading — this is the path no other spec exercises.
  await page.setViewportSize(MOBILE);

  // The flip is pure CSS, so it is immediate; poll only to avoid a paint race.
  await expect(page.locator(SIDEBAR_ROW)).toHaveCSS("display", "none");
  await expect(page.locator(`${SITE_FOOTER} ${FOOTER_ROW}`)).toBeVisible();

  // Still exactly one of each in the accessibility tree — the failure this
  // guards is "both copies live" (duplicate controls) or "neither" (dead row).
  await expect(
    feedbackButton(page),
    "resize must not leave two feedback buttons in the a11y tree",
  ).toHaveCount(1);
  await expect(
    githubLink(page),
    "resize must not leave two GitHub links in the a11y tree",
  ).toHaveCount(1);

  expect(
    await feedbackButton(page).evaluate(
      (el) => el.closest("footer[data-testid='site-footer']") !== null,
    ),
    "after the resize the live feedback button must be in the site footer",
  ).toBe(true);
  expect(
    await githubLink(page).evaluate((el) => el.closest("aside") !== null),
    "after the resize no support control may remain inside the sidebar card",
  ).toBe(false);

  // And back again — the contract is symmetric, not a one-way latch.
  await page.setViewportSize(DESKTOP);
  await expect(page.locator(FOOTER_ROW)).toHaveCSS("display", "none");
  await expect(page.locator(SIDEBAR_ROW)).toBeVisible();
  await expect(feedbackButton(page)).toHaveCount(1);
  await expect(githubLink(page)).toHaveCount(1);
});

// ── The dialog still opens from the restyled meta row ────────────────────────

test("bounce1 — mobile: the feedback dialog still opens from the quiet meta row, traps focus, closes on Escape, and restores focus", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  const trigger = feedbackButton(page);
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

  const dialog = page.getByTestId("feedback-dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();

  // Focus is inside the dialog and stays there.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const d = document.querySelector("[data-testid='feedback-dialog']");
        return d ? d.contains(document.activeElement) : false;
      }),
      `focus escaped the dialog on Tab #${i + 1}`,
    ).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Focus returns to the meta row's button — the one that opened it.
  expect(
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        isTrigger: el?.getAttribute("aria-haspopup") === "dialog",
        inFooter: !!el?.closest("footer[data-testid='site-footer']"),
      };
    }),
    "focus must return to the meta row's feedback button",
  ).toEqual({ isTrigger: true, inFooter: true });
});

// ── QA v2 addendum: the "tracks the footer's type" contract must hold in DARK ──
//
// The Build spec asserts the meta row's font-size/colour against the attribution
// paragraph's OWN computed style — which is the right contract, because it
// tracks the footer instead of hard-coding `12px` / slate-600. But it only ever
// runs in the default (light) colour scheme, so only the light half of that
// contract is actually locked.
//
// The row carries a dark pair (`dark:text-slate-400`) independent of the
// footer's (`dark:text-slate-400` on the wrapper). Hard-coding the row's colour
// — or dropping the dark variant — would keep every existing assertion green and
// still ship a meta row that stops matching the copy above it in dark mode: the
// exact "two stray controls floating in the footer" failure Jon bounced, just
// theme-gated. This closes that half.
test("bounce1 — dark mode: the meta row still resolves to the footer's own type and colour", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: MOBILE, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/");

  const footer = page.locator(SITE_FOOTER);
  await footer.scrollIntoViewIfNeeded();

  const notice = footer.getByText("Not affiliated with College Board.");
  const copy = await notice.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, color: s.color };
  });

  const row = page.locator(FOOTER_ROW);
  await expect(row).toBeVisible();

  for (const [name, control] of [
    ["feedback", feedbackButton(page)],
    ["github", githubLink(page)],
  ] as const) {
    const style = await control.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, color: s.color, background: s.backgroundColor };
    });
    expect(
      style.fontSize,
      `dark: ${name} must use the footer's type scale`,
    ).toBe(copy.fontSize);
    expect(
      style.color,
      `dark: ${name} must resolve to the footer's own muted colour, not a hard-coded light-mode value`,
    ).toBe(copy.color);
    expect(
      style.background,
      `dark: ${name} must not read as a button`,
    ).toBe("rgba(0, 0, 0, 0)");
  }

  await ctx.close();
});
