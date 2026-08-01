import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";

/**
 * Independent Tester verification (super-board QA lane) — issue #101, the
 * inverted conflict-prompt actions ("Move {subject} to late testing").
 *
 * Written against the ACs, not against the builder's spec. The builder's
 * `issue-101-inverted-conflict-actions.spec.ts` already pins the list-view
 * rendering, the keeper-based storage shape, the N≥3 one-at-a-time flow, the
 * midway-dismissal reset, and the calendar host. This suite covers what that
 * spec does NOT observe:
 *
 *   1. **AC1's third surface — the ICS export.** The AC says calendar view,
 *      list view, AND the ICS export all reflect a Move click through the
 *      same `resolveSlots` pathway. No existing spec clicks the inverted
 *      button and then reads the actual exported bytes: here "Move Biology to
 *      late testing" must land Biology's VEVENT on its published late slot
 *      (2027-05-19) while the keeper's VEVENT stays regular (2027-05-03).
 *   2. **AC2's backward-compatibility clause.** "Existing stored resolutions
 *      keep working" — a resolution written before this change (seeded
 *      verbatim in the OLD/only shape) must still load: no prompt, mover on
 *      its late slot, keeper regular.
 *   3. **AC4's untouched-copy clause.** The exact COORDINATOR_NOTE sentence
 *      and the `data-testid="conflict-prompt"` contract, asserted verbatim in
 *      BOTH presentation states (modal + inline) — plus zero remnants of the
 *      old "Keep …/take at the regular time" framing anywhere in the prompt.
 *   4. **The issue's evidence requirement.** Screenshots of the inverted
 *      prompt (modal + inline) at 1920×1080 / 1024×768 / 375×667, light +
 *      dark, plus the N≥3 one-at-a-time flow captured MIDWAY (one subject
 *      marked "Moving …", two Move buttons left, nothing persisted).
 *
 * AC5 (member without a published late slot gets no Move button) is not
 * browser-reachable — the shipped dataset schema guarantees a late slot for
 * every examined subject — so it stays pinned at the unit layer
 * (`src/lib/conflict-moves.test.ts`, `movableMemberIds`).
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";
const EVIDENCE_DIR = evidenceDir("issue-101-qa-v1");

/** AC4: the exact sentence that must survive the copy inversion untouched. */
const COORDINATOR_NOTE =
  "This is a planning choice — the actual late-testing swap is arranged through your school's AP coordinator.";

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

// Two-member fixture (same pair as the issue-5/issue-101 builder suites).
const BIOLOGY = byId("biology");
const ITALIAN = byId("italian-language-and-culture");
// Real 3-way slot in the shipped dataset (2027-05-06 AM).
const TRIO = [
  byId("french-language-and-culture"),
  byId("physics-2"),
  byId("world-history-modern"),
];

// Fixture guards — failures here mean the DATASET moved, not the app.
if (
  BIOLOGY.exam!.date !== ITALIAN.exam!.date ||
  BIOLOGY.exam!.session !== ITALIAN.exam!.session
)
  throw new Error("fixture drift: biology/italian no longer share a slot");
for (const s of TRIO)
  if (
    s.exam!.date !== TRIO[0].exam!.date ||
    s.exam!.session !== TRIO[0].exam!.session ||
    !s.lateTesting
  )
    throw new Error("fixture drift: the 3-way 2027-05-06 AM slot changed");

const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const moveButton = (page: Page, name: string) =>
  prompt(page)
    .getByRole("button", { name: `Move ${name} to late testing` })
    .first();
const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');

async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

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

/** "YYYY-MM-DD" → the "YYYYMMDD" prefix of a floating DTSTART value. */
const dtstamp = (iso: string) => iso.replaceAll("-", "");

/**
 * Unfold RFC 5545 continuation lines and return each VEVENT's text so a
 * subject's SUMMARY and DTSTART can be matched inside ONE event block.
 */
function veventBlocks(ics: string): string[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  return unfolded.split("BEGIN:VEVENT").slice(1);
}

test.describe("issue #101 QA — inverted conflict actions, independent verification", () => {
  test("AC1 — a Move click reaches the ICS export: the moved subject's VEVENT sits on its published late slot, the keeper's stays regular", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);

    // Resolve through the INVERTED action: move Biology, keep Italian.
    await moveButton(page, BIOLOGY.name).click();
    await expect(prompt(page)).toHaveCount(0);

    // AC2 shape check on the way: keeper is the OTHER member, same key.
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(ITALIAN.id);

    // Export the real bytes (issue #51 menu → issue #7 ICS download).
    await page.getByTestId("export-menu-button").click();
    const item = page.getByRole("menuitem", { name: "Save as .ics" });
    await expect(item).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await item.click();
    const download = await downloadPromise;
    const ics = readFileSync((await download.path())!, "utf8");

    const bioEvent = veventBlocks(ics).find((b) =>
      b.includes(`SUMMARY:${BIOLOGY.name} exam`),
    );
    const italianEvent = veventBlocks(ics).find((b) =>
      b.includes(`SUMMARY:${ITALIAN.name} exam`),
    );
    expect(bioEvent, "Biology exam VEVENT missing from export").toBeTruthy();
    expect(italianEvent, "Italian exam VEVENT missing from export").toBeTruthy();

    // Moved subject → ITS OWN late-testing date; keeper → regular date.
    expect(bioEvent!).toContain(`DTSTART:${dtstamp(BIOLOGY.lateTesting!.date)}`);
    expect(bioEvent!).not.toContain(`DTSTART:${dtstamp(BIOLOGY.exam!.date)}`);
    expect(italianEvent!).toContain(
      `DTSTART:${dtstamp(ITALIAN.exam!.date)}`,
    );
  });

  test("AC2 — a resolution stored BEFORE this change keeps working: no prompt, mover late, keeper regular (no migration)", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    // Seed the persisted shape verbatim as issue #5 wrote it — this is what a
    // returning student's localStorage contains today.
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [
        RESOLUTIONS_KEY,
        JSON.stringify([
          {
            date: BIOLOGY.exam!.date,
            session: BIOLOGY.exam!.session,
            keeperId: ITALIAN.id,
            memberIds: [BIOLOGY.id, ITALIAN.id],
          },
        ]),
      ] as const,
    );
    await page.goto("/");
    await openList(page);

    await expect(prompt(page)).toHaveCount(0);
    const bioRow = schedule(page)
      .locator("li")
      .filter({ hasText: BIOLOGY.name })
      .last();
    await expect(bioRow).toContainText("Moved to late testing");
    // The stored value survived the load untouched.
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(ITALIAN.id);
  });

  test("AC4 — COORDINATOR_NOTE and the conflict-prompt testid are untouched in BOTH presentation states; zero old-framing remnants", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);

    // Modal state (first unresolved conflict presents modally, issue #8).
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("conflict-prompt")).toBeVisible();
    await expect(modal).toContainText(COORDINATOR_NOTE);
    await expect(modal).not.toContainText("at the regular time?");
    await expect(
      modal.getByRole("button", { name: /^Keep .* at the regular time$/ }),
    ).toHaveCount(0);

    // Inline state (dismissal never discards — issue #5 AC5).
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page)).toContainText(COORDINATOR_NOTE);
    await expect(prompt(page)).toContainText(
      "Which exam will you move to late testing?",
    );
    await expect(prompt(page)).not.toContainText(
      "Which exam will you take at the regular time?",
    );
  });

  // -------------------------------------------------------------------------
  // Evidence — the issue's mandated screenshot matrix: modal + inline at the
  // three standard viewports, light + dark.
  // -------------------------------------------------------------------------
  for (const vp of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    test(`evidence — inverted prompt, modal + inline, light + dark at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
      await page.goto("/");
      await openList(page);

      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await expect(moveButton(page, BIOLOGY.name)).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/modal-${vp.name}-light.png`,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: `${EVIDENCE_DIR}/modal-${vp.name}-dark.png`,
      });

      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(prompt(page)).toBeVisible();
      await prompt(page).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/inline-${vp.name}-dark.png`,
      });
      await page.emulateMedia({ colorScheme: "light" });
      await page.screenshot({
        path: `${EVIDENCE_DIR}/inline-${vp.name}-light.png`,
      });
    });
  }

  test("evidence — N≥3 one-at-a-time flow captured MIDWAY: one subject moving, two Move buttons left, nothing persisted", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);

    await expect(prompt(page)).toContainText(
      "Which exams will you move to late testing?",
    );
    await moveButton(page, TRIO[0].name).click();

    // Midway: the clicked subject is visibly moving, the prompt stays open,
    // two Move buttons remain, and NOTHING has been persisted yet.
    // Issue #111 put the subject's emoji inside the phrase (via SubjectName)
    // and its destination on a second line, so both matchers are loosened at
    // exactly those two points — the wording either side is still pinned.
    await expect(page.getByTestId("conflict-moving-indicator")).toContainText(
      new RegExp(`Moving .*${TRIO[0].name} to late testing`),
    );
    await expect(
      prompt(page).getByRole("button", { name: /^Move .+ to late testing/ }),
    ).toHaveCount(2);
    expect(await storedResolutions(page)).toHaveLength(0);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/n3-midway-desktop-light.png`,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: `${EVIDENCE_DIR}/n3-midway-desktop-dark.png`,
    });
  });
});
