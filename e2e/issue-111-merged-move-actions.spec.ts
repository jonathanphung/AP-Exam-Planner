import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";

/**
 * Issue #111 — the conflict prompt's destination bullet list is folded INTO
 * the Move buttons.
 *
 * Before: every member was named three times (intro sentence, destination
 * bullet, red button). Now each member renders exactly ONE element in a single
 * stack — a two-line red button whose second line names that subject's own
 * published late-testing slot — and the intro paragraph has shed the
 * now-redundant "Each moves to its own official late-testing slot" clause.
 *
 * One observable test per acceptance criterion:
 *   AC1 — no bullet list; each subject and each destination appear exactly
 *         once in the prompt.
 *   AC2 — each button's ACCESSIBLE NAME carries action + destination.
 *   AC3 — destinations are the dataset's own `lateTesting` slots, formatted
 *         exactly like `formatDateLabel` (no hand-written dates).
 *   AC4 — N≥3 midway: the moving indicator keeps its destination line, the
 *         remaining buttons keep theirs, a partial dismiss resets cleanly.
 *   AC5 — the inert no-late-slot row: unreachable in the shipped dataset (it
 *         is asserted absent here and pinned by `src/lib/conflict-rows.test.ts`).
 *   AC6 — modal, inline and the calendar host all show the merged design.
 *   AC7 — ≥44px tap targets and zero serious/critical axe violations (the
 *         two-line red button's contrast) in light AND dark.
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

// Two-member fixture (the same pair every conflict suite uses).
const BIOLOGY = byId("biology");
const ITALIAN = byId("italian-language-and-culture");
// The shipped dataset's real 3-way slot (2027-05-06 AM).
const TRIO = [
  byId("french-language-and-culture"),
  byId("physics-2"),
  byId("world-history-modern"),
];

// Fixture guards — a failure here means the DATASET moved, not the app.
if (
  BIOLOGY.exam!.date !== ITALIAN.exam!.date ||
  BIOLOGY.exam!.session !== ITALIAN.exam!.session
)
  throw new Error("fixture drift: biology/italian no longer share a slot");
for (const s of TRIO)
  if (
    s.exam!.date !== TRIO[0].exam!.date ||
    s.exam!.session !== TRIO[0].exam!.session
  )
    throw new Error("fixture drift: the 3-way 2027-05-06 AM slot changed");
for (const s of [BIOLOGY, ITALIAN, ...TRIO])
  if (!s.lateTesting)
    throw new Error(`fixture drift: ${s.id} lost its late-testing slot`);

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

/**
 * The destination line the merged button must show for a subject — built from
 * the dataset the same way `lateTestingDestination` builds it, so a hardcoded
 * date in the component can never satisfy this spec.
 */
const destinationOf = (s: Subject): string =>
  `${dateLabel(s.lateTesting!.date)} · ${s.lateTesting!.session} session`;

const prompt = (page: Page) => page.getByTestId("conflict-prompt");
const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const moveButton = (page: Page, name: string) =>
  prompt(page)
    .getByRole("button", { name: `Move ${name} to late testing` })
    .first();
const movingIndicator = (page: Page) =>
  page.getByTestId("conflict-moving-indicator");

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

async function storedResolutions(page: Page): Promise<unknown[]> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "[]"),
    RESOLUTIONS_KEY,
  );
}

/** How many times `needle` occurs in the prompt's visible text. */
async function occurrencesInPrompt(page: Page, needle: string) {
  const text = await prompt(page).first().innerText();
  return text.split(needle).length - 1;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("issue #111 — destination folded into the Move button", () => {
  test("AC1 — the bullet list is gone: no <ul> in the prompt, each subject and each destination stated exactly once", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);
    await expect(prompt(page).first()).toBeVisible();

    // The destination bullet list itself is gone.
    await expect(prompt(page).first().locator("ul")).toHaveCount(0);
    await expect(prompt(page).first().locator("li")).toHaveCount(0);

    // The clause that only existed to introduce the bullets is gone too.
    await expect(prompt(page).first()).not.toContainText(
      "Each moves to its own official late-testing slot",
    );

    // Below the intro paragraph each movable subject appears exactly once —
    // as its Move button — so no slot is stated twice anywhere in the prompt.
    for (const s of [BIOLOGY, ITALIAN]) {
      await expect(
        prompt(page)
          .first()
          .getByRole("button", { name: `Move ${s.name} to late testing` }),
        `${s.name}: exactly one Move action`,
      ).toHaveCount(1);
      expect(
        await occurrencesInPrompt(page, destinationOf(s)),
        `${s.name}: its late-testing slot is stated exactly once`,
      ).toBe(1);
      // Named twice, not three times: once in the intro, once on its action.
      expect(
        await occurrencesInPrompt(page, s.name),
        `${s.name}: named in the intro and on its own action, nowhere else`,
      ).toBe(2);
    }

    // The intro still states the collision and asks the question (issue #101).
    await expect(prompt(page).first()).toContainText(
      "Which exam will you move to late testing?",
    );
    await expect(prompt(page).first()).toContainText(
      `${dateLabel(BIOLOGY.exam!.date)} (${BIOLOGY.exam!.session} session)`,
    );
  });

  test("AC2/AC3 — each button's accessible name carries the action AND the dataset-derived destination", async ({
    page,
  }) => {
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);

    for (const s of [BIOLOGY, ITALIAN]) {
      const button = moveButton(page, s.name);
      await expect(button).toBeVisible();
      // Screen readers hear where the exam goes BEFORE activating it.
      await expect(button).toHaveAccessibleName(
        new RegExp(
          `^Move ${escapeRe(s.name)} to late testing\\s*${escapeRe(
            destinationOf(s),
          )}$`,
        ),
      );
      // …and the visible second line is the same dataset-derived string.
      await expect(button).toContainText(destinationOf(s));
    }

    // Clicking still moves THAT subject to ITS OWN slot (issue #101 model).
    await moveButton(page, BIOLOGY.name).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(
      schedule(page).getByText("Moved to late testing").first(),
    ).toBeVisible();
  });

  test("AC4 — N≥3 midway: the moving indicator keeps its destination and the remaining buttons keep theirs; a partial dismiss resets cleanly", async ({
    page,
  }) => {
    await seedSelection(
      page,
      TRIO.map((s) => s.id),
    );
    await page.goto("/");
    await openList(page);

    const [first, ...rest] = TRIO;
    await moveButton(page, first.name).click();

    // The clicked row became the indicator — and did NOT lose its slot info.
    await expect(movingIndicator(page)).toHaveCount(1);
    await expect(movingIndicator(page)).toContainText(
      new RegExp(`Moving .*${first.name} to late testing`),
    );
    await expect(movingIndicator(page)).toContainText(destinationOf(first));

    // The two remaining rows are still buttons, each with its own destination.
    await expect(
      prompt(page).first().getByRole("button", { name: /^Move .+ to late/ }),
    ).toHaveCount(2);
    for (const s of rest) {
      await expect(moveButton(page, s.name)).toContainText(destinationOf(s));
    }
    expect(await storedResolutions(page)).toHaveLength(0);

    // Dismissing midway discards the partial moving-set: every member is back
    // as a Move button, destination included.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(movingIndicator(page)).toHaveCount(0);
    for (const s of TRIO) {
      await expect(moveButton(page, s.name)).toContainText(destinationOf(s));
    }
    expect(await storedResolutions(page)).toHaveLength(0);
  });

  test("AC5 — no member of a shipped-dataset conflict falls back to the inert no-late-slot row", async ({
    page,
  }) => {
    // The schema requires a late-testing slot for every subject with a regular
    // exam, so the defensive row is unreachable in the browser. Its rendering
    // contract is pinned by src/lib/conflict-rows.test.ts (pnpm test:unit);
    // this asserts the guard never fires on real data.
    await seedSelection(page, [
      BIOLOGY.id,
      ITALIAN.id,
      ...TRIO.map((s) => s.id),
    ]);
    await page.goto("/");
    await openList(page);

    await expect(prompt(page).first()).toBeVisible();
    await expect(page.getByTestId("conflict-no-late-slot")).toHaveCount(0);
  });

  test("AC6 — the calendar's click-a-conflicted-event host shows the identical merged design", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");

    await page
      .locator(`[data-testid="calendar-block"][data-subject-id="${BIOLOGY.id}"]`)
      .locator("button")
      .click();
    await expect(prompt(page).first()).toBeVisible();
    await expect(prompt(page).first().locator("ul")).toHaveCount(0);
    for (const s of [BIOLOGY, ITALIAN]) {
      await expect(moveButton(page, s.name)).toContainText(destinationOf(s));
    }
  });

  test("AC7 — 375×667: both button lines pass axe (contrast) and the button stays a ≥44px tap target, light and dark", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seedSelection(page, [BIOLOGY.id, ITALIAN.id]);
    await page.goto("/");
    await openList(page);

    const button = moveButton(page, BIOLOGY.name);
    await expect(button).toBeVisible();

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });

      const box = await button.boundingBox();
      expect(box, `${scheme}: move button not visible`).not.toBeNull();
      expect(
        box!.height,
        `${scheme}: move button height ${box!.height}px must be ≥ 44px`,
      ).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);

      await page.evaluate(async () => {
        const done = Promise.all(
          document.getAnimations().map((a) => a.finished.catch(() => {})),
        );
        await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
      });
      const results = await new AxeBuilder({ page })
        .include('[data-testid="conflict-prompt"]')
        .exclude("nextjs-portal")
        .analyze();
      const severe = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        severe,
        `axe (conflict prompt, ${scheme}): expected zero serious/critical, got:\n` +
          JSON.stringify(
            severe.map((v) => ({ id: v.id, help: v.help })),
            null,
            2,
          ),
      ).toEqual([]);
    }
  });
});
