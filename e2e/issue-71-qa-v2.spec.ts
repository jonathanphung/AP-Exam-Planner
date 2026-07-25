import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { pressViewChip } from "./support/view-chip";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA v2 (issue #71) — verification of the rebuild-1 fix (`e528422`)
 * and of the states that fix newly touched.
 *
 * QA v1's reproducer (`AC6-QA7` in e2e/issue-71-qa.spec.ts) covered six states:
 * {regular slot, moved to late testing} × {1920, 1024, 375}. All six are green
 * on the rebuild, so this suite does not repeat them. It covers the three
 * things the rebuild changed that nothing measures yet:
 *
 * 1. **The unresolved-conflict state.** The rebuild merged `Time conflict`,
 *    `Moved to late testing` and `Length pending` onto ONE shared `nowrap` row
 *    below the qualifier marker. The unresolved conflict is the only state that
 *    renders `Time conflict` at all, and it is also the narrowest lane the grid
 *    can produce (two same-slot blocks split one day column → 47px at 375px
 *    wide). It is reachable without any interaction: the qualified exam shares
 *    2027-05-07 PM with AP Macroeconomics, so a student who picks both sees it
 *    on load. `AC6-QA7` never enters it, so the row that is *allowed* to clip
 *    and the row that must NEVER clip have never been measured side by side.
 *
 * 2. **The ordering contract as a structural invariant.** The fix is a comment
 *    plus a row order; a later edit that appends a row after the qualifier
 *    re-opens the exact defect QA v1 filed, and every existing assertion would
 *    stay green. This pins the order itself, in both renderers (the site face
 *    and the PNG calendar card, which the rebuild deliberately kept in sync).
 *
 * 3. **The clock's dropped `· length pending` suffix.** The rebuild removed a
 *    third carrier of the approximate signal from the visible clock. That is
 *    only safe while the remaining carriers survive, so they are pinned here:
 *    the dashed border, the `Length pending` marker, and the words in the
 *    button's accessible name.
 *
 * Everything is dataset-derived (subject id, note text, dates, conflict
 * partner), so the next annual swap re-points the suite instead of failing it,
 * and it skips cleanly in a cycle that publishes no qualifier.
 *
 * Evidence: `docs/super-board/runs/issue-71-qa-v2/`.
 */

const EVIDENCE_DIR = evidenceDir("issue-71-qa-v2");

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts. */
const NOTE_LABEL = "Published note";

const SELECTION_KEY = "apx.selection.v1";

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

const weekIndexOf = (iso: string) =>
  WINDOWS.findIndex((w) => iso >= w.start && iso <= w.end);

async function seedSelection(page: Page, ids: string[]) {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [SELECTION_KEY, JSON.stringify(ids)] as const,
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
 * Per-row geometry of one block's exam-segment face.
 *
 * The face is a fixed-height `overflow: hidden` box, so a row can be present,
 * boxed, `toBeVisible()`-true and still paint nothing (QA v1). `paintedHeight`
 * is the height of the intersection between the row's rect and the face's rect
 * — the only honest observable for "did the reader see this".
 */
function faceRows(page: Page, subjectId: string) {
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
    const rows = (Array.from(face.children) as HTMLElement[]).map((row) => {
      const r = row.getBoundingClientRect();
      return {
        text: (row.textContent ?? "").trim(),
        isNoteMarker: row.dataset.testid === "block-exam-note",
        height: Math.round(r.height),
        paintedHeight: Math.round(
          Math.max(0, Math.min(r.bottom, faceRect.bottom) - Math.max(r.top, faceRect.top)),
        ),
        ellipsised: row.scrollWidth > row.clientWidth + 1,
      };
    });
    return {
      laneWidth: Math.round(block.getBoundingClientRect().width),
      faceHeight: Math.round(faceRect.height),
      rows,
    };
  }, subjectId);
}

test.describe("issue #71 QA v2 — the rebuild's block face, in the states it changed", () => {
  test.skip(
    !NOTED || !PARTNER,
    "this cycle publishes no qualified exam with a same-slot partner",
  );

  /**
   * ── QA-V2-1 ───────────────────────────────────────────────────────────────
   * The unresolved conflict: both same-slot blocks are on the grid at once, so
   * each gets half a day column (47px at 375px wide) AND the qualified block
   * renders `Time conflict · Length pending` on its shared marker row. This is
   * the narrowest, busiest face the grid can produce, and it is the default
   * render for a student who has picked both subjects.
   *
   * The contract: the qualifier row must paint in FULL. The shared secondary
   * row is the one allowed to lose pixels, because every marker on it is also
   * carried by a non-text cue (orange fill + ⚠️, the LATE TESTING week badge,
   * the dashed border) — the qualifier has no such second carrier on the grid.
   *
   * Mutation-verified: moving the qualifier row back below the secondary
   * markers clips it to 6px of 13px at 1024 and 375 (this test goes red) while
   * every one of AC6-QA7's six cases stays green — this state is outside the
   * six it measures.
   */
  for (const vp of VIEWPORTS) {
    test(`QA-V2-1 — the qualifier row paints in full in the unresolved-conflict state at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, [NOTED!.id, PARTNER!.id]);
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      await gotoWeek(page, weekIndexOf(NOTED!.exam!.date) + 1);

      const block = blockFor(page, NOTED!.id);
      await expect(block.getByTestId("block-exam-note")).toBeAttached();
      await block.scrollIntoViewIfNeeded();
      await block.screenshot({
        path: `${EVIDENCE_DIR}/v2-conflict-blockface-${vp.name}.png`,
      });
      await page.screenshot({
        path: `${EVIDENCE_DIR}/v2-conflict-grid-${vp.name}.png`,
        fullPage: true,
      });

      const face = await faceRows(page, NOTED!.id);
      expect(face, "the qualified block vanished from the grid").not.toBeNull();
      const marker = face!.rows.find((r) => r.isNoteMarker);
      expect(marker, `no "${NOTE_LABEL}" row on the face`).toBeTruthy();
      expect(
        marker!.paintedHeight,
        `the "${NOTE_LABEL}" row is clipped by the ${face!.faceHeight}px face in the unresolved-conflict state (lane ${face!.laneWidth}px) — ${marker!.paintedHeight}px of ${marker!.height}px painted. A student who picked both same-slot subjects sees this on load, and the grid would show a bare date for an exam only pilot schools may sit.`,
      ).toBe(marker!.height);
    });
  }

  /**
   * ── QA-V2-2 ───────────────────────────────────────────────────────────────
   * The ordering contract, as a structural invariant rather than a comment: the
   * qualifier row must never be the last row of the face while a row that a
   * non-text cue already carries sits above it. Checked in every state that
   * renders a secondary marker at all.
   *
   * Mutation-verified: moving the `block.examNote` JSX back below
   * `secondaryMarkers` in src/components/CalendarView.tsx turns this red at all
   * three viewports while QA v1's `AC6-QA7` stays green in ALL six of its cases
   * — geometry alone cannot see an ordering that only clips in a state the
   * older suite never enters, which is why the contract is pinned structurally
   * as well as by measurement.
   */
  for (const vp of VIEWPORTS) {
    test(`QA-V2-2 — the qualifier row is never the last row of the face at ${vp.name} ${vp.width}x${vp.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, [NOTED!.id, PARTNER!.id]);
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      await gotoWeek(page, weekIndexOf(NOTED!.exam!.date) + 1);

      const face = await faceRows(page, NOTED!.id);
      const index = face!.rows.findIndex((r) => r.isNoteMarker);
      expect(index, `no "${NOTE_LABEL}" row on the face`).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        index,
        `the "${NOTE_LABEL}" row is last on the face (rows: ${face!.rows
          .map((r) => r.text || "∅")
          .join(" / ")}). A fixed-height overflow-hidden face clips from the bottom, so the last row is the one that disappears — and this is the only row on the grid that discloses the qualifier.`,
      ).toBeLessThan(face!.rows.length - 1);
      // The row below it must be the shared secondary-marker row, i.e. the row
      // whose content is also carried by a non-text cue.
      expect(
        face!.rows[index + 1].text,
        "the row below the qualifier must be the shared secondary-marker row",
      ).toMatch(/Time conflict|Moved to late testing|Length pending/);
    });
  }

  /**
   * ── QA-V2-3 ───────────────────────────────────────────────────────────────
   * The rebuild removed `· length pending` from the visible clock. That is only
   * safe while the other carriers of the approximate signal survive, so pin
   * them: the dashed border (visual), the `Length pending` marker (text), and
   * the words in the accessible name (screen reader). Also assert the clock no
   * longer double-prints it — the reason it was removed was that a wrapped
   * three-line clock is what pushed the qualifier off the face.
   *
   * Mutation-verified: restoring `· length pending` on the clock (the
   * pre-rebuild string) turns this red.
   */
  test("QA-V2-3 — an approximate block keeps three carriers of the pending-length signal without the clock suffix", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seedSelection(page, [NOTED!.id]);
    await page.goto("/");
    await pressViewChip(page, "Calendar");
    await gotoWeek(page, weekIndexOf(NOTED!.exam!.date) + 1);

    const block = blockFor(page, NOTED!.id);
    await expect(block).toHaveAttribute("data-approximate", "true");
    // The name lives on the interactive element inside the positioned <li>.
    await expect(block.getByRole("button")).toHaveAccessibleName(
      /exam length pending/i,
    );

    const face = await faceRows(page, NOTED!.id);
    const clock = face!.rows.find((r) => /\d{1,2}:\d{2}\s?(AM|PM)/.test(r.text));
    expect(clock, "no clock row on the face").toBeTruthy();
    expect(
      clock!.text.toLowerCase(),
      "the clock must print the clock only — the wrapped `· length pending` suffix is what pushed the qualifier off the face in QA v1",
    ).not.toContain("length pending");

    const pending = face!.rows.find((r) => /Length pending/.test(r.text));
    expect(
      pending,
      "the `Length pending` marker is the visible carrier that replaced the clock suffix",
    ).toBeTruthy();
    expect(
      pending!.paintedHeight,
      "the `Length pending` marker paints nothing, and the clock no longer says it either",
    ).toBeGreaterThan(0);

    const borderStyle = await block.evaluate(
      (el) =>
        getComputedStyle(el.querySelector("button") ?? el).borderTopStyle,
    );
    expect(
      borderStyle,
      "the dashed border is the non-text carrier of the approximate signal",
    ).toBe("dashed");
  });

  /**
   * ── QA-V2-4 ───────────────────────────────────────────────────────────────
   * Renderer parity. `src/lib/export-png-calendar.ts` took the same row order
   * so the exported grid and the site cannot drift, but nothing observes the
   * PNG's DOM: the existing assertions stop at `block.examNote`, and reordering
   * the appends in that file leaves every test green while the exported image
   * clips the marker the same way the site did.
   *
   * `captureCardPng` parks the finished card in an off-screen holder
   * (`left: -100000px`) before rasterizing, so a MutationObserver installed
   * pre-navigation sees exactly the DOM that becomes the PNG. `textContent`
   * order is DOM order, which is what the fixed-height face clips against.
   *
   * Mutation-verified: swapping the two `examSeg.append` blocks in
   * export-png-calendar.ts turns this red while QA v1's `AC6-QA2` — which reads
   * the same rasterized DOM, but only checks that the notes strip contains the
   * verbatim text — stays green.
   */
  test("QA-V2-4 — the exported calendar PNG orders the qualifier above the secondary markers, like the site", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __attached: string[] }).__attached = seen;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            const el = node as HTMLElement;
            if (el.style?.left !== "-100000px") continue;
            if (el.textContent) seen.push(el.textContent);
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await seedSelection(page, [NOTED!.id, "biology"]);
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
    const download = page.waitForEvent("download");
    await item.first().click();
    await download;

    const captured = await page.evaluate(
      () => (window as unknown as { __attached: string[] }).__attached,
    );
    const card = captured.find((text) => text.includes(NOTE_LABEL));
    expect(
      card,
      `the rasterized calendar card never printed "${NOTE_LABEL}" — the exported PNG lost the qualifier marker`,
    ).toBeTruthy();
    const markerAt = card!.indexOf(NOTE_LABEL);
    const secondaryAt = card!.indexOf("Length pending");
    expect(
      secondaryAt,
      "the exported card lost the `Length pending` marker",
    ).toBeGreaterThanOrEqual(0);
    expect(
      markerAt,
      "the exported PNG puts the qualifier marker BELOW the secondary markers — the same fixed-height face clips from the bottom there, so the two renderers have drifted apart",
    ).toBeLessThan(secondaryAt);
  });

  /**
   * ── QA-V2-5 (measurement, not a gate) ─────────────────────────────────────
   * The rebuild capped the subject-name row at two lines to stop a long name
   * squeezing the qualifier out. This records what that costs: how many of the
   * roster's exam-bearing names are ellipsised at each viewport in the widest
   * lane the grid ever gives a block (one block, no same-slot partner), and how
   * much of the face is still unused when it happens.
   *
   * It asserts only that the measurement harness worked — the numbers are for
   * the report, not a merge gate. See `name-clamp-survey.json` in the evidence
   * folder.
   */
  test("QA-V2-5 — survey: subject-name clamping vs unused face height", async ({
    page,
  }) => {
    const names = SUBJECTS.filter((s) => s.exam).map((s) => s.name);
    const survey: Record<string, unknown> = {};
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSelection(page, ["biology"]);
      await page.goto("/");
      await pressViewChip(page, "Calendar");
      survey[vp.name] = await page.evaluate((allNames) => {
        const block = document.querySelector(
          '[data-testid="calendar-block"]',
        ) as HTMLElement;
        const face = block.querySelector(
          "span[aria-hidden='true'][style*='height']",
        ) as HTMLElement;
        const nameRow = face.children[0] as HTMLElement;
        const probe = nameRow.cloneNode(false) as HTMLElement;
        probe.style.width = `${nameRow.clientWidth}px`;
        nameRow.parentElement!.appendChild(probe);
        const clamped: string[] = [];
        for (const n of allNames) {
          probe.textContent = n;
          if (probe.scrollHeight > probe.clientHeight + 1) clamped.push(n);
        }
        probe.remove();
        const used = Array.from(face.children).reduce(
          (sum, c) => sum + c.getBoundingClientRect().height,
          0,
        );
        return {
          laneWidth: Math.round(block.getBoundingClientRect().width),
          nameWidth: nameRow.clientWidth,
          faceHeight: Math.round(face.getBoundingClientRect().height),
          faceUsed: Math.round(used),
          total: allNames.length,
          clampedCount: clamped.length,
          clamped,
        };
      }, names);
    }
    writeFileSync(
      `${EVIDENCE_DIR}/name-clamp-survey.json`,
      `${JSON.stringify(survey, null, 2)}\n`,
    );
    for (const vp of VIEWPORTS) {
      const row = survey[vp.name] as { total: number };
      expect(row.total).toBe(names.length);
    }
  });
});
