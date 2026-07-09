import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pressViewChip } from "./support/view-chip";

/**
 * super-board QA (issue #7) — export selected exams as an ICS calendar file.
 *
 * AC1 is the browser-observable acceptance criterion (button placement +
 * enabled/disabled state + client-side download of `ap-exams-2026.ics` with
 * zero network requests) and is verified here end-to-end through the real app
 * and the real dataset. AC2–AC5 (the RFC 5545 / ical.js generator contract) are
 * covered at the unit layer by `src/lib/ics.test.ts` and, against the shipped
 * dataset, by `src/lib/ics.qa.test.ts`; this spec additionally confirms the
 * bytes that actually land on disk carry the exam + portfolio VEVENTs.
 *
 * Screenshots are captured at the three standard super-board viewports and
 * committed to the issue branch so they render inline on the issue / PR.
 */

const EVIDENCE_DIR = "docs/super-board/runs/issue-7-qa-v1";

const schedule = (page: Page) =>
  page.locator('section[aria-label="My schedule"]');
// The shared "My Schedule" header (heading + Export) lives in the outer
// "My exams" section since issue #19's second bounce, present on BOTH views.
const myExams = (page: Page) =>
  page.locator('section[aria-label="My exams"]');
const exportButton = (page: Page) => page.getByTestId("export-ics-button");

/**
 * Issue #19 made the calendar the default view; switch to the list.
 * The press is hydration-safe (see e2e/support/view-chip.ts).
 */
async function openList(page: Page) {
  await pressViewChip(page, "List");
  await expect(schedule(page)).toBeVisible();
}

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("ul > li button[aria-pressed]")
    .filter({ hasText: name });

async function select(page: Page, name: string) {
  const c = card(page, name);
  // No explicit scrollIntoViewIfNeeded: click() auto-scrolls and retries if
  // the element detaches while the issue #22 mobile layout mounts post-hydration.
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
}

test.describe("issue #7 — export to calendar", () => {
  test("AC1 — the Export button lives in the My Schedule header and is disabled until ≥1 subject is selected", async ({
    page,
  }) => {
    await page.goto("/");

    // Rendered *near My Schedule*: the button sits in the shared header row
    // beside the "My Schedule" heading — visible on the default (calendar)
    // view AND after switching to the list (issue #19 second bounce, item B4).
    const btn = myExams(page).getByTestId("export-ics-button");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Export to Calendar/i);
    await expect(
      myExams(page).getByRole("heading", { level: 2, name: "My Schedule" }),
    ).toBeVisible();
    await openList(page);
    await expect(btn).toBeVisible();

    // Zero selections → disabled.
    await expect(page.getByText(/^0 selected$/)).toBeVisible();
    await expect(btn).toBeDisabled();

    // One selection → enabled.
    await select(page, "AP Biology");
    await expect(btn).toBeEnabled();

    // Back to zero → disabled again (state tracks the live selection count).
    const bioCard = card(page, "AP Biology");
    await bioCard.click(); // toggle Biology back off
    await expect(bioCard).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/^0 selected$/)).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("AC1 — clicking downloads ap-exams-2026.ics generated client-side (blob, zero network) with the selected exam + portfolio events", async ({
    page,
  }) => {
    await page.goto("/");

    // A selection that yields an exam VEVENT (Biology) and both an exam and a
    // portfolio VEVENT (Seminar) — no same-slot conflict between the two.
    await select(page, "AP Biology"); // 2026-05-04 AM exam
    await select(page, "AP Seminar"); // 2026-05-11 PM exam + 2026-04-30 portfolio

    const btn = exportButton(page);
    await expect(btn).toBeEnabled();

    // Record any real network traffic the click provokes. A truly client-side
    // export must not issue fetch/XHR requests; Next.js dev-only internals
    // (_next, HMR hot-update) are excluded so the assertion tracks app traffic.
    const appRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      const type = req.resourceType();
      const isDevInternal =
        url.includes("/_next/") ||
        url.includes("hot-update") ||
        url.includes("__nextjs");
      if (!isDevInternal && (type === "fetch" || type === "xhr")) {
        appRequests.push(`${type} ${url}`);
      }
    });

    const downloadPromise = page.waitForEvent("download");
    await btn.click();
    const download = await downloadPromise;

    // Named exactly ap-exams-2026.ics…
    expect(download.suggestedFilename()).toBe("ap-exams-2026.ics");
    // …and generated entirely client-side: a blob: URL is not a server fetch.
    expect(download.url()).toMatch(/^blob:/);
    // …with no app-level network requests triggered by the export.
    expect(
      appRequests,
      `unexpected network requests on export: ${appRequests.join(", ")}`,
    ).toEqual([]);

    // The bytes on disk are a real RFC 5545 calendar carrying the events.
    const path = await download.path();
    const ics = readFileSync(path, "utf8");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics.endsWith("\r\n")).toBe(true); // CRLF-terminated (RFC 5545 §3.1)

    const unfolded = ics.replace(/\r\n /g, "");
    // issue #38 — SUMMARY drops the "(AM/PM session)" suffix (it is implicit in
    // the event's DTSTART); portfolio summaries are unchanged.
    expect(unfolded).toContain("SUMMARY:AP Biology exam");
    expect(unfolded).toContain("SUMMARY:AP Seminar exam");
    expect(unfolded).toContain("SUMMARY:AP Seminar portfolio due");
    expect(unfolded).not.toContain("(AM session)");
    expect(unfolded).not.toContain("(PM session)");
    // Exam start times are floating local (no trailing Z).
    expect(unfolded).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
    // issue #38 — each exam carries a floating DTEND = start + published length
    // + a 30-min setup buffer. Biology (AM 08:00, 180 min) → 11:30; Seminar
    // (PM 12:00, 120 min) → 14:30.
    expect(unfolded).toMatch(/DTEND:\d{8}T113000/);
    expect(unfolded).toMatch(/DTEND:\d{8}T143000/);
    expect(unfolded).not.toMatch(/DTEND:\d{8}T\d{6}Z/);
    // issue #38 A/B — the DESCRIPTION carries the published section-by-section
    // timing breakdown; the total is phrased as hours-and-minutes with the +30
    // setup allowance merged into that same row as OUR allowance.
    expect(unfolded).toContain("MCQ: 60 Questions | 90 Minutes");
    expect(unfolded).toContain("FRQ: 6 Questions | 90 Minutes");
    expect(unfolded).toContain(
      "Total Length: 3 hours (+ 30 minutes for exam setup time)",
    );
    // Three events for this selection: 2 exams + 1 portfolio.
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
  });
});

// --- Evidence capture: the three mandatory super-board viewports ------------
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`evidence — enabled Export button over a populated schedule (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");

    await select(page, "AP Biology"); // exam
    await select(page, "AP Seminar"); // exam + portfolio

    // The export affordance is present and enabled in the working state —
    // asserted on the LIST view (the populated-schedule evidence shot).
    await openList(page);
    await expect(exportButton(page)).toBeEnabled();
    await expect(schedule(page).getByText("Portfolio due").first()).toBeVisible();

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
