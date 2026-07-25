import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";
import { SCHEDULES_KEY, seedKey } from "./support/scroll-shift";

/**
 * Issue #75 — QA evidence pass (super-board Tester, v1).
 *
 * The Builder's `issue-75-scroll-lock-sticky.spec.ts` owns the behavioural
 * assertions. This file owns AC7: the visual record, at the three standard
 * super-board viewports, in both colour schemes, for both dialogs the issue
 * names by hand — every shot taken **while the page is scrolled**, because a
 * screenshot at scroll top proves nothing about this bug.
 *
 * 375 is included even though the symptom is desktop-only by construction
 * (`Sidebar.tsx` gates `lg:sticky`, so below 1024px there is no pinned column
 * to lose). The point of the mobile shots is the other half of the claim: the
 * fix changed a lock that every viewport shares, so mobile has to be shown
 * *unharmed*, not assumed to be.
 *
 * Assertions are kept in the shot loop deliberately — a screenshot of a dialog
 * that silently failed to open is worse than no screenshot, so each capture is
 * gated on the dialog being visible and, above `lg`, on the sidebar still being
 * where it was before the dialog opened.
 */

const EVIDENCE_DIR = evidenceDir("issue-75-qa-v1");
const SIDEBAR = "[data-testid='resources-sidebar']";

/** run.md's standard capture set. `lg` is 1024px, so only the first two have a
 *  sticky column and can exhibit (or refute) the bug. */
const VIEWPORTS = [
  { label: "desktop", size: { width: 1920, height: 1080 }, sticky: true },
  { label: "tablet", size: { width: 1024, height: 768 }, sticky: true },
  { label: "mobile", size: { width: 375, height: 667 }, sticky: false },
] as const;

type Box = { x: number; y: number; width: number; height: number };

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

async function scrollDeep(page: Page, wanted = 1200): Promise<number> {
  return page.evaluate((w) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.min(w, max)));
    return window.scrollY;
  }, wanted);
}

/** Open `dialog` via `opener`, retrying the click until it lands — a click
 *  fired before React hydrates is swallowed (see e2e/support/hydration.ts). */
async function openDialog(opener: Locator, dialog: Locator) {
  await expect(async () => {
    if ((await dialog.count()) === 0) await opener.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** The exam-details opener on the LAST catalog chip: deep in the document by
 *  construction, so Playwright's scroll-into-view on click cannot yank the page
 *  back to the top and vacate this spec's "while scrolled" premise. */
async function deepExamDetailsOpener(page: Page): Promise<Locator> {
  const expander = page
    .getByRole("button", { name: /^Show exam dates for / })
    .last();
  await expect(expander).toBeVisible();
  const subject = ((await expander.getAttribute("aria-label")) ?? "").replace(
    /^Show exam dates for /,
    "",
  );
  expect(subject, "could not read the subject off the last chip").not.toBe("");
  const opener = page.getByRole("button", {
    name: `View exam details for ${subject}`,
  });
  await expect(async () => {
    if ((await opener.count()) === 0) await expander.click();
    await expect(opener).toBeVisible({ timeout: 1000 });
  }).toPass();
  return opener;
}

for (const { label, size, sticky } of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`AC7 evidence — ${label} ${size.width}×${size.height} ${scheme}: both dialogs open while scrolled`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await seedKey(page, SCHEDULES_KEY, {
        activeId: "sched-1",
        schedules: [
          { id: "sched-1", name: "Schedule 1", selection: [], resolutions: [] },
          { id: "sched-2", name: "Schedule 2", selection: [], resolutions: [] },
        ],
      });
      await page.goto("/");

      const shot = (name: string) =>
        page.screenshot({
          path: `${EVIDENCE_DIR}/${label}-${scheme}-${name}.png`,
        });

      const box = async (): Promise<Box | null> =>
        sticky ? (await page.locator(SIDEBAR).boundingBox())! : null;

      // Below `lg` the sidebar's sections are disclosures, collapsed by
      // default (`Sidebar.tsx`), so MY SCHEDULES — and with it the trash icon
      // that opens the delete dialog — is not rendered until it is expanded.
      // Retry-until-effect on `aria-expanded`, because a click fired before
      // React hydrates is swallowed (see e2e/support/hydration.ts).
      if (!sticky) {
        const disclosure = page.getByRole("button", { name: "My schedules" });
        await expect(async () => {
          if ((await disclosure.getAttribute("aria-expanded")) !== "true")
            await disclosure.click();
          await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        }).toPass();
      }

      // ── 1. delete-schedule confirm ──────────────────────────────────────
      const deleteOpener = page.getByRole("button", {
        name: "Delete Schedule 2",
      });
      await expect(deleteOpener).toBeVisible();
      // Scroll deep FIRST, then bring the opener into view — never the reverse.
      // Playwright's `click()` scrolls its target into view itself, so an
      // opener left off-screen makes the click move the document and the spec
      // would report a scroll jump the product never caused. Above `lg` the
      // opener rides in the sticky column and is on screen at every depth, so
      // the second step is a no-op there and the full 1200px depth is kept;
      // at 375 the sidebar is a normal block at the top of the document, so
      // the page necessarily settles back near the top for this dialog — the
      // scrolled-mobile case is carried by the exam-details shot below, whose
      // opener is deep in the catalog by construction.
      const landedDelete = await scrollDeep(page).then(async () => {
        await deleteOpener.scrollIntoViewIfNeeded();
        return scrollY(page);
      });
      const beforeDelete = await box();

      const deleteDialog = page.getByRole("dialog", {
        name: /Delete .Schedule 2./,
      });
      await openDialog(deleteOpener, deleteDialog);
      await shot("scrolled-delete-dialog");

      if (beforeDelete) {
        const during = (await page.locator(SIDEBAR).boundingBox())!;
        expect(
          Math.abs(during.y - beforeDelete.y),
          `${label} ${scheme}: sidebar y moved with the delete dialog open (${beforeDelete.y} → ${during.y})`,
        ).toBeLessThanOrEqual(1);
        await expect(page.locator(SIDEBAR)).toBeVisible();
      }
      expect(
        await scrollY(page),
        "opening the delete dialog scrolled the page",
      ).toBe(landedDelete);

      await page.keyboard.press("Escape");
      await expect(deleteDialog).toBeHidden();

      // ── 2. exam details popup ───────────────────────────────────────────
      const examOpener = await deepExamDetailsOpener(page);
      await scrollDeep(page);
      await examOpener.scrollIntoViewIfNeeded();
      const landedExam = await scrollY(page);
      expect(
        landedExam,
        "precondition: the exam-details shot must be taken while scrolled — a screenshot at scroll top proves nothing about this bug",
      ).toBeGreaterThan(200);
      const beforeExam = await box();

      const examDialog = page.getByRole("dialog");
      await openDialog(examOpener, examDialog);
      await shot("scrolled-exam-details-dialog");

      if (beforeExam) {
        const during = (await page.locator(SIDEBAR).boundingBox())!;
        expect(
          Math.abs(during.y - beforeExam.y),
          `${label} ${scheme}: sidebar y moved with the exam-details dialog open (${beforeExam.y} → ${during.y})`,
        ).toBeLessThanOrEqual(1);
        await expect(page.locator(SIDEBAR)).toBeVisible();
      }
      expect(
        await scrollY(page),
        "opening the exam-details dialog scrolled the page",
      ).toBe(landedExam);

      await page.keyboard.press("Escape");
      await expect(examDialog).toBeHidden();
    });
  }
}
