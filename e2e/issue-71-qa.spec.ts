import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #71) — independent verification of AC6, plus the two
 * paths the Builder's own suites cannot reach.
 *
 * ## What the Builder already pinned, and why this suite is not a duplicate
 *
 * `src/lib/exam-note.test.ts` asserts the MODEL: `buildSchedule` copies the
 * verbatim `examNote` onto the exam entry, and it survives into the calendar
 * block, the `.ics` DESCRIPTION, the `.txt` line, the `.json` record, the
 * `WeekCardRow`, and the PNG calendar card's block. `e2e/issue-71-exam-note.spec.ts`
 * asserts the two React render sites and the `.ics`/`.txt` downloads.
 *
 * Two gaps remain, and both are where the risk actually sits:
 *
 * 1. **The PNG RENDERERS.** Every existing assertion stops at the card model
 *    (`row.examNote` / `block.examNote`). Delete the `if (row.examNote)` branch
 *    in `src/lib/export-png.ts`, or `renderNotesStrip` in
 *    `src/lib/export-png-calendar.ts`, and the whole suite still goes green
 *    while the exported image silently loses the qualifier — the exact defect
 *    AC6 exists to prevent, on the one surface that has no tooltip, no
 *    accessible name and no dialog to fall back to. There is no DOM environment
 *    in the vitest setup (no jsdom/happy-dom) to render those nodes, so this
 *    suite observes them where they really run: `captureCardPng`
 *    (src/lib/export-card-theme.ts) attaches the finished card node to
 *    `document.body` inside an off-screen holder before rasterizing, so a
 *    MutationObserver installed pre-navigation captures the exact DOM that
 *    becomes the PNG.
 *
 * 2. **The moved-to-late path.** AP Networking shares 2027-05-07 PM with AP
 *    Macroeconomics, so a student who picks both is *prompted* to move one. A
 *    qualifier that survives at the regular slot but is dropped once conflict
 *    resolution re-points the entry would ship a bare late-testing date — and
 *    the late date is the one a pilot-schools-only restriction matters most on.
 *
 * Also covered: the `.png` downloads really are valid PNGs (the model tests
 * never rasterize), the note is disclosed in dark theme, axe finds no new
 * serious/critical violation with the paragraph on the row, and #37's two
 * catalog surfaces are still intact (this issue adds surfaces, it must not move
 * any).
 *
 * Everything is dataset-derived — subject id, note text, dates, and the
 * conflict partner are all looked up, never hardcoded — so the next annual swap
 * re-points the suite and it skips cleanly in a cycle that publishes no
 * qualifier.
 *
 * Evidence: `docs/super-board/runs/issue-71-qa-v1/` (via QA_EVIDENCE_DIR).
 */

const EVIDENCE_DIR = evidenceDir("issue-71-qa-v1");

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts. */
const NOTE_LABEL = "Published note";

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;
const WINDOWS = [
  { start: "2027-05-03", end: "2027-05-07" },
  { start: "2027-05-10", end: "2027-05-14" },
  { start: "2027-05-17", end: "2027-05-21" },
];

/** The dataset's qualified exam, or undefined in a cycle that ships none. */
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam !== null);
/** A subject sharing NOTED's exact slot — the conflict partner for AC6-QA2. */
const PARTNER = NOTED
  ? SUBJECTS.find(
      (s) =>
        s.id !== NOTED.id &&
        s.exam?.date === NOTED.exam!.date &&
        s.exam?.session === NOTED.exam!.session,
    )
  : undefined;

function weekIndexOf(iso: string): number {
  return WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);
}

async function seedKey(page: Page, key: string, value: unknown) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, JSON.stringify(value)] as const,
  );
}

/**
 * Record the textContent of every subtree attached to `document.body` after
 * load. `captureCardPng` appends the finished export card there (off-screen)
 * before rasterizing it, so this is the rendered DOM that becomes the PNG.
 * Installed pre-navigation so nothing can be attached before the observer runs.
 */
async function recordAttachedNodes(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __attached: string[] }).__attached = seen;
    // Observe `document`, NOT `document.documentElement`: an init script runs
    // before any page script, when documentElement may not exist yet — passing
    // it would throw and silently leave `seen` permanently empty (which reads
    // as "the renderer dropped the note" rather than "the harness broke").
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const el = node as HTMLElement;
          // ONLY the export holder: captureCardPng parks the finished card at
          // left:-100000px before rasterizing. Matching on that inline style
          // (rather than "any attached node whose text mentions the subject")
          // keeps the app's own hydration mutations — the catalog chip already
          // prints this note — from masquerading as export-card evidence.
          if (el.style?.left !== "-100000px") continue;
          if (el.textContent) seen.push(el.textContent);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const attachedText = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __attached: string[] }).__attached,
  );

const scheduleSection = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
const blockFor = (page: Page, subjectId: string) =>
  page.locator(
    `[data-testid="calendar-block"][data-subject-id="${subjectId}"]`,
  );
const pager = (page: Page) => page.getByTestId("calendar-pager");
const indicator = (page: Page) => page.getByTestId("calendar-week-indicator");

async function gotoWeek(page: Page, n: number) {
  for (let guard = 0; guard < 10; guard += 1) {
    const text = (await indicator(page).textContent()) ?? "";
    const match = /Week (\d+) of/.exec(text);
    if (!match) throw new Error(`no week indicator found: "${text}"`);
    const current = Number(match[1]);
    if (current === n) return;
    await pager(page)
      .getByRole("button", {
        name: current < n ? /^Next week/ : /^Previous week/,
      })
      .click();
  }
  throw new Error(`could not reach week ${n}`);
}

/** Open the Export menu and click one item, returning the download. */
async function exportItem(page: Page, label: string) {
  const trigger = page.getByRole("button", { name: "Export" });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const item = page.getByRole("menuitem", { name: label, exact: true });
  await expect(item).toBeVisible();
  const download = page.waitForEvent("download");
  await item.click();
  return download;
}

async function readDownload(page: Page, label: string): Promise<Buffer> {
  const download = await exportItem(page, label);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test.describe("issue #71 QA — published qualifier on every schedule surface", () => {
  test.skip(
    !NOTED,
    "this cycle's dataset publishes no examNote — nothing to disclose",
  );

  test("fixture guard — the dataset still supplies a qualified exam and a same-slot partner", () => {
    // If this fails the two tests below are vacuous rather than wrong: a swap
    // changed the roster, and the fixtures need re-pointing, not the product.
    expect(NOTED, "no exam-bearing examNote in the dataset").toBeTruthy();
    expect(NOTED!.examNote!.length).toBeGreaterThan(40);
    expect(
      PARTNER,
      `no subject shares ${NOTED!.name}'s ${NOTED!.exam!.date} ${NOTED!.exam!.session} slot — the moved-to-late test needs one`,
    ).toBeTruthy();
    expect(NOTED!.lateTesting, "the qualified exam has no late slot").toBeTruthy();
  });

  test("AC6-QA1 — the rasterized list-view .png prints the verbatim qualifier (not just the card model)", async ({
    page,
  }) => {
    await recordAttachedNodes(page);
    await seedKey(page, SELECTION_KEY, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "List");
    await expect(
      scheduleSection(page).getByTestId("schedule-exam-note"),
    ).toBeVisible();

    const png = await readDownload(page, "Save as list view .png");
    // A real PNG, not an error placeholder: 8-byte signature + plausible size.
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.byteLength).toBeGreaterThan(10_000);

    // The DOM that was rasterized carried the qualifier verbatim.
    const cards = await attachedText(page);
    expect(
      cards.length,
      "no export card was parked off-screen during capture — the harness saw nothing to assert on",
    ).toBeGreaterThan(0);
    const card = cards.at(-1)!;
    expect(card, "the exported list card lost the subject").toContain(
      NOTED!.name,
    );
    expect(
      card,
      "the rasterized list card dropped the qualifier — a PNG has no tooltip or dialog to defer it to",
    ).toContain(`${NOTE_LABEL}: ${NOTED!.examNote!}`);
  });

  test("AC6-QA2 — the rasterized calendar-view .png prints the qualifier in a notes strip", async ({
    page,
  }) => {
    await recordAttachedNodes(page);
    await seedKey(page, SELECTION_KEY, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");
    await expect(blockFor(page, NOTED!.id)).toBeVisible();

    const png = await readDownload(page, "Save as calendar view .png");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.byteLength).toBeGreaterThan(10_000);

    const cards = await attachedText(page);
    expect(
      cards.length,
      "no export card was parked off-screen during capture — the harness saw nothing to assert on",
    ).toBeGreaterThan(0);
    const card = cards.at(-1)!;
    // Marker on the block face, verbatim paragraph in the strip below the grid.
    expect(card).toContain(NOTED!.name);
    expect(
      card,
      `no "${NOTE_LABEL}s" strip on the rasterized calendar card — the PNG has no tooltip or dialog to defer the text to`,
    ).toContain(`${NOTE_LABEL}s`);
    expect(card).toContain(NOTED!.examNote!);
  });

  test("AC6-QA3 — the qualifier follows the exam when conflict resolution moves it to late testing", async ({
    page,
  }) => {
    const late = NOTED!.lateTesting!;
    await seedKey(page, SELECTION_KEY, [NOTED!.id, PARTNER!.id]);
    // Keep the partner at the regular slot → the qualified exam moves late.
    await seedKey(page, RESOLUTIONS_KEY, [
      {
        date: NOTED!.exam!.date,
        session: NOTED!.exam!.session,
        keeperId: PARTNER!.id,
        memberIds: [NOTED!.id, PARTNER!.id],
      },
    ]);
    await page.goto("/");

    // List: the row shows the LATE date, the moved flag, and still the note.
    await pressReadyList(page);
    // The entry <li> is nested inside a day-group <li>, so both match the
    // subject name; the entry is the one carrying the session/moved pills.
    const row = scheduleSection(page)
      .locator("li")
      .filter({ hasText: NOTED!.name })
      .last();
    await expect(row).toContainText("moved to late testing", {
      ignoreCase: true,
    });
    await expect(row.getByTestId("schedule-exam-note")).toContainText(
      NOTED!.examNote!,
    );

    // Calendar: the block on the LATE week carries both markers, and the full
    // qualifier is still in the accessible name.
    await pressViewChip(page, "Calendar");
    await gotoWeek(page, weekIndexOf(late.date) + 1);
    const block = blockFor(page, NOTED!.id);
    await expect(block).toBeVisible();
    await expect(block).toContainText("Moved to late testing");
    await expect(block.getByTestId("block-exam-note")).toHaveText(NOTE_LABEL);
    await expect(block.getByRole("button")).toHaveAccessibleName(
      new RegExp(escapeRegExp(NOTED!.examNote!)),
    );

    // …and the exports agree: the late date and the qualifier on one line.
    const txt = (await readDownload(page, "Save as .txt")).toString("utf8");
    const line = txt.split("\r\n").find((l) => l.includes(NOTED!.name))!;
    expect(line, "the .txt line lost the moved-to-late flag").toContain(
      "(moved to late testing)",
    );
    expect(line, "the .txt line lost the qualifier").toContain(
      `| ${NOTE_LABEL}: ${NOTED!.examNote!}`,
    );

    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-moved-to-late-desktop.png`,
      fullPage: true,
    });
  });

  test("AC6-QA4 — the qualifier is disclosed in dark theme too", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedKey(page, SELECTION_KEY, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "List");
    const note = scheduleSection(page).getByTestId("schedule-exam-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(NOTED!.examNote!);
    // Not rendered invisible by a light-theme-only colour.
    const opacity = await note.evaluate(
      (el) => getComputedStyle(el).opacity,
    );
    expect(Number(opacity)).toBeGreaterThan(0.5);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-list-dark-desktop.png`,
      fullPage: true,
    });
  });

  test("AC6-QA5 — no new serious/critical axe violation with the qualifier on screen", async ({
    page,
  }) => {
    await seedKey(page, SELECTION_KEY, [NOTED!.id]);
    await page.goto("/");
    for (const view of ["List", "Calendar"] as const) {
      await pressViewChip(page, view);
      // Settle in-flight `transition-colors` first, and exclude the Next.js dev
      // portal — same two guards e2e/a11y.spec.ts documents (PR #18 thread).
      // Scanning mid-transition samples interpolated chip colours and reports a
      // contrast failure against a settled UI that passes; verified here by
      // three back-to-back unsettled scans returning 1.14, 2.53 and 3.86 for
      // the SAME view-switcher chip.
      await settleAnimations(page);
      const results = await new AxeBuilder({ page })
        .exclude("nextjs-portal")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`),
        `${view} view axe violations with the qualifier rendered`,
      ).toEqual([]);
    }
  });

  test("AC6-QA6 — #37's two catalog surfaces still disclose it (this issue adds surfaces, it must not move any)", async ({
    page,
  }) => {
    await page.goto("/");
    const chip = page
      .locator('section[aria-label="Subject catalog"]')
      .locator("ul > li")
      .filter({ hasText: NOTED!.name })
      .first();
    // Tier-1 disclosure on the chip itself (SubjectChip).
    await expect(chip).toContainText(NOTED!.examNote!);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/ac6-catalog-chip-desktop.png`,
      fullPage: true,
    });
  });

  /**
   * ── QA v1 REPRODUCER (currently RED) ──────────────────────────────────────
   *
   * The calendar block's disclosure is a `Published note` MARKER on the block
   * face — the verbatim text rides the accessible name, the `title` tooltip and
   * the details dialog. That marker is the only at-a-glance signal a sighted
   * mouse user gets on the grid, and it is the LAST child of a fixed-height,
   * `overflow-hidden` exam segment (CalendarView.tsx:325 inside the segment
   * opened at :296). A pending-duration exam gets the nominal 88px block, and
   * once the face also has to carry a wrapped time label, "Length pending" and
   * "Moved to late testing", the marker is pushed past the clip edge and simply
   * is not drawn.
   *
   * `toBeVisible()` cannot see this: Playwright calls a clipped-but-boxed
   * element visible, which is why both the Builder's spec and this suite's own
   * evidence tests pass while the marker renders zero pixels. So this measures
   * the intersection of the marker's rect with its clipping ancestor's rect.
   *
   * Measured on e219424 (marker height / visible height):
   *   regular slot — desktop 15/15 ✅   tablet 15/15 ✅   mobile 30/0 ❌
   *   moved to late — desktop 15/1 ❌   tablet 15/0 ❌    mobile 30/0 ❌
   *
   * Mobile fails in the DEFAULT state (calendar is the default view), and the
   * moved-to-late state is reachable in two clicks because the qualified exam
   * shares its slot with exactly one other subject.
   */
  const CLIP_CASES = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ] as const;

  for (const vp of CLIP_CASES) {
    for (const moved of [false, true] as const) {
      test(`AC6-QA7 — the block-face marker actually renders at ${vp.name} ${vp.width}x${vp.height}${moved ? " (moved to late testing)" : ""}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const ids = moved ? [NOTED!.id, PARTNER!.id] : [NOTED!.id];
        await seedKey(page, SELECTION_KEY, ids);
        if (moved) {
          await seedKey(page, RESOLUTIONS_KEY, [
            {
              date: NOTED!.exam!.date,
              session: NOTED!.exam!.session,
              keeperId: PARTNER!.id,
              memberIds: [NOTED!.id, PARTNER!.id],
            },
          ]);
        }
        await page.goto("/");
        await pressViewChip(page, "Calendar");
        const target = moved ? NOTED!.lateTesting!.date : NOTED!.exam!.date;
        await gotoWeek(page, weekIndexOf(target) + 1);

        const block = blockFor(page, NOTED!.id);
        await expect(block.getByTestId("block-exam-note")).toBeAttached();
        await block.scrollIntoViewIfNeeded();
        const slug = `${moved ? "late" : "regular"}-${vp.name}`;
        // A tight shot of the block itself: whether the marker paints is the
        // whole question, and a full-page capture buries an 88px block.
        await block.screenshot({
          path: `${EVIDENCE_DIR}/ac6-qa7-blockface-${slug}.png`,
        });
        await page.screenshot({
          path: `${EVIDENCE_DIR}/ac6-qa7-grid-${slug}.png`,
          fullPage: true,
        });

        const clip = await markerClip(page);
        expect(clip, "the marker element vanished").not.toBeNull();
        expect(
          clip!.visibleHeight,
          `the "${NOTE_LABEL}" marker is clipped away by its overflow-hidden block face — ${clip!.visibleHeight}px of ${clip!.markerHeight}px rendered, so the grid shows a bare date for an exam only pilot schools may sit`,
        ).toBe(clip!.markerHeight);
      });
    }
  }

  // Evidence at the three standard viewports (PROJECT.md), both views.
  const VIEWPORTS = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`evidence — qualifier on List + Calendar at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedKey(page, SELECTION_KEY, [NOTED!.id, "biology", "seminar"]);
      await page.goto("/");

      await pressReadyList(page);
      await expect(
        scheduleSection(page).getByTestId("schedule-exam-note"),
      ).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/list-${vp.name}.png`,
        fullPage: true,
      });
      expect(
        await horizontalOverflow(page),
        "the qualifier paragraph must not push the page sideways",
      ).toBe(0);

      await pressViewChip(page, "Calendar");
      await gotoWeek(page, weekIndexOf(NOTED!.exam!.date) + 1);
      await expect(
        blockFor(page, NOTED!.id).getByTestId("block-exam-note"),
      ).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/calendar-${vp.name}.png`,
        fullPage: true,
      });
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});

/** Switch to List and wait for the schedule section to settle. */
async function pressReadyList(page: Page) {
  await pressViewChip(page, "List");
  await expect(scheduleSection(page)).toBeVisible();
}

/**
 * How much of the block-face marker actually paints: the height of the
 * intersection between the marker's rect and its nearest `overflow: hidden`
 * ancestor's rect. `toBeVisible()` reports true for a fully clipped element, so
 * geometry is the only honest observable here (see AC6-QA7).
 */
function markerClip(
  page: Page,
): Promise<{ markerHeight: number; visibleHeight: number } | null> {
  return page.evaluate(() => {
    const marker = document.querySelector(
      '[data-testid="block-exam-note"]',
    ) as HTMLElement | null;
    if (!marker) return null;
    let clip: HTMLElement | null = marker.parentElement;
    while (clip && getComputedStyle(clip).overflow !== "hidden")
      clip = clip.parentElement;
    if (!clip) return { markerHeight: 0, visibleHeight: 0 };
    const m = marker.getBoundingClientRect();
    const c = clip.getBoundingClientRect();
    const visible = Math.max(
      0,
      Math.min(m.bottom, c.bottom) - Math.max(m.top, c.top),
    );
    return {
      markerHeight: Math.round(m.height),
      visibleHeight: Math.round(visible),
    };
  });
}

/** Let every in-flight CSS transition finish before an axe scan (see AC6-QA5). */
async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    const done = Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    );
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  });
}

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
