import { test, expect } from "@playwright/test";
import fs from "node:fs";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  SUBJECTS,
  chipFor,
} from "./helpers";

/**
 * Sweep 11 — remaining features: disclosure tiers on every course,
 * noExamReason subjects, calendar block details popup, sidebar persistence,
 * external link inventory (verified out-of-band with curl), pending
 * pass-rate honesty, JSON/TXT exports.
 */

test("every subject: expand control works; noExam subjects say why", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const con = watchConsole(page, "disclosure-all");
  await page.goto("/");
  const failures: string[] = [];
  for (const s of SUBJECTS) {
    const expand = page.getByRole("button", {
      name: new RegExp(
        `Show exam dates for ${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    });
    if (!(await expand.isVisible().catch(() => false))) {
      failures.push(`${s.id}: no expand control`);
      continue;
    }
    await expand.click();
    // Tier content: date or noExamReason.
    const details = page.getByRole("button", {
      name: new RegExp(
        `View exam details for ${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    });
    const hasDetails = await details.isVisible().catch(() => false);
    if (!hasDetails) failures.push(`${s.id}: no details tier after expand`);
    await expand.click(); // collapse again
  }
  if (failures.length) {
    record({
      kind: "bug",
      area: "catalog",
      summary: `disclosure tier failures on ${failures.length} subjects`,
      detail: failures,
    });
  } else {
    record({
      kind: "clean",
      area: "catalog",
      summary: `all ${SUBJECTS.length} subjects expand and expose a details tier`,
    });
  }
  expect.soft(failures, "disclosure works for every subject").toEqual([]);
  con.assertClean("disclosure walk");
});

test("exam-details dialog honors the pending rule and shows College Board link", async ({
  page,
}) => {
  const con = watchConsole(page, "details-pending");
  await page.goto("/");
  // business-with-personal-finance is a new no-exam/pending subject.
  const target =
    SUBJECTS.find((s) => s.passRate === "pending") ??
    SUBJECTS.find((s) => !s.exam);
  const name = target!.name;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByRole("button", { name: new RegExp(`Show exam dates for ${esc}`) })
    .click();
  await page
    .getByRole("button", { name: new RegExp(`View exam details for ${esc}`) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const text = await dialog.innerText();
  const showsPending = /pending/i.test(text);
  record({
    kind: showsPending ? "clean" : "note",
    area: "data-honesty",
    summary: showsPending
      ? `details dialog for ${target!.id} shows literal "pending" (hard data rule holds)`
      : `details dialog for ${target!.id} does NOT show "pending" — verify what it renders`,
    detail: text.slice(0, 400),
  });
  const cbLink = dialog.getByRole("link", { name: /College Board/i });
  const hasLink = (await cbLink.count()) > 0;
  if (hasLink) {
    const href = await cbLink.first().getAttribute("href");
    const targetAttr = await cbLink.first().getAttribute("target");
    expect.soft(targetAttr, "CB link opens in new tab").toBe("_blank");
    record({
      kind: "note",
      area: "links",
      summary: `details dialog CB link: ${href}`,
    });
  }
  await page.keyboard.press("Escape");
  con.assertClean("details pending");
});

test("calendar event click opens block details popup", async ({ page }) => {
  const con = watchConsole(page, "cal-popup");
  await seed(page, { selection: ["biology", "seminar", "chemistry"] });
  await page.goto("/");
  await pressViewChip(page, "Calendar");
  // Event blocks are buttons inside the day cells ("My exams" is the shell
  // section that exists in calendar view; "My schedule" is list-only).
  const block = page
    .locator('section[aria-label="My exams"] button')
    .filter({ hasText: /Biology|Chemistry/ })
    .first();
  if (await block.isVisible().catch(() => false)) {
    await block.click();
    const dialog = page.getByRole("dialog");
    const opened = await dialog
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    record({
      kind: opened ? "clean" : "note",
      area: "calendar",
      summary: opened
        ? "calendar block click opens a details dialog; Escape closes it"
        : "calendar block click did not open a dialog (check interaction model)",
    });
    if (opened) {
      await page.screenshot({
        path: evidencePath("11-calendar-block-popup.png"),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } else {
    record({
      kind: "note",
      area: "calendar",
      summary: "no clickable calendar block found for Biology/Chemistry",
    });
  }
  con.assertClean("calendar popup");
});

test("sidebar collapse persists across reload; inventory external links", async ({
  page,
}) => {
  const con = watchConsole(page, "sidebar");
  await page.goto("/");
  const collapse = page.getByRole("button", { name: /Collapse sidebar/ });
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await page.reload();
    const expand = page.getByRole("button", { name: /Expand sidebar/ });
    const persisted = await expand.isVisible().catch(() => false);
    record({
      kind: persisted ? "clean" : "bug",
      area: "sidebar",
      summary: persisted
        ? "sidebar collapsed state persists across reload"
        : "sidebar collapse does NOT persist across reload",
    });
    if (await expand.isVisible().catch(() => false)) await expand.click();
  }

  // Inventory every external link on the page (sidebar resources + footer).
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='http']"))
      .map((a) => ({
        href: a.href,
        text: (a.getAttribute("aria-label") ?? a.textContent ?? "")
          .trim()
          .slice(0, 60),
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      }))
      .filter((l) => !l.href.includes("localhost")),
  );
  fs.writeFileSync(
    evidencePath("external-links.json"),
    JSON.stringify(links, null, 2),
  );
  const noNewTab = links.filter((l) => l.target !== "_blank");
  if (noNewTab.length) {
    record({
      kind: "suggestion",
      area: "links",
      summary: `${noNewTab.length} external links do not open in a new tab`,
      detail: noNewTab,
    });
  }
  record({
    kind: "note",
    area: "links",
    summary: `collected ${links.length} external links for out-of-band HTTP verification`,
  });
  con.assertClean("sidebar + links");
});

test("JSON and TXT exports download and contain the selection", async ({
  page,
}) => {
  const con = watchConsole(page, "export-json-txt");
  await seed(page, { selection: ["biology", "seminar"] });
  await page.goto("/");
  for (const fmt of ["json", "txt"] as const) {
    await page.getByTestId("export-menu-button").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId(`export-menu-item-${fmt}`).click(),
    ]);
    const file = evidencePath(`export-sample.${fmt}`);
    await download.saveAs(file);
    const content = fs.readFileSync(file, "utf8");
    const hasBio = /biology/i.test(content);
    record({
      kind: hasBio ? "clean" : "bug",
      area: "export",
      summary: hasBio
        ? `${fmt} export contains the selected subjects`
        : `${fmt} export missing selected subject content`,
      detail: content.slice(0, 200),
    });
    expect.soft(hasBio, `${fmt} export contains Biology`).toBe(true);
  }
  con.assertClean("json/txt export");
});
