import { test, expect, type Page } from "@playwright/test";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board Build (issue #71 AC6) — a published exam qualifier reaches the
 * SCHEDULE surfaces, not just the two catalog ones.
 *
 * Context: #37 added AP Networking, whose exam College Board lists as
 * "Networking (2026-27 pilot schools only)", and disclosed that qualifier on the
 * catalog chip (Tier-1) and in the details dialog. #37 was explicitly forbidden
 * from touching other UI, so the List row, the calendar block, and the
 * .ics/.txt/.png exports all printed a bare "May 7 · PM" — a published date
 * without its published restriction, which reads as an exam anyone can sit.
 *
 * This spec is the browser-observable half of AC6. The pure cross-surface
 * contract (schedule entry → calendar block → ics/txt/json/png models) is pinned
 * by `src/lib/exam-note.test.ts`; a PNG's pixels are not assertable here, so the
 * two suites are complements, not duplicates.
 *
 * Everything is derived from the dataset — subject id, note text, and date are
 * never hardcoded — so the next annual swap re-points it automatically and the
 * spec skips cleanly in a cycle that publishes no qualifier.
 *
 * Evidence: the `issue-71-build-v1` folder resolved by `evidenceDir()` (see
 * e2e/support/evidence.ts — AC7 of the same issue).
 */

const EVIDENCE_DIR = evidenceDir("issue-71-build-v1");

/** Kept in sync with `src/lib/schedule.ts` — see EXAM_NOTE_LABEL there. */
const NOTE_LABEL = "Published note";

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam !== null);

const SELECTION_KEY = "apx.selection.v1";

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
  );
}

const scheduleSection = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');

test.describe("issue #71 AC6 — published exam qualifier on the schedule surfaces", () => {
  test.skip(!NOTED, "this cycle's dataset publishes no examNote");

  test("List view prints the verbatim qualifier on the exam row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(page, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "List");

    const note = scheduleSection(page).getByTestId("schedule-exam-note");
    await expect(note).toBeVisible();
    // Verbatim, with the class label in front of it — never a paraphrase.
    await expect(note).toContainText(`${NOTE_LABEL}:`);
    await expect(note).toContainText(NOTED!.examNote!);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-list-row-desktop.png`,
      fullPage: true,
    });
  });

  test("List view leaves an unqualified exam row alone (no empty note element)", async ({
    page,
  }) => {
    const plain = SUBJECTS.find((s) => !s.examNote && s.exam !== null)!;
    await seedSelection(page, [plain.id]);
    await page.goto("/");
    await pressViewChip(page, "List");
    await expect(scheduleSection(page).getByText(plain.name)).toBeVisible();
    await expect(
      scheduleSection(page).getByTestId("schedule-exam-note"),
    ).toHaveCount(0);
  });

  test("Calendar block carries the marker on its face and the verbatim text in its accessible name", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seedSelection(page, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");

    const block = page
      .getByTestId("calendar-block")
      .filter({ has: page.getByTestId("block-exam-note") });
    await expect(block).toHaveCount(1);
    // The face carries only the label — a duration-proportional block cannot
    // hold a paragraph legibly.
    await expect(block.getByTestId("block-exam-note")).toHaveText(NOTE_LABEL);
    // …and the FULL qualifier is in the accessible name, so nothing is lost for
    // screen-reader and keyboard users.
    const button = block.getByRole("button");
    await expect(button).toHaveAccessibleName(
      new RegExp(escapeRegExp(NOTED!.examNote!)),
    );

    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-calendar-block-desktop.png`,
      fullPage: true,
    });
  });

  test("Activating the calendar block opens the details dialog with the verbatim qualifier", async ({
    page,
  }) => {
    await seedSelection(page, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");
    await page
      .getByTestId("calendar-block")
      .filter({ has: page.getByTestId("block-exam-note") })
      .getByRole("button")
      .click();
    await expect(page.getByRole("dialog")).toContainText(NOTED!.examNote!);
  });

  test(".ics DESCRIPTION and .txt line both carry the verbatim qualifier", async ({
    page,
  }) => {
    await seedSelection(page, [NOTED!.id]);
    await page.goto("/");

    for (const item of ["Save as .ics", "Save as .txt"] as const) {
      const trigger = page.getByRole("button", { name: "Export" });
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const menuItem = page.getByRole("menuitem", { name: item, exact: true });
      await expect(menuItem).toBeVisible();
      const downloadPromise = page.waitForEvent("download");
      await menuItem.click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      // The .ics folds long lines at 75 octets (RFC 5545 §3.1) and escapes
      // commas/semicolons in TEXT values; unfold and unescape before matching.
      const body = Buffer.concat(chunks)
        .toString("utf8")
        .replace(/\r\n /g, "")
        .replace(/\\([,;])/g, "$1");
      expect(body, `${item} lost the ${NOTE_LABEL} label`).toContain(
        `${NOTE_LABEL}:`,
      );
      expect(body, `${item} lost the verbatim qualifier`).toContain(
        NOTED!.examNote!,
      );
    }
  });

  // Standard evidence viewports (PROJECT.md). The qualifier is a paragraph on a
  // narrow row, so the wrap is the thing worth pinning at every width.
  const VIEWPORTS = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`evidence — List and Calendar qualifier at ${vp.name} ${vp.width}x${vp.height} with no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, [NOTED!.id]);
      await page.goto("/");

      await pressViewChip(page, "List");
      await expect(
        scheduleSection(page).getByTestId("schedule-exam-note"),
      ).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac6-list-${vp.name}.png`,
        fullPage: true,
      });
      // PROJECT.md convention: no horizontal scroll (asserted at every width,
      // not just 375, because the note is the widest string on the row).
      expect(await horizontalOverflow(page)).toBe(0);

      await pressViewChip(page, "Calendar");
      await expect(page.getByTestId("block-exam-note")).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/ac6-calendar-${vp.name}.png`,
        fullPage: true,
      });
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
