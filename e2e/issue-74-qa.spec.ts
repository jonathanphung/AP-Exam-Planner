import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v1 (issue #74) — independent verification of the height
 * budget that replaced the block face's fixed two-line subject-name cap.
 *
 * The builder's own suite (`e2e/issue-74-face-budget.spec.ts`) measures the
 * budget on the single block the issue names — the longest exam name, alone in
 * its slot, at three viewports. That is the *headline* case. These tests are
 * deliberately the adversarial superset, because the budget is arithmetic over
 * reserved rows and its two failure modes are both invisible to a single-block
 * probe:
 *
 * - **Under-spend.** The budget reserves the clock's full two-line cap on every
 *   block, but on a wide lane the clock renders one line. If a name is ever
 *   ellipsised while a whole 15px line of the face is still unspent, AC4's
 *   invariant ("a name is only ellipsised when the face has no spare height
 *   left") is false — for that block, not for the longest-named one.
 *   `QA74-2` therefore sweeps the WHOLE roster (39 exam-bearing subjects) at
 *   all three viewports, in the widest lane each block can get.
 * - **Over-spend.** A name that takes one line too many pushes a reserved row
 *   through the fixed-height face's clip edge — the issue #71 QA v1 defect.
 *   `QA74-3` re-measures painted height per row across the regular,
 *   unresolved-conflict and moved-to-late states, and additionally pins the
 *   property the builder used to justify deviating from AC1's literal
 *   `flex-1` mechanism: the rows stay TOP-PACKED, so the qualifier marker
 *   still sits against the clock it qualifies instead of at the foot of the
 *   face.
 *
 * `QA74-4` re-derives the exported PNG renderer's budget from its own live
 * DOM (`QA-V2-4` only pins that renderer's row ORDER; `BUDGET-5` only proves
 * the raster is a real PNG — neither can see a face that over-spends its
 * height), and `QA74-5` checks the disclosure the refinement rests on: when a
 * cramped lane does ellipsise a name, the full name is still carried by the
 * accessible name, the tooltip and the details dialog.
 *
 * Everything is dataset-derived, so the next annual swap re-points the suite.
 *
 * Evidence: `docs/super-board/runs/issue-74-qa-v1/`.
 */

const EVIDENCE_DIR = evidenceDir("issue-74-qa-v1");

const SELECTION_KEY = "apx.selection.v1";
const RESOLUTIONS_KEY = "apx.resolutions.v1";

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts. */
const NOTE_LABEL = "Published note";

/**
 * One rendered line of the name / clock rows: `text-xs` 12px × `leading-tight`
 * 1.25. Re-derived here rather than imported so a change to the component's
 * constant cannot silently move this suite's yardstick too — `QA74-1` asserts
 * it against the live DOM first.
 */
const FACE_LINE_PX = 15;

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  lateTesting: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
  format?: { totalMinutes?: number | string };
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;
const EXAM_SUBJECTS = SUBJECTS.filter((s) => s.exam);

const WINDOWS = [
  { start: "2027-05-03", end: "2027-05-07" },
  { start: "2027-05-10", end: "2027-05-14" },
  { start: "2027-05-17", end: "2027-05-21" },
];
const weekIndexOf = (iso: string) =>
  WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);

const durationOf = (s: Subject) =>
  typeof s.format?.totalMinutes === "number" ? s.format.totalMinutes : null;

/** The block the issue measures: longest name among exam-bearing subjects. */
const LONGEST = [...EXAM_SUBJECTS].sort((a, b) => b.name.length - a.name.length)[0];
/** Shortest and longest published durations — the budget must differ between them. */
const TIMED = EXAM_SUBJECTS.filter((s) => durationOf(s) !== null);
const SHORTEST_EXAM = [...TIMED].sort((a, b) => durationOf(a)! - durationOf(b)!)[0];
const LONGEST_EXAM = [...TIMED].sort((a, b) => durationOf(b)! - durationOf(a)!)[0];

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

/**
 * Load the calendar with an exact selection (and optional conflict resolution).
 *
 * Deliberately NOT `addInitScript`: this suite re-seeds the same page several
 * times in one test (the roster sweep walks the schedule in batches), and
 * stacked init scripts do not reliably let the newest write win — the first
 * batch silently rendered three times when this used one. Writing localStorage
 * on a loaded page and reloading is unambiguous.
 */
async function loadCalendar(
  page: Page,
  ids: string[],
  resolutions?: unknown[],
): Promise<void> {
  if (!page.url().startsWith("http")) await page.goto("/");
  await page.evaluate(
    ([selKey, resKey, sel, res]) => {
      // Clear, not overwrite: the app promotes the seeded selection into its
      // My Schedules store (issue #29) on first mount and prefers that store
      // afterwards, so writing the selection key alone leaves the previous
      // batch on the grid.
      window.localStorage.clear();
      window.localStorage.setItem(selKey, sel!);
      if (res) window.localStorage.setItem(resKey, res);
    },
    [
      SELECTION_KEY,
      RESOLUTIONS_KEY,
      JSON.stringify(ids),
      resolutions ? JSON.stringify(resolutions) : null,
    ] as const,
  );
  await page.reload();
  await pressViewChip(page, "Calendar");
}

const blockFor = (page: Page, subjectId: string) =>
  page.locator(`[data-testid="calendar-block"][data-subject-id="${subjectId}"]`);

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
      .getByRole("button", { name: current < n ? /^Next week/ : /^Previous week/ })
      .click();
  }
  throw new Error(`could not reach week ${n}`);
}

/**
 * Every block currently on the grid, measured the way the clip edge sees it.
 *
 * The face is a fixed-height `overflow: hidden` box, so a row can be attached,
 * boxed, `toBeVisible()`-true and still paint nothing. `painted` is the height
 * of the intersection of a row's rect with the face's CONTENT box; `spare` is
 * the unused content height below the last row — the height the budget still
 * had left to give the name.
 */
function surveyGrid(page: Page) {
  return page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll('[data-testid="calendar-block"]'),
    ) as HTMLElement[];
    return blocks
      .map((block) => {
        const face = block.querySelector(
          "span[aria-hidden='true'][style*='height']",
        ) as HTMLElement | null;
        if (!face) return null;
        const faceRect = face.getBoundingClientRect();
        const faceStyle = getComputedStyle(face);
        const contentTop = faceRect.top + parseFloat(faceStyle.paddingTop);
        const contentBottom = faceRect.bottom - parseFloat(faceStyle.paddingBottom);
        const children = Array.from(face.children) as HTMLElement[];
        const rows = children.map((row) => {
          const r = row.getBoundingClientRect();
          const rs = getComputedStyle(row);
          return {
            text: (row.textContent ?? "").trim(),
            isQualifier: row.dataset.testid === "block-exam-note",
            top: r.top - contentTop,
            bottom: r.bottom - contentTop,
            height: r.height,
            painted: Math.max(
              0,
              Math.min(r.bottom, contentBottom) - Math.max(r.top, contentTop),
            ),
            /** Text the clamp is hiding, in px (0 when the row renders in full). */
            overflow: Math.max(0, row.scrollHeight - row.clientHeight),
            lines: Math.round(r.height / parseFloat(rs.lineHeight)),
            lineHeight: parseFloat(rs.lineHeight),
            marginTop: parseFloat(rs.marginTop),
            clamp: rs.webkitLineClamp,
            flexGrow: rs.flexGrow,
            flexShrink: rs.flexShrink,
          };
        });
        const lastBottom = children.reduce(
          (max, row) => Math.max(max, row.getBoundingClientRect().bottom),
          contentTop,
        );
        return {
          subjectId: block.dataset.subjectId ?? "?",
          laneWidth: Math.round(block.getBoundingClientRect().width),
          faceHeight: faceRect.height,
          faceDisplay: faceStyle.display,
          faceFlexDirection: faceStyle.flexDirection,
          spare: contentBottom - lastBottom,
          rows,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  });
}

type GridSurvey = Awaited<ReturnType<typeof surveyGrid>>;

/** Widest-lane batches: one subject per exam slot, so no lane is ever split. */
function widestLaneBatches(): string[][] {
  const bySlot = new Map<string, Subject[]>();
  for (const s of EXAM_SUBJECTS) {
    const key = `${s.exam!.date}|${s.exam!.session}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), s]);
  }
  const depth = Math.max(...[...bySlot.values()].map((v) => v.length));
  return Array.from({ length: depth }, (_, i) =>
    [...bySlot.values()].map((v) => v[i]?.id).filter((v): v is string => !!v),
  );
}

test.describe("issue #74 QA — the block face's height budget", () => {
  /**
   * ── QA74-1 (AC1) ──────────────────────────────────────────────────────────
   * The face allocates, it does not cap. Two observables, both on the live DOM:
   *
   * a) the rows below the name are RESERVED — `flex: none` (grow 0 AND shrink
   *    0), which is what AC1 asks for in so many words; and
   * b) the name's line allowance is a function of THIS block's height — the
   *    195-minute exam's face must afford strictly more name lines than the
   *    120-minute one at the same viewport. A fixed cap gives both the same
   *    number, so this is the assertion the pre-#74 code fails.
   *
   * It also pins FACE_LINE_PX / the marker line box to the live DOM, because
   * every arithmetic assertion below is denominated in them.
   */
  test("QA74-1 — the name's line allowance scales with the block's height, and the rows below it are reserved", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    expect(
      durationOf(LONGEST_EXAM),
      "the dataset must publish two different exam durations for this to mean anything",
    ).toBeGreaterThan(durationOf(SHORTEST_EXAM)!);

    const clampFor = async (subject: Subject) => {
      await loadCalendar(page, [subject.id]);
      await gotoWeek(page, weekIndexOf(subject.exam!.date) + 1);
      const survey = await surveyGrid(page);
      const entry = survey.find((b) => b.subjectId === subject.id);
      expect(entry, `no block rendered for ${subject.name}`).toBeTruthy();
      return entry!;
    };

    const short = await clampFor(SHORTEST_EXAM);
    const long = await clampFor(LONGEST_EXAM);

    // (a) geometry the budget is denominated in.
    expect(short.faceDisplay, "the face lays its rows out as a flex column").toBe(
      "flex",
    );
    expect(short.faceFlexDirection).toBe("column");
    expect(
      short.rows[0].lineHeight,
      "FACE_LINE_PX — one rendered line of the name row",
    ).toBe(FACE_LINE_PX);

    // (b) every row below the name is `flex: none`, i.e. reserved.
    for (const row of short.rows.slice(1)) {
      expect(
        [row.flexGrow, row.flexShrink],
        `the "${row.text}" row must be flex-none so the name can never squeeze it out`,
      ).toEqual(["0", "0"]);
    }

    // (c) the allowance is per-block, not a constant.
    expect(
      Number(long.rows[0].clamp),
      `the ${durationOf(LONGEST_EXAM)}-minute exam's face (${Math.round(
        long.faceHeight,
      )}px) must afford more name lines than the ${durationOf(
        SHORTEST_EXAM,
      )}-minute one (${Math.round(
        short.faceHeight,
      )}px) — a fixed cap gives both the same allowance`,
    ).toBeGreaterThan(Number(short.rows[0].clamp));
    expect(
      Number(short.rows[0].clamp),
      "the budget never drops below the pre-#74 two-line floor",
    ).toBeGreaterThanOrEqual(2);
  });

  /**
   * ── QA74-2 (AC4, roster-wide) ─────────────────────────────────────────────
   * AC4's invariant, applied to every exam-bearing subject at every viewport
   * instead of only the longest-named one: a name may lose text ONLY when the
   * face has no whole line left to give it.
   *
   * Blocks are selected one-per-slot so each gets the widest lane the grid can
   * produce — the state the issue measured, and the state where an unspent
   * line is a real visual cost rather than an unavoidable one.
   *
   * The gate is `spare < FACE_LINE_PX` rather than AC4's literal
   * `spare < overflow`: the honest question for a reader is whether one MORE
   * whole line could have been rendered, and a whole unspent line is the
   * smallest unit the budget can allocate. It is the stricter of the two.
   */
  for (const vp of VIEWPORTS) {
    test(`QA74-2 — no subject name is ellipsised while a whole line of its face is unspent at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const seen: GridSurvey = [];
      for (const batch of widestLaneBatches()) {
        await loadCalendar(page, batch);
        for (let week = 1; week <= WINDOWS.length; week += 1) {
          await gotoWeek(page, week);
          seen.push(...(await surveyGrid(page)));
        }
      }
      const byId = new Map(seen.map((b) => [b.subjectId, b]));
      writeFileSync(
        `${EVIDENCE_DIR}/roster-budget-${vp.name}.json`,
        `${JSON.stringify(
          {
            viewport: vp,
            measured: byId.size,
            rosterSize: EXAM_SUBJECTS.length,
            blocks: [...byId.values()].map((b) => ({
              subjectId: b.subjectId,
              laneWidth: b.laneWidth,
              faceHeight: Math.round(b.faceHeight),
              nameClamp: Number(b.rows[0].clamp),
              nameLines: b.rows[0].lines,
              nameHidden: Math.round(b.rows[0].overflow),
              clockLines: b.rows[1]?.lines ?? 0,
              spare: Math.round(b.spare),
            })),
          },
          null,
          2,
        )}\n`,
      );

      expect(
        byId.size,
        "the sweep must reach every exam-bearing subject exactly once",
      ).toBe(EXAM_SUBJECTS.length);

      const offenders = [...byId.values()]
        .filter((b) => b.rows[0].overflow > 0 && b.spare >= FACE_LINE_PX)
        .map(
          (b) =>
            `${b.subjectId}: ${Math.round(
              b.rows[0].overflow,
            )}px of the name hidden on a ${Math.round(
              b.faceHeight,
            )}px face (lane ${b.laneWidth}px) that still has ${Math.round(
              b.spare,
            )}px = ${Math.floor(
              b.spare / FACE_LINE_PX,
            )} whole unspent line(s); clamp ${b.rows[0].clamp}, clock ${
              b.rows[1]?.lines ?? 0
            } line(s)`,
        );
      expect(
        offenders,
        `the face budgets its height: a name may only lose text once every whole line is spent.\n${offenders.join(
          "\n",
        )}`,
      ).toEqual([]);
    });
  }

  /**
   * ── QA74-3 (AC1 + AC2 regression, all three states) ───────────────────────
   * The over-spend direction, plus the property the builder traded AC1's
   * literal `flex-1` mechanism for.
   *
   * - Every reserved row (name, clock, qualifier) paints its full height — a
   *   budget that hands the name one line too many clips the qualifier, which
   *   is issue #71's QA v1 defect.
   * - Rows stay TOP-PACKED: the vertical gap between consecutive rows is the
   *   row's own margin and nothing more. This is what `flex-1` on a growing
   *   name+clock group would have broken (the qualifier drifts to the foot of
   *   the face, away from the clock it qualifies), so the substitute mechanism
   *   has to be held to it.
   *
   * The shared secondary-marker row is excluded from the painted-height check
   * by the ordering contract: it is the one row allowed to lose pixels on a
   * narrow lane, because every marker on it is also carried by a non-text cue.
   */
  const STATES = [
    { slug: "regular", moved: false, partner: false },
    { slug: "conflict", moved: false, partner: true },
    { slug: "late", moved: true, partner: true },
  ] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      test(`QA74-3 — reserved rows paint in full and stay top-packed, ${state.slug} state at ${vp.name} ${vp.width}x${vp.height}`, async ({
        page,
      }) => {
        test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await loadCalendar(
          page,
          state.partner ? [NOTED!.id, PARTNER!.id] : [NOTED!.id],
          state.moved
            ? [
                {
                  date: NOTED!.exam!.date,
                  session: NOTED!.exam!.session,
                  keeperId: PARTNER!.id,
                  memberIds: [NOTED!.id, PARTNER!.id],
                },
              ]
            : undefined,
        );
        await gotoWeek(
          page,
          weekIndexOf(state.moved ? NOTED!.lateTesting!.date : NOTED!.exam!.date) + 1,
        );

        const block = blockFor(page, NOTED!.id);
        await expect(block.getByTestId("block-exam-note")).toBeAttached();
        await block.scrollIntoViewIfNeeded();
        await block.screenshot({
          path: `${EVIDENCE_DIR}/qa74-${state.slug}-blockface-${vp.name}.png`,
        });

        const survey = await surveyGrid(page);
        const face = survey.find((b) => b.subjectId === NOTED!.id);
        expect(face, "the qualified block vanished from the grid").toBeTruthy();

        for (const row of face!.rows.slice(0, 3)) {
          expect(
            Math.round(row.painted),
            `the "${row.text}" row loses ${Math.round(
              row.height - row.painted,
            )}px of ${Math.round(row.height)}px to the ${Math.round(
              face!.faceHeight,
            )}px face (lane ${face!.laneWidth}px, ${state.slug} state)`,
          ).toBe(Math.round(row.height));
        }

        for (let i = 1; i < face!.rows.length; i += 1) {
          const gap = face!.rows[i].top - face!.rows[i - 1].bottom;
          expect(
            Math.round(gap),
            `the "${face!.rows[i].text}" row floats ${Math.round(
              gap,
            )}px below the row above it (its margin is ${
              face!.rows[i].marginTop
            }px). Rows must stay top-packed — a marker that drifts to the foot of the face is no longer next to the clock it qualifies.`,
          ).toBe(Math.round(face!.rows[i].marginTop));
        }
      });
    }
  }

  /**
   * ── QA74-4 (AC5 — renderer parity, re-derived) ────────────────────────────
   * The exported calendar PNG is a second, hand-authored renderer of the same
   * face. `QA-V2-4` pins its row ORDER and `BUDGET-5` proves the raster is a
   * real PNG — neither can see a face whose rows over-spend its fixed height,
   * which is precisely what a budget bug produces.
   *
   * `captureCardPng` parks the finished card off-screen (`left: -100000px`)
   * before rasterizing, so a MutationObserver installed pre-navigation sees the
   * exact DOM that becomes the PNG. For every block face in it: the rows below
   * the name are reserved (`flex-shrink: 0`), the name carries a real budget
   * (a clamp above the old fixed 2 on at least one block), and the reserved
   * rows plus the name's budgeted height fit inside the face's own height.
   */
  test("QA74-4 — the exported calendar card's faces budget their height too", async ({
    page,
  }) => {
    test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      const faces: unknown[] = [];
      (window as unknown as { __faces: unknown[] }).__faces = faces;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            const holder = node as HTMLElement;
            if (holder.style?.left !== "-100000px") continue;
            const names = Array.from(
              holder.querySelectorAll<HTMLElement>("div[style*='line-clamp']"),
            );
            for (const name of names) {
              const seg = name.parentElement;
              if (!seg) continue;
              const rows = Array.from(seg.children) as HTMLElement[];
              faces.push({
                text: (name.textContent ?? "").trim(),
                segHeight: parseFloat(seg.style.height),
                segDisplay: seg.style.display,
                segFlexDirection: seg.style.flexDirection,
                segPadding: seg.style.padding,
                nameClamp: Number(name.style.webkitLineClamp),
                nameMaxHeight: parseFloat(name.style.maxHeight),
                rows: rows.map((row) => ({
                  text: (row.textContent ?? "").trim(),
                  flexShrink: row.style.flexShrink,
                  maxHeight: parseFloat(row.style.maxHeight || "0"),
                  marginTop: parseFloat(row.style.marginTop || "0"),
                  fontSize: row.style.fontSize,
                })),
              });
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });

    await loadCalendar(page, [NOTED!.id, PARTNER!.id, LONGEST.id, LONGEST_EXAM.id]);

    const trigger = page.getByRole("button", { name: "Export" });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const item = page.getByRole("menuitem", { name: /Calendar view.*\.png/i });
    await expect(item.first()).toBeVisible();
    const downloads: Download[] = [];
    page.on("download", (d) => downloads.push(d));
    await item.first().click();
    await expect.poll(() => downloads.length, { timeout: 30000 }).toBeGreaterThan(0);
    for (const download of downloads) {
      const buf = readFileSync(await download.path());
      writeFileSync(`${EVIDENCE_DIR}/qa74-export-${download.suggestedFilename()}`, buf);
    }

    const faces = (await page.evaluate(
      () => (window as unknown as { __faces: unknown[] }).__faces,
    )) as {
      text: string;
      segHeight: number;
      segDisplay: string;
      segFlexDirection: string;
      nameClamp: number;
      nameMaxHeight: number;
      rows: {
        text: string;
        flexShrink: string;
        maxHeight: number;
        marginTop: number;
        fontSize: string;
      }[];
    }[];

    writeFileSync(
      `${EVIDENCE_DIR}/export-face-budget.json`,
      `${JSON.stringify(faces, null, 2)}\n`,
    );
    expect(
      faces.length,
      "the rasterized calendar card rendered no block face with a clamped name row — the export lost the budget",
    ).toBeGreaterThan(0);

    for (const face of faces) {
      expect(face.segDisplay, `"${face.text}" face is not a flex column`).toBe("flex");
      expect(face.segFlexDirection).toBe("column");
      for (const row of face.rows.slice(1)) {
        expect(
          row.flexShrink,
          `the "${row.text}" row of the exported "${face.text}" face is not reserved`,
        ).toBe("0");
      }
      // Reserved height = the name's budget + every row below it + padding.
      // The trailing shared secondary-marker row is excluded: the ordering
      // contract designates it as the one row allowed to lose pixels on a
      // cramped face, because every marker on it is also carried by a non-text
      // cue (the violet late badge, the dashed border).
      const rows = face.rows.filter(
        (row, index) =>
          !(
            index === face.rows.length - 1 &&
            index > 0 &&
            row.fontSize === "10px" &&
            row.text !== NOTE_LABEL
          ),
      );
      const reserved = rows.reduce(
        (sum, row, index) =>
          sum + row.marginTop + (index === 0 ? face.nameMaxHeight : row.maxHeight || 12),
        8,
      );
      expect(
        reserved,
        `the exported "${face.text}" face allocates ${reserved.toFixed(
          1,
        )}px of rows (name budget + clock + qualifier + padding) into a ${
          face.segHeight
        }px box — the budget over-spends and the PNG clips the qualifier the site protects`,
      ).toBeLessThanOrEqual(face.segHeight + 0.5);
    }
    expect(
      Math.max(...faces.map((f) => f.nameClamp)),
      "no exported face affords more than the pre-#74 two-line cap — the second renderer never got the budget",
    ).toBeGreaterThan(2);
  });

  /**
   * ── QA74-5 (the refinement's safety net) ──────────────────────────────────
   * The issue's premise for treating this as a legibility refinement rather
   * than a data-loss bug is that the full name is always recoverable: the
   * accessible name, the `title` tooltip and the details dialog all carry it.
   * The budget does not remove ellipsis in the cramped lanes, so that premise
   * still has to hold exactly where a name IS cut — the unresolved-conflict
   * state, the narrowest lane the grid can produce.
   */
  test("QA74-5 — a name the cramped lane ellipsises is still recoverable in full", async ({
    page,
  }) => {
    test.skip(!NOTED || !PARTNER, "this cycle publishes no qualified exam");
    await page.setViewportSize({ width: 375, height: 667 });
    await loadCalendar(page, [NOTED!.id, PARTNER!.id]);
    await gotoWeek(page, weekIndexOf(PARTNER!.exam!.date) + 1);

    const block = blockFor(page, PARTNER!.id);
    await expect(block).toBeVisible();
    const survey = await surveyGrid(page);
    const face = survey.find((b) => b.subjectId === PARTNER!.id)!;
    expect(
      face.laneWidth,
      "the unresolved conflict must actually split the day column",
    ).toBeLessThan(80);
    expect(
      Math.round(face.rows[0].overflow),
      `"${PARTNER!.name}" is not actually ellipsised in the ${
        face.laneWidth
      }px lane, so this test is not measuring what it claims`,
    ).toBeGreaterThan(0);

    const trigger = block.getByRole("button");
    const namePattern = new RegExp(
      PARTNER!.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await expect(
      trigger,
      "the block's accessible name must carry the full subject name",
    ).toHaveAccessibleName(namePattern);
    await expect(
      trigger,
      "the tooltip must carry the full subject name",
    ).toHaveAttribute("title", namePattern);

    await trigger.click();
    await expect(
      page.getByRole("dialog").getByText(PARTNER!.name, { exact: false }).first(),
      "the details dialog must carry the full subject name",
    ).toBeVisible();
  });

  /**
   * ── QA74-6 (AC6) ──────────────────────────────────────────────────────────
   * The ordering contract is the only thing standing between a future edit and
   * a re-opened issue #71 defect, so AC6 asks for it to describe the budget and
   * keep naming the specs that enforce it. A comment is not observable through
   * the DOM — read the source.
   */
  test("QA74-6 — the ORDERING CONTRACT comment describes the budget and names its gates", async () => {
    const source = readFileSync("src/components/CalendarView.tsx", "utf8");
    const contract = source.slice(
      source.indexOf("ORDERING CONTRACT"),
      source.indexOf("ORDERING CONTRACT") + 3000,
    );
    expect(contract, "the ORDERING CONTRACT comment is gone").not.toBe("");
    expect(contract.toLowerCase()).toContain("budget");
    for (const gate of [
      "AC6-QA7",
      "QA-V2-1",
      "QA-V2-2",
      "issue-74-face-budget.spec.ts",
    ]) {
      expect(contract, `the contract no longer names ${gate}`).toContain(gate);
    }
    expect(
      readFileSync("src/lib/export-png-calendar.ts", "utf8"),
      "the PNG renderer must point back at the contract it mirrors",
    ).toContain("ORDERING CONTRACT");
  });

  /**
   * ── QA74-7 (evidence) ─────────────────────────────────────────────────────
   * Standard-viewport screenshots of week 1 with one subject per exam slot — the
   * widest lane the grid gives a block, which is the state the budget changes
   * and the state `QA74-2` sweeps. A selection that also includes same-slot
   * partners halves every affected lane and photographs the cramped state
   * instead, which is what `QA74-3`'s per-state block-face shots are for.
   */
  for (const vp of VIEWPORTS) {
    test(`QA74-7 — evidence: calendar grid at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loadCalendar(page, widestLaneBatches()[0]);
      await gotoWeek(page, 1);
      await expect(page.getByTestId("calendar-block").first()).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE_DIR}/${vp.name}.png`, fullPage: true });
    });
  }
});
