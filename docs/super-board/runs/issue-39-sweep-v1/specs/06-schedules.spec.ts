import { test, expect, type Page } from "@playwright/test";
import { watchConsole, record, evidencePath, chipFor } from "./helpers";

/**
 * Sweep 06 — My Schedules: create / rename / delete / switch / last-one,
 * hostile names (long, emoji, duplicate), per-schedule isolation.
 */

async function openSchedules(page: Page) {
  // Mobile renders a disclosure button; desktop renders the section already
  // expanded with a plain heading. Only click when the button exists.
  const trigger = page.getByRole("button", { name: "My schedules" });
  if ((await trigger.count()) > 0) {
    if ((await trigger.getAttribute("aria-expanded")) === "false") {
      await trigger.click();
    }
  }
  await page.getByRole("radiogroup", { name: "My schedules" }).waitFor();
}

test("schedule CRUD with hostile names + isolation", async ({ page }) => {
  test.setTimeout(150_000);
  const con = watchConsole(page, "schedules");
  await page.goto("/");
  await openSchedules(page);

  const newBtn = page.getByRole("button", { name: /New schedule/ });
  await expect(newBtn).toBeVisible();

  // Baseline: select a subject in schedule 1.
  await chipFor(page, "AP Biology").click();
  await expect(chipFor(page, "AP Biology")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Create schedule 2 — selection must be isolated (empty).
  await newBtn.click();
  await expect(chipFor(page, "AP Biology")).toHaveAttribute(
    "aria-pressed",
    "false",
    { timeout: 5000 },
  );
  record({
    kind: "clean",
    area: "schedules",
    summary: "new schedule starts with empty selection (isolation holds)",
  });

  // Rename schedule 2 to a 300-char name.
  const longName = "Ω🎓 " + "very-long-".repeat(28) + "end";
  const radios = page.getByRole("radio");
  const active = radios.filter({ has: page.locator(":scope") }).last();
  const activeName = (await active.textContent())?.trim() ?? "";
  const renameBtn = page.getByRole("button", {
    name: new RegExp(`^Rename `),
  });
  await renameBtn.last().click();
  const nameInput = page.getByLabel(/New name for /);
  await nameInput.fill(longName);
  await nameInput.press("Enter");
  await page.waitForTimeout(300);
  const sidebarText = await page
    .locator('[aria-label="App panel"], aside, nav')
    .first()
    .innerText()
    .catch(() => "");
  record({
    kind: "note",
    area: "schedules",
    summary: `300-char emoji rename accepted=${sidebarText.includes("very-long-")}; previous name was "${activeName}"`,
  });
  await page.screenshot({
    path: evidencePath("06-schedule-long-name.png"),
    fullPage: false,
  });

  // Duplicate name: rename schedule 2 to exactly schedule 1's name.
  await renameBtn.last().click();
  const nameInput2 = page.getByLabel(/New name for /);
  await nameInput2.fill("Schedule 1");
  await nameInput2.press("Enter");
  await page.waitForTimeout(300);
  const dupCount = await page.getByText("Schedule 1", { exact: true }).count();
  record({
    kind: dupCount > 1 ? "note" : "clean",
    area: "schedules",
    summary: `duplicate name allowed: ${dupCount} elements now labelled "Schedule 1" (ambiguity risk)`,
  });

  // Switch back to schedule 1 — biology should be selected again.
  await radios.first().click();
  await expect(chipFor(page, "AP Biology")).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );

  // Delete schedule 2.
  const delBtn = page.getByRole("button", { name: /^Delete / }).last();
  await delBtn.click();
  const confirm = page.getByRole("dialog").getByRole("button", {
    name: /delete/i,
  });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(300);

  // Last remaining schedule: delete must be disabled.
  const remainingDel = page.getByRole("button", { name: /^Delete / });
  const count = await remainingDel.count();
  if (count === 1) {
    await expect(remainingDel.first()).toBeDisabled();
    record({
      kind: "clean",
      area: "schedules",
      summary: "last remaining schedule's delete button is disabled",
    });
  } else {
    record({
      kind: "note",
      area: "schedules",
      summary: `after delete, ${count} delete buttons remain (expected 1)`,
    });
  }
  con.assertClean("schedule CRUD");
});

test("rapid new-schedule spam then delete-all-but-one", async ({ page }) => {
  const con = watchConsole(page, "schedules-spam");
  await page.goto("/");
  await openSchedules(page);
  const newBtn = page.getByRole("button", { name: /New schedule/ });
  for (let i = 0; i < 6; i++) await newBtn.click();
  await page.waitForTimeout(300);
  const delBtns = page.getByRole("button", { name: /^Delete / });
  let guard = 0;
  while ((await delBtns.count()) > 1 && guard++ < 12) {
    const enabled = delBtns.last();
    if (!(await enabled.isEnabled().catch(() => false))) break;
    await enabled.click();
    const confirm = page.getByRole("dialog").getByRole("button", {
      name: /delete/i,
    });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForTimeout(150);
  }
  const left = await delBtns.count();
  record({
    kind: "note",
    area: "schedules",
    summary: `created 6 schedules rapidly, deleted down to ${left} remaining`,
  });
  con.assertClean("schedule spam");
});
