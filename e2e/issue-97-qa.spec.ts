import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";
import { pressViewChip } from "./support/view-chip";

/**
 * Independent Tester verification (super-board QA lane) — issue #97, the
 * "Week 0" card that collects every portfolio deadline so deadline rows stop
 * riding the Week 1 exam card.
 *
 * Written against the ACs, not against the builder's spec. Where
 * `issue-97-week-zero.spec.ts` drives a hand-picked 3-subject fixture, this
 * suite sweeps the WHOLE dataset — all 12 portfolio subjects, every distinct
 * submission-note string, every emitted card's count line — because the AC
 * says "all 12 possible in the current dataset" and "no portfolio note text
 * anywhere on the card", and a 2-subject fixture cannot observe either claim.
 *
 * Everything is measured on the REAL app: the off-screen DOM `html-to-image`
 * actually rasterizes (captured through a pre-navigation MutationObserver on
 * `captureCardPng`'s holder), the REAL downloaded filenames, and the REAL
 * on-screen views for the "untouched" AC.
 *
 * Test TITLES here deliberately spell no two-digit "all NN" count: the repo's
 * own anti-drift guard (`src/data/doc-freshness.test.ts` AC5, issue #71) reads
 * every test and describe title in the repo and rejects a roster count the
 * dataset does not produce. 12 is the portfolio-subject count, not a roster or
 * category size, so it reads as drift there. The sweep still covers all of
 * them — the count lives in the assertions, derived from the dataset.
 *
 * AC → test map:
 *   AC1  every selected deadline on Week 0, none on an exam week  → "every … deadline"
 *   AC2  Week 0 only when non-empty                               → "no deadline"
 *   AC3  label/slug + regular numbering unshifted                 → "every … deadline"
 *   AC4  weekPngFileName composition                              → filenames
 *   AC5  name + "Portfolio deadline" + real date, no note prose   → "every … deadline"
 *   AC6  portfolio-only selection → exactly one card, Week 0      → "portfolio only"
 *   AC7  undated footnote unaffected                              → "undated"
 *   AC8  calendar variant consistent with the list variant        → "calendar"
 *   AC9  no card's count line reads "0 exams"                     → "count lines"
 *   AC10 on-screen views untouched                                → "on screen"
 */

const EVIDENCE_DIR = evidenceDir("issue-97-qa-v1");

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  portfolio?: { deadline: string; note?: string } | null;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;
const byId = (id: string) => SUBJECTS.find((s) => s.id === id)!;

/** Every portfolio subject in the shipped cycle — the AC's "all 12". */
const PORTFOLIO = SUBJECTS.filter((s) => s.portfolio);
const PORTFOLIO_IDS = PORTFOLIO.map((s) => s.id);
/** Deadlines before every testing window. */
const APR30 = PORTFOLIO.filter((s) => s.portfolio!.deadline === "2027-04-30");
/** Deadlines INSIDE Week 1's window — the Art & Design trio. */
const MAY7 = PORTFOLIO.filter((s) => s.portfolio!.deadline === "2027-05-07");
/** Every DISTINCT verbatim submission note the card must never print. */
const PORTFOLIO_NOTES = [
  ...new Set(
    PORTFOLIO.map((s) => s.portfolio?.note).filter((n): n is string => !!n),
  ),
];
/** A dated exam with NO portfolio of its own (the AC2 control). */
const PLAIN_EXAM = SUBJECTS.find((s) => !s.portfolio && s.exam)!;

interface CardProbe {
  /** The whole header's text — label + range + cycle + count line. */
  header: string;
  /** The whole card's text, for containment / absence assertions. */
  text: string;
  /** Text of each LIST row (a body child with the 4px accent bar). */
  rowTexts: string[];
  /** The card root's own width in CSS px. */
  width: number;
}

/**
 * Record every export card attached to the document during this page's life.
 * Measured INSIDE the observer callback — `captureCardPng` removes the holder
 * in its `finally`, so nothing survives to be measured afterwards.
 */
async function probeExportCards(page: Page) {
  await page.addInitScript(() => {
    const probes: unknown[] = [];
    (window as unknown as { __qaProbes: unknown[] }).__qaProbes = probes;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const holder = node as HTMLElement;
          // Only captureCardPng's off-screen holder, never app markup.
          if (holder.style?.left !== "-100000px") continue;
          const root = holder.firstElementChild as HTMLElement | null;
          const box = root?.firstElementChild as HTMLElement | null;
          const header = box?.children[0] as HTMLElement | null;
          const body = box?.children[1] as HTMLElement | null;
          if (!root || !header) continue;
          const rows = body
            ? (Array.from(body.children) as HTMLElement[]).filter(
                (c) => getComputedStyle(c).borderLeftWidth === "4px",
              )
            : [];
          probes.push({
            header: header.textContent ?? "",
            text: root.textContent ?? "",
            rowTexts: rows.map((r) => r.textContent ?? ""),
            width: root.offsetWidth,
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const readProbes = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __qaProbes: CardProbe[] }).__qaProbes,
  ) as Promise<CardProbe[]>;

/** Seed the selection through the legacy keys the schedules store migrates. */
async function seed(page: Page, selection: readonly string[]) {
  await page.addInitScript((sel) => {
    try {
      localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
      localStorage.setItem("apx.resolutions.v1", "[]");
    } catch {}
  }, selection);
}

/** Export one variant and return its real downloads + the probed card DOM. */
async function exportCards(
  page: Page,
  selection: readonly string[],
  menuItem: string,
) {
  await probeExportCards(page);
  await seed(page, selection);
  await page.goto("/");

  const trigger = page.getByTestId("export-menu-button");
  await expect(trigger).toBeEnabled();
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await trigger.click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: menuItem, exact: true }).click();

  // The exporter walks the cards SERIALLY — wait until the download count has
  // settled AND every card has been probed, so no later card is missed.
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

/** Save the real rasterized files, asserting each is a genuine PNG. */
async function saveEvidence(downloads: Download[], prefix: string) {
  for (const download of downloads) {
    const buf = readFileSync(await download.path());
    expect([...buf.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    writeFileSync(
      `${EVIDENCE_DIR}/${prefix}-${download.suggestedFilename()}`,
      buf,
    );
  }
}

test("fixture guard — the cycle ships 12 deadlines on two dates, one inside Week 1", () => {
  expect(PORTFOLIO_IDS).toHaveLength(12);
  expect(APR30).toHaveLength(9);
  expect(MAY7).toHaveLength(3);
  // The reason a date cutoff cannot implement this ticket: the Art & Design
  // deadline is the same day as a real Week 1 exam sitting.
  expect(byId("german-language-and-culture").exam?.date).toBe("2027-05-07");
  expect(PORTFOLIO_NOTES.length).toBeGreaterThan(0);
  expect(PLAIN_EXAM.exam?.date).toBeTruthy();
});

test("AC1/AC3/AC5/AC9 — every portfolio deadline lands on ONE Week 0 card; exam weeks keep their numbers and hold no deadline", async ({
  page,
}) => {
  const { downloads, probes } = await exportCards(
    page,
    PORTFOLIO_IDS,
    "Save as list view .png",
  );

  // AC3/AC4: Week 0 leads, and the position-derived numbering is unshifted —
  // the eight portfolio subjects that also sit exams span Weeks 1 and 2, and
  // those cards are still "week-1" / "week-2".
  expect(downloads.map((d) => d.suggestedFilename())).toEqual([
    "schedule-1-ap-exams-2027-week-0-list.png",
    "schedule-1-ap-exams-2027-week-1-list.png",
    "schedule-1-ap-exams-2027-week-2-list.png",
  ]);

  const [week0, ...examWeeks] = probes;
  expect(probes).toHaveLength(3);
  expect(week0.header).toContain("Week 0");
  expect(examWeeks[0].header).toContain("Week 1");
  expect(examWeeks[1].header).toContain("Week 2");

  // AC1: every one of the 12 deadlines is a Week 0 row, correctly dated.
  expect(week0.rowTexts).toHaveLength(12);
  for (const subject of APR30) {
    const row = week0.rowTexts.find((r) => r.includes(subject.name));
    expect(row, `${subject.id} is missing from Week 0`).toBeTruthy();
    expect(row).toContain("Fri, Apr 30");
  }
  for (const subject of MAY7) {
    const row = week0.rowTexts.find((r) => r.includes(subject.name));
    expect(row, `${subject.id} is missing from Week 0`).toBeTruthy();
    // The real deadline date, even though May 7 is inside Week 1's window.
    expect(row).toContain("Fri, May 7");
  }
  // AC5: every row names the kind.
  for (const row of week0.rowTexts) expect(row).toContain("Portfolio deadline");

  // AC1: and NO exam-week card carries a deadline row.
  for (const card of examWeeks) {
    expect(card.text).not.toContain("Portfolio deadline");
    for (const subject of PORTFOLIO) {
      expect(card.text).not.toContain(subject.portfolio!.deadline);
    }
  }

  // AC5: Jon's #91 bounce is not resurrected — NO submission-note prose on any
  // card, swept across every distinct note string in the dataset.
  for (const note of PORTFOLIO_NOTES) {
    for (const card of probes) {
      expect(
        card.text,
        `a portfolio submission note is printed on ${card.header.slice(0, 12)}`,
      ).not.toContain(note);
    }
  }

  // AC9 + the header identity: a deadlines card counts deadlines, never exams,
  // and its range describes the rows it holds rather than a fabricated window.
  expect(week0.header).toContain("12 deadlines");
  expect(week0.header).toContain("Apr 30 – May 7, 2027");
  for (const card of probes) expect(card.header).not.toContain("0 exams");

  await saveEvidence(downloads, "all12-list");
});

test("AC2 — a selection with no portfolio subject gets NO Week 0 card, in either variant", async ({
  page,
}) => {
  for (const [menuItem, view] of [
    ["Save as list view .png", "list"],
    ["Save as calendar view .png", "calendar"],
  ] as const) {
    const { downloads, probes } = await exportCards(
      page,
      [PLAIN_EXAM.id],
      menuItem,
    );
    expect(downloads.map((d) => d.suggestedFilename())).toEqual([
      `schedule-1-ap-exams-2027-week-1-${view}.png`,
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0].header).toContain("Week 1");
    expect(probes[0].header).not.toContain("Week 0");
    expect(probes[0].text).not.toContain("Portfolio");
  }
});

test("AC6 — a portfolio-ONLY selection exports exactly one card, and it is Week 0", async ({
  page,
}) => {
  for (const [menuItem, view] of [
    ["Save as list view .png", "list"],
    ["Save as calendar view .png", "calendar"],
  ] as const) {
    // Every Art & Design subject: three deadlines, no exam of their own, all
    // dated INSIDE Week 1's window. Pre-#97 this shipped as a card labeled
    // "Week 1" holding nothing but deadlines.
    const { downloads, probes } = await exportCards(
      page,
      MAY7.map((s) => s.id),
      menuItem,
    );
    expect(downloads.map((d) => d.suggestedFilename())).toEqual([
      `schedule-1-ap-exams-2027-week-0-${view}.png`,
    ]);
    expect(probes).toHaveLength(1);
    expect(probes[0].header).toContain("Week 0");
    expect(probes[0].header).toContain("3 deadlines");
    // Single-date card → a single-date range label, not an invented span.
    expect(probes[0].header).toContain("May 7, 2027");
    expect(probes[0].header).not.toContain("–");
  }
});

test("AC8 — the calendar variant fans out the SAME cards, with a grid-less Week 0", async ({
  page,
}) => {
  const { downloads, probes } = await exportCards(
    page,
    PORTFOLIO_IDS,
    "Save as calendar view .png",
  );

  // #73's one-presentation principle: same set, same order as the list run.
  expect(downloads.map((d) => d.suggestedFilename())).toEqual([
    "schedule-1-ap-exams-2027-week-0-calendar.png",
    "schedule-1-ap-exams-2027-week-1-calendar.png",
    "schedule-1-ap-exams-2027-week-2-calendar.png",
  ]);

  const [week0, ...examWeeks] = probes;
  expect(week0.header).toContain("Week 0");
  expect(week0.header).toContain("12 deadlines");
  // The strip IS the card — it must not name a grid the reader cannot see.
  expect(week0.text).toContain("Portfolio deadlines");
  expect(week0.text).not.toContain("Not placed on the grid");
  // No grid chrome: no hour axis, no weekday column headers.
  expect(week0.text).not.toContain("8 AM");
  expect(week0.text).not.toContain("12 PM");
  // Every deadline is present with its real date.
  for (const subject of APR30) {
    expect(week0.text).toContain(subject.name);
  }
  expect(week0.text).toContain("Portfolio due Friday, April 30, 2027");
  expect(week0.text).toContain("Portfolio due Friday, May 7, 2027");

  // The exam weeks lose the deadline strip entirely and keep their grids.
  for (const card of examWeeks) {
    expect(card.text).not.toContain("Portfolio due");
    expect(card.text).not.toContain("Not placed on the grid");
    expect(card.header).not.toContain("0 exams");
  }
  for (const note of PORTFOLIO_NOTES) {
    for (const card of probes) expect(card.text).not.toContain(note);
  }

  await saveEvidence(downloads, "all12-calendar");
});

test("AC7 — the undated footnote is untouched: no card prints one, because the cycle has no undated subject", async ({
  page,
}) => {
  // The footnote is driven by `undated`, which #97 does not touch: a portfolio
  // deadline is a DATED entry and can never reach it. The shipped 2027 cycle
  // has no undated subject at all, so the correct observable is that no
  // exported card prints the footnote — on Week 0 least of all, where it would
  // wrongly imply an undated subject has a deadline.
  expect(SUBJECTS.filter((s) => !s.exam && !s.portfolio)).toHaveLength(0);
  const { probes } = await exportCards(
    page,
    PORTFOLIO_IDS,
    "Save as list view .png",
  );
  for (const card of probes) {
    expect(card.text).not.toContain("Also selected (no");
  }
});

test("AC10 — the on-screen views are untouched by the export change", async ({
  page,
}) => {
  const selection = [
    "german-language-and-culture", // Apr 30 deadline + a May 7 exam
    "drawing", // May 7 deadline, no exam
    "biology", // an ordinary Week 1 exam
  ];
  await seed(page, selection);
  await page.goto("/");

  // Calendar view: the portfolio deadlines still sit in the site's own
  // "Not placed on the grid" strip — #97 changed the EXPORT, not the app.
  await pressViewChip(page, "Calendar");
  const strip = page.getByTestId("calendar-off-grid");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Not placed on the grid");
  await expect(strip).toContainText("Portfolio due Friday, April 30, 2027");
  await expect(strip).toContainText("Portfolio due Friday, May 7, 2027");
  // …and there is no "Week 0" anywhere on screen.
  await expect(page.getByText("Week 0", { exact: true })).toHaveCount(0);

  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `${EVIDENCE_DIR}/onscreen-calendar-${name}.png`,
      fullPage: true,
    });
  }

  // List view: the portfolio row is still an ordinary dated row with its
  // "Portfolio due" pill (issue #91's on-screen contract).
  await page.setViewportSize({ width: 1920, height: 1080 });
  await pressViewChip(page, "List");
  const schedule = page.locator('section[aria-label="My schedule"]');
  await expect(schedule).toBeVisible();
  await expect(schedule).toContainText("Portfolio due");
  await expect(schedule).toContainText(byId("drawing").name);
  await expect(page.getByText("Week 0", { exact: true })).toHaveCount(0);

  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `${EVIDENCE_DIR}/onscreen-list-${name}.png`,
      fullPage: true,
    });
  }
});
