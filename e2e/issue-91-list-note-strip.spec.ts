import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";

/**
 * Builder acceptance drive + evidence for issue #91 — the list card's note
 * budget, as amended by Jon's bounce (2026-07-27).
 *
 * ## The amended contract this pins
 *
 * PR #96 first moved BOTH long verbatim strings (portfolio submission notes +
 * the published exam qualifier) out of the rows into a de-duplicated strip.
 * Jon bounced that with a product call: the portfolio note should not be on
 * the exported list card AT ALL — not inline, not in the strip, not as a row
 * marker. The dated deadline ROW stays; the prose goes. The `examNote`
 * treatment (marker on the row, verbatim text once in the strip) stays exactly
 * as approved. So this suite asserts:
 *
 * 1. The portfolio note text appears NOWHERE in the rasterized card DOM, and
 *    neither does the retired `Portfolio note` marker label.
 * 2. Every selected portfolio deadline still gets its dated row.
 * 3. The exam qualifier survives verbatim — marker on the row, `Published
 *    note: <text>` contiguous in the strip (issue #71's disclosure contract).
 * 4. A card with no qualified exam gets no strip at all.
 *
 * ## What this observes that no other suite can
 *
 * `src/lib/week-card-notes.test.ts` pins the MODEL (`weekCardNotes` emits only
 * exam qualifiers). It cannot see pixels: "the portfolio text is not painted"
 * and "the strip really renders" are unobservable there. This suite measures
 * the ACTUAL node that becomes the PNG, using the harness
 * `e2e/issue-71-qa.spec.ts` established — `captureCardPng` parks the finished
 * card in a `left: -100000px` holder on `document.body` before rasterizing, so
 * a MutationObserver installed pre-navigation gets the exact geometry and text
 * the exporter hands to `html-to-image`.
 *
 * ## The scenario is the issue's own worst case
 *
 * Every subject sharing the most-repeated portfolio note (May 2027: the six AP
 * language subjects and the byte-identical 310-character PPR text) PLUS the
 * subject whose exam carries a published qualifier (AP Networking). Everything
 * is dataset-derived so the next annual swap re-points the suite instead of
 * asserting on stale strings.
 *
 * Evidence: `docs/super-board/runs/issue-91-build-v2/` (via QA_EVIDENCE_DIR).
 */

const EVIDENCE_DIR = evidenceDir("issue-91-build-v2");

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts. */
const EXAM_NOTE_LABEL = "Published note";
/**
 * The RETIRED portfolio marker label (was `PORTFOLIO_NOTE_LABEL` in
 * src/lib/export-png.ts until Jon's bounce). Asserted ABSENT.
 */
const RETIRED_PORTFOLIO_LABEL = "Portfolio note";
/** Mirrors `CARD_WIDTH` in src/lib/export-png.ts. */
const CARD_WIDTH = 680;

/**
 * A row is identity + timing + at most a one-line marker. 16px name (×1.2) +
 * 4px gap + 11px marker (×1.3) + 24px vertical padding + 2px border ≈ 63px.
 * The budget is deliberately just above that and FAR below the ~110px a single
 * inlined 310-character note produced, so it fails on a regression and not on a
 * one-pixel font-metric drift.
 */
const ROW_HEIGHT_BUDGET_PX = 72;

type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
  portfolio?: { note?: string } | null;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;

/** The most-repeated portfolio note in this cycle, with its subjects. */
const SHARED = (() => {
  const byNote = new Map<string, Subject[]>();
  for (const subject of SUBJECTS) {
    const note = subject.portfolio?.note;
    if (!note) continue;
    byNote.set(note, [...(byNote.get(note) ?? []), subject]);
  }
  const best = [...byNote.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0];
  return best ? { note: best[0], subjects: best[1] } : undefined;
})();

/** The dataset's qualified exam (May 2027: AP Networking). */
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam !== null);

const SELECTION = [
  ...(SHARED?.subjects ?? []).map((s) => s.id),
  ...(NOTED ? [NOTED.id] : []),
];

interface CardProbe {
  text: string;
  /** The card root's own width — must stay exactly `CARD_WIDTH`. */
  width: number;
  /** `scrollWidth - clientWidth` on the root: >0 means horizontal overflow. */
  overflow: number;
  /** Height of every exam/portfolio row on the card. */
  rowHeights: number[];
  /** Text of each row, so a failure names the offending subject. */
  rowTexts: string[];
  /** The notes strip's text, or null when the card has none. */
  stripText: string | null;
}

/**
 * Record geometry + text for every export card attached during this page's
 * life. Measured INSIDE the observer callback: `captureCardPng` removes the
 * holder in its `finally`, so there is nothing left to measure afterwards.
 */
async function probeExportCards(page: Page) {
  await page.addInitScript(() => {
    const probes: unknown[] = [];
    (window as unknown as { __probes: unknown[] }).__probes = probes;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const holder = node as HTMLElement;
          // Only the export holder (see captureCardPng), never app markup.
          if (holder.style?.left !== "-100000px") continue;
          const root = holder.firstElementChild as HTMLElement | null;
          const box = root?.firstElementChild as HTMLElement | null;
          const body = box?.children[1] as HTMLElement | null;
          if (!root || !body) continue;
          const children = Array.from(body.children) as HTMLElement[];
          // A row is the only body child with the 4px accent bar on its left
          // edge; the notes strip and the undated footnote have none.
          const rows = children.filter(
            (c) => getComputedStyle(c).borderLeftWidth === "4px",
          );
          // The strip heading is the calendar's "Published notes" since Jon's
          // bounce aligned the two variants.
          const strip = children.find((c) =>
            c.textContent?.startsWith("Published notes"),
          );
          probes.push({
            text: root.textContent ?? "",
            width: root.offsetWidth,
            overflow: root.scrollWidth - root.clientWidth,
            rowHeights: rows.map((r) => r.getBoundingClientRect().height),
            rowTexts: rows.map((r) => r.textContent ?? ""),
            stripText: strip?.textContent ?? null,
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const readProbes = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __probes: CardProbe[] }).__probes,
  ) as Promise<CardProbe[]>;

async function seed(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ([sel, th]) => {
      try {
        localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
        localStorage.setItem("apx.resolutions.v1", "[]");
        localStorage.setItem("apx.theme.v1", th as string);
      } catch {}
    },
    [SELECTION, theme] as const,
  );
}

/** Export the list cards and return every downloaded file plus the probes. */
async function exportListCards(page: Page, theme: "light" | "dark") {
  await probeExportCards(page);
  await seed(page, theme);
  await page.goto("/");

  const trigger = page.getByTestId("export-menu-button");
  await expect(trigger).toBeEnabled();
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await trigger.click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Save as list view .png", exact: true })
    .click();
  // The exporter walks the weeks SERIALLY — a plain "≥1 download" wait would
  // return mid-walk and silently drop the later week's card (and its evidence
  // file). Wait for the count to be non-zero AND unchanged between two polls,
  // with the probe count caught up, so every emitted card is measured.
  let previous = -1;
  await expect
    .poll(
      async () => {
        const seen = downloads.length;
        const probed = (await readProbes(page)).length;
        const settled = seen > 0 && seen === previous && probed === seen;
        previous = seen;
        return settled;
      },
      { timeout: 30000, intervals: Array(60).fill(500) },
    )
    .toBe(true);
  return { downloads, probes: await readProbes(page) };
}

test.describe("issue #91 — the list card's note budget (amended by Jon's bounce)", () => {
  test.skip(
    !SHARED || SHARED.subjects.length < 2,
    "this cycle ships no portfolio note shared by 2+ subjects — the six-times-over defect is unreproducible",
  );

  test("fixture guard — the dataset still supplies the worst case", () => {
    expect(SHARED!.subjects.length).toBeGreaterThan(1);
    expect(
      SHARED!.note.length,
      "the shared note is no longer long enough to have swamped a row",
    ).toBeGreaterThan(150);
    expect(NOTED, "no exam carries a published qualifier this cycle").toBeTruthy();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: the portfolio note is GONE from the card, its deadline rows stay, no overflow`, async ({
      page,
    }) => {
      const { downloads, probes } = await exportListCards(page, theme);
      expect(probes.length).toBeGreaterThan(0);

      // Jon's bounce — the portfolio note text appears NOWHERE in the list
      // card DOM: no row, no strip entry, no marker. Swept across EVERY
      // emitted card, not just the worst one.
      for (const probe of probes) {
        expect(
          probe.text,
          "the portfolio submission note is still on the exported card",
        ).not.toContain(SHARED!.note);
        expect(
          probe.text,
          "the retired Portfolio note marker is still on the exported card",
        ).not.toContain(RETIRED_PORTFOLIO_LABEL);

        // The card is still exactly CARD_WIDTH with no horizontal overflow.
        expect(probe.width).toBe(CARD_WIDTH);
        expect(probe.overflow).toBeLessThanOrEqual(0);

        // No row is a paragraph.
        probe.rowHeights.forEach((height, i) => {
          expect(
            height,
            `row "${probe.rowTexts[i].slice(0, 60)}" is ${Math.round(height)}px tall`,
          ).toBeLessThanOrEqual(ROW_HEIGHT_BUDGET_PX);
        });
      }

      // The deadline ROWS survive the bounce — one dated row per selected
      // portfolio subject. Only the prose was removed.
      const deadlineRows = probes
        .flatMap((p) => p.rowTexts)
        .filter((t) => t.includes("Portfolio deadline"));
      expect(
        deadlineRows.length,
        "removing the note also removed the deadline rows — the bounce kept those",
      ).toBeGreaterThanOrEqual(SHARED!.subjects.length);
      for (const subject of SHARED!.subjects) {
        expect(
          deadlineRows.some((t) => t.includes(subject.name)),
          `${subject.name} lost its portfolio deadline row`,
        ).toBe(true);
      }

      // Save the real exported images as evidence.
      for (const download of downloads) {
        const buf = readFileSync(await download.path());
        expect([...buf.subarray(0, 8)]).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        writeFileSync(
          `${EVIDENCE_DIR}/${theme}-${download.suggestedFilename()}`,
          buf,
        );
      }
    });
  }

  test("the exam qualifier keeps the approved treatment: marker on the row, verbatim in the strip", async ({
    page,
  }) => {
    test.skip(!NOTED, "this cycle publishes no examNote");
    const { probes } = await exportListCards(page, "light");
    const carrier = probes.find((p) => p.text.includes(NOTED!.examNote!))!;
    expect(
      carrier,
      "no exported card carried the qualifier — #71's disclosure was lost",
    ).toBeTruthy();

    // Marker on the row, never the paragraph.
    const row = carrier.rowTexts.find((t) => t.includes(NOTED!.name))!;
    expect(row).toContain(EXAM_NOTE_LABEL);
    expect(row).not.toContain(NOTED!.examNote!);

    // Verbatim text once, in the strip, attributed, contiguous with its label
    // ("Published note: <text>" — issue #71's disclosure contract, which
    // e2e/issue-71-qa.spec.ts asserts on the rasterized DOM).
    expect(carrier.stripText, "no notes strip on the qualifier's card").toBeTruthy();
    expect(carrier.stripText!).toContain(
      `${EXAM_NOTE_LABEL}: ${NOTED!.examNote!}`,
    );
    expect(carrier.stripText!).toContain(NOTED!.name);
    const occurrences = carrier.text.split(NOTED!.examNote!).length - 1;
    expect(occurrences, "the qualifier printed more than once").toBe(1);
  });

  test("a card with no qualified exam gets no strip (and no empty dashed rule)", async ({
    page,
  }) => {
    const { probes } = await exportListCards(page, "light");
    expect(probes.length).toBeGreaterThan(0);
    // Since the bounce, ONLY examNote reaches the strip: every card without
    // the qualifier text must have no strip at all — including the cards that
    // carry the six portfolio deadline rows.
    for (const probe of probes) {
      if (NOTED && probe.text.includes(NOTED.examNote!)) continue;
      expect(
        probe.stripText,
        "a card without an examNote rendered a strip anyway",
      ).toBeNull();
    }
  });
});
