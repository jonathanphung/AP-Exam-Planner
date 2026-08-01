import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";

/**
 * Issue #101 — the conflict prompt's red actions are INVERTED: each button
 * reads "Move {subject} to late testing" and clicking it moves THAT subject
 * to its own published late-testing slot. The persisted model is unchanged
 * and keeper-based (`apx.resolutions.v1`, `SlotResolution.keeperId`):
 *
 *   - two members — one click resolves; the OTHER member is recorded keeper.
 *   - N ≥ 3 members (PRD §7.4 edge case) — subjects move one at a time; the
 *     resolution is recorded only once exactly one subject remains (it
 *     becomes the keeper). Dismissing the modal midway persists nothing and
 *     the same prompt re-raises with the partial moving-set discarded.
 *
 * The moving-set → keeper translation itself is pure and unit-tested in
 * `src/lib/conflict-moves.test.ts` (pnpm test:unit); this spec covers the
 * browser-observable behavior end to end.
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

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

// Two-member fixture (same pair as the issue-5 suite).
const BIOLOGY = byId("biology");
const ITALIAN = byId("italian-language-and-culture");

// Three-member fixture: the shipped May-2027 dataset has a real 3-way slot.
const FRENCH = byId("french-language-and-culture");
const PHYSICS2 = byId("physics-2");
const WORLD_HISTORY = byId("world-history-modern");
const TRIO = [FRENCH, PHYSICS2, WORLD_HISTORY];

// Guard the fixture assumptions against dataset edits — if these ever fail,
// the spec's scenario (not the app) needs re-picking.
if (
  BIOLOGY.exam!.date !== ITALIAN.exam!.date ||
  BIOLOGY.exam!.session !== ITALIAN.exam!.session
)
  throw new Error("fixture drift: biology/italian no longer share a slot");
for (const s of [PHYSICS2, WORLD_HISTORY]) {
  if (
    s.exam!.date !== FRENCH.exam!.date ||
    s.exam!.session !== FRENCH.exam!.session
  )
    throw new Error(
      "fixture drift: french/physics-2/world-history no longer share a slot",
    );
}
for (const s of TRIO) {
  if (!s.lateTesting)
    throw new Error(`fixture drift: ${s.id} lost its late-testing slot`);
}

/** "Monday, May 3, 2027" — must match src/lib/schedule.ts formatDateLabel. */
function dateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const movingIndicator = (page: Page) =>
  page.getByTestId("conflict-moving-indicator");
const moveButton = (page: Page, name: string) =>
  prompt(page)
    .getByRole("button", { name: `Move ${name} to late testing` })
    .first();
const dateGroup = (page: Page, iso: string) =>
  schedule(page)
    .locator("ol > li")
    .filter({ has: page.locator("h3", { hasText: dateLabel(iso) }) });
const rowsIn = (page: Page, iso: string) =>
  dateGroup(page, iso).locator("ul > li");

async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

/** Seed localStorage before any app script runs (persisted-load path). */
async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

async function storedResolutions(
  page: Page,
): Promise<Array<{ keeperId: string; memberIds: string[] }>> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "[]"),
    RESOLUTIONS_KEY,
  );
}

test.describe("issue #101 — inverted red actions: Move {subject} to late testing", () => {
  test("AC1/AC4 — the prompt asks which exam MOVES; each red button names a subject and moving it lands it at ITS OWN late slot (keeper recorded is the other member)", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);

    // Inverted copy — no "Which exam will you take at the regular time?"
    // remnant; the two-member phrasing is singular.
    await expect(prompt(page)).toContainText(
      "Which exam will you move to late testing?",
    );
    await expect(prompt(page)).not.toContainText(
      "Which exam will you take at the regular time?",
    );
    await expect(moveButton(page, BIOLOGY.name)).toBeVisible();
    await expect(moveButton(page, ITALIAN.name)).toBeVisible();

    // One click resolves: Biology (the clicked subject) moves to ITS late
    // slot; Italian stays regular and is recorded as the keeper.
    await moveButton(page, BIOLOGY.name).click();
    await expect(prompt(page)).toHaveCount(0);

    const lateRows = rowsIn(page, BIOLOGY.lateTesting!.date);
    await expect(lateRows).toHaveCount(1);
    await expect(lateRows.first()).toContainText(BIOLOGY.name);
    await expect(lateRows.first()).toContainText("Moved to late testing");
    const regularRows = rowsIn(page, ITALIAN.exam!.date);
    await expect(regularRows).toHaveCount(1);
    await expect(regularRows.first()).toContainText(ITALIAN.name);

    // Unchanged persisted model: same key, same keeper-based shape.
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(ITALIAN.id);
    expect([...stored[0].memberIds].sort()).toEqual(
      [BIOLOGY.id, ITALIAN.id].sort(),
    );
  });

  test("AC3 — N≥3: subjects move ONE AT A TIME; clicked subjects show a moving indicator; the resolution is recorded only when exactly one subject remains", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);

    // Plural phrasing for a 3-way group; one Move button per member.
    await expect(prompt(page)).toContainText(
      "Which exams will you move to late testing?",
    );
    for (const s of TRIO) {
      await expect(moveButton(page, s.name)).toBeVisible();
    }

    // First move: prompt stays open, French is visibly marked as moving
    // (button replaced by the indicator), and NOTHING is persisted yet.
    await moveButton(page, FRENCH.name).click();
    await expect(prompt(page)).toBeVisible();
    await expect(movingIndicator(page)).toHaveCount(1);
    await expect(movingIndicator(page)).toContainText(
      `Moving ${FRENCH.name} to late testing`,
    );
    await expect(moveButton(page, FRENCH.name)).toHaveCount(0);
    expect(await storedResolutions(page)).toHaveLength(0);

    // Second move leaves exactly one subject → it becomes the keeper and the
    // resolution is recorded through the same pathway as the 2-member case.
    await moveButton(page, PHYSICS2.name).click();
    await expect(prompt(page)).toHaveCount(0);

    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(WORLD_HISTORY.id);
    expect([...stored[0].memberIds].sort()).toEqual(
      TRIO.map((s) => s.id).sort(),
    );

    // Each moved exam sits at ITS OWN late slot; the keeper stays regular.
    for (const moved of [FRENCH, PHYSICS2]) {
      const rows = rowsIn(page, moved.lateTesting!.date).filter({
        hasText: moved.name,
      });
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Moved to late testing");
    }
    await expect(
      rowsIn(page, WORLD_HISTORY.exam!.date).filter({
        hasText: WORLD_HISTORY.name,
      }),
    ).toHaveCount(1);
  });

  test("AC3 — N≥3: dismissing the modal midway persists NOTHING and re-raises the prompt with the partial moving-set discarded", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);

    // The first unresolved conflict presents modally (issue #8 behavior).
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    // Mark one subject as moving, then dismiss midway.
    await moveButton(page, FRENCH.name).click();
    await expect(movingIndicator(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    // Nothing persisted; the same prompt is still available inline with the
    // partial selection discarded — all three Move buttons are back.
    expect(await storedResolutions(page)).toHaveLength(0);
    await expect(prompt(page)).toBeVisible();
    await expect(movingIndicator(page)).toHaveCount(0);
    for (const s of TRIO) {
      await expect(moveButton(page, s.name)).toBeVisible();
    }

    // Reload: still unresolved, the modal prompt re-raises fresh.
    await page.reload();
    await openList(page);
    await expect(prompt(page)).toBeVisible();
    expect(await storedResolutions(page)).toHaveLength(0);
  });

  test("AC6 — the calendar's click-a-conflicted-event flow uses the same inverted actions and records the same resolution", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");

    // Activate a conflicted block → the conflict dialog surfaces (issue #19).
    await page
      .locator(`[data-testid="calendar-block"][data-subject-id="${BIOLOGY.id}"]`)
      .locator("button")
      .click();
    await expect(prompt(page)).toBeVisible();
    await expect(moveButton(page, BIOLOGY.name)).toBeVisible();
    await expect(moveButton(page, ITALIAN.name)).toBeVisible();

    // Move Italian from the calendar host: Biology is recorded as keeper.
    await moveButton(page, ITALIAN.name).click();
    await expect(prompt(page)).toHaveCount(0);
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(BIOLOGY.id);
  });
});
