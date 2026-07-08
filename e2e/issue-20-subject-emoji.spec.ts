import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2026.json";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #20) — decorative subject emoji next to every name.
 *
 * One observable browser-level assertion per acceptance criterion, plus
 * screenshot capture at the three standard super-board viewports (desktop
 * 1920x1080, tablet 1024x768, mobile 375x667). Screenshots are written to the
 * run evidence folder and committed to the issue branch so they render inline
 * on the issue / PR.
 *
 * ACs covered here (browser-observable):
 *   AC1 — complete coverage: every one of the 42 catalog cards renders a
 *         non-blank leading emoji glyph.
 *   AC2 — the emoji appears next to the name on every surface: catalog grid,
 *         schedule list, conflict prompt's subject list, and info-panel title.
 *   AC3 — the emoji is decorative for assistive tech: the emoji spans are
 *         aria-hidden, so the accessible name of a card is the subject name
 *         WITHOUT the emoji glyph (a role query by the glyph finds nothing).
 * AC4 (emoji-free ICS) and AC5 (per-id coverage) are pinned by unit tests
 * (`src/lib/ics.test.ts`, `src/lib/subject-emoji.test.ts`) run under
 * `pnpm test:unit`; this spec covers the visual/interaction surface.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-20-qa-v1";
const TOTAL_SUBJECTS = 42;

type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
};
const SUBJECTS = (apData as { subjects: Subject[] }).subjects;

// A handful of hand-picked glyphs to spot-check the map end-to-end in the DOM.
const BIOLOGY_EMOJI = "🧬";
const US_HISTORY_EMOJI = "🗽";
const LATIN_EMOJI = "📜";
const CALCULUS_AB_EMOJI = "➗";

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
// Select toggle = the button carrying aria-pressed (issue #6 adds a second
// per-card "View exam details" button that has no aria-pressed).
const cards = (page: Page) =>
  catalog(page).locator("ul > li button[aria-pressed]");
const card = (page: Page, name: string) =>
  cards(page).filter({ hasText: name });
// The decorative emoji spans injected by <SubjectName/>.
const emojiSpans = (scope: ReturnType<typeof card>) =>
  scope.locator('span[aria-hidden="true"].select-none');

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const conflictPrompt = (page: Page) =>
  page.getByTestId("conflict-prompt");

async function select(page: Page, name: string) {
  const c = card(page, name);
  // No explicit scrollIntoViewIfNeeded: click() auto-scrolls and retries if
  // the element detaches while the issue #22 mobile layout mounts post-hydration.
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

/**
 * The CALENDAR is now the default view (issue #19 bounce item B6); the
 * schedule LIST rows and the auto-raised conflict prompt these tests assert
 * against live in the list view, so switch to it first.
 * The press is hydration-safe (see e2e/support/view-chip.ts).
 */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

test.describe("issue #20 — decorative subject emoji everywhere the name shows", () => {
  test("AC1 — every catalog card renders a non-blank leading emoji (complete coverage, all 42)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page)).toHaveCount(TOTAL_SUBJECTS);

    // Every card carries exactly one decorative emoji span, and none is blank.
    for (const subject of SUBJECTS) {
      const c = card(page, subject.name);
      const span = emojiSpans(c).first();
      await expect(
        span,
        `card "${subject.name}" is missing its decorative emoji span`,
      ).toHaveCount(1);
      const glyph = (await span.textContent())?.trim() ?? "";
      expect(
        glyph.length,
        `card "${subject.name}" (${subject.id}) rendered a BLANK emoji`,
      ).toBeGreaterThan(0);
    }

    // Spot-check specific hand-picked glyphs actually reach the DOM.
    await expect(card(page, "AP Biology")).toContainText(BIOLOGY_EMOJI);
    await expect(card(page, "AP United States History")).toContainText(
      US_HISTORY_EMOJI,
    );
    await expect(card(page, "AP Calculus AB")).toContainText(CALCULUS_AB_EMOJI);
  });

  test("AC3 — the emoji is aria-hidden: accessible name is the subject name WITHOUT the glyph", async ({
    page,
  }) => {
    await page.goto("/");

    // The emoji span carries aria-hidden="true".
    const bioEmoji = emojiSpans(card(page, "AP Biology")).first();
    await expect(bioEmoji).toHaveAttribute("aria-hidden", "true");
    await expect(bioEmoji).toHaveText(BIOLOGY_EMOJI);

    // The card's ACCESSIBLE NAME (name-matched role query) resolves by the
    // plain subject name but NOT by the emoji glyph — proof a screen reader
    // announces "AP Biology", never "AP Biology dna double helix".
    await expect(
      page.getByRole("button", { name: "AP Biology", exact: false }),
    ).not.toHaveCount(0);
    await expect(
      page.getByRole("button", { name: BIOLOGY_EMOJI }),
    ).toHaveCount(0);

    // Cross-check the accessibility tree directly: the card's aria snapshot
    // (the computed AX view a screen reader consumes) names the button by the
    // subject name and never surfaces the aria-hidden emoji glyph.
    const axYaml = await card(page, "AP Biology").first().ariaSnapshot();
    expect(axYaml).toContain("AP Biology");
    expect(
      axYaml,
      `aria snapshot leaked the emoji glyph:\n${axYaml}`,
    ).not.toContain(BIOLOGY_EMOJI);
  });

  test("AC2 — emoji shows on schedule rows and the conflict prompt's subject list", async ({
    page,
  }) => {
    await page.goto("/");

    // Select AP Biology + AP Latin: they share the 2026-05-04 AM slot, so this
    // both populates the schedule AND raises the conflict prompt (issue #5).
    await select(page, "AP Biology");
    await select(page, "AP Latin");
    await openList(page);

    // Schedule list rows carry the emoji next to the name.
    await expect(schedule(page)).toContainText(BIOLOGY_EMOJI);
    await expect(schedule(page)).toContainText(LATIN_EMOJI);

    // Conflict prompt is up, and its bulleted subject list carries the emoji.
    await expect(conflictPrompt(page)).toContainText("Exam time conflict");
    await expect(
      conflictPrompt(page).locator("ul > li").filter({ hasText: "AP Biology" }),
    ).toContainText(BIOLOGY_EMOJI);
    await expect(
      conflictPrompt(page).locator("ul > li").filter({ hasText: "AP Latin" }),
    ).toContainText(LATIN_EMOJI);
  });

  test("AC2 — emoji shows in the info-panel title (and stays aria-hidden there)", async ({
    page,
  }) => {
    await page.goto("/");

    // Open the panel via the chip's Tier-1 disclosure (issues #22/#24: the
    // details button lives inside the expanded panel at every width) — no
    // conflicting selection so no modal overlay intercepts the click.
    await page
      .getByRole("button", { name: "Show exam dates for AP Biology" })
      .click();
    await page
      .getByRole("button", { name: "View exam details for AP Biology" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "AP Biology" }),
    ).toContainText(BIOLOGY_EMOJI);
    // Dialog title's emoji is also aria-hidden (accessible heading name clean).
    await expect(
      dialog.getByRole("heading", { name: BIOLOGY_EMOJI }),
    ).toHaveCount(0);
  });

  // ---- Screenshot evidence at the three standard viewports ----------------
  const VIEWPORTS = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`evidence — catalog + schedule with emoji at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      // Populate the schedule + raise a conflict so one screenshot shows the
      // emoji across the catalog, the schedule rows, and the conflict prompt.
      await select(page, "AP Biology");
      await select(page, "AP Latin");
      await openList(page);
      await expect(conflictPrompt(page)).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}.png`,
        fullPage: true,
      });
    });
  }

  test("evidence — info panel title with emoji (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    // Issues #22/#24: reveal the Tier-1 panel to reach the details button.
    await page
      .getByRole("button", { name: "Show exam dates for AP Biology" })
      .click();
    await page
      .getByRole("button", { name: "View exam details for AP Biology" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/info-panel-desktop.png`,
    });
  });
});
