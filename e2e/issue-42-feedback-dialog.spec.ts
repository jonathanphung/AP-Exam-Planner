import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * super-board QA (issue #42) — in-app feedback dialog.
 *
 * One observable, browser-level test per acceptance-criterion clause that the
 * unit suite (src/lib/feedback.test.ts, the pure core) cannot reach: the
 * trigger button in the sidebar footer, the dialog's DOM/aria wiring, the
 * inline validation surfaces, the three honest submission states (pending /
 * success / failure), focus management, and the responsive + a11y bar.
 *
 * Test hooks (from the Builder's handoff):
 *   data-testid="sidebar-footer"        — desktop support row (sidebar bottom)
 *   data-testid="footer-support-links"  — mobile support row (site footer, #60)
 *   data-testid="feedback-dialog"    — the dialog panel
 *   data-testid="feedback-success"   — the success (thank-you) view
 *   window.__APX_FEEDBACK_GATE__     — deterministic pending gate (e2e-only)
 *
 * Transport is ALWAYS stubbed here (window.open recorded, never real): the
 * interim adapter would otherwise open github.com in a new tab on every
 * submit-path test. The stub also lets us model a blocked pop-up (returns
 * null) to drive the failure state.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-42-qa-v2";
const REPO_URL = "https://github.com/jonathanphung/AP-Exam-Planner";
const THEME_KEY = "apx.theme.v1";
const MAX_LEN = 2000;
const COUNTER_AT = 1800;

// Issue #60: the trigger is rendered twice (desktop sidebar bottom / mobile
// site footer) with complementary CSS visibility, so exactly ONE is in the
// accessibility tree per viewport. Query it by role, unscoped: the role engine
// skips `display:none` subtrees and strict mode catches a leaked duplicate.
const feedbackButton = (page: Page) =>
  page.getByRole("button", { name: "Send us Feedback" });
const dialog = (page: Page) => page.getByTestId("feedback-dialog");
const emailField = (page: Page) => page.getByLabel("Your email");
const messageField = (page: Page) => page.getByLabel("Your feedback");
const sendButton = (page: Page) =>
  dialog(page).getByRole("button", { name: /Send Feedback|Sending…/ });
const cancelButton = (page: Page) => dialog(page).getByRole("button", { name: "Cancel" });
const closeX = (page: Page) => dialog(page).getByRole("button", { name: "Close", exact: true });

type OpenCall = { url: string; target: string };

/**
 * Stub window.open BEFORE any app script runs. Records calls to
 * `window.__OPEN_CALLS__`; `blockFirst` returns null on the first call
 * (a blocked pop-up) and a window-like object afterwards — used to drive
 * failure-then-retry.
 */
async function stubWindowOpen(page: Page, opts: { blockFirst?: boolean } = {}) {
  await page.addInitScript((blockFirst) => {
    const calls: OpenCall[] = [];
    (window as unknown as { __OPEN_CALLS__: OpenCall[] }).__OPEN_CALLS__ = calls;
    window.open = ((url?: unknown, target?: unknown) => {
      calls.push({ url: String(url), target: String(target) });
      if (blockFirst && calls.length === 1) return null;
      return { opener: {} } as unknown as Window;
    }) as typeof window.open;
  }, opts.blockFirst ?? false);
}

const openCalls = (page: Page): Promise<OpenCall[]> =>
  page.evaluate(
    () => (window as unknown as { __OPEN_CALLS__?: OpenCall[] }).__OPEN_CALLS__ ?? [],
  );

/** Seed the stored theme before any app script runs (same as issue-41 spec). */
async function seedTheme(page: Page, value: string) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [THEME_KEY, value] as const,
  );
}

/** Open the dialog from the footer trigger and wait for it. */
async function openDialog(page: Page) {
  await feedbackButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

/**
 * Install the deterministic pending gate (Builder's handoff): holds the
 * submission's promise until `releaseGate` is called, so the busy UI is
 * observable without racing a real transport.
 */
async function armPendingGate(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __APX_FEEDBACK_GATE__?: () => Promise<void>;
      __APX_GATE_RELEASE__?: () => void;
    };
    w.__APX_FEEDBACK_GATE__ = () =>
      new Promise<void>((resolve) => {
        w.__APX_GATE_RELEASE__ = resolve;
      });
  });
}

async function releaseGate(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __APX_GATE_RELEASE__?: () => void }).__APX_GATE_RELEASE__?.();
  });
}

// ───────────────────────── AC: the trigger ─────────────────────────

test("AC1 — footer 'Send us Feedback' is a real <button> that opens the dialog without navigating; the GitHub icon still links to the repo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  const trigger = feedbackButton(page);
  await expect(trigger).toBeVisible();
  // A real <button> — not an anchor dressed as one.
  await expect(trigger).toHaveJSProperty("tagName", "BUTTON");
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

  // The GitHub mark beside it is unchanged: still an <a> to the repo.
  const github = page.getByRole("link", { name: /GitHub repository/ });
  await expect(github).toHaveAttribute("href", REPO_URL);
  await expect(github).toHaveAttribute("target", "_blank");

  const urlBefore = page.url();
  await trigger.click();
  await expect(dialog(page)).toBeVisible();
  expect(page.url()).toBe(urlBefore); // no navigation
});

test("AC1 — opens from the mobile presentation too (375px)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await openDialog(page);
});

// ───────────────────────── AC: dialog contents ─────────────────────────

test("AC2 — dialog contents match the card: heading, blurb, labeled optional email, labeled textarea w/ placeholder, Cancel + Send Feedback + ✕", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openDialog(page);

  const dlg = dialog(page);
  await expect(dlg).toHaveAttribute("role", "dialog");
  await expect(dlg).toHaveAttribute("aria-modal", "true");

  // Labelled by its heading.
  const heading = dlg.getByRole("heading", { name: "Send us feedback" });
  await expect(heading).toBeVisible();
  const headingId = await heading.getAttribute("id");
  await expect(dlg).toHaveAttribute("aria-labelledby", headingId!);

  await expect(dlg.getByText("Help us make AP Exam Planner better.")).toBeVisible();

  // Email: real <label>, optional hint per the card's divergence from the reference.
  await expect(emailField(page)).toBeVisible();
  await expect(emailField(page)).toHaveJSProperty("tagName", "INPUT");
  await expect(dlg.getByText(/Optional — only if you.d like a reply/)).toBeVisible();

  // Message: real <label>, placeholder, resizable textarea.
  await expect(messageField(page)).toBeVisible();
  await expect(messageField(page)).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(messageField(page)).toHaveAttribute(
    "placeholder",
    /What.s working, what.s confusing/,
  );

  await expect(cancelButton(page)).toBeVisible();
  await expect(sendButton(page)).toBeVisible();
  await expect(sendButton(page)).toHaveJSProperty("type", "submit");
  await expect(closeX(page)).toBeVisible();

  // Evidence: default dialog, desktop light.
  await page.screenshot({ path: `${EVIDENCE_DIR}/desktop.png` });
});

// ───────────────────────── AC: email optional / unrestricted ─────────────────────────

test("AC3 — invalid email blocks submission with an inline, aria-tied error; no transport is touched", async ({
  page,
}) => {
  await stubWindowOpen(page);
  await page.goto("/");
  await openDialog(page);

  await emailField(page).fill("not-an-email");
  await messageField(page).fill("Real feedback text");
  await sendButton(page).click();

  const error = dialog(page).getByText("Enter a valid email address, or leave it blank.");
  await expect(error).toBeVisible();

  // Inline + tied to the field (aria-describedby) + announced (role=alert).
  const errorId = await error.locator("xpath=ancestor-or-self::*[@role='alert']").getAttribute("id");
  expect(errorId).toBeTruthy();
  const describedBy = await emailField(page).getAttribute("aria-describedby");
  expect(describedBy!.split(/\s+/)).toContain(errorId!);
  await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(emailField(page)).toBeFocused();

  expect(await openCalls(page)).toHaveLength(0);
  await expect(dialog(page)).toBeVisible(); // still editing
});

test("AC3 — empty email submits fine (email is optional); any-domain email is accepted and rides along", async ({
  page,
}) => {
  await stubWindowOpen(page);
  await page.goto("/");
  await openDialog(page);

  // No email at all → success.
  await messageField(page).fill("Feedback without an email");
  await sendButton(page).click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  let calls = await openCalls(page);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0].url).searchParams.get("body")).toContain("No reply email provided.");

  // Reopen: a non-school-domain address is accepted (unrestricted).
  await page.getByTestId("feedback-success").getByRole("button", { name: "Close" }).click();
  await openDialog(page);
  await emailField(page).fill("student@gmail.com");
  await messageField(page).fill("Feedback with an email");
  await sendButton(page).click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  calls = await openCalls(page);
  expect(calls).toHaveLength(2);
  const body = new URL(calls[1].url).searchParams.get("body")!;
  expect(body).toContain("Reply to: student@gmail.com");
  expect(body).toContain("Feedback with an email");
});

// ───────────────────────── AC: message required + cap + counter ─────────────────────────

test("AC4 — empty and whitespace-only messages are rejected inline (role=alert, aria-describedby, focus moves to the field); no transport", async ({
  page,
}) => {
  await stubWindowOpen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openDialog(page);

  await sendButton(page).click(); // empty
  const error = dialog(page).getByText("Please enter your feedback before sending.");
  await expect(error).toBeVisible();
  const errorId = await error.locator("xpath=ancestor-or-self::*[@role='alert']").getAttribute("id");
  expect(errorId).toBeTruthy();
  const describedBy = await messageField(page).getAttribute("aria-describedby");
  expect(describedBy!.split(/\s+/)).toContain(errorId!);
  await expect(messageField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(messageField(page)).toBeFocused();

  // Evidence: error state (invalid email + empty message).
  await emailField(page).fill("not-an-email");
  await sendButton(page).click();
  await expect(
    dialog(page).getByText("Enter a valid email address, or leave it blank."),
  ).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/error-state.png` });
  await emailField(page).fill("");

  // Whitespace-only is also rejected.
  await messageField(page).fill("   \n\t  ");
  await sendButton(page).click();
  await expect(
    dialog(page).getByText("Please enter your feedback before sending."),
  ).toBeVisible();

  expect(await openCalls(page)).toHaveLength(0);
});

test("AC4 — 2000-char cap is enforced (maxLength) and the live counter appears near the cap, turning emphatic at it", async ({
  page,
}) => {
  await page.goto("/");
  await openDialog(page);

  await expect(messageField(page)).toHaveAttribute("maxlength", String(MAX_LEN));

  // Below the threshold: no counter.
  await messageField(page).fill("x".repeat(COUNTER_AT - 1));
  await expect(dialog(page).getByText(`1,799/${MAX_LEN.toLocaleString("en-US")}`)).toHaveCount(0);

  // At the threshold: live counter appears, polite.
  await messageField(page).fill("x".repeat(COUNTER_AT));
  const counter = dialog(page).getByText(
    `${COUNTER_AT.toLocaleString("en-US")}/${MAX_LEN.toLocaleString("en-US")}`,
  );
  await expect(counter).toBeVisible();
  await expect(counter).toHaveAttribute("aria-live", "polite");

  // At the cap: value is clamped and the counter goes emphatic (not color-only:
  // font weight changes too).
  await messageField(page).fill("x".repeat(MAX_LEN + 50));
  await expect(messageField(page)).toHaveJSProperty("value", "x".repeat(MAX_LEN));
  const capCounter = dialog(page).getByText(
    `${MAX_LEN.toLocaleString("en-US")}/${MAX_LEN.toLocaleString("en-US")}`,
  );
  await expect(capCounter).toBeVisible();
  await expect(capCounter).toHaveClass(/font-semibold/);
});

// ───────────────────────── AC: honest pending / success / failure ─────────────────────────

test("AC5 — pending: submit disabled w/ busy indicator, dialog not dismissable mid-flight (Cancel, ✕, Escape, backdrop all inert)", async ({
  page,
}) => {
  await stubWindowOpen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openDialog(page);
  await armPendingGate(page);

  await messageField(page).fill("Hold this in pending");
  await sendButton(page).click();

  // Busy UI: label flips, all controls disabled, dialog aria-busy.
  await expect(dialog(page).getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect(cancelButton(page)).toBeDisabled();
  await expect(closeX(page)).toBeDisabled();
  await expect(dialog(page)).toHaveAttribute("aria-busy", "true");
  await expect(dialog(page).locator("svg.animate-spin")).toBeVisible();
  await expect(emailField(page)).toBeDisabled();
  await expect(messageField(page)).toBeDisabled();

  // Escape must NOT close mid-flight.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  // Backdrop click must not close either (click its top-left corner, outside the panel).
  await page.mouse.click(10, 10);
  await expect(dialog(page)).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE_DIR}/pending-state.png` });

  // Release the gate → success view.
  await releaseGate(page);
  await expect(page.getByTestId("feedback-success")).toBeVisible();
});

test("AC5 — success: thank-you view uses the adapter's own notice and never claims delivery the interim path can't guarantee", async ({
  page,
}) => {
  await stubWindowOpen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openDialog(page);

  await messageField(page).fill("Success path feedback");
  await sendButton(page).click();

  const success = page.getByTestId("feedback-success");
  await expect(success).toBeVisible();
  await expect(success.getByRole("heading", { name: "Thanks — almost there" })).toBeVisible();
  // The notice is the transport's own honest copy (interim = prefilled GitHub issue)...
  await expect(success.getByText(/pre-filled GitHub issue/)).toBeVisible();
  // ...and nothing in the view claims the message was sent/delivered.
  const successText = (await success.innerText()).toLowerCase();
  expect(successText).not.toMatch(/\b(sent|delivered)\b/);

  await page.screenshot({ path: `${EVIDENCE_DIR}/success-state.png` });

  // Focus lands on the success Close button; closing dismisses the dialog.
  const closeBtn = success.getByRole("button", { name: "Close" });
  await expect(closeBtn).toBeFocused();
  await closeBtn.click();
  await expect(dialog(page)).toHaveCount(0);
});

test("AC5 — failure (blocked pop-up): error surfaces, the user's text is preserved, and retry succeeds — the UI never claims success on failure", async ({
  page,
}) => {
  await stubWindowOpen(page, { blockFirst: true });
  await page.goto("/");
  await openDialog(page);

  const text = "Precious feedback that must survive a failure";
  await emailField(page).fill("keep@me.com");
  await messageField(page).fill(text);
  await sendButton(page).click();

  // Failure: back to editing with an announced error; NOT the success view.
  const alert = dialog(page).getByText(/blocked the pop-up/);
  await expect(alert).toBeVisible();
  await expect(page.getByTestId("feedback-success")).toHaveCount(0);

  // The user's text is preserved for retry.
  await expect(messageField(page)).toHaveJSProperty("value", text);
  await expect(emailField(page)).toHaveJSProperty("value", "keep@me.com");

  // Retry (second window.open call succeeds) → success.
  await sendButton(page).click();
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  expect(await openCalls(page)).toHaveLength(2);
});

// ───────────────────────── AC: accessibility ─────────────────────────

test("AC6 — focus management: initial focus in the dialog, Tab is trapped, and Cancel / Escape / ✕ each restore focus to the trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  // Cancel path.
  await openDialog(page);
  await expect(emailField(page)).toBeFocused(); // initial focus inside
  await cancelButton(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(feedbackButton(page)).toBeFocused(); // focus restored

  // Escape path.
  await openDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(feedbackButton(page)).toBeFocused();

  // ✕ path.
  await openDialog(page);
  await closeX(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(feedbackButton(page)).toBeFocused();

  // Focus trap: Tab from the LAST focusable (Send Feedback) wraps to the
  // FIRST (the ✕ close), never escaping to the page behind.
  await openDialog(page);
  await sendButton(page).focus();
  await page.keyboard.press("Tab");
  await expect(closeX(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sendButton(page)).toBeFocused();
});

test("AC6 — it's a real form: Enter from the email field submits", async ({ page }) => {
  await stubWindowOpen(page);
  await page.goto("/");
  await openDialog(page);

  await messageField(page).fill("Submitted via Enter");
  await emailField(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feedback-success")).toBeVisible();
  expect(await openCalls(page)).toHaveLength(1);
});

test("AC6 — ≥44×44px touch targets on mobile (trigger, ✕, Cancel, Send)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const triggerBox = (await feedbackButton(page).boundingBox())!;
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);

  await openDialog(page);
  for (const [name, locator] of [
    ["close ✕", closeX(page)],
    ["Cancel", cancelButton(page)],
    ["Send Feedback", sendButton(page)],
  ] as const) {
    const box = (await locator.boundingBox())!;
    expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    if (name === "close ✕") expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`AC6 — axe: the open dialog has no WCAG violations (${theme})`, async ({
    page,
  }) => {
    await seedTheme(page, theme);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await openDialog(page);

    const results = await new AxeBuilder({ page })
      .include('[data-testid="feedback-dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations,
      results.violations.map((v) => `${v.id}: ${v.help}`).join("\n"),
    ).toEqual([]);
  });
}

// ───────────────────────── AC: responsive + evidence ─────────────────────────

const viewports = [
  { name: "320w", width: 320, height: 568, shot: null },
  { name: "mobile", width: 375, height: 667, shot: "mobile.png" },
  { name: "tablet", width: 1024, height: 768, shot: "tablet.png" },
  { name: "desktop", width: 1920, height: 1080, shot: null }, // desktop.png taken in AC2
] as const;

for (const vp of viewports) {
  test(`AC7 — dialog works at ${vp.width}×${vp.height} with no horizontal page scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openDialog(page);

    await expect(sendButton(page)).toBeVisible();
    const noHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHScroll, "no horizontal page scroll with the dialog open").toBe(true);

    if (vp.shot) await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.shot}` });
  });
}

test("AC7 — desktop presentation: the modal overlay covers the sticky catalog filter bar (QA v1 FAIL — issue-29 R6 regression class)", async ({
  page,
}) => {
  // The desktop <aside> is `position: sticky`, which creates a stacking
  // context. The dialog renders INSIDE the aside, so its `fixed inset-0 z-50`
  // overlay is trapped in that context and paints BELOW the catalog's
  // `sticky top-0 z-30` filter bar in <main> — the bar stays lit and fully
  // clickable over the backdrop while the "modal" is open. This is the exact
  // defect issue-29 QA v3 R6 documented; MySchedules.tsx fixed it with
  // `createPortal(overlay, document.body)` and its doc comment warns about
  // precisely this trap. Binding expectation: with the dialog open, the
  // topmost element at a filter chip's center must NOT be the chip.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openDialog(page);

  const chip = page
    .locator("nav[aria-label='Jump to category']")
    .getByRole("button", { name: "STEM" });
  const box = (await chip.boundingBox())!;
  const chipIsTopmost = await page.evaluate(
    ({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      const nav = document.querySelector("nav[aria-label='Jump to category']");
      return top !== null && nav !== null && nav.contains(top);
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(
    chipIsTopmost,
    "filter chip must be covered by the dialog backdrop, not hittable above it",
  ).toBe(false);

  // And the overlay must not live inside the sticky aside's stacking context.
  const dialogInsideAside = await page.evaluate(() => {
    const dlg = document.querySelector("[data-testid='feedback-dialog']");
    return dlg !== null && dlg.closest("aside") !== null;
  });
  expect(
    dialogInsideAside,
    "feedback dialog overlay must be portaled out of the sticky <aside> (MySchedules pattern)",
  ).toBe(false);

  // Evidence: fixed state — the filter bar sits dimmed UNDER the backdrop
  // (pairs with issue-42-qa-v1/broken-filterbar-desktop.png).
  await page.screenshot({ path: `${EVIDENCE_DIR}/fixed-filterbar-desktop.png` });
});

test("AC7 — the dialog itself scrolls on short viewports (footer actions stay reachable)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  await openDialog(page);

  // The panel is height-capped and its own scroll container...
  const overflowY = await dialog(page).evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe("auto");

  // ...so the primary action can be scrolled to and used.
  await sendButton(page).scrollIntoViewIfNeeded();
  await expect(sendButton(page)).toBeVisible();
});

for (const theme of ["dark"] as const) {
  for (const vp of [
    { name: "desktop-dark", width: 1920, height: 1080 },
    { name: "mobile-dark", width: 375, height: 667 },
  ] as const) {
    test(`AC7 — evidence: ${theme} theme dialog at ${vp.width}×${vp.height}`, async ({
      page,
    }) => {
      await seedTheme(page, theme);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await openDialog(page);
      await messageField(page).fill("Dark-mode evidence capture");
      await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png` });
    });
  }
}
