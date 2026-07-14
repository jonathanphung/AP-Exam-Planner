import { test, expect, type Page } from "@playwright/test";
import { MAX_SCHEDULE_NAME_LENGTH } from "../src/lib/schedules";

/**
 * super-board QA (issue #62) — reject duplicate + over-length schedule names
 * in My Schedules.
 *
 * The pure store rules (validateScheduleName, withScheduleRenamed,
 * withScheduleCreated) are unit-tested in src/lib/schedules.test.ts. This
 * suite is the browser-level counterpart: one observable test per UI/a11y
 * acceptance criterion, driving the real rename field the issue's repro names.
 *
 *   AC1 — a rename to another schedule's exact name is REJECTED with inline
 *         feedback: the field stays open, a role="alert" states the reason, no
 *         second radio with that name appears (the issue's original repro:
 *         two indistinguishable "Schedule 1" radios). Fixing the name commits.
 *   AC2 — the rename input caps length at MAX_SCHEDULE_NAME_LENGTH via
 *         `maxLength`; a user cannot type past it (store cap is unit-covered).
 *   AC3 — the constraint is announced accessibly: an always-present
 *         aria-describedby hint states it, and a rejected commit sets
 *         aria-invalid + points aria-describedby at the role="alert" message
 *         (no silent truncation).
 *   AC5 — existing behavior preserved: blank commit rejected (no-op), trim
 *         applied on a valid rename, last remaining schedule's delete disabled.
 *
 * Screenshot evidence of the rejection state at the three standard super-board
 * viewports lands in the run folder and is committed to the issue branch.
 */

const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-62-qa-v1";

const DESKTOP = { width: 1920, height: 1080 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 375, height: 667 };

const radiogroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "My schedules" });
const radios = (page: Page) => radiogroup(page).getByRole("radio");
const radio = (page: Page, name: string) =>
  radiogroup(page).getByRole("radio", { name, exact: true });
const newScheduleButton = (page: Page) =>
  page.getByRole("button", { name: "New schedule" });
const renameField = (page: Page, forName: string) =>
  page.getByRole("textbox", { name: `New name for ${forName}` });

/** On mobile the switcher lives inside a disclosure; expand it if collapsed. */
async function ensureSchedulesVisible(page: Page) {
  if (await radiogroup(page).isVisible()) return;
  const toggle = page.getByRole("button", { name: "My schedules" });
  await expect(async () => {
    await toggle.click();
    await expect(radiogroup(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Hydration-safe "New schedule" press: retry until the radio count grows. */
async function createSchedule(page: Page) {
  const before = await radios(page).count();
  await expect(async () => {
    await newScheduleButton(page).click();
    await expect(radios(page)).toHaveCount(before + 1, { timeout: 1000 });
  }).toPass();
}

/** Start from a clean single-schedule store, then add a 2nd schedule. */
async function twoScheduleStart(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await ensureSchedulesVisible(page);
  await expect(radios(page)).toHaveCount(1);
  await createSchedule(page); // "Schedule 2", active
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
}

// ── AC1: duplicate rename is rejected with inline feedback ──────────────────

test("AC1 — renaming Schedule 2 to the existing 'Schedule 1' is rejected inline; no duplicate radio; fixing the name commits", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await twoScheduleStart(page);

  // The issue's exact repro: rename Schedule 2 → "Schedule 1" → Enter.
  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  const field = renameField(page, "Schedule 2");
  await field.fill("Schedule 1");
  await field.press("Enter");

  // Rejected: field stays open, alert names the reason, radio was NOT renamed.
  // (Scope to the rename error's id — Next's route announcer is also role=alert.)
  await expect(field).toBeVisible();
  const alert = page.locator("#schedule-rename-error");
  await expect(alert).toHaveRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText("You already have a schedule with this name.");
  await expect(field).toHaveAttribute("aria-invalid", "true");

  // Crucially: no second "Schedule 1" radio — the original bug is gone.
  // While the row is mid-rename it renders the input (not a radio), so the
  // group holds exactly the one untouched "Schedule 1" radio.
  await expect(radios(page)).toHaveCount(1);
  await expect(radio(page, "Schedule 1")).toHaveCount(1);

  // Editing again clears the stale alert; a unique name commits and closes.
  await field.fill("revision plan");
  await expect(page.locator("#schedule-rename-error")).toHaveCount(0);
  await field.press("Enter");
  await expect(renameField(page, "revision plan")).toBeHidden();
  await expect(radio(page, "revision plan")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(radios(page)).toHaveCount(2);
});

// ── AC2: the rename input enforces the length cap (no typing past it) ────────

test(`AC2 — the rename input caps length at ${MAX_SCHEDULE_NAME_LENGTH} characters`, async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await twoScheduleStart(page);

  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  const field = renameField(page, "Schedule 2");
  await expect(field).toHaveAttribute(
    "maxlength",
    String(MAX_SCHEDULE_NAME_LENGTH),
  );

  // Real keystrokes past the cap: the browser stops accepting at the limit.
  await field.fill("");
  await field.pressSequentially("x".repeat(MAX_SCHEDULE_NAME_LENGTH + 5), {
    delay: 0,
  });
  const value = await field.inputValue();
  expect(value.length).toBe(MAX_SCHEDULE_NAME_LENGTH);

  // An at-cap name is valid and commits (no false "too-long").
  await field.press("Enter");
  await expect(radio(page, "x".repeat(MAX_SCHEDULE_NAME_LENGTH))).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

// ── AC3: the constraint is announced accessibly ─────────────────────────────

test("AC3 — always-present aria-describedby hint; a rejected commit sets aria-invalid + role=alert wired via aria-describedby", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await twoScheduleStart(page);

  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  const field = renameField(page, "Schedule 2");

  // Before any error: the hint alone describes the field and states the rule.
  await expect(field).toHaveAttribute(
    "aria-describedby",
    "schedule-rename-hint",
  );
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  const hint = page.locator("#schedule-rename-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(String(MAX_SCHEDULE_NAME_LENGTH));
  await expect(hint).toContainText("differ");

  // Reject with a duplicate: aria-invalid flips and the alert joins the
  // description so a screen reader reads it on the field.
  await field.fill("Schedule 1");
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAttribute(
    "aria-describedby",
    "schedule-rename-hint schedule-rename-error",
  );
  const error = page.locator("#schedule-rename-error");
  await expect(error).toHaveRole("alert");
  await expect(error).toBeVisible();
});

// ── AC5: existing behavior preserved ────────────────────────────────────────

test("AC5 — blank rename rejected (no-op), trim applied on a valid rename, last-remaining delete disabled", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);

  // Last-remaining guard from a clean single-schedule store.
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await ensureSchedulesVisible(page);
  await expect(radios(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Delete Schedule 1" }),
  ).toBeDisabled();

  await createSchedule(page); // "Schedule 2"

  // Blank commit: rejected, field stays open, name unchanged.
  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  let field = renameField(page, "Schedule 2");
  await field.fill("   ");
  await field.press("Enter");
  await expect(page.locator("#schedule-rename-error")).toHaveText(
    "Enter a name for this schedule.",
  );
  await expect(field).toBeVisible();
  await field.press("Escape"); // cancel → reverts to "Schedule 2"
  await expect(radio(page, "Schedule 2")).toBeVisible();

  // Trim applied on a valid rename.
  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  field = renameField(page, "Schedule 2");
  await field.fill("   ambitious draft   ");
  await field.press("Enter");
  await expect(radio(page, "ambitious draft")).toBeVisible();
  await expect(radios(page)).toHaveCount(2);
});

// ── Evidence: the rejection state at the three standard viewports ────────────

for (const vp of [
  { name: "desktop", size: DESKTOP, file: "desktop.png" },
  { name: "tablet", size: TABLET, file: "tablet.png" },
  { name: "mobile", size: MOBILE, file: "mobile.png" },
] as const) {
  test(`evidence — duplicate-name rejection alert at ${vp.name} ${vp.size.width}x${vp.size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp.size);
    await twoScheduleStart(page);

    await page.getByRole("button", { name: "Rename Schedule 2" }).click();
    const field = renameField(page, "Schedule 2");
    await field.fill("Schedule 1");
    await field.press("Enter");
    await expect(page.locator("#schedule-rename-error")).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.file}`, fullPage: true });
  });
}
