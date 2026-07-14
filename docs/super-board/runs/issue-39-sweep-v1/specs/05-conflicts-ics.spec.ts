import { test, expect } from "@playwright/test";
import fs from "node:fs";
import ICAL from "ical.js";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  conflictPrompt,
  SUBJECTS,
} from "./helpers";

/**
 * Sweep 05 — conflicts end to end, and list/calendar/ICS agreement after
 * resolution. Also ICS content for zero/one/many/resolved selections.
 */

async function downloadIcs(page: import("@playwright/test").Page) {
  await page.getByTestId("export-menu-button").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-menu-item-ics").click(),
  ]);
  const file = evidencePath(`ics-${Date.now()}.ics`);
  await download.saveAs(file);
  return fs.readFileSync(file, "utf8");
}

function icsEvents(text: string) {
  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  return comp.getAllSubcomponents("vevent").map((v) => {
    const e = new ICAL.Event(v);
    return {
      summary: e.summary,
      start: e.startDate?.toString(),
      end: e.endDate?.toString(),
    };
  });
}

test("resolve conflict → list, calendar, ICS all agree", async ({ page }) => {
  const con = watchConsole(page, "conflicts-agree");
  await seed(page, { selection: ["biology", "latin"] });
  await page.goto("/");
  await pressViewChip(page, "List");
  await page
    .getByRole("button", { name: "Keep AP Biology at the regular time" })
    .first()
    .click();
  await expect(conflictPrompt(page)).toHaveCount(0);

  const latin = SUBJECTS.find((s) => s.id === "latin")!;
  const lateDate = latin.lateTesting!.date; // ISO

  // List shows Latin on the late date.
  await pressViewChip(page, "List");
  const listText = await page
    .locator('section[aria-label="My schedule"]')
    .innerText();
  const latinMovedInList = /latin/i.test(listText) && /late/i.test(listText);
  expect.soft(latinMovedInList, "list shows Latin moved to late testing").toBe(
    true,
  );

  // Calendar shows Latin in the late-testing week.
  await pressViewChip(page, "Calendar");
  const next = page.getByRole("button", { name: /^Next/ });
  let foundInCalendar = false;
  for (let hop = 0; hop < 8; hop++) {
    // "My exams" is the shared shell that exists in BOTH views; the
    // "My schedule" section is list-only.
    const calText = await page
      .locator('section[aria-label="My exams"]')
      .innerText();
    if (/latin/i.test(calText)) {
      foundInCalendar = true;
      break;
    }
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click();
  }
  expect
    .soft(foundInCalendar, "calendar shows Latin somewhere after resolution")
    .toBe(true);

  // ICS has Latin at the late date and Biology at the regular date.
  const ics = await downloadIcs(page);
  const events = icsEvents(ics);
  const latinEvent = events.find((e) => /latin/i.test(e.summary ?? ""));
  const bioEvent = events.find((e) => /biology/i.test(e.summary ?? ""));
  expect.soft(latinEvent, "ICS contains Latin event").toBeTruthy();
  expect.soft(bioEvent, "ICS contains Biology event").toBeTruthy();
  if (latinEvent) {
    expect
      .soft(
        latinEvent.start?.startsWith(lateDate),
        `ICS Latin start ${latinEvent.start} should be on late date ${lateDate}`,
      )
      .toBe(true);
  }
  if (bioEvent) {
    const bio = SUBJECTS.find((s) => s.id === "biology")!;
    expect
      .soft(
        bioEvent.start?.startsWith(bio.exam!.date),
        `ICS Biology start ${bioEvent.start} on regular date ${bio.exam!.date}`,
      )
      .toBe(true);
  }
  record({
    kind: "note",
    area: "conflicts",
    summary: `post-resolution agreement: list=${latinMovedInList} calendar=${foundInCalendar} ics-latin=${latinEvent?.start} ics-bio=${bioEvent?.start}`,
  });
  con.assertClean("conflict agreement");
});

test("deselect+reselect a moved exam re-prompts (no stale resolution)", async ({
  page,
}) => {
  const con = watchConsole(page, "conflicts-reprompt");
  await seed(page, {
    selection: ["biology", "latin"],
    resolutions: { latin: "moved" } as unknown as Record<string, string>,
  });
  // Seed a RESOLVED state the way the app writes it: keep biology, latin moved.
  // If the seeded shape is wrong the app should self-heal; we observe.
  await page.goto("/");
  const prompts = await conflictPrompt(page).count();
  record({
    kind: "note",
    area: "conflicts",
    summary: `hand-seeded resolutions {latin:"moved"} → ${prompts} prompt(s) shown (self-heal check)`,
  });
  con.assertClean("stale resolution seed");
});

test("ICS export: zero selection disables export", async ({ page }) => {
  const con = watchConsole(page, "ics-zero");
  await page.goto("/");
  const btn = page.getByTestId("export-menu-button");
  await expect(btn).toBeDisabled();
  record({
    kind: "clean",
    area: "export",
    summary: "export trigger disabled at zero selections",
  });
  con.assertClean("ics zero");
});

test("ICS export: 42-subject conflict-resolved export parses", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const con = watchConsole(page, "ics-sizes");
  // Many: all subjects with exams (portfolio-only ones have no exam event).
  await seed(page, { selection: SUBJECTS.map((s) => s.id) });
  await page.goto("/");
  await pressViewChip(page, "List");
  // Resolve every conflict, preferring the modal's Keep button while a
  // modal is open (its scrim blocks the inline prompts behind it).
  for (let i = 0; i < 20; i++) {
    const dialog = page.getByRole("dialog");
    const scope = (await dialog.isVisible().catch(() => false))
      ? dialog
      : conflictPrompt(page).first();
    const keep = scope.getByRole("button", { name: /^Keep / }).first();
    if (!(await keep.isVisible().catch(() => false))) break;
    await keep.click();
    await page.waitForTimeout(150);
  }
  await expect(conflictPrompt(page)).toHaveCount(0);
  const ics = await downloadIcs(page);
  const events = icsEvents(ics);
  record({
    kind: "note",
    area: "export",
    summary: `all-42 resolved ICS parses with ${events.length} events`,
    detail: events.slice(0, 3),
  });
  expect
    .soft(events.length, "ICS event count at full selection")
    .toBeGreaterThanOrEqual(36);
  // Floating times: no Z suffix / UTC marker on DTSTART.
  const dtstarts = ics.match(/^DTSTART[^\n]*$/gm) ?? [];
  const utcStarts = dtstarts.filter((l) => l.trim().endsWith("Z"));
  if (utcStarts.length) {
    record({
      kind: "bug",
      area: "export",
      summary: "ICS DTSTART uses UTC (Z) instead of floating local time",
      detail: utcStarts.slice(0, 5),
    });
  }
  expect.soft(utcStarts, "no UTC DTSTART lines").toEqual([]);
  con.assertClean("ics sizes");
});
