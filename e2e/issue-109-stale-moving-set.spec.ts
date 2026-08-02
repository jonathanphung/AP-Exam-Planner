import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";

/**
 * Issue #109 — an in-progress N≥3 moving-set must not outlive the collision it
 * was built for.
 *
 * Both hosts key `ConflictDialog` by the slot alone, so changing the catalog
 * selection mid-flow re-renders the SAME dialog instance with a different
 * member list. Before the fix, a stale set could mark every remaining member
 * as moving: the inline prompt ended up with zero Move buttons and no
 * recordable keeper — a dead end the student could only escape by toggling
 * the selection again or reloading. Nothing wrong was ever persisted.
 *
 * The dialog now scopes the set to its membership (`conflictMembersKey`,
 * unit-tested in `src/lib/conflict-moves.test.ts`): a membership change
 * restarts the flow with every Move button offered again. This spec pins the
 * browser-observable half — the exact repro from the issue.
 *
 * Inline-only by construction: the modal presentation blocks page interaction,
 * and dismissing it already discards the partial set (issue #101).
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

// The shipped May-2027 dataset's real 3-way slot (2027-05-06 AM).
const FRENCH = byId("french-language-and-culture");
const PHYSICS2 = byId("physics-2");
const WORLD_HISTORY = byId("world-history-modern");
const TRIO = [FRENCH, PHYSICS2, WORLD_HISTORY];

// Guard the fixture assumptions against dataset edits — if these ever fail,
// the scenario (not the app) needs re-picking.
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

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const movingIndicator = (page: Page) =>
  page.getByTestId("conflict-moving-indicator");
const moveButton = (page: Page, name: string) =>
  prompt(page)
    .getByRole("button", { name: `Move ${name} to late testing` })
    .first();
const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

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

/** Dismiss the modal presentation so the inline prompt is the live one. */
async function dismissModal(page: Page) {
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
}

test.describe("issue #109 — a mid-flow selection change never dead-ends the conflict prompt", () => {
  test("AC1/AC2 — deselecting a NON-moving member restarts the flow: Move buttons return, nothing is persisted, and the next click resolves", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    // Step 2 of the repro: French is marked as moving (movingIds = {french}).
    await moveButton(page, FRENCH.name).click();
    await expect(movingIndicator(page)).toHaveCount(1);
    await expect(movingIndicator(page)).toContainText(
      new RegExp(`Moving .*${FRENCH.name} to late testing`),
    );

    // Step 3: deselect a member that is NOT moving. Same slot, so the dialog
    // instance survives — but its membership just changed.
    await card(page, WORLD_HISTORY.name).click();
    await expect(card(page, WORLD_HISTORY.name)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Step 4 (the bug): the prompt must NOT be left with only "Moving …"
    // indicators. The stale set is dropped and both remaining members are
    // actionable again.
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page)).toContainText(
      "Which exam will you move to late testing?",
    );
    await expect(movingIndicator(page)).toHaveCount(0);
    await expect(moveButton(page, FRENCH.name)).toBeVisible();
    await expect(moveButton(page, PHYSICS2.name)).toBeVisible();

    // AC2 — the membership change itself persists nothing.
    expect(await storedResolutions(page)).toHaveLength(0);

    // …and the flow completes normally from there: one click on a two-member
    // conflict records the OTHER member as keeper (unchanged #101 model).
    await moveButton(page, FRENCH.name).click();
    await expect(prompt(page)).toHaveCount(0);
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(PHYSICS2.id);
    expect([...stored[0].memberIds].sort()).toEqual(
      [FRENCH.id, PHYSICS2.id].sort(),
    );
  });

  test("AC2 — dismissal semantics unchanged: a shrinking collision does not re-raise the dismissed modal", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    await moveButton(page, FRENCH.name).click();
    await expect(movingIndicator(page)).toHaveCount(1);
    await card(page, WORLD_HISTORY.name).click();

    // The dialog is reset, not remounted: `dismissed` survives, so the prompt
    // stays inline instead of interrupting the student a second time.
    await expect(prompt(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await storedResolutions(page)).toHaveLength(0);
  });

  test("AC1 — deselecting the MOVING member also leaves an actionable prompt", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    await moveButton(page, FRENCH.name).click();
    await expect(movingIndicator(page)).toHaveCount(1);

    // Drop the very subject that was marked as moving.
    await card(page, FRENCH.name).click();
    await expect(card(page, FRENCH.name)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await expect(prompt(page)).toBeVisible();
    await expect(movingIndicator(page)).toHaveCount(0);
    await expect(moveButton(page, PHYSICS2.name)).toBeVisible();
    await expect(moveButton(page, WORLD_HISTORY.name)).toBeVisible();
    expect(await storedResolutions(page)).toHaveLength(0);
  });
});
