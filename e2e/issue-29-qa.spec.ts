import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #29) — branded sidebar panel with MY SCHEDULES:
 * multiple switchable schedules saved client-side.
 *
 * One observable, browser-level test per acceptance criterion, plus screenshot
 * capture at the three standard super-board viewports (desktop 1920x1080,
 * tablet 1024x768, mobile 375x667). Screenshots land in the run evidence
 * folder and are committed to the issue branch so they render inline on the
 * issue / PR.
 *
 *   AC1  — desktop hierarchy: branding row (h1 + collapse toggle with
 *          aria-expanded, remembered in apx.sidebar.v1) → MY SCHEDULES →
 *          divider → RESOURCES; collapsing widens the main content.
 *   AC2  — mobile keeps the #22/#23 pattern: no persistent left column; My
 *          Schedules and Resources are disclosures, and schedule switching
 *          works inside the disclosure.
 *   AC3  — every resource link fits on ONE line, untruncated, at desktop
 *          widths (1024/1440/1920) and in the 375px mobile disclosure.
 *   AC4  — link labels are parenthesis-free.
 *   AC5  — hover underlines the label text but never the trailing ↗ (and the
 *          anchor itself never carries the underline, so nothing propagates).
 *   AC6  — switching schedules swaps the ENTIRE app: catalog chips, list
 *          view, calendar view, and ICS export all follow the active
 *          schedule immediately.
 *   AC7  — `+` creates auto-named empty "Schedule N"; inline rename; delete
 *          behind a confirm dialog (cancel path honored); the last remaining
 *          schedule cannot be deleted.
 *   AC8  — per-schedule resolutions: opposite resolutions of the same
 *          collision live side-by-side in two schedules with zero leakage;
 *          the legacy mirror keys always describe the active schedule.
 *   AC9  — persistence is client-side per browser (versioned localStorage
 *          apx.schedules.v1, zero cookies), surviving reload.
 *   AC10 — migration: a pre-#29 visitor's apx.selection.v1 +
 *          apx.resolutions.v1 are adopted as "Schedule 1" on first load
 *          (browser-level; the pure function is unit-tested in
 *          src/lib/schedules.test.ts).
 *   AC11 — cross-tab: switching/creating schedules in one tab is reflected
 *          in another via the storage event.
 *   AC12 — a11y: real radiogroup with roving tabindex + arrow-key operation,
 *          focus-managed inline rename, focus-trapped delete dialog with
 *          focus restore, keyboard-operable announced collapse toggle.
 *   AC13 — no horizontal scroll at 375/1024/1440/1920 (expanded AND
 *          collapsed); evidence screenshots at the standard viewports.
 *
 * Contrast and reduced-motion at the app level are regression-covered by the
 * axe scan in e2e/a11y.spec.ts, which runs in the same suite.
 */

// Env-overridable so a re-verification pass writes a fresh evidence set
// instead of rewriting a prior run's committed screenshots.
const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-29-qa-v1";

const SCHEDULES_KEY = "apx.schedules.v1";
const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";
const SIDEBAR_KEY = "apx.sidebar.v1";

const SIDEBAR = "aside[data-testid='resources-sidebar']";
const RESOURCE_LINKS = `${SIDEBAR} #resources-panel a[target='_blank']`; // scoped: the #29 footer row added non-resource links to the sidebar
/** 4 exam-logistics + 1 scores + 3 planning links (src/data/resources.ts). */
const EXPECTED_LINK_COUNT = 8;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 667 };

// ── Dataset-driven fixtures (same rule as issue-5: ids only, never dates) ──
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
const CHEMISTRY = byId("chemistry");

if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");
if (BIOLOGY.exam!.date === CHEMISTRY.exam!.date)
  throw new Error("fixture drift: biology/chemistry now share a day");

/** "Monday, May 4, 2026" — must match src/lib/schedule.ts formatDateLabel. */
function dateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

// ── Shared locators / helpers ───────────────────────────────────────────────

const radiogroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "My schedules" });
const radios = (page: Page) => radiogroup(page).getByRole("radio");
const radio = (page: Page, name: string) =>
  radiogroup(page).getByRole("radio", { name });
const newScheduleButton = (page: Page) =>
  page.getByRole("button", { name: "New schedule" });
const collapseToggle = (page: Page) =>
  page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const dateGroup = (page: Page, iso: string) =>
  schedule(page)
    .locator("ol > li")
    .filter({ has: page.locator("h3", { hasText: dateLabel(iso) }) });
const catalogCard = (page: Page, name: string) =>
  page
    .locator('section[aria-label="Subject catalog"]')
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

/** Hydration-safe chip select (issue-5 pattern). */
async function selectSubject(page: Page, name: string) {
  const c = catalogCard(page, name);
  await expect(async () => {
    await c.click();
    await expect(c).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
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

/** Hydration-safe schedule switch: retry until aria-checked flips. */
async function switchSchedule(page: Page, name: string) {
  const r = radio(page, name);
  await expect(async () => {
    await r.click();
    await expect(r).toHaveAttribute("aria-checked", "true", { timeout: 1000 });
  }).toPass();
}

/** Seed a localStorage key before any app script runs. */
async function seedKey(page: Page, key: string, value: string) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, value] as const,
  );
}

const readKey = (page: Page, key: string) =>
  page.evaluate((k) => window.localStorage.getItem(k), key);

/** documentElement must not be wider than the viewport (1px rounding slack). */
async function expectNoHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `horizontal overflow at ${label}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

// ── AC1: desktop hierarchy + collapse toggle (remembered) ───────────────────

test("AC1 — desktop sidebar: branding → MY SCHEDULES → divider → RESOURCES; collapse toggle widens main, is announced, and is remembered", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Branding row: the app h1 lives in the sidebar.
  const aside = page.locator(SIDEBAR);
  await expect(
    aside.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
  ).toBeVisible();

  // Reference hierarchy, asserted by document order inside the sidebar.
  const order = await page.evaluate((sel) => {
    const aside = document.querySelector(sel)!;
    const h1 = aside.querySelector("h1")!;
    const schedules = document.getElementById("my-schedules-heading")!;
    const hr = aside.querySelector("hr")!;
    const resources = Array.from(aside.querySelectorAll("h2")).find(
      (el) =>
        el.textContent?.trim() === "Resources" &&
        getComputedStyle(el).display !== "none",
    )!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      brandingBeforeSchedules: before(h1, schedules),
      schedulesBeforeDivider: before(schedules, hr),
      dividerBeforeResources: before(hr, resources),
    };
  }, SIDEBAR);
  expect(order).toEqual({
    brandingBeforeSchedules: true,
    schedulesBeforeDivider: true,
    dividerBeforeResources: true,
  });

  // Visible MY SCHEDULES + RESOURCES headings and the divider between them.
  await expect(
    page.getByRole("heading", { level: 2, name: "My schedules" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Resources" }),
  ).toBeVisible();
  await expect(aside.locator("hr")).toBeVisible();

  // Collapse toggle: accessible, announced, widens the main content.
  const toggle = collapseToggle(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Collapse sidebar");
  const mainBefore = (await page.getByRole("main").boundingBox())!;

  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false", {
      timeout: 1000,
    });
  }).toPass();
  await expect(toggle).toHaveAccessibleName("Expand sidebar");
  await expect(page.locator("#sidebar-sections")).toBeHidden();
  const mainAfter = (await page.getByRole("main").boundingBox())!;
  expect(
    mainAfter.width,
    "collapsing the sidebar must widen the main content",
  ).toBeGreaterThan(mainBefore.width + 100);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/desktop-collapsed.png`,
    fullPage: true,
  });

  // Remembered client-side across reload (apx.sidebar.v1).
  expect(await readKey(page, SIDEBAR_KEY)).toBe("collapsed");
  await page.reload();
  await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#sidebar-sections")).toBeHidden();

  // And back: expand, reload, still expanded.
  await collapseToggle(page).click();
  await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(collapseToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("heading", { level: 2, name: "My schedules" }),
  ).toBeVisible();
});

// ── AC2: mobile keeps the disclosure pattern, now with schedule switching ──

test("AC2 — mobile: no persistent left column; My Schedules and Resources are disclosures and schedule switching works inside them", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");

  // Stacked layout: the sidebar card spans the viewport and the main planner
  // flows BELOW it — no persistent left column.
  const asideBox = (await page.locator(SIDEBAR).boundingBox())!;
  const mainBox = (await page.getByRole("main").boundingBox())!;
  expect(asideBox.width).toBeGreaterThan(300);
  expect(mainBox.y).toBeGreaterThan(asideBox.y + asideBox.height - 1);

  // The desktop collapse toggle does not exist here (builder's documented call).
  await expect(collapseToggle(page)).toBeHidden();

  // Both disclosures collapsed by default.
  const schedulesToggle = page.getByRole("button", { name: "My schedules" });
  const resourcesToggle = page.getByRole("button", { name: "Resources" });
  await expect(schedulesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(resourcesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(radiogroup(page)).toBeHidden();

  // Expand My Schedules → the switcher is fully operable on mobile.
  await expect(async () => {
    await schedulesToggle.click();
    await expect(schedulesToggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();
  await expect(radiogroup(page)).toBeVisible();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await createSchedule(page);
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await switchSchedule(page, "Schedule 1");

  await page.screenshot({
    path: `${EVIDENCE_DIR}/mobile-schedules-open.png`,
    fullPage: true,
  });

  // Resources disclosure still works (content unchanged from #23/#25).
  await expect(async () => {
    await resourcesToggle.click();
    await expect(resourcesToggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();
  await expect(page.locator(RESOURCE_LINKS)).toHaveCount(EXPECTED_LINK_COUNT);
});

// ── AC3: every resource link fits on one line, untruncated ─────────────────

for (const width of [1024, 1440, 1920]) {
  test(`AC3 — all ${EXPECTED_LINK_COUNT} resource labels render on one line, untruncated, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const links = page.locator(RESOURCE_LINKS);
    await expect(links).toHaveCount(EXPECTED_LINK_COUNT);

    for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
      const link = links.nth(i);
      const label = link.locator("span").first();
      const text = (await label.textContent())!.trim();
      // The label span is nowrap+ellipsis; overflow (scrollWidth > clientWidth)
      // is exactly "does not fit on one line".
      const fits = await label.evaluate(
        (el) => el.scrollWidth <= el.clientWidth,
      );
      expect(fits, `"${text}" truncated at ${width}px`).toBe(true);
      // The ↗ shares the line: anchor renders as a single-line inline-flex row.
      const box = (await link.boundingBox())!;
      expect(box.height, `"${text}" wrapped to two lines`).toBeLessThan(32);
    }
  });
}

test("AC3 — resource labels also fit on one line inside the 375px mobile disclosure", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  const resourcesToggle = page.getByRole("button", { name: "Resources" });
  await expect(async () => {
    await resourcesToggle.click();
    await expect(resourcesToggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();

  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
  for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
    const label = links.nth(i).locator("span").first();
    const text = (await label.textContent())!.trim();
    const fits = await label.evaluate(
      (el) => el.scrollWidth <= el.clientWidth,
    );
    expect(fits, `"${text}" truncated at 375px`).toBe(true);
  }
});

// ── AC4: parenthesis-free labels ────────────────────────────────────────────

test("AC4 — no resource link label contains parentheses", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
  for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
    // Label span only — the sr-only "(opens in a new tab)" hint is exempt.
    const text = (await links.nth(i).locator("span").first().textContent())!;
    expect(text, `label "${text}" contains parentheses`).not.toMatch(/[()]/);
  }
});

// ── AC5: hover underline excludes the trailing ↗ ────────────────────────────

for (const [name, viewport, reveal] of [
  ["desktop", DESKTOP, false],
  ["mobile disclosure", MOBILE, true],
] as const) {
  test(`AC5 — hovering a resource link underlines the label but never the ↗ (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    if (reveal) {
      const resourcesToggle = page.getByRole("button", { name: "Resources" });
      await expect(async () => {
        await resourcesToggle.click();
        await expect(resourcesToggle).toHaveAttribute(
          "aria-expanded",
          "true",
          { timeout: 1000 },
        );
      }).toPass();
    }

    const links = page.locator(RESOURCE_LINKS);
    await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
    const decoration = (el: Element) =>
      getComputedStyle(el).textDecorationLine;

    for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
      const link = links.nth(i);
      const label = link.locator("span").first();
      const arrow = link.locator("svg[aria-hidden='true']");
      const text = (await label.textContent())!.trim();

      // Before hover: nothing is underlined.
      expect(await label.evaluate(decoration)).not.toContain("underline");

      await link.hover();
      expect(
        await label.evaluate(decoration),
        `"${text}": label must underline on hover`,
      ).toContain("underline");
      expect(
        await arrow.evaluate(decoration),
        `"${text}": the ↗ must NOT underline on hover`,
      ).not.toContain("underline");
      // The anchor itself carries no underline either — text-decoration
      // propagates through inline boxes, so this is what would leak onto the ↗.
      expect(
        await link.evaluate(decoration),
        `"${text}": the anchor must not carry the underline`,
      ).not.toContain("underline");
    }
  });
}

// ── AC6: switching swaps the entire app immediately ────────────────────────

test("AC6 — switching schedules swaps chips, list, calendar, and ICS export immediately", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Build Schedule 1's plan via the UI: two non-conflicting subjects.
  await selectSubject(page, BIOLOGY.name);
  await selectSubject(page, CHEMISTRY.name);

  const exportButton = page.getByTestId("export-ics-button");
  await expect(exportButton).toBeEnabled();

  await pressViewChip(page, "List");
  await expect(schedule(page)).toContainText(BIOLOGY.name);
  await expect(schedule(page)).toContainText(CHEMISTRY.name);

  // Create Schedule 2 → empty and active: the WHOLE app follows.
  await createSchedule(page);
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    catalogCard(page, BIOLOGY.name),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    catalogCard(page, CHEMISTRY.name),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(schedule(page)).not.toContainText(BIOLOGY.name);
  await expect(exportButton).toBeDisabled(); // export follows the ACTIVE schedule

  // Calendar view reflects the empty active schedule…
  await pressViewChip(page, "Calendar");
  await expect(page.getByTestId("calendar-block")).toHaveCount(0);

  // …and switching back restores Schedule 1 everywhere.
  await switchSchedule(page, "Schedule 1");
  await expect(
    catalogCard(page, BIOLOGY.name),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("calendar-block")).not.toHaveCount(0);
  await expect(exportButton).toBeEnabled();

  // The ICS download contains Schedule 1's exams (client-side blob).
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  const { readFileSync } = await import("node:fs");
  const ics = readFileSync((await download.path())!, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain(BIOLOGY.name);
  expect(ics).toContain(CHEMISTRY.name);
});

// ── AC7: create / rename / delete with confirm; last-schedule guard ─────────

test("AC7 — + creates 'Schedule N'; inline rename; delete needs confirmation; the last schedule cannot be deleted", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Last-remaining guard, disabled from the start.
  await expect(radios(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Delete Schedule 1" }),
  ).toBeDisabled();

  // Create: auto-named "Schedule 2", empty, active.
  await createSchedule(page);
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("export-ics-button")).toBeDisabled();

  // Inline rename: field replaces the row; Enter commits.
  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  const field = page.getByRole("textbox", {
    name: "New name for Schedule 2",
  });
  await expect(field).toBeVisible();
  await field.fill("ambitious draft");
  await field.press("Enter");
  await expect(radio(page, "ambitious draft")).toBeVisible();
  await expect(radios(page)).toHaveCount(2);

  // Auto-name never collides after renames: next create is "Schedule 2" again
  // (highest existing "Schedule k" is 1).
  await createSchedule(page);
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(radios(page)).toHaveCount(3);

  // Delete needs a confirm step — Cancel keeps the schedule.
  await page.getByRole("button", { name: "Delete Schedule 2" }).click();
  const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/delete-dialog.png` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(radios(page)).toHaveCount(3);

  // Confirmed delete removes it. (`exact` — "Delete schedule" would otherwise
  // substring-match the per-row "Delete Schedule N" buttons.)
  const confirmDelete = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete schedule", exact: true })
      .click();
  await page.getByRole("button", { name: "Delete Schedule 2" }).click();
  await confirmDelete();
  await expect(radios(page)).toHaveCount(2);

  await page.getByRole("button", { name: "Delete ambitious draft" }).click();
  await confirmDelete();
  await expect(radios(page)).toHaveCount(1);

  // Guard again: the survivor cannot be deleted.
  await expect(
    page.getByRole("button", { name: "Delete Schedule 1" }),
  ).toBeDisabled();
});

// ── AC8: per-schedule resolutions — zero leakage between schedules ─────────

test("AC8 — two schedules hold OPPOSITE resolutions of the same collision without leaking; legacy mirror follows the active schedule", async ({
  page,
}) => {
  // Seed the multi-schedule store directly: S1 has the biology/latin collision
  // RESOLVED (keep Biology → Latin moves late); S2 has the same selection
  // UNRESOLVED.
  const slot = { date: BIOLOGY.exam!.date, session: BIOLOGY.exam!.session };
  await seedKey(
    page,
    SCHEDULES_KEY,
    JSON.stringify({
      activeId: "sched-1",
      schedules: [
        {
          id: "sched-1",
          name: "Schedule 1",
          selection: [BIOLOGY.id, LATIN.id],
          resolutions: [
            {
              ...slot,
              keeperId: BIOLOGY.id,
              memberIds: [BIOLOGY.id, LATIN.id],
            },
          ],
        },
        {
          id: "sched-2",
          name: "Schedule 2",
          selection: [BIOLOGY.id, LATIN.id],
          resolutions: [],
        },
      ],
    }),
  );
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await pressViewChip(page, "List");

  // S1 (active): resolved — no prompt; Latin sits at its late-testing slot.
  await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
  await expect(dateGroup(page, LATIN.lateTesting!.date)).toContainText(
    LATIN.name,
  );
  await expect(dateGroup(page, BIOLOGY.exam!.date)).toContainText(
    BIOLOGY.name,
  );

  // Switch to S2: same collision, no stored resolution → it re-prompts.
  // S1's resolution did NOT leak in.
  await switchSchedule(page, "Schedule 2");
  await expect(page.getByTestId("conflict-prompt").first()).toBeVisible();

  // Resolve S2 the OPPOSITE way: keep Latin → Biology moves late.
  await page
    .getByTestId("conflict-prompt")
    .first()
    .getByRole("button", { name: `Keep ${LATIN.name} at the regular time` })
    .first()
    .click();
  await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
  await expect(dateGroup(page, BIOLOGY.lateTesting!.date)).toContainText(
    BIOLOGY.name,
  );
  await expect(dateGroup(page, LATIN.exam!.date)).toContainText(LATIN.name);

  // Legacy mirror describes the ACTIVE schedule (S2: keeper = Latin).
  const mirrorS2 = JSON.parse((await readKey(page, RESOLUTIONS_KEY))!);
  expect(mirrorS2).toHaveLength(1);
  expect(mirrorS2[0].keeperId).toBe(LATIN.id);

  // Back to S1: its own resolution is intact — S2's opposite choice did not
  // leak. Latin late, Biology regular, still no prompt.
  await switchSchedule(page, "Schedule 1");
  await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
  await expect(dateGroup(page, LATIN.lateTesting!.date)).toContainText(
    LATIN.name,
  );
  await expect(dateGroup(page, BIOLOGY.exam!.date)).toContainText(
    BIOLOGY.name,
  );
  const mirrorS1 = JSON.parse((await readKey(page, RESOLUTIONS_KEY))!);
  expect(mirrorS1[0].keeperId).toBe(BIOLOGY.id);
});

// ── AC9: client-side persistence, no account, no cookies ───────────────────

test("AC9 — schedules persist across reload in versioned localStorage with zero cookies", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  await selectSubject(page, BIOLOGY.name);
  await createSchedule(page);
  await page.getByRole("button", { name: "Rename Schedule 2" }).click();
  const field = page.getByRole("textbox", { name: "New name for Schedule 2" });
  await field.fill("ambitious draft");
  await field.press("Enter");
  await expect(radio(page, "ambitious draft")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // The versioned key exists and no cookie was written (no-account contract).
  const stored = JSON.parse((await readKey(page, SCHEDULES_KEY))!);
  expect(stored.schedules).toHaveLength(2);
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await page.reload();

  // Everything survived: both schedules, the rename, the active choice, and
  // Schedule 1's selection (visible again after switching back).
  await expect(radios(page)).toHaveCount(2);
  await expect(radio(page, "ambitious draft")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(catalogCard(page, BIOLOGY.name)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await switchSchedule(page, "Schedule 1");
  await expect(catalogCard(page, BIOLOGY.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

// ── AC10: migration of a pre-#29 visitor ────────────────────────────────────

test("AC10 — legacy apx.selection.v1 + apx.resolutions.v1 are adopted as 'Schedule 1' with nothing lost", async ({
  page,
}) => {
  // A pre-#29 visitor: legacy keys only, NO apx.schedules.v1.
  await seedKey(
    page,
    SELECTION_KEY,
    JSON.stringify([BIOLOGY.id, LATIN.id]),
  );
  await seedKey(
    page,
    RESOLUTIONS_KEY,
    JSON.stringify([
      {
        date: BIOLOGY.exam!.date,
        session: BIOLOGY.exam!.session,
        keeperId: BIOLOGY.id,
        memberIds: [BIOLOGY.id, LATIN.id],
      },
    ]),
  );
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  // Exactly one schedule, the default name, active.
  await expect(radios(page)).toHaveCount(1);
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // The selection migrated (chips reflect it)…
  await expect(catalogCard(page, BIOLOGY.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(catalogCard(page, LATIN.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // …and the RESOLUTION migrated too: no re-prompt, Latin at its late slot.
  await pressViewChip(page, "List");
  await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
  await expect(dateGroup(page, LATIN.lateTesting!.date)).toContainText(
    LATIN.name,
  );

  // The store adopted it under the new versioned key.
  const stored = JSON.parse((await readKey(page, SCHEDULES_KEY))!);
  expect(stored.schedules).toHaveLength(1);
  expect(stored.schedules[0].name).toBe("Schedule 1");
  expect(stored.schedules[0].selection).toEqual(
    expect.arrayContaining([BIOLOGY.id, LATIN.id]),
  );
  expect(stored.schedules[0].resolutions).toHaveLength(1);
});

// ── AC11: cross-tab consistency via the storage event ──────────────────────

test("AC11 — creating and switching schedules in one tab is reflected in another tab", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(radios(page)).toHaveCount(1);

  // Same context = same localStorage + storage events (deliberate here).
  const other = await page.context().newPage();
  await other.setViewportSize(DESKTOP);
  await other.goto("/");
  await expect(radios(other)).toHaveCount(1);

  // Create in tab A → appears (and becomes active) in tab B.
  await createSchedule(page);
  await expect(radios(other)).toHaveCount(2);
  await expect(radio(other, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Switch back in tab B → tab A follows.
  await switchSchedule(other, "Schedule 1");
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await other.close();
});

// ── AC12: keyboard + focus management ───────────────────────────────────────

test("AC12 — radiogroup roving tabindex + arrow keys; rename and delete manage focus; collapse toggle is keyboard-operable", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await createSchedule(page); // "Schedule 2", active

  // Roving tabindex: active radio is the single tab stop.
  await expect(radio(page, "Schedule 2")).toHaveAttribute("tabindex", "0");
  await expect(radio(page, "Schedule 1")).toHaveAttribute("tabindex", "-1");

  // Arrow keys move focus AND select (WAI-ARIA radio-group pattern).
  await radio(page, "Schedule 2").focus();
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, "Schedule 1")).toBeFocused();
  await expect(radio(page, "Schedule 1")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("End");
  await expect(radio(page, "Schedule 2")).toBeFocused();
  await expect(radio(page, "Schedule 2")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Inline rename: field autofocuses; Escape cancels and restores focus to
  // the Rename button; the name is unchanged.
  const renameButton = page.getByRole("button", { name: "Rename Schedule 2" });
  await renameButton.click();
  const field = page.getByRole("textbox", { name: "New name for Schedule 2" });
  await expect(field).toBeFocused();
  await field.press("Escape");
  await expect(renameButton).toBeFocused();
  await expect(radio(page, "Schedule 2")).toBeVisible();

  // Delete dialog: focus moves in, stays trapped, Escape restores it.
  const deleteButton = page.getByRole("button", { name: "Delete Schedule 2" });
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: /Delete .Schedule 2./ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  // Tab around the trap: focus never leaves the dialog.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    const inside = await dialog.evaluate((el) =>
      el.contains(document.activeElement),
    );
    expect(inside, `focus escaped the delete dialog on Tab #${i + 1}`).toBe(
      true,
    );
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();

  // Collapse toggle: keyboard-operable, state announced via aria-expanded.
  const toggle = collapseToggle(page);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

// ── AC13: no horizontal scroll + standard evidence screenshots ──────────────

const EVIDENCE_VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080, screenshot: "desktop.png" },
  { name: "tablet", width: 1024, height: 768, screenshot: "tablet.png" },
  { name: "mobile", width: 375, height: 667, screenshot: "mobile.png" },
  { name: "laptop", width: 1440, height: 900, screenshot: null },
] as const;

for (const vp of EVIDENCE_VIEWPORTS) {
  test(`AC13 — no horizontal scroll at ${vp.width}px (${vp.name}); evidence screenshot`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, `${vp.width}px expanded`);

    if (vp.screenshot) {
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.screenshot}`,
        fullPage: true,
      });
    }

    // Collapsed state must not overflow either (desktop widths only).
    if (vp.width >= 1024) {
      const toggle = collapseToggle(page);
      await expect(async () => {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false", {
          timeout: 1000,
        });
      }).toPass();
      await expectNoHorizontalScroll(page, `${vp.width}px collapsed`);
    }
  });
}
