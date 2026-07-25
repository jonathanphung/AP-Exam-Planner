import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * Issue #74 — the calendar block face budgets its height instead of capping the
 * subject name at two lines.
 *
 * ## What changed
 *
 * Issue #71's rebuild gave the face an ORDERING CONTRACT (the `Published note`
 * qualifier row can never be clipped away) and enforced it with a hard
 * `line-clamp-2` on the subject-name row. That worked, but it ellipsised names
 * on blocks with plenty of unused face: 3/39 exam-bearing names at 1920, 17/39
 * at 1024, 23/39 at 375, with 35–87px of the face still empty
 * (`docs/super-board/runs/issue-71-qa-v2/name-clamp-survey.json`).
 *
 * The fix reserves the rows below the name (`flex-none`: the clock at its own
 * two-line cap, the one-line qualifier row, the one-line shared secondary-marker
 * row) and gives the name every whole line that is left — `nameLineBudget()` in
 * src/components/CalendarView.tsx, mirrored in src/lib/export-png-calendar.ts.
 *
 * ## Why these tests
 *
 * The budget is arithmetic over rendered geometry, so it can drift two ways that
 * no existing spec can see:
 *
 * - a Tailwind class change moves a row's real height away from the constant the
 *   budget reserves for it (`BUDGET-1` pins the geometry to the live DOM);
 * - the budget is dropped or mis-computed, and names ellipsise again on a face
 *   with room to spare (`BUDGET-2` measures the refinement itself, `BUDGET-4`
 *   surveys the whole roster against a live pre-#74 baseline).
 *
 * `BUDGET-3` guards the other direction: a name that spends more than its budget
 * would clip a reserved row, which is exactly the issue #71 defect. The existing
 * `AC6-QA7` (e2e/issue-71-qa.spec.ts) and `QA-V2-1` / `QA-V2-2`
 * (e2e/issue-71-qa-v2.spec.ts) remain the qualifier row's own gates; `BUDGET-3`
 * extends the same painted-height measurement to the clock and name rows across
 * all three states the issue calls out.
 *
 * Everything is dataset-derived (longest name, qualified subject, its same-slot
 * partner, dates), so an annual dataset swap re-points the suite.
 *
 * Evidence: `docs/super-board/runs/issue-74-build-v1/`.
 */

const EVIDENCE_DIR = evidenceDir("issue-74-build-v1");

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
const weekIndexOf = (iso: string) =>
  WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);

/** The block the issue measures: longest name among exam-bearing subjects. */
const LONGEST = [...SUBJECTS.filter((s) => s.exam)].sort(
  (a, b) => b.name.length - a.name.length,
)[0];

/** The qualified exam + its same-slot partner: the unresolved-conflict state. */
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam !== null);
const PARTNER = NOTED
  ? SUBJECTS.find(
      (s) =>
        s.id !== NOTED.id &&
        s.exam?.date === NOTED.exam!.date &&
        s.exam?.session === NOTED.exam!.session,
    )
  : undefined;

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

async function seed(page: Page, key: string, value: unknown) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [key, JSON.stringify(value)] as const,
  );
}

const blockFor = (page: Page, subjectId: string) =>
  page.locator(
    `[data-testid="calendar-block"][data-subject-id="${subjectId}"]`,
  );

async function gotoWeek(page: Page, n: number) {
  for (let guard = 0; guard < 10; guard += 1) {
    const text =
      (await page.getByTestId("calendar-week-indicator").textContent()) ?? "";
    const match = /Week (\d+) of/.exec(text);
    if (!match) throw new Error(`no week indicator found: "${text}"`);
    const current = Number(match[1]);
    if (current === n) return;
    await page
      .getByTestId("calendar-pager")
      .getByRole("button", {
        name: current < n ? /^Next week/ : /^Previous week/,
      })
      .click();
  }
  throw new Error(`could not reach week ${n}`);
}

/**
 * The block face as the budget sees it.
 *
 * The face is a fixed-height `overflow: hidden` box, so a row can be attached,
 * boxed, `toBeVisible()`-true and still paint nothing (issue #71 QA v1).
 * `painted` is the height of the intersection of the row's rect with the face's
 * CONTENT box — the only honest observable for "did the reader see this" — and
 * `spare` is the unused content height below the last row, i.e. the height the
 * budget still had to give.
 */
function faceBudget(page: Page, subjectId: string) {
  return page.evaluate((id) => {
    const block = document.querySelector(
      `[data-testid="calendar-block"][data-subject-id="${id}"]`,
    ) as HTMLElement | null;
    if (!block) return null;
    const face = block.querySelector(
      "span[aria-hidden='true'][style*='height']",
    ) as HTMLElement | null;
    if (!face) return null;
    const faceRect = face.getBoundingClientRect();
    const faceStyle = getComputedStyle(face);
    const padTop = parseFloat(faceStyle.paddingTop);
    const padBottom = parseFloat(faceStyle.paddingBottom);
    const contentTop = faceRect.top + padTop;
    const contentBottom = faceRect.bottom - padBottom;
    const children = Array.from(face.children) as HTMLElement[];
    const rows = children.map((row) => {
      const r = row.getBoundingClientRect();
      const rs = getComputedStyle(row);
      return {
        text: (row.textContent ?? "").trim(),
        isQualifier: row.dataset.testid === "block-exam-note",
        height: r.height,
        painted: Math.max(
          0,
          Math.min(r.bottom, contentBottom) - Math.max(r.top, contentTop),
        ),
        /** Text the clamp is hiding, in px (0 when the name renders in full). */
        overflow: Math.max(0, row.scrollHeight - row.clientHeight),
        lineHeight: parseFloat(rs.lineHeight),
        fontSize: parseFloat(rs.fontSize),
        marginTop: parseFloat(rs.marginTop),
        lineClamp: rs.webkitLineClamp,
        flexShrink: rs.flexShrink,
      };
    });
    const lastBottom = children.reduce(
      (max, row) => Math.max(max, row.getBoundingClientRect().bottom),
      contentTop,
    );
    return {
      laneWidth: Math.round(block.getBoundingClientRect().width),
      faceHeight: faceRect.height,
      padTop,
      padBottom,
      display: faceStyle.display,
      spare: contentBottom - lastBottom,
      rows,
    };
  }, subjectId);
}

/** Regular state: one block, no same-slot partner — the widest lane there is. */
async function openSingle(page: Page, subject: Subject) {
  await seed(page, SELECTION_KEY, [subject.id]);
  await page.goto("/");
  await pressViewChip(page, "Calendar");
  await gotoWeek(page, weekIndexOf(subject.exam!.date) + 1);
}

test.describe("issue #74 — the block face budgets its height", () => {
  /**
   * ── BUDGET-1 ──────────────────────────────────────────────────────────────
   * The budget is arithmetic over the face's rendered geometry, so its inputs
   * are constants in src/components/CalendarView.tsx. If a Tailwind class on the
   * face changes (`text-xs` → `text-sm`, `py-1` → `py-1.5`, `mt-0.5` → `mt-1`,
   * `leading-tight` dropped), those constants become lies and the budget starts
   * over- or under-spending silently — every other spec here stays green while
   * the qualifier row creeps back toward the clip edge.
   *
   * So: pin the geometry to the live DOM. Values mirror FACE_LINE_PX,
   * FACE_MARKER_PX, FACE_ROW_GAP_PX and FACE_PAD_Y_PX.
   */
  test("BUDGET-1 — the face's rendered geometry matches the constants the budget reserves", async ({
    page,
  }) => {
    test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
    await page.setViewportSize({ width: 1920, height: 1080 });
    // The qualified + moved-to-late block is the only state that renders all
    // four rows at once, so one measurement covers every constant.
    await seed(page, SELECTION_KEY, [NOTED!.id, PARTNER!.id]);
    await seed(page, RESOLUTIONS_KEY, [
      {
        date: NOTED!.exam!.date,
        session: NOTED!.exam!.session,
        keeperId: PARTNER!.id,
        memberIds: [NOTED!.id, PARTNER!.id],
      },
    ]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");
    await gotoWeek(page, weekIndexOf(NOTED!.lateTesting!.date) + 1);

    const face = await faceBudget(page, NOTED!.id);
    expect(face, "the qualified block vanished from the grid").not.toBeNull();
    expect(face!.display, "the face reserves rows via flex").toBe("flex");
    expect(
      [face!.padTop, face!.padBottom],
      "FACE_PAD_Y_PX (8) is the face's py-1, split top/bottom",
    ).toEqual([4, 4]);

    const [name, clock, qualifier, markers] = face!.rows;
    expect(
      face!.rows.map((r) => r.isQualifier),
      "row order: name, clock, qualifier, secondary markers",
    ).toEqual([false, false, true, false]);
    expect(name.lineHeight, "FACE_LINE_PX — the name row's line box").toBe(15);
    expect(clock.lineHeight, "FACE_LINE_PX — the clock row's line box").toBe(15);
    expect(
      [qualifier.lineHeight, markers.lineHeight],
      "FACE_MARKER_PX — the one-line marker rows",
    ).toEqual([12.5, 12.5]);
    expect(
      [clock.marginTop, qualifier.marginTop, markers.marginTop],
      "FACE_ROW_GAP_PX — mt-0.5 above every row after the name",
    ).toEqual([2, 2, 2]);
    expect(
      [clock.flexShrink, qualifier.flexShrink, markers.flexShrink],
      "every row below the name is RESERVED (flex-none), so the name can never squeeze one out",
    ).toEqual(["0", "0", "0"]);
    expect(
      Number(clock.lineClamp),
      "CLOCK_MAX_LINES — the budget reserves both of the clock's lines",
    ).toBe(2);
  });

  /**
   * ── BUDGET-2 (the refinement itself — AC4) ────────────────────────────────
   * A subject name may only be ellipsised when the face has no spare height left
   * to give it. Measured on the longest-named exam subject, one block (the
   * widest lane the grid ever produces), at the three standard viewports.
   *
   * Pre-#74 numbers for this exact case — the name clamped to 2 lines with the
   * face still empty below it, which is what this test now forbids:
   *
   *   desktop 1920  lane 159px  face 132px  rows 47px  spare 77px  hidden 15px
   *   tablet  1024  lane 113px  face 132px  rows 62px  spare 62px  hidden 30px
   *   mobile   375  lane  97px  face 132px  rows 62px  spare 62px  hidden 30px
   *
   * Post-fix the name renders in full at all three (3, 4 and 4 lines), so the
   * assertion passes on its `overflow === 0` branch; the `spare < overflow`
   * branch keeps it honest for a future dataset whose longest name genuinely
   * outgrows the tallest face.
   */
  for (const vp of VIEWPORTS) {
    test(`BUDGET-2 — the longest subject name is ellipsised only when the face has no spare height at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openSingle(page, LONGEST);

      const block = blockFor(page, LONGEST.id);
      await expect(block).toBeVisible();
      await block.scrollIntoViewIfNeeded();
      await block.screenshot({
        path: `${EVIDENCE_DIR}/budget-longest-name-${vp.name}.png`,
      });

      const face = await faceBudget(page, LONGEST.id);
      expect(face, `no block for ${LONGEST.name}`).not.toBeNull();
      const name = face!.rows[0];
      expect(
        name.text,
        "the first face row is the subject name",
      ).toContain(LONGEST.name);
      expect(
        name.overflow === 0 || face!.spare < name.overflow,
        `"${LONGEST.name}" is ellipsised on a ${Math.round(
          face!.faceHeight,
        )}px face (lane ${face!.laneWidth}px) that still has ${Math.round(
          face!.spare,
        )}px of unused height, while ${Math.round(
          name.overflow,
        )}px of the name is hidden. The face budgets its height: a name may only lose text once every whole line of the face is spent.`,
      ).toBe(true);
    });
  }

  /**
   * ── BUDGET-3 ──────────────────────────────────────────────────────────────
   * The other direction. A budget that over-spends puts the name's extra lines
   * through the clip edge and takes a reserved row with it — the issue #71 QA v1
   * defect. `AC6-QA7` and `QA-V2-1` already gate the qualifier row in the
   * regular / moved-to-late / unresolved-conflict states; this widens the same
   * painted-height measurement to EVERY row the budget reserves (the name row
   * itself must be clamped, never clipped) across those three states.
   *
   * The shared secondary-marker row is deliberately excluded: the ordering
   * contract designates it as the one row allowed to lose pixels on a narrow
   * lane, because each of its markers is also carried by a non-text cue.
   */
  const STATES = [
    { slug: "regular", moved: false, conflicted: false },
    { slug: "conflict", moved: false, conflicted: true },
    { slug: "late", moved: true, conflicted: false },
  ] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      test(`BUDGET-3 — every reserved row still paints in full, ${state.slug} state at ${vp.name} ${vp.width}x${vp.height}`, async ({
        page,
      }) => {
        test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // The qualified exam is the tightest face on the grid (a pending length
        // gets the nominal block) and the only one that renders the qualifier
        // row, so all three states are measured on it. Its same-slot partner is
        // selected too: unresolved in the conflict state, the keeper in the
        // moved-to-late state, and it is the block that halves the lane.
        const ids = state.conflicted || state.moved ? [NOTED!.id, PARTNER!.id] : [NOTED!.id];
        await seed(page, SELECTION_KEY, ids);
        if (state.moved) {
          await seed(page, RESOLUTIONS_KEY, [
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
        await gotoWeek(
          page,
          weekIndexOf(
            state.moved ? NOTED!.lateTesting!.date : NOTED!.exam!.date,
          ) + 1,
        );

        const block = blockFor(page, NOTED!.id);
        await expect(block.getByTestId("block-exam-note")).toBeAttached();
        await block.scrollIntoViewIfNeeded();
        await block.screenshot({
          path: `${EVIDENCE_DIR}/budget-${state.slug}-blockface-${vp.name}.png`,
        });
        await page.screenshot({
          path: `${EVIDENCE_DIR}/budget-${state.slug}-grid-${vp.name}.png`,
          fullPage: true,
        });

        const face = await faceBudget(page, NOTED!.id);
        expect(face, "the qualified block vanished from the grid").not.toBeNull();
        const reserved = face!.rows.slice(0, 3); // name, clock, qualifier
        for (const row of reserved) {
          expect(
            Math.round(row.painted),
            `the "${row.text}" row loses ${Math.round(
              row.height - row.painted,
            )}px of ${Math.round(row.height)}px to the ${Math.round(
              face!.faceHeight,
            )}px face (lane ${face!.laneWidth}px, ${
              state.slug
            } state). The name budget over-spent: every row above the shared secondary-marker row is reserved.`,
          ).toBe(Math.round(row.height));
        }
      });
    }
  }

  /**
   * ── BUDGET-4 (roster survey — gated against a live pre-#74 baseline) ──────
   * `QA-V2-5` on issue #71 surveyed how many exam-bearing subject names the
   * two-line cap ellipsised in the widest lane: 3/39 at 1920, 17/39 at 1024,
   * 23/39 at 375. This repeats the survey against the budget AND re-measures the
   * old two-line cap in the same run, so the comparison cannot go stale when the
   * dataset's names change: probe A carries the face's live clamp, probe B is
   * pinned to `-webkit-line-clamp: 2`.
   *
   * Gate: the budget must never ellipsise MORE names than the old fixed cap, and
   * must ellipsise strictly fewer at the two viewports where the cap was
   * measurably wasteful (1024 and 375).
   */
  test("BUDGET-4 — the budget ellipsises fewer names than the pre-#74 two-line cap", async ({
    page,
  }) => {
    const names = SUBJECTS.filter((s) => s.exam).map((s) => s.name);
    const survey: Record<string, unknown> = {};
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openSingle(page, LONGEST);
      survey[vp.name] = await page.evaluate((allNames) => {
        const block = document.querySelector(
          '[data-testid="calendar-block"]',
        ) as HTMLElement;
        const face = block.querySelector(
          "span[aria-hidden='true'][style*='height']",
        ) as HTMLElement;
        const nameRow = face.children[0] as HTMLElement;
        /** Count the names a probe with `clamp` lines would ellipsise. */
        const clampedWith = (clamp: string | null) => {
          const probe = nameRow.cloneNode(false) as HTMLElement;
          probe.style.width = `${nameRow.clientWidth}px`;
          if (clamp !== null) probe.style.webkitLineClamp = clamp;
          face.appendChild(probe);
          const hit: string[] = [];
          for (const n of allNames) {
            probe.textContent = n;
            if (probe.scrollHeight > probe.clientHeight + 1) hit.push(n);
          }
          probe.remove();
          return hit;
        };
        const budgeted = clampedWith(null);
        const twoLineCap = clampedWith("2");
        const used = Array.from(face.children).reduce(
          (sum, c) => sum + c.getBoundingClientRect().height,
          0,
        );
        return {
          laneWidth: Math.round(block.getBoundingClientRect().width),
          nameWidth: nameRow.clientWidth,
          faceHeight: Math.round(face.getBoundingClientRect().height),
          faceUsed: Math.round(used),
          nameLineBudget: Number(getComputedStyle(nameRow).webkitLineClamp),
          total: allNames.length,
          budgetedClampedCount: budgeted.length,
          budgetedClamped: budgeted,
          twoLineCapClampedCount: twoLineCap.length,
          twoLineCapClamped: twoLineCap,
        };
      }, names);
    }
    writeFileSync(
      `${EVIDENCE_DIR}/name-budget-survey.json`,
      `${JSON.stringify(survey, null, 2)}\n`,
    );

    for (const vp of VIEWPORTS) {
      const row = survey[vp.name] as {
        total: number;
        nameLineBudget: number;
        budgetedClampedCount: number;
        twoLineCapClampedCount: number;
      };
      expect(row.total, "the survey harness saw the whole roster").toBe(
        names.length,
      );
      expect(
        row.nameLineBudget,
        `the face still budgets the name row at ${vp.name}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        row.budgetedClampedCount,
        `the budget ellipsises MORE names (${row.budgetedClampedCount}/${row.total}) than the pre-#74 two-line cap (${row.twoLineCapClampedCount}/${row.total}) at ${vp.name}`,
      ).toBeLessThanOrEqual(row.twoLineCapClampedCount);
    }
    for (const vp of ["tablet", "mobile"] as const) {
      const row = survey[vp] as {
        budgetedClampedCount: number;
        twoLineCapClampedCount: number;
      };
      expect(
        row.budgetedClampedCount,
        `the two-line cap ellipsised names at ${vp} with the face still empty below them; the budget must free some of them`,
      ).toBeLessThan(row.twoLineCapClampedCount);
    }
  });

  /**
   * ── BUDGET-5 (renderer parity evidence) ───────────────────────────────────
   * The exported calendar card runs the same face contract through a second,
   * hand-authored renderer (src/lib/export-png-calendar.ts), which #74 moved to
   * the same reserved-rows + name-budget layout. `QA-V2-4` gates the ROW ORDER
   * of that DOM; this captures the rasterized result so the two faces can be
   * compared by eye, and checks the raster is real (a flex-layout mistake in the
   * card DOM shows up as a zero-size or unreadable PNG, which no DOM-order
   * assertion can see).
   */
  test("BUDGET-5 — the exported calendar PNG still rasterizes with the budgeted face", async ({
    page,
  }) => {
    test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await seed(page, SELECTION_KEY, [NOTED!.id, PARTNER!.id, LONGEST.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");

    const trigger = page.getByRole("button", { name: "Export" });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const item = page.getByRole("menuitem", {
      name: /Calendar view.*\.png/i,
      exact: false,
    });
    await expect(item.first()).toBeVisible();
    const downloads: Download[] = [];
    page.on("download", (d) => downloads.push(d));
    await item.first().click();
    await expect.poll(() => downloads.length, { timeout: 20000 }).toBeGreaterThan(0);

    for (const download of downloads) {
      const buf = readFileSync(await download.path());
      expect(
        [...buf.subarray(0, 8)],
        "the exported calendar card is not a PNG",
      ).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(buf.readUInt32BE(16), "PNG width").toBeGreaterThan(0);
      expect(buf.readUInt32BE(20), "PNG height").toBeGreaterThan(0);
      writeFileSync(
        `${EVIDENCE_DIR}/export-${download.suggestedFilename()}`,
        buf,
      );
    }
  });
});
