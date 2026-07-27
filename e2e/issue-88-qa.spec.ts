import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { MAX_SCHEDULE_NAME_LENGTH } from "../src/lib/schedules";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #88) — Duplicate button forks a plan (selection +
 * resolutions) into a uniquely named copy.
 *
 * The pure store rules (`withScheduleDuplicated`, `copyScheduleName`) are
 * unit-tested in `src/lib/schedules.test.ts` (9 new tests, re-run by this
 * lane: 260/260 green). This suite is the independent browser-level
 * counterpart: it never calls the transitions directly — every assertion is
 * on what a user (or the persisted storage the app owns) actually observes.
 *
 *   AC1  — every schedule row has its own `Duplicate <name>` button beside
 *          Rename/Delete, with a distinct (non-pencil, non-trash) glyph.
 *   AC2  — the button is a real <button> OUTSIDE the role="radio" control:
 *          not a radio-group stop, roving tabindex + arrow keys unchanged.
 *   AC3  — one click forks the FULL plan (selection AND resolutions) under a
 *          fresh id; the copy is independent — editing it never leaks back
 *          into the source (asserted on the store's own persisted payload,
 *          not object identity, since the browser boundary serializes).
 *   AC4  — names derive from the source and never collide:
 *          `<name> (copy)`, `(copy 2)`, `(copy 3)` — forking a copy strips
 *          the suffix first (never `(copy) (copy)`).
 *   AC5  — a MAX-length (60-char) source still duplicates: base truncated so
 *          the suffix fits; the rendered name is ≤60 and unique.
 *   AC6  — the copy becomes ACTIVE: radio aria-checked, keyboard focus, the
 *          schedule view, and the legacy mirror keys all switch to it.
 *   AC7  — pure transition + API surface: unit-covered (see above); this
 *          suite adds a source-contract check that `withScheduleDuplicated`
 *          lives in `src/lib/schedules.ts` beside the other transitions and
 *          `SchedulesApi` exposes `duplicate`.
 *   AC8  — unknown-id no-op: NOT browser-reachable (the UI only ever passes
 *          real schedule ids), so its observable test lives at the unit
 *          layer — `schedules.test.ts` "unknown id is a no-op". Documented
 *          omission, per the super-qa non-visual-AC rule.
 *   AC9  — persistence: the duplicate survives reload via `apx.schedules.v1`,
 *          and the legacy mirror (`apx.selection.v1` / `apx.resolutions.v1`)
 *          always describes the ACTIVE schedule — copy while the copy is
 *          active, source again after switching back.
 *   AC10 — the code comment reconciling auto-suffixing with issue #62's
 *          reject-duplicates rule exists (source-contract check).
 *
 * Layout note from the issue ("the real risk"): a dedicated 375px test
 * asserts all three per-row buttons keep their 44px touch targets AND the
 * truncating name keeps meaningful width — plus the three standard-viewport
 * screenshots for the evidence folder.
 *
 * v1 VERDICT: every numbered AC passes, but the mobile-layout constraint
 * fails — at 375px the name span gets 99px, so "Schedule 1 (copy)" and
 * "Schedule 1 (copy 2)" BOTH clip to "Schedule 1 (c…" and are pixel-
 * identical. The deliberately-red "visually distinguishable" test below is
 * the repro; the rebuild turns it green.
 *
 * v2 VERDICT (post-rebuild 0af518e): the copy-suffix now renders as a pinned
 * segment inside the row's `.truncate` span (`splitCopySuffix`), so the base
 * truncates but the suffix never does. The v1 repro is GREEN with zero
 * assertion changes — only the evidence slug and the mobile screenshot's
 * name (before-fix → after-fix) moved to v2. Full suite 13/13.
 */

const EVIDENCE_DIR = evidenceDir("issue-88-qa-v2");

const SCHEDULES_KEY = "apx.schedules.v1";
const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

const DESKTOP = { width: 1920, height: 1080 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 375, height: 667 };

// ── dataset fixture (same pair issue #5's suite proved collides) ────────────
type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
};
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const byId = (id: string): Subject => {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};
const BIOLOGY = byId("biology");
const ITALIAN = byId("italian-language-and-culture");
if (
  BIOLOGY.exam!.date !== ITALIAN.exam!.date ||
  BIOLOGY.exam!.session !== ITALIAN.exam!.session
)
  throw new Error("fixture drift: biology/italian no longer share a slot");

// ── locators (issue #62 suite conventions) ──────────────────────────────────
const radiogroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "My schedules" });
const radios = (page: Page) => radiogroup(page).getByRole("radio");
const radio = (page: Page, name: string) =>
  radiogroup(page).getByRole("radio", { name, exact: true });
const duplicateButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Duplicate ${name}`, exact: true });
const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

/** On mobile the switcher lives inside a disclosure; expand it if collapsed. */
async function ensureSchedulesVisible(page: Page) {
  if (await radiogroup(page).isVisible()) return;
  const toggle = page.getByRole("button", { name: "My schedules" });
  await expect(async () => {
    await toggle.click();
    await expect(radiogroup(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Start from a clean single-schedule store. */
async function cleanStart(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await ensureSchedulesVisible(page);
  await expect(radios(page)).toHaveCount(1);
}

/** Hydration-safe Duplicate press: retry until the radio count grows. */
async function duplicateSchedule(page: Page, name: string) {
  const before = await radios(page).count();
  await expect(async () => {
    await duplicateButton(page, name).first().click();
    await expect(radios(page)).toHaveCount(before + 1, { timeout: 1000 });
  }).toPass();
}

/** Select a catalog subject and wait for the pressed state. */
async function select(page: Page, name: string) {
  const c = card(page, name);
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

/** Hydration-safe rename via the inline field (Enter commit). */
async function renameSchedule(page: Page, from: string, to: string) {
  await expect(async () => {
    await page
      .getByRole("button", { name: `Rename ${from}`, exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: `New name for ${from}` }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  const field = page.getByRole("textbox", { name: `New name for ${from}` });
  await field.fill(to);
  await field.press("Enter");
  await expect(radio(page, to)).toBeVisible();
}

/** Parse the store's own persisted payload. */
async function persistedState(page: Page): Promise<{
  activeId: string;
  schedules: {
    id: string;
    name: string;
    selection: string[];
    resolutions: unknown[];
  }[];
}> {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    SCHEDULES_KEY,
  );
  expect(raw, `${SCHEDULES_KEY} must exist after a store write`).toBeTruthy();
  return JSON.parse(raw!);
}

/**
 * Build "Schedule 1" into a real plan: two colliding subjects + one resolved
 * conflict (keep Biology → Italian moves to its late slot). Returns with the
 * List view open and the resolution visible.
 */
async function planWithResolution(page: Page) {
  await cleanStart(page);
  await pressViewChip(page, "List");
  await select(page, BIOLOGY.name);
  await select(page, ITALIAN.name);
  await prompt(page)
    .getByRole("button", { name: `Keep ${BIOLOGY.name} at the regular time` })
    .first()
    .click();
  await expect(prompt(page)).toBeHidden();
  await expect(page.getByText("Moved to late testing")).toBeVisible();
}

// ── AC1: per-row Duplicate button with per-schedule accessible name ─────────

test("AC1 — every schedule row has its own Duplicate button, named for its schedule, with a non-pencil non-trash glyph", async ({
  page,
}) => {
  await cleanStart(page);
  // Grow to two rows so "per-schedule" is observable.
  await expect(async () => {
    await page.getByRole("button", { name: "New schedule" }).click();
    await expect(radios(page)).toHaveCount(2, { timeout: 1000 });
  }).toPass();

  for (const name of ["Schedule 1", "Schedule 2"]) {
    const dup = duplicateButton(page, name);
    await expect(dup, `row "${name}" must own a Duplicate button`).toBeVisible();
    // Alongside Rename and Delete — all three per-row actions coexist.
    await expect(
      page.getByRole("button", { name: `Rename ${name}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Delete ${name}`, exact: true }),
    ).toBeVisible();
    // Distinct glyph: an aria-hidden svg of its own (icon-only button whose
    // accessible name comes from aria-label, not from shared icon markup).
    await expect(dup.locator("svg[aria-hidden='true']")).toHaveCount(1);
    const paths = await dup
      .locator("svg path")
      .evaluateAll((els) => els.map((e) => e.getAttribute("d") ?? ""));
    const renamePaths = await page
      .getByRole("button", { name: `Rename ${name}`, exact: true })
      .locator("svg path")
      .evaluateAll((els) => els.map((e) => e.getAttribute("d") ?? ""));
    expect(
      paths.join("|"),
      "Duplicate glyph must differ from Rename's pencil",
    ).not.toBe(renamePaths.join("|"));
  }
});

// ── AC2: real <button> outside the radio; radiogroup semantics unchanged ────

test("AC2 — Duplicate is outside the role=radio control, is a regular tab stop, and arrow keys still walk radios only", async ({
  page,
}) => {
  await cleanStart(page);
  await expect(async () => {
    await page.getByRole("button", { name: "New schedule" }).click();
    await expect(radios(page)).toHaveCount(2, { timeout: 1000 });
  }).toPass();
  // "New schedule" activates Schedule 2; make Schedule 1 active for the walk.
  await radio(page, "Schedule 1").click();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const dup1 = duplicateButton(page, "Schedule 1");
  // (a) Not inside any radio, and not itself a radio.
  expect(
    await dup1.evaluate((el) => ({
      tag: el.tagName,
      role: el.getAttribute("role"),
      insideRadio: el.closest('[role="radio"]') !== null,
    })),
  ).toEqual({ tag: "BUTTON", role: null, insideRadio: false });

  // (b) Roving tabindex intact on the radios; Duplicate carries NO tabindex
  //     override (regular tab stop, not part of the roving scheme).
  await expect(radio(page, "Schedule 1")).toHaveAttribute("tabindex", "0");
  await expect(radio(page, "Schedule 2")).toHaveAttribute("tabindex", "-1");
  expect(await dup1.evaluate((el) => el.hasAttribute("tabindex"))).toBe(false);

  // (c) Arrow keys walk radio → radio, skipping the three action buttons
  //     that sit between them in DOM order.
  await radio(page, "Schedule 1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, "Schedule 2")).toBeFocused();
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("ArrowUp");
  await expect(radio(page, "Schedule 1")).toBeFocused();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // (d) Tab from the active radio reaches the row's Duplicate button — a
  //     real stop in the normal sequence (screen-reader/keyboard parity).
  await page.keyboard.press("Tab");
  await expect(dup1).toBeFocused();
});

// ── AC3 + AC6: full-plan fork under a fresh id; the copy becomes active ─────

test("AC3+AC6 — one click forks selection AND resolutions under a fresh id, and the whole app switches to the active copy", async ({
  page,
}) => {
  await planWithResolution(page);
  const before = await persistedState(page);
  expect(before.schedules).toHaveLength(1);
  const source = before.schedules[0];
  expect(source.selection.length).toBe(2);
  expect(source.resolutions.length).toBe(1);

  await duplicateSchedule(page, "Schedule 1");

  // AC6 — the copy is the active radio and holds keyboard focus (same
  // focus-follows-change behavior as create/delete).
  const copyRadio = radio(page, "Schedule 1 (copy)");
  await expect(copyRadio).toHaveAttribute("aria-checked", "true");
  await expect(copyRadio).toBeFocused();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // The app is now LOOKING AT the copy: same two subjects pressed in the
  // catalog, and the carried resolution renders with no re-prompt.
  await expect(card(page, BIOLOGY.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(card(page, ITALIAN.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(prompt(page)).toBeHidden();
  await expect(page.getByText("Moved to late testing")).toBeVisible();

  // AC3 — persisted payload: two schedules, fresh id, deep-equal plan state.
  const after = await persistedState(page);
  expect(after.schedules).toHaveLength(2);
  const [origin, copy] = after.schedules; // copy inserted directly after source
  expect(origin.id).toBe(source.id);
  expect(copy.id).not.toBe(source.id);
  expect(copy.name).toBe("Schedule 1 (copy)");
  expect(after.activeId).toBe(copy.id);
  expect(copy.selection).toEqual(origin.selection);
  expect(copy.resolutions).toEqual(origin.resolutions);

  // AC6 — legacy mirror now describes the COPY (selection + resolutions are
  // what list/calendar/export read for the active schedule).
  const mirror = await page.evaluate(
    ([sel, res]) => ({
      selection: JSON.parse(window.localStorage.getItem(sel)!),
      resolutions: JSON.parse(window.localStorage.getItem(res)!),
    }),
    [SELECTION_KEY, RESOLUTIONS_KEY] as const,
  );
  expect(mirror.selection).toEqual(copy.selection);
  expect(mirror.resolutions).toEqual(copy.resolutions);
});

test("AC3 — the copy is independent: editing the copy's plan never mutates the source", async ({
  page,
}) => {
  await planWithResolution(page);
  await duplicateSchedule(page, "Schedule 1");
  const forked = await persistedState(page);
  const sourceBefore = forked.schedules.find(
    (s) => s.name === "Schedule 1",
  )!;

  // Edit the COPY: drop Italian (which also prunes its resolution).
  const italian = card(page, ITALIAN.name);
  await italian.click();
  await expect(italian).toHaveAttribute("aria-pressed", "false");

  const after = await persistedState(page);
  const sourceAfter = after.schedules.find((s) => s.name === "Schedule 1")!;
  const copyAfter = after.schedules.find(
    (s) => s.name === "Schedule 1 (copy)",
  )!;
  // The copy really changed…
  expect(copyAfter.selection).toEqual([BIOLOGY.id]);
  expect(copyAfter.resolutions).toEqual([]);
  // …and the source is byte-identical to before the edit (non-aliasing as
  // observed through the store's own persistence — the only cross-page
  // boundary the browser exposes).
  expect(sourceAfter).toEqual(sourceBefore);
  expect(sourceAfter.selection.length).toBe(2);
  expect(sourceAfter.resolutions.length).toBe(1);

  // Switching back shows the source untouched in the UI: both subjects
  // pressed, resolution still applied, no conflict re-prompt.
  await radio(page, "Schedule 1").click();
  await expect(card(page, ITALIAN.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(prompt(page)).toBeHidden();
  await expect(page.getByText("Moved to late testing")).toBeVisible();
});

// ── AC4: derived names stay unique; forking a copy strips the suffix ────────

test("AC4 — name chain: (copy), (copy 2) when forking the copy, (copy 3) when re-forking the original — never '(copy) (copy)'", async ({
  page,
}) => {
  await cleanStart(page);

  await duplicateSchedule(page, "Schedule 1");
  await expect(radio(page, "Schedule 1 (copy)")).toBeVisible();

  // Fork the COPY: suffix is stripped and re-derived, not stacked.
  await duplicateSchedule(page, "Schedule 1 (copy)");
  await expect(radio(page, "Schedule 1 (copy 2)")).toBeVisible();

  // Fork the ORIGINAL again: (copy) and (copy 2) are taken → (copy 3).
  await duplicateSchedule(page, "Schedule 1");
  await expect(radio(page, "Schedule 1 (copy 3)")).toBeVisible();

  const names = await radios(page).evaluateAll((els) =>
    els.map((el) => el.textContent!.trim()),
  );
  expect(new Set(names).size, "all schedule names must be unique").toBe(
    names.length,
  );
  expect(names.join("|")).not.toContain("(copy) (copy)");
});

// ── AC5: 60-char source still duplicates to a valid, unique, ≤60 name ───────

test("AC5 — a MAX_SCHEDULE_NAME_LENGTH source truncates its base so the suffix fits; the copy renders and is unique", async ({
  page,
}) => {
  await cleanStart(page);
  const longName = "L".repeat(MAX_SCHEDULE_NAME_LENGTH); // 60 chars
  await renameSchedule(page, "Schedule 1", longName);

  await duplicateSchedule(page, longName);

  // Expected: base truncated (in code points) to fit " (copy)", trimmed.
  const expected =
    [...longName]
      .slice(0, MAX_SCHEDULE_NAME_LENGTH - " (copy)".length)
      .join("")
      .trimEnd() + " (copy)";
  expect(expected.length).toBeLessThanOrEqual(MAX_SCHEDULE_NAME_LENGTH);
  await expect(radio(page, expected)).toBeVisible();
  await expect(radio(page, expected)).toHaveAttribute("aria-checked", "true");

  // A second fork of the same source must ALSO fit and stay unique.
  await duplicateSchedule(page, longName);
  const names = (await persistedState(page)).schedules.map((s) => s.name);
  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(3);
  for (const n of names)
    expect(
      n.length,
      `"${n}" must satisfy the store's own length cap`,
    ).toBeLessThanOrEqual(MAX_SCHEDULE_NAME_LENGTH);
});

// ── AC9: reload persistence + legacy mirror tracks the active schedule ──────

test("AC9 — the duplicate survives reload, stays active, and the legacy mirror follows the active schedule both ways", async ({
  page,
}) => {
  await planWithResolution(page);
  await duplicateSchedule(page, "Schedule 1");
  const persisted = await persistedState(page);
  const copy = persisted.schedules.find(
    (s) => s.name === "Schedule 1 (copy)",
  )!;
  const source = persisted.schedules.find((s) => s.name === "Schedule 1")!;

  await page.reload();
  await ensureSchedulesVisible(page);

  // Both rows back; the copy is still the active one.
  await expect(radios(page)).toHaveCount(2);
  await expect(radio(page, "Schedule 1 (copy)")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const reloaded = await persistedState(page);
  expect(reloaded.activeId).toBe(copy.id);
  expect(reloaded.schedules).toEqual(persisted.schedules);

  // Mirror contract: active copy → legacy keys describe the copy…
  const mirrorOfCopy = await page.evaluate(
    ([sel, res]) => ({
      selection: JSON.parse(window.localStorage.getItem(sel)!),
      resolutions: JSON.parse(window.localStorage.getItem(res)!),
    }),
    [SELECTION_KEY, RESOLUTIONS_KEY] as const,
  );
  expect(mirrorOfCopy.selection).toEqual(copy.selection);
  expect(mirrorOfCopy.resolutions).toEqual(copy.resolutions);

  // …switch back to the source → the mirror flips with the active schedule.
  await radio(page, "Schedule 1").click();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const mirrorOfSource = await page.evaluate(
    ([sel, res]) => ({
      selection: JSON.parse(window.localStorage.getItem(sel)!),
      resolutions: JSON.parse(window.localStorage.getItem(res)!),
    }),
    [SELECTION_KEY, RESOLUTIONS_KEY] as const,
  );
  expect(mirrorOfSource.selection).toEqual(source.selection);
  expect(mirrorOfSource.resolutions).toEqual(source.resolutions);
});

// ── AC7 + AC10: source contract — transition placement + the #62 rationale ──

test("AC7+AC10 — withScheduleDuplicated is a pure store transition on SchedulesApi, and the #62 reconciliation comment exists", () => {
  const schedules = readFileSync("src/lib/schedules.ts", "utf8");
  // AC7 — transition + wrapper + API surface live in the store module.
  expect(schedules).toContain("export function withScheduleDuplicated(");
  expect(schedules).toContain("export function duplicateSchedule(");
  expect(schedules).toMatch(/interface SchedulesApi \{[\s\S]*?duplicate:/);
  // The transition must not touch the imperative shell (purity smoke check:
  // no setState/localStorage inside the withScheduleDuplicated body).
  const body = schedules.slice(
    schedules.indexOf("export function withScheduleDuplicated("),
    schedules.indexOf("export function withScheduleRenamed("),
  );
  expect(body).not.toContain("setState");
  expect(body).not.toContain("localStorage");
  // AC10 — the doc comment reconciles auto-suffixing with issue #62.
  expect(schedules).toMatch(/#62[\s\S]{0,600}?(typed|TYPED)/i);
  expect(schedules).toContain("does NOT contradict issue #62");
  // The section a11y contract mentions the new behavior too.
  const component = readFileSync("src/components/MySchedules.tsx", "utf8");
  expect(component).toMatch(/Duplicate \(issue #88\)/);
});

// ── Layout risk (issue "Notes"): 375px keeps 44px targets + a readable name ─

test("layout — at 375px each row keeps three 44px touch targets and the name stays visible", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await cleanStart(page);
  // Worst case: a long name PLUS three buttons on the same row.
  await renameSchedule(
    page,
    "Schedule 1",
    "ambitious draft with a very long descriptive name",
  );
  const name = "ambitious draft with a very long descriptive name";

  for (const action of ["Duplicate", "Rename", "Delete"]) {
    const box = await page
      .getByRole("button", { name: `${action} ${name}`, exact: true })
      .boundingBox();
    expect(box, `${action} button must render`).toBeTruthy();
    expect(box!.width, `${action} touch-target width`).toBeGreaterThanOrEqual(
      43,
    );
    expect(
      box!.height,
      `${action} touch-target height`,
    ).toBeGreaterThanOrEqual(43);
  }

  // The truncating name keeps SOME meaningful width (measured 99px today —
  // roughly 13 characters of text-sm; the base name stays recognizable).
  const nameBox = await radio(page, name)
    .locator("span.truncate")
    .boundingBox();
  expect(nameBox).toBeTruthy();
  expect(nameBox!.width).toBeGreaterThanOrEqual(80);
});

/**
 * ❌ RED on v1 (the QA-fail driver) → ✅ GREEN on v2: the rebuild pins the
 * copy-suffix outside the truncating base segment, so sibling copies paint
 * different name pixels at 375px. The assertions below are byte-identical to
 * v1 — only the captured screenshot's name records the fixed state.
 *
 * Original v1 finding, kept for the record:
 *
 * At 375px the name span gets 99px, but "Schedule 1 (copy)" needs 109px and
 * "Schedule 1 (copy 2)" needs 122px — BOTH clip to "Schedule 1 (c…", so two
 * adjacent rows produced by the feature itself are pixel-identical. The
 * copy-suffix — the ONLY part of the derived name that distinguishes the
 * copies AC4 guarantees are uniquely named — is exactly what gets truncated
 * away. The issue's Notes called this breakpoint "the real risk" and required
 * the treatment not to squeeze the name into meaninglessness; a uniqueness
 * scheme the user cannot see is meaningless on this viewport.
 *
 * The assertion is implementation-agnostic: it does not prescribe suffix-
 * preserving truncation vs. tighter chrome vs. an overflow menu — it only
 * demands that two schedules with DIFFERENT names paint DIFFERENT name
 * pixels at mobile width. Any real fix satisfies it; the current build
 * cannot.
 */
test("layout — at 375px two sibling copies must be visually distinguishable (the copy-suffix must survive truncation)", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await cleanStart(page);
  await duplicateSchedule(page, "Schedule 1");
  await duplicateSchedule(page, "Schedule 1 (copy)");
  // Make the ORIGINAL active so both copies render in the same (inactive)
  // visual state — the only remaining difference is the name itself.
  await radio(page, "Schedule 1").click();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.screenshot({
    path: `${EVIDENCE_DIR}/after-fix-mobile.png`,
    fullPage: false,
  });

  const copyPixels = await radio(page, "Schedule 1 (copy)")
    .locator("span.truncate")
    .screenshot();
  const copy2Pixels = await radio(page, "Schedule 1 (copy 2)")
    .locator("span.truncate")
    .screenshot();
  expect(
    copyPixels.equals(copy2Pixels),
    "'Schedule 1 (copy)' and 'Schedule 1 (copy 2)' render identical name " +
      "pixels at 375px — the user cannot tell the two copies apart",
  ).toBe(false);
});

// ── Evidence: the standard super-board viewports ─────────────────────────────

for (const [slug, viewport] of [
  ["desktop", DESKTOP],
  ["tablet", TABLET],
] as const) {
  test(`evidence — ${slug} screenshot of a forked plan`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await planWithResolution(page);
    await renameSchedule(page, "Schedule 1", "ambitious draft");
    await duplicateSchedule(page, "ambitious draft");
    await duplicateSchedule(page, "ambitious draft (copy)");
    await expect(radio(page, "ambitious draft (copy 2)")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.screenshot({
      path: `${EVIDENCE_DIR}/${slug}.png`,
      fullPage: false,
    });
  });
}
