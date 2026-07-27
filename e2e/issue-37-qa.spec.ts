import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { LATE_TESTING_WINDOW, REGULAR_WINDOWS } from "../src/data/schema";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #37) — annual dataset swap to the May 2027 cycle.
 *
 * One browser-observable test per acceptance criterion that a user can see.
 * The data-provenance ACs (AC1/AC2/AC4/AC5) are verified against College
 * Board's live pages in the QA report and pinned at the data layer by
 * `src/data/ap-2027.*.test.ts`; what this spec adds is the part only the
 * running app can prove: that the swapped dataset actually reaches every
 * cycle-derived surface, that no 2026 label survived anywhere a user can read
 * one, and that a saved plan from the previous cycle does not take the app
 * down (AC8).
 *
 * Everything is derived from the dataset — no date, subject name, or count is
 * hardcoded here. A future swap re-points these assertions automatically,
 * which is the property AC6 is actually about.
 */

/**
 * Where the visual-evidence tests write. The per-spec `QA_EVIDENCE_DIR`
 * override this spec introduced is now the shared `evidenceDir()` helper
 * (issue #71 AC7), so a default `pnpm test:e2e` no longer rewrites ANY
 * committed evidence folder — see e2e/support/evidence.ts.
 */
const EVIDENCE_DIR = evidenceDir("issue-37-qa-v1");

type Slot = { date: string; session: "AM" | "PM" } | null;
type Subject = {
  id: string;
  name: string;
  exam: Slot;
  lateTesting: Slot;
  portfolio: { deadline: string } | null;
  examNote?: string;
  passRate?: number;
  format: { totalMinutes?: number; sections: unknown[] };
};
const DATASET = apData as unknown as {
  cycle: string;
  lastVerified: string;
  subjects: Subject[];
};
const CYCLE = DATASET.cycle; // "May 2027"
const CYCLE_YEAR = CYCLE.split(" ")[1]; // "2027"
const PREVIOUS_YEAR = String(Number(CYCLE_YEAR) - 1); // "2026"
const SUBJECTS = DATASET.subjects;

/** A subject with a published exam AND a published pass rate. */
const DATED = SUBJECTS.find(
  (s) => s.exam !== null && typeof s.passRate === "number",
)!;
/** A subject College Board schedules but publishes no exam format for. */
const NO_PUBLISHED_FORMAT = SUBJECTS.find(
  (s) => s.exam !== null && s.format.totalMinutes === undefined,
);

const SELECTION_KEY = "apx.selection.v1";
const SCHEDULES_KEY = "apx.schedules.v1";

async function seed(page: Page, key: string, value: unknown) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, JSON.stringify(value)] as const,
  );
}

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const chipToggle = (page: Page, name: string) =>
  catalog(page).locator("ul > li button[aria-pressed]").filter({ hasText: name });

/**
 * Expand a chip's Tier-1 disclosure (hydration-safe).
 *
 * The click is retried until the button reports `aria-expanded="true"` — the
 * app's own signal that React attached the handler — but never fired while it
 * already reads true, because a second click on a live disclosure collapses it
 * again and the loop would oscillate instead of converging.
 */
async function expandChip(page: Page, subject: Subject) {
  const expander = page.getByRole("button", {
    name: `Show exam dates for ${subject.name}`,
  });
  await expect(async () => {
    if ((await expander.getAttribute("aria-expanded")) !== "true") {
      await expander.click();
    }
    await expect(expander).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();
}

/** Every string a user can actually read on the current page. */
function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test.describe("issue #37 — annual dataset swap to the May 2027 cycle", () => {
  test("AC6 — every cycle-derived label reads the new cycle: banner, footer, resources, page description", async ({
    page,
  }) => {
    await page.goto("/");

    // Schedule banner (ScheduleViews) — reads apData.cycle.
    await expect(
      page.getByText(`Dates reflect the ${CYCLE} AP exam cycle.`),
    ).toBeVisible();

    // Footer attribution.
    await expect(page.getByTestId("site-footer")).toContainText(
      `${CYCLE} cycle`,
    );

    // Resources labels built from the `{cycle}` token.
    const sidebar = page.getByTestId("resources-sidebar");
    await expect(
      sidebar.getByRole("link", { name: new RegExp(`^${CYCLE} AP Exam dates`) }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", {
        name: new RegExp(`^${CYCLE} AP late-testing dates`),
      }),
    ).toBeVisible();

    // Document description metadata.
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain(CYCLE);
    expect(description).not.toContain(PREVIOUS_YEAR);
  });

  test(`AC6 — no "${PREVIOUS_YEAR}" survives in any rendered surface (catalog, list, calendar, details, resources)`, async ({
    page,
  }) => {
    // A plan wide enough to render dated rows across both testing weeks and a
    // portfolio deadline, but with at most ONE subject per (date, session)
    // slot: a same-slot pair opens the conflict dialog on load, which would
    // cover the surfaces this test is here to read.
    const takenSlots = new Set<string>();
    const selected = SUBJECTS.filter((s) => {
      if (s.exam === null) return s.portfolio !== null;
      const slot = `${s.exam.date}|${s.exam.session}`;
      if (takenSlots.has(slot)) return false;
      takenSlots.add(slot);
      return true;
    })
      .slice(0, 12)
      .map((s) => s.id);
    await seed(page, SELECTION_KEY, selected);
    await page.goto("/");

    // Default (calendar) view.
    expect(await visibleText(page)).not.toContain(PREVIOUS_YEAR);

    // List view.
    await pressViewChip(page, "List");
    await expect(
      page.locator('section[aria-label="My schedule"]'),
    ).toBeVisible();
    expect(await visibleText(page)).not.toContain(PREVIOUS_YEAR);

    // Exam-details dialog for a dated subject.
    await expandChip(page, DATED);
    await page
      .getByRole("button", { name: `View exam details for ${DATED.name}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.innerText()).not.toContain(PREVIOUS_YEAR);
    await page.keyboard.press("Escape");

    // Resources page.
    await page.goto("/resources");
    expect(await visibleText(page)).not.toContain(PREVIOUS_YEAR);
  });

  test("AC3/AC6 — the calendar pager derives its weeks from the published 2027 windows", async ({
    page,
  }) => {
    // Select one subject in each regular window plus one that has late
    // testing, so all three week pages carry content.
    const spread = REGULAR_WINDOWS.map(
      (w) => SUBJECTS.find((s) => s.exam && s.exam.date >= w.start && s.exam.date <= w.end)!,
    ).map((s) => s.id);
    await seed(page, SELECTION_KEY, spread);
    await page.goto("/");

    const indicator = page.getByTestId("calendar-week-indicator");
    await expect(indicator).toBeVisible();

    // Every window in the schema is a page, and each page's range label names
    // that window's month/day — pinning the pager to the 2027 constants.
    const windows = [...REGULAR_WINDOWS, LATE_TESTING_WINDOW];
    await expect(indicator).toContainText(`of ${windows.length}`);

    const monthDay = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    };

    for (let i = 0; i < windows.length; i += 1) {
      await expect(indicator).toContainText(`Week ${i + 1} of ${windows.length}`);
      await expect(indicator).toContainText(monthDay(windows[i].start));
      await expect(indicator).toContainText(monthDay(windows[i].end));
      if (i < windows.length - 1) {
        await page
          .getByTestId("calendar-pager")
          .getByRole("button", { name: /^Next week/ })
          .click();
      }
    }
  });

  test("AC1/AC2 — the catalog renders the full published 2027 roster, and a schedule-only exam carries its published qualifier", async ({
    page,
  }) => {
    await page.goto("/");

    // Roster size comes from the dataset — the catalog must show all of it.
    const cards = catalog(page).locator("ul > li button[aria-pressed]");
    await expect(cards).toHaveCount(SUBJECTS.length);

    // Any subject whose exam carries a published qualifier must render it on
    // BOTH surfaces that print the exam date — a bare date would read as an
    // exam any student can sit. Tier 1 is the chip's disclosure; Tier 2 is the
    // "Full exam details" dialog, which prints the date in its own header.
    const noted = SUBJECTS.filter((s) => s.examNote);
    expect(
      noted.length,
      "fixture: the 2027 dataset ships at least one examNote",
    ).toBeGreaterThan(0);
    for (const subject of noted) {
      await expandChip(page, subject);
      await expect(page.getByText(subject.examNote!)).toBeVisible();

      await page
        .getByRole("button", { name: `View exam details for ${subject.name}` })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(subject.examNote!);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });

  test("AC1/AC4 — an unpublished value renders as a visible dash, never a fabricated number", async ({
    page,
  }) => {
    test.skip(
      !NO_PUBLISHED_FORMAT,
      "no scheduled subject ships an entirely unpublished format this cycle",
    );
    await page.goto("/");

    // Published pass rate renders as a real percentage.
    await expandChip(page, DATED);
    await page
      .getByRole("button", { name: `View exam details for ${DATED.name}` })
      .click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`${DATED.passRate as number}%`);
    await page.keyboard.press("Escape");

    // An unpublished value renders as the dash + its sr-only text, with no
    // invented numbers and — since issue #84 — no "pending" badge anywhere.
    await expandChip(page, NO_PUBLISHED_FORMAT!);
    await page
      .getByRole("button", {
        name: `View exam details for ${NO_PUBLISHED_FORMAT!.name}`,
      })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("none published").first()).toHaveCount(1);
    await expect(dialog.getByText("pending", { exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText("%");
    // No section table can appear for an exam with no published sections.
    expect(NO_PUBLISHED_FORMAT!.format.sections).toHaveLength(0);
  });

  test("AC6 — the ICS export is named for the new cycle and its dates land in the published 2027 windows", async ({
    page,
  }) => {
    await seed(page, SELECTION_KEY, [DATED.id]);
    await page.goto("/");

    await page.getByTestId("export-menu-button").click();
    const item = page.getByRole("menuitem", { name: "Save as .ics" });
    await expect(item).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await item.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`ap-exams-${CYCLE_YEAR}.ics`);

    const path = await download.path();
    const ics = readFileSync(path, "utf8");
    const starts = [...ics.matchAll(/DTSTART[^:]*:(\d{8})/g)].map((m) => m[1]);
    expect(starts.length).toBeGreaterThan(0);
    for (const stamp of starts) {
      const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
      const inWindow = [...REGULAR_WINDOWS, LATE_TESTING_WINDOW].some(
        (w) => iso >= w.start && iso <= w.end,
      );
      expect(inWindow, `ICS DTSTART ${iso} is outside the published windows`).toBe(
        true,
      );
    }
  });

  test("AC8 — a saved plan carrying a subject id that no longer exists renders without crashing", async ({
    page,
  }) => {
    const STALE = "ap-course-retired-after-2026";
    expect(SUBJECTS.some((s) => s.id === STALE)).toBe(false);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    // A full previous-cycle store: an active schedule whose selection mixes a
    // live id with a retired one, plus a resolution naming only retired ids.
    await seed(page, SCHEDULES_KEY, {
      activeId: "prev-cycle",
      schedules: [
        {
          id: "prev-cycle",
          name: "Last year's plan",
          selection: [DATED.id, STALE],
          resolutions: [
            {
              date: DATED.exam!.date,
              session: DATED.exam!.session,
              keeperId: STALE,
              memberIds: [STALE, "another-retired-course"],
            },
          ],
        },
      ],
    });
    await page.goto("/");

    // The app is alive and the saved schedule survived the swap by name.
    await expect(
      page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
    ).toBeVisible();
    await expect(page.getByTestId("resources-sidebar")).toContainText(
      "Last year's plan",
    );

    // The still-published subject keeps its selection…
    await expect(chipToggle(page, DATED.name).first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // …and the retired id contributes nothing rather than a phantom row.
    await pressViewChip(page, "List");
    const schedule = page.locator('section[aria-label="My schedule"]');
    await expect(schedule).toBeVisible();
    await expect(schedule).toContainText(DATED.name);
    expect(await visibleText(page)).not.toContain(STALE);

    expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
    expect(
      consoleErrors.filter((t) => !/favicon/i.test(t)),
      `console errors: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
  });

  test("AC5 — the shipped dataset declares the cycle and fetch date the sources file documents", async ({
    page,
  }) => {
    // Browser-side proof that the app is serving the 2027 dataset (not a
    // stale bundle): the footer's cycle and the calendar's dates both come
    // from the same JSON the sources file was written for.
    await page.goto("/");
    await expect(page.getByTestId("site-footer")).toContainText(CYCLE);
    expect(DATASET.lastVerified.startsWith(PREVIOUS_YEAR)).toBe(true);
    expect(CYCLE).toMatch(/^May \d{4}$/);
  });
});

test.describe("issue #37 — visual evidence", () => {
  const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ] as const;

  for (const vp of viewports) {
    test(`evidence — planner with a 2027 plan (${vp.name} ${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      const spread = REGULAR_WINDOWS.map(
        (w) =>
          SUBJECTS.find(
            (s) => s.exam && s.exam.date >= w.start && s.exam.date <= w.end,
          )!,
      ).map((s) => s.id);
      await seed(page, SELECTION_KEY, spread);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(
        page.getByText(`Dates reflect the ${CYCLE} AP exam cycle.`),
      ).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${vp.name}.png`,
        fullPage: true,
      });
    });
  }

  test("evidence — the schedule-only exam's published qualifier (desktop)", async ({
    page,
  }) => {
    const noted = SUBJECTS.find((s) => s.examNote);
    test.skip(!noted, "no examNote in this cycle");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expandChip(page, noted!);
    await expect(page.getByText(noted!.examNote!)).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/exam-note-desktop.png`,
      fullPage: true,
    });

    // Tier 2 — the "Full exam details" dialog prints its own exam-date header,
    // so it needs the qualifier as much as the chip does. Captured separately
    // because it is a different surface, not a different state of the same one.
    await page
      .getByRole("button", { name: `View exam details for ${noted!.name}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(noted!.examNote!);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/exam-note-details-dialog-desktop.png`,
      fullPage: true,
    });
  });

  test("evidence — calendar week pager across the published 2027 windows (desktop)", async ({
    page,
  }) => {
    const spread = REGULAR_WINDOWS.map(
      (w) =>
        SUBJECTS.find(
          (s) => s.exam && s.exam.date >= w.start && s.exam.date <= w.end,
        )!,
    ).map((s) => s.id);
    await seed(page, SELECTION_KEY, spread);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    const indicator = page.getByTestId("calendar-week-indicator");
    await expect(indicator).toContainText("Week 1 of");
    await page.screenshot({
      path: `${EVIDENCE_DIR}/calendar-week1-desktop.png`,
      fullPage: true,
    });
    await page
      .getByTestId("calendar-pager")
      .getByRole("button", { name: /^Next week/ })
      .click();
    await expect(indicator).toContainText("Week 2 of");
    await page.screenshot({
      path: `${EVIDENCE_DIR}/calendar-week2-desktop.png`,
      fullPage: true,
    });
  });

  test("evidence — a stale saved subject id degrades gracefully (desktop)", async ({
    page,
  }) => {
    await seed(page, SCHEDULES_KEY, {
      activeId: "prev-cycle",
      schedules: [
        {
          id: "prev-cycle",
          name: "Last year's plan",
          selection: [DATED.id, "ap-course-retired-after-2026"],
          resolutions: [],
        },
      ],
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await pressViewChip(page, "List");
    await expect(
      page.locator('section[aria-label="My schedule"]'),
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/stale-id-desktop.png`,
      fullPage: true,
    });
  });
});
