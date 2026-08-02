import { test, expect, type Locator, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";

/**
 * Independent Tester verification (super-board QA lane) — issue #109, the
 * stale N≥3 moving-set that survived a mid-flow selection change.
 *
 * Written against the ACs, not against the builder's spec. The builder's
 * `e2e/issue-109-stale-moving-set.spec.ts` already pins the issue's literal
 * repro (deselect a non-moving member → Move buttons return → the next click
 * resolves), the deselect-the-moving-member variant, and the no-modal-re-raise
 * assertion. This suite covers what that spec does NOT observe:
 *
 *   1. **The invariant, not one repro (AC1).** The bug is "a reachable prompt
 *      state with zero Move buttons". One scripted repro proves one path; here
 *      a churn sequence — move, shrink, re-grow, shrink on a different member,
 *      re-grow, resolve — asserts after EVERY step that the prompt is either
 *      gone (resolved) or still offers at least one Move action. That is the
 *      AC stated as a property.
 *   2. **Re-growing the membership (AC1).** Deselect-then-RE-select is the one
 *      path where the shipped guard (derive per membership, keep the state
 *      object) differs from a hard reset: the stored set becomes live again
 *      because its key matches once more. Nothing in the builder's spec walks
 *      it. Pinned here as an explicit, coherent, actionable state — this is
 *      the sharpest probe of the chosen design.
 *   3. **The guard must not OVER-reset (AC1/AC3, #101 regression).** A fix that
 *      dropped the moving-set on any re-render would also pass the literal
 *      repro while quietly breaking issue #101's whole N≥3 one-at-a-time flow.
 *      Two simultaneous 3-way conflicts ship in the May-2027 dataset, so this
 *      asserts that churning conflict B (and an unrelated subject) leaves
 *      conflict A's in-progress set intact.
 *   4. **What actually gets persisted (AC2), end to end.** The builder checks
 *      the resolution's keeper + members in localStorage. Here the resolution
 *      recorded after churn is also checked against the rendered schedule and
 *      across a reload: the subjects that were marked as moving really sit in
 *      late testing, the keeper really stays at the regular time, and the
 *      member list recorded is the CURRENT membership, never the stale trio.
 *   5. **The regression is actually pinned.** Both this suite and the
 *      builder's were re-run against a deliberately reverted guard; the
 *      red/green transcript is in the evidence folder.
 *
 * Inline-only by construction (as the issue scopes it): the calendar host
 * mounts the prompt as a modal whose backdrop covers the catalog and which
 * unmounts on dismiss, so no catalog toggle can reach an in-progress set there.
 */

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";
const EVIDENCE_DIR = evidenceDir("issue-109-qa-v1");

type Slot = { date: string; session: "AM" | "PM" };
type Subject = {
  id: string;
  name: string;
  exam: Slot | null;
  lateTesting: Slot | null;
};

const SUBJECTS = (apData as { subjects: Subject[] }).subjects;
const byId = (id: string): Subject => {
  const s = SUBJECTS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture subject missing from dataset: ${id}`);
  return s;
};

// The two 3-way collisions the shipped May-2027 dataset actually contains.
const FRENCH = byId("french-language-and-culture");
const PHYSICS2 = byId("physics-2");
const WORLD_HISTORY = byId("world-history-modern");
const TRIO_A = [FRENCH, PHYSICS2, WORLD_HISTORY];

const COMP_GOV = byId("comparative-government-and-politics");
const CSP = byId("computer-science-principles");
const SPANISH_LIT = byId("spanish-literature-and-culture");
const TRIO_B = [COMP_GOV, CSP, SPANISH_LIT];

// An exam with no collision at all — used to prove an unrelated selection
// change does not disturb an in-progress moving-set.
const BIOLOGY = byId("biology");

/**
 * Fixture guards. If the dataset is re-published and these stop holding, the
 * SCENARIO needs re-picking — the failure must not read as an app regression.
 */
for (const trio of [TRIO_A, TRIO_B]) {
  const [head, ...rest] = trio;
  for (const s of rest) {
    if (s.exam?.date !== head.exam?.date || s.exam?.session !== head.exam?.session)
      throw new Error(
        `fixture drift: ${trio.map((x) => x.id).join("/")} no longer share a slot`,
      );
  }
  for (const s of trio) {
    if (!s.lateTesting)
      throw new Error(`fixture drift: ${s.id} lost its late-testing slot`);
  }
}
if (
  TRIO_A[0].exam!.date === TRIO_B[0].exam!.date ||
  BIOLOGY.exam!.date === TRIO_A[0].exam!.date
) {
  throw new Error("fixture drift: the two trios / biology must not share a slot");
}

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');

/** The conflict prompt that currently names `subjectName`. */
const promptNaming = (page: Page, subjectName: string) =>
  page.getByTestId("conflict-prompt").filter({ hasText: subjectName });
const moveButtonsIn = (prompt: Locator) =>
  prompt.getByRole("button", { name: /^Move .+ to late testing/ });
const moveButtonFor = (prompt: Locator, subjectName: string) =>
  prompt.getByRole("button", { name: `Move ${subjectName} to late testing` });
const movingIn = (prompt: Locator) =>
  prompt.getByTestId("conflict-moving-indicator");

const catalogCard = (page: Page, subjectName: string) =>
  catalog(page).locator("ul > li button[aria-pressed]").filter({
    hasText: subjectName,
  });

async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

/** Seed the selection before any app script runs (persisted-load path). */
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

/** Toggle a catalog card and wait for the app to register the new state. */
async function toggleCard(page: Page, subject: Subject, to: boolean) {
  const cardButton = catalogCard(page, subject.name);
  await expect(cardButton).toHaveCount(1);
  await cardButton.scrollIntoViewIfNeeded();
  await cardButton.click();
  await expect(cardButton).toHaveAttribute("aria-pressed", String(to));
}

/** Dismiss the modal presentation so the INLINE prompt is the live one. */
async function dismissModal(page: Page) {
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
}

/**
 * THE issue-#109 invariant, checked after every step of a churn sequence.
 *
 * An unresolved prompt that is still on screen must (a) render exactly one row
 * per CURRENT member — no ghost row for a member that left, none missing for a
 * member that arrived — and (b) still offer at least one Move action. Zero Move
 * buttons with nothing recorded is precisely the dead end the issue reports.
 *
 * Deliberately agnostic about WHICH rows are indicators vs buttons: both "the
 * membership change resets the flow" and "the flow resumes where it left off"
 * satisfy the AC ("resets or resolves coherently"), so the assertion pins
 * coherence rather than one of the two acceptable designs.
 */
async function expectCoherentPrompt(
  page: Page,
  anchorName: string,
  memberCount: number,
  step: string,
): Promise<"open" | "resolved"> {
  const prompt = promptNaming(page, anchorName);
  if ((await prompt.count()) === 0) return "resolved";
  await expect(
    moveButtonsIn(prompt),
    `${step}: the open prompt still offers at least one Move action`,
  ).not.toHaveCount(0);
  const rows =
    (await moveButtonsIn(prompt).count()) +
    (await movingIn(prompt).count()) +
    (await prompt.getByTestId("conflict-no-late-slot").count());
  expect(rows, `${step}: exactly one row per current member`).toBe(memberCount);
  return "open";
}

/**
 * A subject's EXAM row on the schedule. French also ships a portfolio-deadline
 * row under the same name (issue #91), so it is filtered out explicitly —
 * otherwise the locator is ambiguous and the assertion reads as an app bug.
 */
const scheduleRow = (page: Page, subjectName: string) =>
  schedule(page)
    .locator("ol > li ul > li")
    .filter({ hasText: subjectName })
    .filter({ hasNotText: "Portfolio due" });

test.describe("issue #109 QA — a mid-flow membership change can never dead-end the prompt", () => {
  test("AC1 — churn invariant: move → shrink → re-grow → shrink again → re-grow → resolve, with an actionable prompt at EVERY step", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO_A.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    const prompt = () => promptNaming(page, FRENCH.name);
    await expect(moveButtonsIn(prompt())).toHaveCount(3);

    // 1. Start the N≥3 flow.
    await moveButtonFor(prompt(), FRENCH.name).click();
    await expect(movingIn(prompt())).toHaveCount(1);
    expect(
      await expectCoherentPrompt(page, FRENCH.name, 3, "after Move French"),
    ).toBe("open");

    // 2. Shrink: deselect a NON-moving member (the issue's repro step 3).
    await toggleCard(page, WORLD_HISTORY, false);
    expect(
      await expectCoherentPrompt(
        page,
        FRENCH.name,
        2,
        "after deselecting World History",
      ),
    ).toBe("open");
    // The stale set no longer applies, so the pair is fully actionable again.
    await expect(movingIn(prompt())).toHaveCount(0);
    await expect(moveButtonsIn(prompt())).toHaveCount(2);
    expect(await storedResolutions(page)).toHaveLength(0);

    // 3. Re-grow: put the member back. The membership matches the dropped
    //    set's key again, so the shipped guard makes it live once more (the
    //    Moving-French indicator returns). That is coherent — two members are
    //    still actionable — and it is asserted only as the invariant, so a
    //    future hard-reset design would also pass.
    await toggleCard(page, WORLD_HISTORY, true);
    expect(
      await expectCoherentPrompt(
        page,
        FRENCH.name,
        3,
        "after re-selecting World History",
      ),
    ).toBe("open");
    await expect(prompt()).toContainText(WORLD_HISTORY.name);
    expect(await storedResolutions(page)).toHaveLength(0);

    // 4. Shrink again, on a DIFFERENT member this time.
    await toggleCard(page, PHYSICS2, false);
    expect(
      await expectCoherentPrompt(
        page,
        FRENCH.name,
        2,
        "after deselecting Physics 2",
      ),
    ).toBe("open");
    await expect(moveButtonsIn(prompt())).toHaveCount(2);
    expect(await storedResolutions(page)).toHaveLength(0);

    // 5. Re-grow back to the full trio.
    await toggleCard(page, PHYSICS2, true);
    expect(
      await expectCoherentPrompt(
        page,
        FRENCH.name,
        3,
        "after re-selecting Physics 2",
      ),
    ).toBe("open");
    expect(await storedResolutions(page)).toHaveLength(0);

    // 6. Resolve from wherever the churn left the flow: click Move buttons
    //    until the prompt closes. A three-member conflict needs at most two.
    for (let click = 0; click < 3; click += 1) {
      const open = await expectCoherentPrompt(
        page,
        FRENCH.name,
        3,
        `before resolving click ${click + 1}`,
      );
      if (open === "resolved") break;
      await moveButtonsIn(prompt()).first().click();
    }
    await expect(promptNaming(page, FRENCH.name)).toHaveCount(0);

    // Exactly one resolution, for the CURRENT (full trio) membership.
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect([...stored[0].memberIds].sort()).toEqual(
      TRIO_A.map((s) => s.id).sort(),
    );
    expect(TRIO_A.map((s) => s.id)).toContain(stored[0].keeperId);

    // The keeper stayed at the regular time; the other two really moved.
    for (const s of TRIO_A) {
      const row = scheduleRow(page, s.name);
      await expect(row).toHaveCount(1);
      if (s.id === stored[0].keeperId) {
        await expect(row).not.toContainText("Moved to late testing");
      } else {
        await expect(row).toContainText("Moved to late testing");
      }
    }
  });

  test("AC1/AC3 — the guard is membership-scoped, not a blanket reset: churning an UNRELATED selection keeps the in-progress moving-set (issue #101's N≥3 flow)", async ({
    page,
  }) => {
    await seedSelection(page, [...TRIO_A, ...TRIO_B].map((s) => s.id));
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    const promptA = () => promptNaming(page, FRENCH.name);
    const promptB = () => promptNaming(page, COMP_GOV.name);
    await expect(page.getByTestId("conflict-prompt")).toHaveCount(2);
    await expect(moveButtonsIn(promptA())).toHaveCount(3);
    await expect(moveButtonsIn(promptB())).toHaveCount(3);

    // In-progress on conflict A only.
    await moveButtonFor(promptA(), FRENCH.name).click();
    await expect(movingIn(promptA())).toHaveCount(1);

    // A member of the OTHER conflict is deselected: different slot, so A's
    // membership is untouched and its in-progress click must survive.
    await toggleCard(page, SPANISH_LIT, false);
    await expect(
      movingIn(promptA()),
      "conflict A keeps its Moving indicator when a different conflict changes",
    ).toHaveCount(1);
    await expect(movingIn(promptA())).toContainText(FRENCH.name);
    await expect(moveButtonsIn(promptA())).toHaveCount(2);

    // An entirely unrelated (non-colliding) subject is added.
    await toggleCard(page, BIOLOGY, true);
    await expect(
      movingIn(promptA()),
      "an unrelated selection change does not restart the N≥3 flow",
    ).toHaveCount(1);
    await expect(moveButtonsIn(promptA())).toHaveCount(2);
    expect(await storedResolutions(page)).toHaveLength(0);

    // …and the preserved set still completes in ONE more click (the #101
    // contract): the last remaining member becomes the keeper.
    await moveButtonFor(promptA(), PHYSICS2.name).click();
    await expect(promptNaming(page, FRENCH.name)).toHaveCount(0);
    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(WORLD_HISTORY.id);
    expect([...stored[0].memberIds].sort()).toEqual(
      TRIO_A.map((s) => s.id).sort(),
    );

    // Conflict B — now a two-member collision — is untouched and still live.
    await expect(promptB()).toBeVisible();
    await expect(moveButtonsIn(promptB())).toHaveCount(2);
  });

  test("AC2 — the churn persists nothing, and the resolution finally recorded matches the CURRENT membership (survives reload)", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO_A.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);
    await dismissModal(page);

    const prompt = () => promptNaming(page, FRENCH.name);
    await moveButtonFor(prompt(), FRENCH.name).click();
    await expect(movingIn(prompt())).toHaveCount(1);
    expect(
      await storedResolutions(page),
      "a partial moving-set is never persisted",
    ).toHaveLength(0);

    // Shrink to a two-member collision mid-flow.
    await toggleCard(page, WORLD_HISTORY, false);
    expect(
      await storedResolutions(page),
      "the membership change itself persists nothing",
    ).toHaveLength(0);
    // …and it did not silently resolve anything either: both members are
    // still at the regular time, and the prompt is still asking.
    await expect(prompt()).toBeVisible();
    for (const s of [FRENCH, PHYSICS2]) {
      await expect(scheduleRow(page, s.name)).not.toContainText(
        "Moved to late testing",
      );
    }

    // One deliberate click on the (now two-member) conflict resolves it.
    await moveButtonFor(prompt(), FRENCH.name).click();
    await expect(promptNaming(page, FRENCH.name)).toHaveCount(0);

    const stored = await storedResolutions(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].keeperId).toBe(PHYSICS2.id);
    expect(
      [...stored[0].memberIds].sort(),
      "the recorded members are the CURRENT pair, not the stale trio",
    ).toEqual([FRENCH.id, PHYSICS2.id].sort());

    // End-to-end truth: French really sits in its own late-testing slot, and
    // the resolution survives a reload without re-prompting.
    await expect(scheduleRow(page, FRENCH.name)).toContainText(
      "Moved to late testing",
    );
    await expect(scheduleRow(page, PHYSICS2.name)).not.toContainText(
      "Moved to late testing",
    );

    await page.reload();
    await openList(page);
    await expect(page.getByTestId("conflict-prompt")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(scheduleRow(page, FRENCH.name)).toContainText(
      "Moved to late testing",
    );
    expect(await storedResolutions(page)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Evidence — the repro's before/after at the three standard viewports.
  // -------------------------------------------------------------------------
  for (const vp of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    test(`evidence — mid-flow shrink, before/after, at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(
        page,
        TRIO_A.map((s) => s.id),
      );
      await page.goto("/");
      await openList(page);
      await dismissModal(page);

      const prompt = () => promptNaming(page, FRENCH.name);
      await moveButtonFor(prompt(), FRENCH.name).click();
      await expect(movingIn(prompt())).toHaveCount(1);
      await prompt().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac1-midway-3way-${vp.name}.png`,
      });

      await toggleCard(page, WORLD_HISTORY, false);
      await expect(movingIn(prompt())).toHaveCount(0);
      await expect(moveButtonsIn(prompt())).toHaveCount(2);
      await prompt().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac1-after-deselect-${vp.name}.png`,
      });

      if (vp.name === "desktop") {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({
          path: `${EVIDENCE_DIR}/ac1-after-deselect-desktop-dark.png`,
        });
        await page.emulateMedia({ colorScheme: "light" });
      }

      // AC2 — and the resolution that follows is the normal #101 one.
      await moveButtonFor(prompt(), FRENCH.name).click();
      await expect(promptNaming(page, FRENCH.name)).toHaveCount(0);
      await expect(scheduleRow(page, FRENCH.name)).toContainText(
        "Moved to late testing",
      );
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac2-resolved-${vp.name}.png`,
      });
    });
  }
});
