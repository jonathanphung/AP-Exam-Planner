import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #91) — independent verification that the list-view
 * `.png` no longer prints multi-hundred-character notes inside its rows.
 *
 * ## Amended by Jon's bounce (2026-07-27)
 *
 * The approved PR #96 relocated BOTH verbatim strings (portfolio submission
 * notes + the published exam qualifier) into a de-duplicated strip. Jon then
 * bounced the card: the portfolio note must not be on the exported list card
 * AT ALL — not inline, not in the strip, not as a marker; only the dated
 * deadline row stays. The `examNote` treatment stays as approved. Where the
 * ticket's original ACs conflict with the bounce, the bounce supersedes: AC2
 * ("every note still on the card") is voided for portfolio notes and holds for
 * examNote; AC4 (dedup) now applies only to examNote; AC6 (same treatment for
 * both kinds) is voided — the divergence is deliberate.
 *
 * ## What the Builder already pinned, and why this is not a duplicate
 *
 * `src/lib/week-card-notes.test.ts` pins the MODEL (`weekCardNotes` emits only
 * exam qualifiers). `e2e/issue-91-list-note-strip.spec.ts` measures the
 * rasterized card for ONE selection — the issue's worst case.
 *
 * Three things neither of those can fail on, and all three are where the risk
 * sits:
 *
 * 1. **"Nowhere on the card" is asserted for one note group, not for the
 *    dataset.** The Builder's e2e sweeps the largest portfolio group + the one
 *    `examNote`. A renderer that still printed, say, the AP Research note (a
 *    group of one) would keep every Builder assertion green. The amended
 *    contract is a claim about EVERY portfolio note, so this suite selects all
 *    12 note-bearing subjects plus AP Networking and sweeps every distinct
 *    dataset string across every emitted card: portfolio texts absent
 *    everywhere, the qualifier present exactly once on its card.
 *
 * 2. **AC5 is a claim about DOMINANCE, not about row height.** "The exam dates
 *    must remain the visually dominant content" can regress without any row
 *    growing. So this suite measures the painted geometry — strip height vs.
 *    the height the rows occupy, and each region's share of the card — instead
 *    of only the per-row budget.
 *
 * 3. **AC8 ("the calendar `.png` is unchanged") is asserted by nobody.** The
 *    diff not touching `export-png-calendar.ts` is necessary, not sufficient:
 *    both variants consume `WeekCardRow`/`week-cards.ts`, which this change
 *    edited. This suite exports the calendar card in the same browser session
 *    and asserts its notes strip is still the `Published notes` construction
 *    with the verbatim qualifier, and that neither the retired `Portfolio
 *    note` label nor any portfolio note text has leaked into it.
 *
 * Everything is dataset-derived — no note text, subject id or subject name is
 * hardcoded — so the next annual swap re-points the suite rather than going
 * stale, and the fixture guard fails loudly instead of letting an assertion go
 * vacuous.
 *
 * Evidence: `docs/super-board/runs/issue-91-qa-v1/` (via QA_EVIDENCE_DIR).
 */

const EVIDENCE_DIR = evidenceDir("issue-91-qa-v1");

/** Mirrors `EXAM_NOTE_LABEL` in src/lib/schedule.ts. */
const EXAM_NOTE_LABEL = "Published note";
/**
 * The RETIRED portfolio marker label (was `PORTFOLIO_NOTE_LABEL` in
 * src/lib/export-png.ts until Jon's bounce removed the portfolio note from the
 * list card entirely). Asserted ABSENT from every export.
 */
const RETIRED_PORTFOLIO_LABEL = "Portfolio note";
/** Mirrors `CARD_WIDTH` in src/lib/export-png.ts. */
const CARD_WIDTH = 680;

/**
 * A row may be at most two painted lines of identity (long subject names wrap
 * against the day/session/clock column — that predates this issue) plus one
 * marker line. 2 × 16px × 1.2 + 4px gap + 11px × 1.3 + 24px padding + 2px
 * border ≈ 84px. Anything above this is a paragraph again, not a row: a single
 * inlined 310-character note measured ~110px on top of the name.
 */
const ROW_HEIGHT_BUDGET_PX = 90;

type Subject = {
  id: string;
  name: string;
  category: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  examNote?: string;
  portfolio?: { note?: string } | null;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;

/** Every distinct verbatim string the old renderer inlined into a row. */
interface DatasetNote {
  kind: "portfolio" | "exam";
  text: string;
  subjects: Subject[];
}
const DATASET_NOTES: DatasetNote[] = (() => {
  const byKey = new Map<string, DatasetNote>();
  const add = (kind: DatasetNote["kind"], text: string, subject: Subject) => {
    const hit = byKey.get(`${kind}:${text}`);
    if (hit) hit.subjects.push(subject);
    else byKey.set(`${kind}:${text}`, { kind, text, subjects: [subject] });
  };
  for (const subject of SUBJECTS) {
    // Only subjects that actually reach a card row can carry a note there.
    if (subject.portfolio?.note) add("portfolio", subject.portfolio.note, subject);
    if (subject.examNote && subject.exam) add("exam", subject.examNote, subject);
  }
  return [...byKey.values()];
})();

/** Every subject that carries any note — the "nothing lost" selection. */
const NOTE_BEARERS = [
  ...new Set(DATASET_NOTES.flatMap((n) => n.subjects.map((s) => s.id))),
];

/** The most-repeated note (May 2027: the 310-char PPR text, ×6). */
const SHARED = [...DATASET_NOTES].sort(
  (a, b) => b.subjects.length - a.subjects.length,
)[0];

/** The dataset's qualified exam (May 2027: AP Networking). */
const NOTED = SUBJECTS.find((s) => s.examNote && s.exam !== null);

/** The issue's stated worst case: the shared-note subjects + the qualified exam. */
const WORST_CASE = [
  ...SHARED.subjects.map((s) => s.id),
  ...(NOTED ? [NOTED.id] : []),
];

interface RowProbe {
  height: number;
  text: string;
  /** Text of every italic marker span in the row (the note markers). */
  markers: string[];
}

interface CardProbe {
  text: string;
  /** The card root's own width — must stay exactly `CARD_WIDTH`. */
  width: number;
  /** Root `scrollWidth - clientWidth`: > 0 means horizontal overflow. */
  overflow: number;
  /** Painted height of the whole card. */
  height: number;
  rows: RowProbe[];
  /** Painted height of the notes strip, or 0 when the card has none. */
  stripHeight: number;
  /** The notes strip's text, or null when the card has none. */
  stripText: string | null;
  /** One string per entry in the strip. */
  stripEntries: string[];
}

/**
 * Record geometry + text for every export card attached during this page's
 * life. Measured INSIDE the observer callback: `captureCardPng` removes the
 * off-screen holder in its `finally`, so there is nothing left to measure once
 * the download resolves.
 *
 * Written independently of the Builder's probe: it keys the notes strip off the
 * dashed top border + a `Notes` heading child (the construction under test),
 * not off `textContent.startsWith("Notes")`, so a strip that renders its
 * heading but drops its entries is still visible to the assertions.
 */
async function probeExportCards(page: Page) {
  await page.addInitScript(() => {
    const probes: unknown[] = [];
    (window as unknown as { __qa91: unknown[] }).__qa91 = probes;
    const px = (n: number) => Math.round(n * 100) / 100;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const holder = node as HTMLElement;
          // Only the export holder — see captureCardPng in export-card-theme.ts.
          if (holder.style?.left !== "-100000px") continue;
          const root = holder.firstElementChild as HTMLElement | null;
          if (!root) continue;
          const box = root.firstElementChild as HTMLElement | null;
          const body = box?.children[1] as HTMLElement | null;
          const children = body
            ? (Array.from(body.children) as HTMLElement[])
            : [];
          // A row is the only body child painted with the 4px accent bar.
          const rowEls = children.filter(
            (c) => getComputedStyle(c).borderLeftWidth === "4px",
          );
          const stripEl =
            children.find((c) => {
              const style = getComputedStyle(c);
              if (style.borderTopStyle !== "dashed") return false;
              return (
                (c.firstElementChild?.textContent ?? "") === "Published notes"
              );
            }) ?? null;
          // The entry list is the strip's second child (heading, then list).
          const entryEls = stripEl
            ? Array.from((stripEl.children[1]?.children ?? []) as HTMLCollection)
            : [];
          probes.push({
            text: root.textContent ?? "",
            width: root.offsetWidth,
            overflow: root.scrollWidth - root.clientWidth,
            height: px(root.getBoundingClientRect().height),
            rows: rowEls.map((r) => ({
              height: px(r.getBoundingClientRect().height),
              text: r.textContent ?? "",
              markers: Array.from(r.querySelectorAll("span"))
                .filter((s) => getComputedStyle(s).fontStyle === "italic")
                .map((s) => s.textContent ?? ""),
            })),
            stripHeight: stripEl
              ? px(stripEl.getBoundingClientRect().height)
              : 0,
            stripText: stripEl?.textContent ?? null,
            stripEntries: entryEls.map((e) => e.textContent ?? ""),
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const readProbes = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __qa91: CardProbe[] }).__qa91,
  ) as Promise<CardProbe[]>;

async function seed(
  page: Page,
  selection: readonly string[],
  theme: "light" | "dark",
) {
  await page.addInitScript(
    ([sel, th]) => {
      try {
        localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
        localStorage.setItem("apx.resolutions.v1", "[]");
        localStorage.setItem("apx.theme.v1", th as string);
      } catch {}
    },
    [selection, theme] as const,
  );
}

/**
 * Export one `.png` variant and return every download plus every measured card.
 *
 * The exporter walks the weeks SERIALLY and emits one download per week, so a
 * plain "at least one download" wait returns mid-walk and silently skips the
 * later weeks. Settle on: ≥1 download, the count unchanged between two polls,
 * and the probe count caught up with it.
 */
async function exportCards(
  page: Page,
  item: "Save as list view .png" | "Save as calendar view .png",
  selection: readonly string[],
  theme: "light" | "dark",
) {
  await probeExportCards(page);
  await seed(page, selection, theme);
  await page.goto("/");
  await pressViewChip(page, item.includes("list") ? "List" : "Calendar");

  const trigger = page.getByTestId("export-menu-button");
  await expect(trigger).toBeEnabled();
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await trigger.click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: item, exact: true }).click();

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
      { timeout: 60000, intervals: Array(120).fill(500) },
    )
    .toBe(true);
  return { downloads, probes: await readProbes(page) };
}

/** How many times `needle` occurs in `haystack`. */
const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

test.describe("issue #91 QA — the list card's note budget", () => {
  test("fixture guard — the dataset still supplies the defect", () => {
    // Without these the de-duplication and dominance assertions below would
    // pass vacuously on a cycle whose notes happen to be short or unique.
    expect(DATASET_NOTES.length, "no subject carries a note at all").toBeGreaterThan(
      1,
    );
    expect(
      SHARED.subjects.length,
      "no note is shared by 2+ subjects — nothing to de-duplicate",
    ).toBeGreaterThan(1);
    expect(
      SHARED.text.length,
      "the shared note is no longer long enough to swamp a row",
    ).toBeGreaterThan(150);
    expect(NOTED, "no exam carries a published qualifier this cycle").toBeTruthy();
    expect(NOTE_BEARERS.length).toBeGreaterThan(SHARED.subjects.length);
  });

  test("amended AC2 — portfolio notes appear NOWHERE; the exam qualifier survives, once per card", async ({
    page,
  }) => {
    // The whole note-bearing selection, not just the worst case: a renderer
    // that still printed a group-of-one note (AP Research, AP Seminar, AP CSP)
    // would keep the Builder's suite green.
    const { probes } = await exportCards(
      page,
      "Save as list view .png",
      NOTE_BEARERS,
      "light",
    );
    expect(probes.length).toBeGreaterThan(0);

    for (const note of DATASET_NOTES) {
      if (note.kind === "portfolio") {
        // Jon's bounce — the portfolio prose is not on ANY list card, in any
        // region: not a row, not a strip entry, not a marker.
        for (const probe of probes) {
          expect(
            probe.text,
            `"${note.text.slice(0, 48)}…" (${note.subjects
              .map((s) => s.name)
              .join(", ")}) is still on an exported list card`,
          ).not.toContain(note.text);
        }
        // …but its dated deadline ROW survives for every selected subject.
        for (const subject of note.subjects) {
          expect(
            probes.some((p) =>
              p.rows.some(
                (r) =>
                  r.text.includes(subject.name) &&
                  r.text.includes("Portfolio deadline"),
              ),
            ),
            `${subject.name} lost its portfolio deadline row`,
          ).toBe(true);
        }
        continue;
      }

      // examNote — the approved treatment is untouched by the bounce.
      const carriers = probes.filter((p) => p.text.includes(note.text));
      expect(
        carriers.length,
        `"${note.text.slice(0, 48)}…" (${note.subjects
          .map((s) => s.name)
          .join(", ")}) is on NO exported card — the qualifier was dropped, not deferred`,
      ).toBeGreaterThan(0);

      for (const carrier of carriers) {
        // AC4 — printed once per card however many of its subjects are on it.
        expect(
          occurrences(carrier.text, note.text),
          `printed ${occurrences(carrier.text, note.text)}× on one card`,
        ).toBe(1);
        // In the strip, not back on a row.
        expect(carrier.stripText, "the card has no notes strip").toBeTruthy();
        expect(carrier.stripText!).toContain(note.text);
        for (const row of carrier.rows) {
          expect(
            row.text,
            `row "${row.text.slice(0, 40)}" inlines the qualifier again`,
          ).not.toContain(note.text);
        }
      }
    }

    // The retired marker label is gone from every card too.
    for (const probe of probes) {
      expect(probe.text).not.toContain(RETIRED_PORTFOLIO_LABEL);
    }
  });

  test("amended AC2/AC4 — the strip attributes each qualifier to every subject on the card that carries it", async ({
    page,
  }) => {
    const { probes } = await exportCards(
      page,
      "Save as list view .png",
      NOTE_BEARERS,
      "light",
    );
    const examNotes = DATASET_NOTES.filter((n) => n.kind === "exam");
    expect(examNotes.length, "no examNote in the dataset").toBeGreaterThan(0);
    for (const note of examNotes) {
      const carriers = probes.filter((p) => p.text.includes(note.text));
      // Not `for (…of carriers)` alone: an empty list would make every
      // assertion below vacuous, which is exactly what a renderer that DROPPED
      // the strip looks like from here.
      expect(
        carriers.length,
        `"${note.text.slice(0, 48)}…" is on no exported card — nothing to attribute`,
      ).toBeGreaterThan(0);
      for (const carrier of carriers) {
        const entry = carrier.stripEntries.find((e) => e.includes(note.text));
        expect(
          entry,
          `the qualifier is on the card but not in a strip ENTRY (heading-only strip?)`,
        ).toBeTruthy();
        // Only subjects whose rows are on THIS card should be attributed.
        const onThisCard = note.subjects.filter((s) =>
          carrier.rows.some((r) => r.text.includes(s.name)),
        );
        expect(onThisCard.length).toBeGreaterThan(0);
        for (const subject of onThisCard) {
          expect(
            entry!,
            `"${subject.name}" carries this qualifier on this card but is not attributed`,
          ).toContain(subject.name);
        }
        // AC3 — the label sits inside the entry, contiguous with the verbatim
        // text, and the text is byte-identical to the dataset.
        expect(entry!).toContain(`${EXAM_NOTE_LABEL}: ${note.text}`);
      }
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`AC1/AC5/AC7 — ${theme}: rows are one line of identity, the exam list dominates, no overflow`, async ({
      page,
    }) => {
      const { downloads, probes } = await exportCards(
        page,
        "Save as list view .png",
        WORST_CASE,
        theme,
      );
      // The worst-case card: the one carrying the portfolio deadline rows.
      // (It can no longer be found by the note text — the bounce removed the
      // prose from the card; only the dated rows remain.)
      const worst = probes.find((p) =>
        p.rows.some((r) => r.text.includes("Portfolio deadline")),
      );
      expect(
        worst,
        "no exported card carried the portfolio deadline rows at all",
      ).toBeTruthy();

      for (const probe of probes) {
        // Jon's bounce — the shared portfolio prose is on NO card, any theme.
        expect(probe.text).not.toContain(SHARED.text);

        // AC7 — the card is still exactly CARD_WIDTH and does not overflow.
        expect(probe.width).toBe(CARD_WIDTH);
        expect(probe.overflow).toBeLessThanOrEqual(0);

        // AC1 — no row is a paragraph.
        for (const row of probe.rows) {
          expect(
            row.height,
            `row "${row.text.slice(0, 50)}" is ${row.height}px tall`,
          ).toBeLessThanOrEqual(ROW_HEIGHT_BUDGET_PX);
          // AC3 — a row's lead-in is a derived short LABEL, never a paraphrase
          // and never a slice of the source text. Since the bounce the only
          // permitted marker is the exam-qualifier label.
          for (const marker of row.markers) {
            expect([EXAM_NOTE_LABEL]).toContain(marker);
          }
        }
      }

      // AC5 — the dates, not the prose, are the card's dominant content. Both
      // halves matter: the rows must out-measure the strip, and the strip must
      // stay a minority of the card. (Since the bounce the strip carries only
      // the exam qualifier, so on this card it is one short entry — or absent
      // when AP Networking's exam lands on the other week's card.)
      const rowsHeight = worst!.rows.reduce((sum, r) => sum + r.height, 0);
      expect(worst!.rows.length).toBeGreaterThan(1);
      expect(
        worst!.stripHeight,
        `the notes strip (${worst!.stripHeight}px) out-measures all ${worst!.rows.length} rows (${rowsHeight}px)`,
      ).toBeLessThan(rowsHeight);
      // Was 14% with the portfolio entries in the strip; the ceiling still
      // guards against the strip regrowing into a wall of text.
      expect(
        worst!.stripHeight / worst!.height,
        `the notes strip is ${Math.round(
          (100 * worst!.stripHeight) / worst!.height,
        )}% of the card`,
      ).toBeLessThan(0.3);

      // Real exported bytes, kept as evidence.
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

  test("AC8 — the calendar .png still defers to its own Published notes strip, untouched", async ({
    page,
  }) => {
    test.skip(!NOTED, "this cycle publishes no examNote");
    const { downloads, probes } = await exportCards(
      page,
      "Save as calendar view .png",
      WORST_CASE,
      "light",
    );
    const carrier = probes.find((p) => p.text.includes(NOTED!.examNote!));
    expect(
      carrier,
      "the rasterized calendar card lost the published qualifier",
    ).toBeTruthy();
    // Still the calendar's own construction — "Published notes" (plural
    // heading) — and neither the retired list-card label nor the portfolio
    // prose has leaked into it.
    expect(carrier!.text).toContain(`${EXAM_NOTE_LABEL}s`);
    for (const probe of probes) {
      expect(
        probe.text,
        "the retired Portfolio note marker leaked into the calendar export",
      ).not.toContain(RETIRED_PORTFOLIO_LABEL);
      expect(
        probe.text,
        "the portfolio prose leaked into the calendar export",
      ).not.toContain(SHARED.text);
    }
    for (const download of downloads) {
      const buf = readFileSync(await download.path());
      expect([...buf.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      writeFileSync(
        `${EVIDENCE_DIR}/calendar-${download.suggestedFilename()}`,
        buf,
      );
    }
  });

  test("AC9 — the source comment records the new decision, not the old one", () => {
    const source = readFileSync("src/lib/export-png.ts", "utf8");
    // The stale claim the issue calls out by line number.
    expect(
      source,
      'export-png.ts still documents the qualifier as "Printed in full on the card"',
    ).not.toContain("Printed in full on the card");
    // The new decision, and why #71's requirement still holds.
    expect(source).toContain("#91");
    expect(source).toMatch(/#71/);
    // The bounce amendment: the deliberate examNote/portfolio divergence is
    // recorded as Jon's product call on the exported card, with its date.
    expect(source).toContain("2026-07-27");
  });

  test("visual evidence — the on-screen list view + export menu at the standard viewports", async ({
    page,
  }) => {
    const viewports = [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "tablet", width: 1024, height: 768 },
      { name: "mobile", width: 375, height: 667 },
    ] as const;
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seed(page, WORST_CASE, "light");
      await page.goto("/");
      await pressViewChip(page, "List");
      await expect(page.getByTestId("export-menu-button")).toBeEnabled();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${viewport.name}.png`,
        fullPage: false,
      });
    }
  });
});
