import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import {
  LATE_TESTING_WINDOW,
  REGULAR_WINDOWS,
} from "../src/data/schema";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #19) — week-paged calendar grid view for selected
 * exams (v3 design after the SECOND human bounce: the week pager stays; block
 * heights are duration-proportional — published `format.totalMinutes` from
 * the session start plus a visually distinct 30-minute setup buffer; the
 * "My Schedule" header + Export button live above the switcher on BOTH views;
 * the switcher chips read "List"/"Calendar"; the CALENDAR is the default
 * view; and blocks are interactive — details popup, conflict-dialog-first for
 * conflicted events, switch-back/swap for moved-to-late events).
 *
 * One observable, browser-level test per acceptance criterion, plus pager
 * coverage (week 1 → next → late-testing week, indicator text, a11y
 * semantics, default page), bounce-item coverage (A/B/C above), and
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots land in the run
 * evidence folder and are committed to the issue branch so they render inline
 * on the issue / PR.
 *
 * Dataset-driven fixtures (asserted from the shipped JSON, never hardcoded
 * beyond ids):
 *   - AP Biology        STEM        2026-05-04 AM → late 2026-05-20 PM
 *   - AP Latin          Languages   2026-05-04 AM (collides with Biology)
 *   - AP Chemistry      STEM        2026-05-05 AM (same category as Biology)
 *   - AP European History Humanities 2026-05-04 PM, 195 min (axis-extension)
 *   - AP Spanish Literature and Culture  Languages  2026-05-13 PM (conflict-free)
 *   - AP Seminar        Humanities  2026-05-11 PM + portfolio 2026-04-30
 *   - AP Drawing        Arts        portfolio-only, deadline 2026-05-08
 *   - AP Cybersecurity  Career Kickstart — no exam, no portfolio (undated)
 *
 * Fixture rule: tests that seed selections via localStorage use CONFLICT-FREE
 * sets unless the test targets the conflict path itself. On the CALENDAR view
 * an unresolved conflict does NOT auto-open a modal (the documented v3
 * choice: the calendar surfaces issue #5's dialog when a conflicted event is
 * interacted with — bounce item C8); on the LIST view the issue-#5
 * modal-on-mount behavior is unchanged.
 */

// Env-overridable so a re-verification pass writes a fresh evidence set
// instead of rewriting a prior run's committed screenshots.
const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR ?? "docs/super-board/runs/issue-19-qa-v3";

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
  portfolio: { deadline: string } | null;
  format: { totalMinutes: number | "pending" };
};

const DATASET = apData as {
  cycle: string;
  sessionStartTimes: { AM: string; PM: string };
  subjects: Subject[];
};
const byId = (id: string): Subject => {
  const s = DATASET.subjects.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};

const BIOLOGY = byId("biology");
const LATIN = byId("latin");
const CHEMISTRY = byId("chemistry");
const EURO_HISTORY = byId("european-history");
const SPANISH_LIT = byId("spanish-literature-and-culture");
const SEMINAR = byId("seminar");
const DRAWING = byId("drawing");
const CYBER = byId("cybersecurity");

// Guard the fixture assumptions against dataset edits — if these ever fail,
// the spec's scenario (not the app) needs re-picking.
if (
  BIOLOGY.exam!.date !== LATIN.exam!.date ||
  BIOLOGY.exam!.session !== LATIN.exam!.session
)
  throw new Error("fixture drift: biology/latin no longer share a slot");
if (BIOLOGY.lateTesting!.date !== "2026-05-20")
  throw new Error("fixture drift: biology late-testing date moved");
if (BIOLOGY.category !== CHEMISTRY.category)
  throw new Error("fixture drift: biology/chemistry categories differ");
if (CYBER.exam !== null || CYBER.portfolio !== null)
  throw new Error("fixture drift: cybersecurity now has a dated entry");
if (REGULAR_WINDOWS.length + 1 < 3)
  throw new Error(
    "fixture drift: fewer than 3 testing weeks — pager tests assume week 3 exists",
  );
{
  // The seeded (non-conflict) sets must stay conflict-free — see fixture rule.
  const slots = [BIOLOGY, CHEMISTRY, SPANISH_LIT, SEMINAR].map(
    (s) => `${s.exam!.date}:${s.exam!.session}`,
  );
  if (new Set(slots).size !== slots.length)
    throw new Error("fixture drift: seeded subjects now share a slot");
  if (SPANISH_LIT.category !== "Languages")
    throw new Error("fixture drift: spanish-literature category changed");
}
// Duration fixtures (bounce item A): the length assertions need PUBLISHED
// numeric lengths, two of them different; the axis-extension check needs a
// PM exam long enough that exam + buffer passes 4 PM (>= 181 min from 12:00).
for (const s of [BIOLOGY, CHEMISTRY, LATIN, EURO_HISTORY]) {
  if (typeof s.format.totalMinutes !== "number" || s.format.totalMinutes <= 0)
    throw new Error(`fixture drift: ${s.id} no longer publishes totalMinutes`);
}
if (BIOLOGY.format.totalMinutes === CHEMISTRY.format.totalMinutes)
  throw new Error(
    "fixture drift: biology/chemistry lengths equal — proportionality check needs two different lengths",
  );
if (
  EURO_HISTORY.exam!.session !== "PM" ||
  (EURO_HISTORY.format.totalMinutes as number) < 181
)
  throw new Error(
    "fixture drift: european-history no longer a >3h PM exam — re-pick the axis-extension fixture",
  );
if (!LATIN.lateTesting)
  throw new Error("fixture drift: latin lost its late-testing slot");

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

const switcher = (page: Page) =>
  page.getByRole("group", { name: "Schedule view" });
const listChip = (page: Page) =>
  switcher(page).getByRole("button", { name: "List" });
const calendarChip = (page: Page) =>
  switcher(page).getByRole("button", { name: "Calendar" });
const calendarView = (page: Page) => page.getByTestId("calendar-view");
const scheduleHeading = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "My Schedule" });
const exportButton = (page: Page) => page.getByTestId("export-ics-button");
const weekSections = (page: Page) =>
  calendarView(page).locator(
    'section[aria-label^="Week of"], section[aria-label^="Late-testing week"]',
  );
const blocks = (page: Page) => page.getByTestId("calendar-block");
const blockFor = (page: Page, subjectId: string) =>
  page.locator(
    `[data-testid="calendar-block"][data-subject-id="${subjectId}"]`,
  );
const offGrid = (page: Page) => page.getByTestId("calendar-off-grid");

// Pager (v2 design): Previous/Next buttons + aria-live position indicator.
// Accessible names start with "Previous week" / "Next week"; when other weeks
// hold exams the name carries a count suffix, so match by prefix.
const pager = (page: Page) => page.getByTestId("calendar-pager");
const prevButton = (page: Page) =>
  pager(page).getByRole("button", { name: /^Previous week/ });
const nextButton = (page: Page) =>
  pager(page).getByRole("button", { name: /^Next week/ });
const indicator = (page: Page) =>
  page.getByTestId("calendar-week-indicator");

/** Page forward until the indicator reads "Week <n> of ...". */
async function gotoWeek(page: Page, n: number) {
  for (let guard = 0; guard < 10; guard += 1) {
    const text = (await indicator(page).textContent()) ?? "";
    const match = /Week (\d+) of/.exec(text);
    if (!match) throw new Error(`no week indicator found: "${text}"`);
    const current = Number(match[1]);
    if (current === n) return;
    if (current < n) await nextButton(page).click();
    else await prevButton(page).click();
  }
  throw new Error(`could not reach week ${n}`);
}

// Schema-derived week fixtures (never hardcoded): regular windows in order,
// then the late-testing window — mirrors `calendarWeeks()`.
const WINDOWS = [
  ...REGULAR_WINDOWS.map((w) => ({ ...w, late: false })),
  { ...LATE_TESTING_WINDOW, late: true },
];
const WEEK_COUNT = WINDOWS.length;

/** Every ISO date from start to end inclusive (UTC math, no DST drift). */
function datesOf(w: { start: string; end: string }): string[] {
  const out: string[] = [];
  for (
    let ms = Date.parse(`${w.start}T00:00:00Z`);
    ms <= Date.parse(`${w.end}T00:00:00Z`);
    ms += 86_400_000
  )
    out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

/** "MON" / "May 4" labels for a floating ISO date (mirrors the app's labels). */
function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" })
    .format(new Date(y, m - 1, d))
    .toUpperCase();
}
function monthDayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
}
function rangeOf(w: { start: string; end: string }): string {
  return `${monthDayOf(w.start)} – ${monthDayOf(w.end)}`;
}

/** 0-based index of the window containing an ISO date, or -1. */
function weekIndexOf(iso: string): number {
  return WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);
}

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

async function select(page: Page, name: string) {
  const c = card(page, name);
  await c.scrollIntoViewIfNeeded();
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

/** Seed the selection store before any app script runs (persisted-load path). */
async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

/** Seed conflict resolutions (issue #5 store) before any app script runs. */
async function seedResolutions(
  page: Page,
  resolutions: Array<{
    date: string;
    session: "AM" | "PM";
    keeperId: string;
    memberIds: string[];
  }>,
) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RESOLUTIONS_KEY, JSON.stringify(resolutions)] as const,
  );
}

/**
 * The calendar is the DEFAULT view (bounce item B6); the press is a state
 * no-op when the chip is already active, and hydration-safe otherwise
 * (see e2e/support/view-chip.ts).
 */
async function openCalendar(page: Page) {
  await pressViewChip(page, "Calendar");
  await expect(calendarView(page)).toBeVisible();
  // Navigate to the section the way a user does: since the calendar is now
  // the default (no chip click to auto-scroll) and the #25 resources layout
  // keeps the catalog above it, bring the view on-screen before assertions
  // that check what is visible within the viewport.
  await calendarView(page).scrollIntoViewIfNeeded();
}

/** Hydration-safe switch to the list view (see e2e/support/view-chip.ts). */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(
    page.locator('section[aria-label="My schedule"]'),
  ).toBeVisible();
}

// ---- Clock-label helpers (mirror src/lib/calendar.ts, dataset-driven) ------

/** Parse "8 a.m. local time" / "12 p.m. local time" into fractional hours. */
function parseHourOf(label: string): number {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i.exec(label);
  if (!m) throw new Error(`unparseable session label: "${label}"`);
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hour += 12;
  return hour + (m[2] ? Number(m[2]) : 0) / 60;
}

/** "8:00 AM" / "11:15 AM" for a fractional hour. */
function clockOf(hour: number): string {
  const total = Math.round(hour * 60);
  const h24 = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

const startHourOf = (s: Subject) =>
  parseHourOf(DATASET.sessionStartTimes[s.exam!.session]);
const startClockOf = (s: Subject) => clockOf(startHourOf(s));
const endClockOf = (s: Subject) =>
  clockOf(startHourOf(s) + (s.format.totalMinutes as number) / 60);

// ---------------------------------------------------------------------------
// AC1 (v3) — view switcher: keyboard-operable, obvious selected state,
//       CALENDAR is the default view (bounce item B6), chips read
//       "List"/"Calendar" (B5), the shared "My Schedule" header + Export
//       button sit ABOVE the switcher and are present on BOTH views (B4/B5).
// ---------------------------------------------------------------------------

test("AC1 — calendar is the default; List/Calendar chips toggle by keyboard under a shared header", async ({
  page,
}) => {
  // Reduced-motion-safe (issue #8 a11y bar): the switcher must work
  // identically with animations disabled.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  // Default = CALENDAR view: Calendar pressed, list not mounted.
  await expect(calendarChip(page)).toHaveAttribute("aria-pressed", "true");
  await expect(listChip(page)).toHaveAttribute("aria-pressed", "false");
  await expect(calendarView(page)).toBeVisible();
  await expect(page.locator('section[aria-label="My schedule"]')).toHaveCount(
    0,
  );

  // Shared header on the calendar view: "My Schedule" heading + Export button
  // both visible (B4/B5), with the switcher BELOW the heading (B5).
  await expect(scheduleHeading(page)).toBeVisible();
  await expect(exportButton(page)).toBeVisible();
  const [headingBox, switcherBox] = await Promise.all([
    scheduleHeading(page).boundingBox(),
    switcher(page).boundingBox(),
  ]);
  expect(headingBox && switcherBox).toBeTruthy();
  expect(
    switcherBox!.y,
    "the view switcher must sit below the My Schedule header",
  ).toBeGreaterThan(headingBox!.y + headingBox!.height - 1);

  // Obvious selected state: the pressed chip paints a different background
  // than the unpressed one (blue-600 vs white), not just an ARIA flag.
  const bg = (locator: ReturnType<typeof listChip>) =>
    locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(calendarChip(page))).not.toBe(await bg(listChip(page)));

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac1-switcher-calendar-default-desktop.png`,
  });

  // Keyboard: focus the List chip and activate with Enter → list view, with
  // the SAME header (heading + Export) still visible above the switcher.
  await listChip(page).focus();
  await page.keyboard.press("Enter");
  await expect(listChip(page)).toHaveAttribute("aria-pressed", "true");
  await expect(calendarChip(page)).toHaveAttribute("aria-pressed", "false");
  await expect(calendarView(page)).toHaveCount(0);
  await expect(
    page.locator('section[aria-label="My schedule"]'),
  ).toBeVisible();
  await expect(scheduleHeading(page)).toBeVisible();
  await expect(exportButton(page)).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac1-switcher-list-active-desktop.png`,
  });

  // Space toggles back to the calendar view.
  await calendarChip(page).focus();
  await page.keyboard.press("Space");
  await expect(calendarChip(page)).toHaveAttribute("aria-pressed", "true");
  await expect(calendarView(page)).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC2 (v2) — time-grid pages ONE week at a time: hourly axis, dated day
//       headers, every published window reachable via the Previous/Next
//       pager (which replaces month scrolling), ends disabled (no wrap).
// ---------------------------------------------------------------------------

test("AC2 — pager walks every published week one grid at a time with dated headers and an hourly axis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, SEMINAR.id]);
  await page.goto("/");
  await openCalendar(page);

  // Biology sits in the first window, so the default page is week 1: the
  // Previous button is disabled at the start end (documented no-wrap choice).
  await expect(indicator(page)).toContainText(`Week 1 of ${WEEK_COUNT}`);
  await expect(prevButton(page)).toBeDisabled();
  await expect(nextButton(page)).toBeEnabled();

  // Walk forward through EVERY published window — regular weeks in order,
  // then the late-testing week — asserting exactly one week grid at a time.
  for (const [index, window] of WINDOWS.entries()) {
    if (index > 0) await nextButton(page).click();

    // Indicator: schema-derived range + position ("May 4 – May 8 · Week 1 of 3").
    await expect(indicator(page)).toContainText(rangeOf(window));
    await expect(indicator(page)).toContainText(
      `Week ${index + 1} of ${WEEK_COUNT}`,
    );

    // Exactly ONE week section mounted — the month never stacks vertically.
    await expect(weekSections(page)).toHaveCount(1);
    const section = weekSections(page).first();
    await expect(section).toBeInViewport();

    // The late-testing week is visibly badged; regular weeks are not.
    await expect(
      indicator(page).getByText("Late testing", { exact: true }),
    ).toHaveCount(window.late ? 1 : 0);

    // Every day of the window renders a dated column header ("MON · May 4").
    const days = datesOf(window);
    for (const iso of days) {
      const header = section
        .locator("p")
        .filter({ hasText: weekdayOf(iso) })
        .filter({ hasText: monthDayOf(iso) });
      await expect(header).toHaveCount(1);
    }
    const headerCells = section
      .locator("p")
      .filter({ hasText: /^(MON|TUE|WED|THU|FRI|SAT|SUN)\s*·/ });
    await expect(headerCells).toHaveCount(days.length);

    // Hourly axis on every page: both dataset session anchors are labeled
    // (8 AM / 12 PM per the shipped sessionStartTimes) plus a later tick
    // proving the axis is hour-by-hour, not a two-band AM/PM strip.
    await expect(section.getByText("8 AM", { exact: true })).toBeVisible();
    await expect(section.getByText("12 PM", { exact: true })).toBeVisible();
    await expect(section.getByText("2 PM", { exact: true })).toBeVisible();

    if (index === 0) {
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac2-week1-grid-desktop.png`,
        fullPage: true,
      });
    }
  }

  // Far end: Next is disabled on the last (late-testing) week — no wrap.
  await expect(nextButton(page)).toBeDisabled();
  await expect(prevButton(page)).toBeEnabled();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac2-late-week-grid-desktop.png`,
    fullPage: true,
  });

  // And back: Previous returns to week 1 where Previous disables again.
  await gotoWeek(page, 1);
  await expect(indicator(page)).toContainText(`Week 1 of ${WEEK_COUNT}`);
  await expect(prevButton(page)).toBeDisabled();
});

// ---------------------------------------------------------------------------
// AC3 — blocks read through the conflict-resolution layer: a moved exam
//       renders at its effective late-testing slot, matching the list view.
// ---------------------------------------------------------------------------

test("AC3 — resolved conflict places the moved exam at its late-testing slot in both views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  // Drive the real resolution flow in the LIST view (where issue #5's
  // modal-on-collision behavior lives; the calendar-native path is covered by
  // the Bounce C tests below): Biology and Latin share 2026-05-04 AM; keeping
  // Latin moves Biology to its official late slot (2026-05-20 PM).
  await openList(page);
  await select(page, BIOLOGY.name);
  await select(page, LATIN.name);
  const prompt = page.getByTestId("conflict-prompt");
  await expect(prompt).toBeVisible();

  // UNRESOLVED state first: dismiss the modal (Escape, per issue #5) and
  // check the calendar renders the still-conflicting exams side by side in
  // the one real slot they share — no position invented for either.
  await page.keyboard.press("Escape");
  await openCalendar(page);
  const may4Exams = calendarView(page).locator(
    'ul[aria-label*="May 4"] [data-testid="calendar-block"]',
  );
  await expect(may4Exams).toHaveCount(2);
  const [bioBox, latinBox] = await Promise.all([
    blockFor(page, BIOLOGY.id).boundingBox(),
    blockFor(page, LATIN.id).boundingBox(),
  ]);
  expect(bioBox && latinBox).toBeTruthy();
  // Same start time → same top edge; lane-split → non-overlapping x ranges.
  expect(Math.abs(bioBox!.y - latinBox!.y)).toBeLessThanOrEqual(1);
  const [left, right] = [bioBox!, latinBox!].sort((a, b) => a.x - b.x);
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac3-unresolved-lane-split-desktop.png`,
  });

  // Now resolve: back to the list view, keep Latin at the regular time.
  // (Hydration-safe press: nothing before this point proves the handlers
  // are attached — the block reads above are passive.)
  await pressViewChip(page, "List");
  await expect(prompt.first()).toBeVisible();
  await prompt
    .getByRole("button", { name: `Keep ${LATIN.name} at the regular time` })
    .first()
    .click();

  // List view truth: Biology now sits under the late date's group.
  const listSection = page.locator('section[aria-label="My schedule"]');
  await expect(
    listSection
      .locator("ol > li")
      .filter({ hasText: "May 20" })
      .filter({ hasText: BIOLOGY.name }),
  ).toHaveCount(1);

  await openCalendar(page);

  // Reopening the calendar re-derives the default page: Latin (the keeper)
  // is now the earliest placed exam, so the view opens on week 1 with Latin
  // at its regular AM slot — and Biology's block is NOT on this page. The
  // block label carries the true exam span (start – published end).
  await expect(indicator(page)).toContainText(`Week 1 of ${WEEK_COUNT}`);
  const latinBlock = blockFor(page, LATIN.id);
  await expect(latinBlock).toHaveCount(1);
  await expect(latinBlock).toContainText(startClockOf(LATIN));
  await expect(latinBlock).toContainText(endClockOf(LATIN));
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(0);

  // Page to the late-testing week (the pager, not scrolling, reaches it).
  await gotoWeek(page, WEEK_COUNT);
  const lateSection = calendarView(page).locator(
    'section[aria-label^="Late-testing week"]',
  );
  await expect(lateSection).toBeVisible();

  // Calendar truth: exactly one Biology block, inside the late-testing week,
  // in the May 20 column, at the PM session start read from the dataset.
  const bioBlock = blockFor(page, BIOLOGY.id);
  await expect(bioBlock).toHaveCount(1);
  await expect(lateSection.getByTestId("calendar-block")).toHaveCount(1);
  await expect(bioBlock).toContainText(BIOLOGY.name);
  // Late slot is a PM session: the block anchors at the PM start read from
  // the dataset, spanning Biology's published length from there.
  await expect(bioBlock).toContainText(
    clockOf(parseHourOf(DATASET.sessionStartTimes.PM)),
  );
  await expect(bioBlock).toContainText("Moved to late testing");
  // ...and inside the May 20 day column specifically.
  const may20Exams = lateSection.locator(
    'ul[aria-label*="May 20"] [data-testid="calendar-block"]',
  );
  await expect(may20Exams).toHaveCount(1);
  // Latin stayed behind on week 1 — one week mounted at a time.
  await expect(blockFor(page, LATIN.id)).toHaveCount(0);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac3-moved-to-late-desktop.png`,
  });
});

// ---------------------------------------------------------------------------
// AC4 — blocks are color-coded by category and show name + start time.
// ---------------------------------------------------------------------------

test("AC4 — blocks are category-colored with a legend, showing subject name and start time", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [
    BIOLOGY.id, // STEM
    CHEMISTRY.id, // STEM — same category, must share Biology's color
    SPANISH_LIT.id, // Languages
    SEMINAR.id, // Humanities
  ]);
  await page.goto("/");
  await openCalendar(page);

  // The fixtures span two testing weeks; the view shows one week at a time,
  // so visit each subject's week via the pager and collect its rendered
  // background along the way (computed styles, not class names).
  const fixtures = [BIOLOGY, CHEMISTRY, SPANISH_LIT, SEMINAR];
  const bgBySubject = new Map<string, string>();
  for (const s of fixtures) {
    await gotoWeek(page, weekIndexOf(s.exam!.date) + 1);
    const b = blockFor(page, s.id);
    await expect(b).toHaveCount(1);
    // Every block shows its subject name + its session start time (v3: the
    // clock-format span label, e.g. "8:00 AM – 11:00 AM").
    await expect(b).toContainText(s.name);
    await expect(b).toContainText(startClockOf(s));
    // The category color paints the block's interactive button (v3: the
    // whole block is a real <button>), so measure the computed style there.
    bgBySubject.set(
      s.id,
      await b
        .locator("button")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    );
  }

  // Color-coded by category: same category → same background, different
  // category → different background — consistent across pager pages.
  const bg = (id: string) => bgBySubject.get(id)!;
  expect(bg(CHEMISTRY.id)).toBe(bg(BIOLOGY.id)); // STEM = STEM
  expect(bg(SPANISH_LIT.id)).not.toBe(bg(BIOLOGY.id)); // Languages ≠ STEM
  expect(bg(SEMINAR.id)).not.toBe(bg(BIOLOGY.id)); // Humanities ≠ STEM
  expect(bg(SEMINAR.id)).not.toBe(bg(SPANISH_LIT.id));

  // Pager nice-to-have (bounce item 5): with two exams in a later week, the
  // Next button carries an exam-count badge, folded into its accessible name.
  await gotoWeek(page, 1);
  await expect(nextButton(page)).toHaveAccessibleName(
    "Next week (2 exams in later weeks)",
  );
  await expect(prevButton(page)).toHaveAccessibleName("Previous week");

  // Legend lists exactly the categories in use.
  const legend = page.getByRole("list", { name: "Category color legend" });
  await expect(legend.getByText("STEM")).toBeVisible();
  await expect(legend.getByText("Languages")).toBeVisible();
  await expect(legend.getByText("Humanities")).toBeVisible();
  await expect(legend.locator("li")).toHaveCount(3);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac4-category-colors-desktop.png`,
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// AC5 — portfolio deadlines and undated subjects are LISTED beside the grid,
//       never positioned at an invented time (PRD §7.5).
// ---------------------------------------------------------------------------

test("AC5 — portfolio deadlines and undated subjects land in the off-grid list, never on the grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [SEMINAR.id, DRAWING.id, CYBER.id]);
  await page.goto("/");
  await openCalendar(page);

  // Default page (bounce item 5): Seminar's exam is the only placed block and
  // sits in the second window, so the calendar opens directly on that week —
  // off-grid-only subjects (Drawing/Cyber) never influence the default.
  await expect(indicator(page)).toContainText(
    `Week ${weekIndexOf(SEMINAR.exam!.date) + 1} of ${WEEK_COUNT}`,
  );

  const section = offGrid(page);
  await expect(section).toBeVisible();
  await expect(
    section.getByRole("heading", { name: "Not placed on the grid" }),
  ).toBeVisible();

  // Drawing: portfolio-only → listed with its deadline, no grid block.
  await expect(
    section.locator("li").filter({ hasText: DRAWING.name }),
  ).toContainText("Portfolio due");
  await expect(
    section.locator("li").filter({ hasText: DRAWING.name }),
  ).toContainText("May 8, 2026");
  await expect(blockFor(page, DRAWING.id)).toHaveCount(0);

  // Seminar: its exam IS on the grid, but its portfolio deadline (a date
  // with no clock time) is listed, not positioned.
  await expect(blockFor(page, SEMINAR.id)).toHaveCount(1);
  await expect(
    section.locator("li").filter({ hasText: SEMINAR.name }),
  ).toContainText("Portfolio due");

  // Cybersecurity: no May 2026 exam at all → listed as undated, no block.
  await expect(
    section.locator("li").filter({ hasText: CYBER.name }),
  ).toContainText(`No ${DATASET.cycle} exam date`);
  await expect(blockFor(page, CYBER.id)).toHaveCount(0);

  // Exactly one block total (Seminar's exam) — nothing was guessed onto
  // the grid for the timeless/undated entries.
  await expect(blocks(page)).toHaveCount(1);

  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac5-offgrid-list-desktop.png`,
  });
});

// ---------------------------------------------------------------------------
// AC6 — zero selections shows an empty-state hint, not a blank grid.
// ---------------------------------------------------------------------------

test("AC6 — empty selection renders a hint instead of a blank grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await openCalendar(page);

  await expect(
    calendarView(page).getByText(
      "Select subjects above to build your calendar",
    ),
  ).toBeVisible();
  await expect(weekSections(page)).toHaveCount(0);
  await expect(blocks(page)).toHaveCount(0);
  // The pager only exists alongside the grid — the empty state replaces both.
  await expect(pager(page)).toHaveCount(0);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/ac6-empty-state-desktop.png`,
  });
});

// ---------------------------------------------------------------------------
// AC7 — banner states the cycle, read from dataset metadata.
// ---------------------------------------------------------------------------

test("AC7 — banner names the dataset cycle on both views", async ({ page }) => {
  await page.goto("/");
  await openCalendar(page);

  // Asserted against the JSON the app ships — if the dataset cycle changes,
  // this expectation changes with it (nothing hardcoded to "May 2026").
  // v3: the banner lives in the shared "My Schedule" header, so it is
  // visible on the calendar view AND the list view.
  const banner = page.getByText(
    `Dates reflect the ${DATASET.cycle} AP exam cycle.`,
  );
  await expect(banner).toBeVisible();
  await openList(page);
  await expect(banner).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC8 — usable at 375 / 1024 / 1920: the grid may scroll inside its own
//       container, the page body never scrolls horizontally; zero console
//       and page errors at every viewport (issue #8 bar).
// ---------------------------------------------------------------------------

const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC8 — calendar usable at ${vp.name} ${vp.width}x${vp.height}: no body h-scroll, grid scrolls internally, no errors`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedSelection(page, [
      BIOLOGY.id,
      CHEMISTRY.id,
      SPANISH_LIT.id,
      SEMINAR.id,
      DRAWING.id,
      CYBER.id,
    ]);
    await page.goto("/");
    await openCalendar(page);
    await expect(blocks(page).first()).toBeVisible();

    // One week at a time, with the pager buttons ALWAYS visible (touch swipe,
    // where offered, is never the only affordance — bounce item 4).
    await expect(weekSections(page)).toHaveCount(1);
    await expect(prevButton(page)).toBeVisible();
    await expect(nextButton(page)).toBeVisible();
    await expect(indicator(page)).toContainText(`of ${WEEK_COUNT}`);

    // Export stays visible on the calendar view at every viewport (B4).
    await expect(exportButton(page)).toBeVisible();

    // Page body NEVER scrolls horizontally.
    const bodyOverflow = await page.evaluate(
      () =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) -
        document.documentElement.clientWidth,
    );
    expect(
      bodyOverflow,
      `page body overflows horizontally by ${bodyOverflow}px`,
    ).toBeLessThanOrEqual(0);

    // The grid's own container is the horizontal scroller when the viewport
    // is narrower than the grid's minimum width (mobile), and needs no
    // scrolling on desktop.
    const gridScroller = calendarView(page)
      .locator("div.overflow-x-auto")
      .first();
    const scroll = await gridScroller.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollable: el.scrollWidth > el.clientWidth,
    }));
    expect(scroll.overflowX).toBe("auto");
    if (vp.name === "mobile") {
      expect(
        scroll.scrollable,
        "at 375px the grid should scroll within its own container",
      ).toBe(true);
    }

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });

    const meaningfulErrors = consoleErrors.filter(
      (t) => !/favicon/i.test(t),
    );
    expect(
      pageErrors,
      `Unexpected page errors: ${pageErrors.join(", ")}`,
    ).toEqual([]);
    expect(
      meaningfulErrors,
      `Unexpected console errors: ${meaningfulErrors.join(", ")}`,
    ).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// AC8 (keyboard) — focus-visible ring on the switcher chips (issue #8 bar).
// ---------------------------------------------------------------------------

test("AC8 — switcher chips paint a focus-visible ring under keyboard focus", async ({
  page,
}) => {
  await page.goto("/");

  // Walk keyboard focus onto the Calendar chip (real Tab traversal, so the
  // browser applies :focus-visible, unlike programmatic .focus()).
  await listChip(page).focus();
  await page.keyboard.press("Tab");
  await expect(calendarChip(page)).toBeFocused();

  const shadow = await calendarChip(page).evaluate(
    (el) => getComputedStyle(el).boxShadow,
  );
  expect(shadow, "keyboard focus should paint a visible ring").not.toBe(
    "none",
  );
});

// ---------------------------------------------------------------------------
// Pager a11y (bounce item 4) — real buttons with accessible labels, fully
// keyboard operable, week changes announced via an aria-live region, and a
// focus-visible ring on the pager buttons; reduced-motion safe throughout.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bounce item 5 (QA-added) — the default page FOLLOWS the live selection
// (first week holding a placed exam) until the student pages manually; after
// a manual page, their position wins and later selection changes never yank
// the view away. Also exercises the issue-notes constraint that the grid
// reacts live to catalog toggles while mounted.
// ---------------------------------------------------------------------------

test("Bounce 5 — default page follows the live selection until the student pages manually", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [SPANISH_LIT.id]);
  await page.goto("/");
  await openCalendar(page);

  const spanishWeek = weekIndexOf(SPANISH_LIT.exam!.date) + 1;
  const bioWeek = weekIndexOf(BIOLOGY.exam!.date) + 1;
  expect(bioWeek, "fixture sanity: biology must sit in an earlier week").toBeLessThan(spanishWeek);

  // Default = the first (here: only) week holding a placed exam — week 2.
  await expect(indicator(page)).toContainText(
    `Week ${spanishWeek} of ${WEEK_COUNT}`,
  );
  await expect(blockFor(page, SPANISH_LIT.id)).toHaveCount(1);

  // Live-toggle an EARLIER-week subject in the catalog while the calendar is
  // mounted (no reload): the grid reacts live and the default page follows
  // back to Biology's week, where its block is now placed.
  await select(page, BIOLOGY.name);
  await expect(indicator(page)).toContainText(
    `Week ${bioWeek} of ${WEEK_COUNT}`,
  );
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(1);

  // The student pages manually — their position now wins...
  await gotoWeek(page, WEEK_COUNT);
  await expect(indicator(page)).toContainText(
    `Week ${WEEK_COUNT} of ${WEEK_COUNT}`,
  );

  // ...so a further live selection change (Chemistry lands in week 1, not
  // here) must NOT yank the page away from the student's chosen week.
  await select(page, CHEMISTRY.name);
  await expect(card(page, CHEMISTRY.name)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(indicator(page)).toContainText(
    `Week ${WEEK_COUNT} of ${WEEK_COUNT}`,
  );
  await expect(blockFor(page, CHEMISTRY.id)).toHaveCount(0);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounce5-default-follows-then-manual-wins-desktop.png`,
  });
});

test("Pager a11y — keyboard-operable buttons with accessible names and an aria-live week announcement", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id]);
  await page.goto("/");
  await openCalendar(page);

  // Real <button>s with the required accessible labels.
  await expect(prevButton(page)).toHaveCount(1);
  await expect(nextButton(page)).toHaveCount(1);
  await expect(prevButton(page)).toHaveAccessibleName(/^Previous week/);
  await expect(nextButton(page)).toHaveAccessibleName(/^Next week/);

  // The position indicator is a polite atomic live region, so week changes
  // are announced to assistive tech without stealing focus.
  await expect(indicator(page)).toHaveAttribute("aria-live", "polite");
  await expect(indicator(page)).toHaveAttribute("aria-atomic", "true");
  await expect(indicator(page)).toContainText(`Week 1 of ${WEEK_COUNT}`);

  // Real Tab traversal reaches the pager: with Previous disabled on week 1
  // (disabled buttons are skipped), the next stop after the Calendar chip is
  // the Next button — and keyboard focus paints a :focus-visible ring.
  await calendarChip(page).focus();
  await page.keyboard.press("Tab");
  await expect(nextButton(page)).toBeFocused();
  const shadow = await nextButton(page).evaluate(
    (el) => getComputedStyle(el).boxShadow,
  );
  expect(shadow, "keyboard focus should paint a visible ring").not.toBe(
    "none",
  );

  // Enter pages forward and the live region reflects the new week.
  await page.keyboard.press("Enter");
  await expect(indicator(page)).toContainText(`Week 2 of ${WEEK_COUNT}`);
  await expect(indicator(page)).toContainText(rangeOf(WINDOWS[1]));
  await expect(prevButton(page)).toBeEnabled();

  // Space works too (native button semantics).
  await nextButton(page).focus();
  await page.keyboard.press("Space");
  await expect(indicator(page)).toContainText(`Week 3 of ${WEEK_COUNT}`);

  // Keyboard paging back via the Previous button.
  await prevButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(indicator(page)).toContainText(`Week 2 of ${WEEK_COUNT}`);

  await page.screenshot({
    path: `${EVIDENCE_DIR}/pager-keyboard-week2-desktop.png`,
  });
});

// ---------------------------------------------------------------------------
// Bounce A (second bounce) — duration-proportional blocks: each block spans
// its subject's PUBLISHED `format.totalMinutes` from the session start, plus
// a visually distinct 30-minute setup-buffer segment (deliberate product
// padding, excluded from the labeled exam span); the hour axis extends far
// enough that the longest selected exam + buffer fits.
// ---------------------------------------------------------------------------

test("Bounce A — blocks span published exam lengths plus a distinct setup buffer, and the axis fits the longest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  // Conflict-free set inside week 1; European History is the >3h PM exam
  // that forces the axis past 4 PM (12:00 + 195 min + 30 min buffer).
  await seedSelection(page, [BIOLOGY.id, CHEMISTRY.id, EURO_HISTORY.id]);
  await page.goto("/");
  await openCalendar(page);

  // The label carries the TRUE published span only (start – published end).
  const bio = blockFor(page, BIOLOGY.id);
  await expect(bio).toContainText(
    `${startClockOf(BIOLOGY)} – ${endClockOf(BIOLOGY)}`,
  );
  await expect(bio).toContainText(BIOLOGY.name);

  // The setup buffer renders as its own labeled segment INSIDE the block —
  // inspectable product padding, not silently inflated published data.
  await expect(bio.getByTestId("block-setup-buffer")).toBeVisible();
  await expect(bio.getByTestId("block-setup-buffer")).toContainText(
    "+30 min setup",
  );
  // Neither fixture is length-pending, so nothing is marked approximate.
  await expect(
    page.locator('[data-testid="calendar-block"][data-approximate="true"]'),
  ).toHaveCount(0);

  // Height is proportional to (published minutes + buffer): Biology (180)
  // must render shorter than Chemistry (195) in exactly that ratio.
  const bioBox = await bio.locator("button").boundingBox();
  const chemBox = await blockFor(page, CHEMISTRY.id)
    .locator("button")
    .boundingBox();
  expect(bioBox && chemBox).toBeTruthy();
  const expectedRatio =
    ((BIOLOGY.format.totalMinutes as number) + 30) /
    ((CHEMISTRY.format.totalMinutes as number) + 30);
  expect(bioBox!.height).toBeLessThan(chemBox!.height);
  expect(bioBox!.height / chemBox!.height).toBeGreaterThan(
    expectedRatio - 0.05,
  );
  expect(bioBox!.height / chemBox!.height).toBeLessThan(expectedRatio + 0.05);

  // Axis extension (A3): European History runs 12:00 PM – 3:15 PM + buffer,
  // so a "3 PM" hour tick must exist (the pre-bounce fixed axis ended with
  // "2 PM" as its last tick) and the block's full span label is rendered.
  const euro = blockFor(page, EURO_HISTORY.id);
  await expect(euro).toContainText(
    `${startClockOf(EURO_HISTORY)} – ${endClockOf(EURO_HISTORY)}`,
  );
  const section = weekSections(page).first();
  await expect(section.getByText("3 PM", { exact: true })).toBeVisible();
  // The euro block (tallest) still bottoms out inside the grid — no clipping.
  const euroBox = await euro.locator("button").boundingBox();
  const gridBox = await section.boundingBox();
  expect(euroBox!.y + euroBox!.height).toBeLessThanOrEqual(
    gridBox!.y + gridBox!.height + 1,
  );

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounceA-duration-blocks-desktop.png`,
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// Bounce C7 (second bounce) — calendar events are interactive: activating a
// block opens the SAME exam-details popup as the catalog's info button
// (shared InfoPanel), focus-trapped with Escape-close + focus restore.
// ---------------------------------------------------------------------------

test("Bounce C7 — activating a block opens the shared exam-details popup; Escape closes and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id]);
  await page.goto("/");
  await openCalendar(page);

  const blockButton = blockFor(page, BIOLOGY.id).locator("button");
  await blockButton.click();

  // Shared InfoPanel content: modal dialog titled with the subject, carrying
  // the same detail rows as the catalog's info button (e.g. "Exam length").
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: BIOLOGY.name }),
  ).toBeVisible();
  await expect(dialog.getByText("Exam length")).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounceC7-block-details-popup-desktop.png`,
  });

  // Escape closes (C10 a11y bar) and focus returns to the activating block.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(blockButton).toBeFocused();
});

// ---------------------------------------------------------------------------
// Bounce C8 — a block that is part of an UNRESOLVED time conflict surfaces
// the issue-#5 conflict dialog FIRST, so the conflict is resolvable from the
// calendar view; the resolution routes through the shared store (list view
// reflects it identically).
// ---------------------------------------------------------------------------

test("Bounce C8 — activating a conflicted block opens the conflict dialog; resolving from the calendar moves the loser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  await page.goto("/");
  await openCalendar(page);

  // Documented v3 choice: the calendar does NOT auto-open the conflict modal
  // on load — the conflict stays visible as lane-split blocks and the dialog
  // surfaces on interaction (the list view keeps issue #5's modal-on-mount).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(blocks(page)).toHaveCount(2);

  // Activating either conflicted block surfaces the conflict prompt first —
  // NOT the details popup.
  await blockFor(page, BIOLOGY.id).locator("button").click();
  const prompt = page.getByTestId("conflict-prompt");
  await expect(prompt).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounceC8-conflict-dialog-from-calendar-desktop.png`,
  });

  // Resolve from the calendar: keep Biology → Latin moves to late testing.
  await prompt
    .getByRole("button", { name: `Keep ${BIOLOGY.name} at the regular time` })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Calendar truth: Biology stays on week 1; Latin left the week-1 page...
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(1);
  await expect(blockFor(page, LATIN.id)).toHaveCount(0);
  // ...and sits marked on its late-testing page.
  await gotoWeek(page, weekIndexOf(LATIN.lateTesting!.date) + 1);
  const latinBlock = blockFor(page, LATIN.id);
  await expect(latinBlock).toHaveCount(1);
  await expect(latinBlock).toContainText("Moved to late testing");

  // Shared-store truth: the LIST view shows the same effective schedule.
  await openList(page);
  await expect(
    page
      .locator('section[aria-label="My schedule"] ol > li')
      .filter({ hasText: monthDayOf(LATIN.lateTesting!.date) })
      .filter({ hasText: LATIN.name }),
  ).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Bounce C9 — a block MOVED to late testing offers: (a) switch back to the
// regular slot, which re-prompts the conflict dialog (the slot re-collides);
// (b) swap — keep this exam at the regular time and move the OTHER conflicting
// exam to late testing instead. Both route through the shared resolutions
// store.
// ---------------------------------------------------------------------------

const MOVED_BIO_SEED = [
  {
    date: BIOLOGY.exam!.date,
    session: BIOLOGY.exam!.session,
    keeperId: LATIN.id,
    memberIds: [BIOLOGY.id, LATIN.id],
  },
];

test("Bounce C9 — swap: keep the moved exam at the regular time and move the other exam instead", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  await seedResolutions(page, MOVED_BIO_SEED);
  await page.goto("/");
  await openCalendar(page);

  // Biology was moved to its late slot by the seeded resolution.
  await gotoWeek(page, weekIndexOf(BIOLOGY.lateTesting!.date) + 1);
  const bioBlock = blockFor(page, BIOLOGY.id);
  await expect(bioBlock).toContainText("Moved to late testing");

  // Activating it opens the moved-to-late action dialog...
  await bioBlock.locator("button").click();
  const lateDialog = page.getByTestId("late-testing-dialog");
  await expect(lateDialog).toBeVisible();

  // ...which is Escape-dismissable (C10) and reopenable.
  await page.keyboard.press("Escape");
  await expect(lateDialog).toHaveCount(0);
  await bioBlock.locator("button").click();
  await expect(lateDialog).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounceC9-late-testing-dialog-desktop.png`,
  });

  // Swap: Biology returns to the regular slot; Latin moves to late instead.
  await lateDialog.getByTestId("late-swap").click();
  await expect(lateDialog).toHaveCount(0);

  // Still on the late-testing page (manual paging wins): Latin is here now,
  // Biology is not.
  const latinBlock = blockFor(page, LATIN.id);
  await expect(latinBlock).toHaveCount(1);
  await expect(latinBlock).toContainText("Moved to late testing");
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(0);

  // Week 1 shows Biology back at its regular slot, unmarked.
  await gotoWeek(page, weekIndexOf(BIOLOGY.exam!.date) + 1);
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(1);
  await expect(blockFor(page, BIOLOGY.id)).not.toContainText(
    "Moved to late testing",
  );
  await expect(blockFor(page, LATIN.id)).toHaveCount(0);
});

test("Bounce C9 — switch back re-opens the conflict prompt so the collision is re-resolved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedSelection(page, [BIOLOGY.id, LATIN.id]);
  await seedResolutions(page, MOVED_BIO_SEED);
  await page.goto("/");
  await openCalendar(page);

  await gotoWeek(page, weekIndexOf(BIOLOGY.lateTesting!.date) + 1);
  await blockFor(page, BIOLOGY.id).locator("button").click();
  const lateDialog = page.getByTestId("late-testing-dialog");
  await expect(lateDialog).toBeVisible();

  // Switch back to the regular time: the regular slot re-collides, so the
  // issue-#5 conflict prompt re-opens immediately for a fresh choice.
  await lateDialog.getByTestId("late-switch-back").click();
  await expect(lateDialog).toHaveCount(0);
  const prompt = page.getByTestId("conflict-prompt");
  await expect(prompt).toBeVisible();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/bounceC9-switch-back-reprompts-desktop.png`,
  });

  // Re-resolve, keeping Biology this time: Latin moves to late testing —
  // the same round-trip the list view's prompt would apply.
  await prompt
    .getByRole("button", { name: `Keep ${BIOLOGY.name} at the regular time` })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Current (late) page now shows Latin moved; Biology returned to week 1.
  await expect(blockFor(page, LATIN.id)).toContainText(
    "Moved to late testing",
  );
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(0);
  await gotoWeek(page, weekIndexOf(BIOLOGY.exam!.date) + 1);
  await expect(blockFor(page, BIOLOGY.id)).toHaveCount(1);
});
