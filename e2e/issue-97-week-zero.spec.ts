import { test, expect, type Download, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import apData from "../src/data/ap-2027.json";
import { evidenceDir } from "./support/evidence";
import { calendarWeeks } from "../src/lib/calendar";
import { firstWindowStart } from "../src/lib/week-cards";

/**
 * Builder evidence + acceptance drive for issue #97 — the "Week 0" card that
 * collects the portfolio deadlines due BEFORE exam week, so those rows stop
 * riding the Week 1 exam card.
 *
 * ## Why this fixture
 *
 * The ticket's own worst case, and the reason the rule needed settling: the May
 * 2027 dataset has TWO deadline dates, and one of them is INSIDE Week 1's
 * window.
 *
 *   - AP German Language and Culture — PPR due 2027-04-30 (before every
 *     window) AND an exam on 2027-05-07 AM (Week 1, Friday).
 *   - AP Drawing — portfolio due 2027-05-07, the same Friday German sits its
 *     exam, and no exam of its own.
 *   - AP Biology — 2027-05-03 PM, an ordinary Week 1 exam.
 *
 * Jon settled it on the bounce of this build (2026-07-27): the split is a DATE
 * CUTOFF — "i only want the stuff due before ap exam week on week 0. keep
 * portfolios due on ap exam week (ap 2-d art and design, ap drawing, etc.) on
 * the actual week that they occur for both list and calendar view." So German's
 * April 30 PPR goes to Week 0, and AP Drawing's May 7 portfolio stays on Week 1
 * beside the exams that share its day. A row-KIND implementation — this build's
 * first draft — would move Drawing too; this spec is what tells those apart.
 *
 * Measured on the REAL app + real download pipeline: the assertions run against
 * the off-screen DOM `html-to-image` actually rasterizes (captured through a
 * MutationObserver installed pre-navigation, the issue-#91 technique), plus the
 * real downloaded filenames, and the PNGs are saved as evidence.
 */

/**
 * `-v2`: the v1 folder holds the superseded kind-predicate build's PNGs, which
 * older issue/PR comments embed by raw URL. It stays untouched as the record of
 * what was shipped then; this rebuild writes its own.
 */
const EVIDENCE_DIR = evidenceDir("issue-97-build-v2");

/** A subject with BOTH an Apr 30 deadline and a Week 1 exam. */
const LANGUAGE_ID = "german-language-and-culture";
/** An Art & Design subject: deadline 2027-05-07, INSIDE Week 1's window. */
const ART_ID = "drawing";
/** An ordinary Week 1 exam, so Week 1 is non-empty and comparable. */
const EXAM_ID = "biology";
const SELECTION = [LANGUAGE_ID, ART_ID, EXAM_ID];

type Subject = {
  id: string;
  name: string;
  exam: { date: string; session: "AM" | "PM" } | null;
  portfolio?: { deadline: string; note?: string } | null;
};
const SUBJECTS = (apData as unknown as { subjects: Subject[] }).subjects;
const subject = (id: string) => SUBJECTS.find((s) => s.id === id)!;
/** The Week 0 cutoff, derived exactly as production derives it. */
const FIRST_DAY = firstWindowStart(calendarWeeks())!;

interface CardProbe {
  /** Header label: "Week 0" / "Week 1" / "Late Testing". */
  label: string;
  /**
   * Header range line, e.g. "May 3 – May 7, 2027" for a window week, or the
   * single-date "Apr 30, 2027" for a Week 0 whose rows share one deadline. The
   * "Apr 30 – May 7, 2027" span this example used to name was the retracted
   * kind-predicate build's Week 0 — no card produces it any more (Jon's bounce,
   * 2026-07-27).
   */
  range: string;
  /** Header count line — must never read "0 exams". */
  count: string;
  /** The whole card's text, for absence assertions. */
  text: string;
  /** Text of each list row (the calendar variant has none). */
  rowTexts: string[];
  /** The card root's own width in CSS px. */
  width: number;
}

/**
 * Record label / range / count / rows for every export card attached during
 * this page's life. Measured INSIDE the observer callback: `captureCardPng`
 * removes the holder in its `finally`, so nothing survives to measure after.
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
          const header = box?.children[0] as HTMLElement | null;
          const body = box?.children[1] as HTMLElement | null;
          if (!root || !header || !body) continue;
          const left = header.children[0] as HTMLElement | undefined;
          // A list row is the only body child with the 4px accent bar on its
          // left edge; strips and the undated footnote have none.
          const rows = (Array.from(body.children) as HTMLElement[]).filter(
            (c) => getComputedStyle(c).borderLeftWidth === "4px",
          );
          probes.push({
            label: left?.children[0]?.textContent ?? "",
            range: left?.children[1]?.textContent ?? "",
            count: (header.children[1] as HTMLElement | undefined)
              ?.textContent ?? "",
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
    () => (window as unknown as { __probes: CardProbe[] }).__probes,
  ) as Promise<CardProbe[]>;

/** Seed the selection through the legacy keys the schedules store migrates. */
async function seed(page: Page) {
  await page.addInitScript((sel) => {
    try {
      localStorage.setItem("apx.selection.v1", JSON.stringify(sel));
      localStorage.setItem("apx.resolutions.v1", "[]");
    } catch {}
  }, SELECTION);
}

/** Export one variant and return its downloads + the probed card DOM. */
async function exportCards(page: Page, menuItem: string) {
  await probeExportCards(page);
  await seed(page);
  await page.goto("/");

  const trigger = page.getByTestId("export-menu-button");
  await expect(trigger).toBeEnabled();
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await trigger.click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: menuItem, exact: true }).click();

  // The exporter walks the cards SERIALLY — wait until the count has settled
  // AND every card has been probed, so no later card is silently missed.
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

test("fixture guard — the dataset still ships deadlines on BOTH sides of the cutoff", () => {
  const language = subject(LANGUAGE_ID);
  const art = subject(ART_ID);
  expect(language.portfolio?.deadline).toBe("2027-04-30");
  expect(art.portfolio?.deadline).toBe("2027-05-07");
  // The cutoff is derived, never spelled: one deadline is strictly before the
  // first testing day, the other is not.
  expect(FIRST_DAY).toBe("2027-05-03");
  expect(language.portfolio!.deadline < FIRST_DAY).toBe(true);
  expect(art.portfolio!.deadline < FIRST_DAY).toBe(false);
  // …and the Art deadline is the same day as a real Week 1 exam sitting, which
  // is why Jon ruled it stays on that week.
  expect(language.exam?.date).toBe("2027-05-07");
  expect(subject(EXAM_ID).exam?.date).toBe("2027-05-03");
});

test("list .png — Week 0 holds the pre-window deadline; the May 7 one rides Week 1", async ({
  page,
}) => {
  const { downloads, probes } = await exportCards(
    page,
    "Save as list view .png",
  );

  expect(downloads.map((d) => d.suggestedFilename())).toEqual([
    "schedule-1-ap-exams-2027-week-0-list.png",
    "schedule-1-ap-exams-2027-week-1-list.png",
  ]);
  expect(probes.map((p) => p.label)).toEqual(["Week 0", "Week 1"]);

  const [week0, week1] = probes;

  // ── Week 0 — the deadline due before exams start, and only that ──────────
  expect(week0.rowTexts).toHaveLength(1);
  expect(week0.rowTexts[0]).toContain(subject(LANGUAGE_ID).name);
  expect(week0.rowTexts[0]).toContain("Fri, Apr 30");
  expect(week0.rowTexts[0]).toContain("Portfolio deadline");
  // The Art & Design deadline is NOT here — Jon's bounce, in one assertion.
  expect(week0.text).not.toContain(subject(ART_ID).name);

  // Jon's #91 bounce is not resurrected: no submission-note prose anywhere.
  for (const id of [LANGUAGE_ID, ART_ID]) {
    for (const card of probes) {
      expect(
        card.text,
        `${id}'s portfolio note is back on the exported card`,
      ).not.toContain(subject(id).portfolio!.note!);
    }
  }

  // The header describes the rows it holds and never says "0 exams". One date
  // on the card → a single-date label, not an invented span.
  expect(week0.count).toBe("1 deadline");
  expect(week0.range).toBe("Apr 30, 2027");
  expect(week0.range).not.toContain("–");

  // ── Week 1 — its two exams AND the in-window deadline, in date order ─────
  expect(week1.rowTexts).toHaveLength(3);
  expect(week1.rowTexts[0]).toContain(subject(EXAM_ID).name); // May 3 exam
  expect(week1.rowTexts[1]).toContain(subject(LANGUAGE_ID).name); // May 7 exam
  expect(week1.rowTexts[2]).toContain(subject(ART_ID).name); // May 7 deadline
  expect(week1.rowTexts[2]).toContain("Portfolio deadline");
  expect(week1.rowTexts[2]).toContain("Fri, May 7");
  expect(week1.range).toBe("May 3 – May 7, 2027");
  // Accepted consequence of the revert (Jon, 2026-07-27): a week that gains a
  // deadline row still counts its EXAMS, so the count line trails the row
  // count. Pinned as the current contract, flagged for a follow-up card.
  expect(week1.count).toBe("2 exams");

  await saveEvidence(downloads, "list");
});

test("calendar .png — the same split: strip-only Week 0, Week 1 grid keeps its deadline", async ({
  page,
}) => {
  const { downloads, probes } = await exportCards(
    page,
    "Save as calendar view .png",
  );

  // The #73 one-presentation principle: the two variants fan out the same set.
  expect(downloads.map((d) => d.suggestedFilename())).toEqual([
    "schedule-1-ap-exams-2027-week-0-calendar.png",
    "schedule-1-ap-exams-2027-week-1-calendar.png",
  ]);
  expect(probes.map((p) => p.label)).toEqual(["Week 0", "Week 1"]);

  const [week0, week1] = probes;

  // Week 0 is the deadline list under its own heading — no grid beside it, so
  // no "Not placed on the grid" naming something the reader cannot see.
  expect(week0.text).toContain("Portfolio deadlines");
  expect(week0.text).not.toContain("Not placed on the grid");
  expect(week0.text).toContain("Portfolio due Friday, April 30, 2027");
  expect(week0.text).not.toContain("Portfolio due Friday, May 7, 2027");
  expect(week0.count).toBe("1 deadline");
  // No hour axis: a grid-less card must not print grid chrome.
  expect(week0.text).not.toContain("8 AM");

  // Week 1 keeps its grid AND the in-window deadline, in its own off-grid
  // strip — the wording the site uses, because there IS a grid beside it here.
  expect(week1.text).toContain("Not placed on the grid");
  expect(week1.text).toContain("Portfolio due Friday, May 7, 2027");
  expect(week1.text).not.toContain("Portfolio due Friday, April 30, 2027");
  expect(week1.text).toContain(subject(EXAM_ID).name);
  expect(week1.count).toBe("2 exams");

  await saveEvidence(downloads, "calendar");
});
