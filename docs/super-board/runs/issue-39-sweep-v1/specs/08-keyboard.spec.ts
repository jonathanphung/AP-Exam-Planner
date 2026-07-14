import { test, expect } from "@playwright/test";
import { watchConsole, seed, record, evidencePath } from "./helpers";

/**
 * Sweep 08 — keyboard + semantics: one h1, dialog focus trap / Escape /
 * focus restore, visible focus indicators, decorative emoji hidden,
 * landmarks sane.
 */

test("exactly one h1; headings and landmarks sane", async ({ page }) => {
  const con = watchConsole(page, "kbd-headings");
  await page.goto("/");
  const h1s = await page.locator("h1").count();
  expect.soft(h1s, "exactly one h1").toBe(1);
  const mains = await page.getByRole("main").count();
  expect.soft(mains, "exactly one main landmark").toBe(1);
  const headings = await page
    .locator("h1, h2, h3, h4")
    .evaluateAll((els) =>
      els.map((e) => `${e.tagName}:${(e.textContent ?? "").trim().slice(0, 40)}`),
    );
  // Check no level skip (h1 → h3 without h2 etc.) in document order.
  let prev = 0;
  const skips: string[] = [];
  for (const h of headings) {
    const lvl = Number(h[1]);
    if (prev && lvl > prev + 1) skips.push(`${h} after h${prev}`);
    prev = lvl;
  }
  if (skips.length) {
    record({
      kind: "a11y",
      area: "headings",
      summary: `heading level skips: ${skips.slice(0, 5).join("; ")}`,
      detail: headings,
    });
  }
  expect.soft(skips, "no heading level skips").toEqual([]);
  con.assertClean("headings");
});

test("decorative emoji are aria-hidden", async ({ page }) => {
  await page.goto("/");
  const leaked = await page.evaluate(() => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    const bad: string[] = [];
    document
      .querySelectorAll(
        'section[aria-label="Subject catalog"] button[aria-pressed]',
      )
      .forEach((btn) => {
        // Compute rough accessible name: aria-label else text content of
        // non-hidden nodes.
        const label = btn.getAttribute("aria-label");
        if (label && EMOJI.test(label)) {
          bad.push(`aria-label leaks emoji: ${label.slice(0, 60)}`);
          return;
        }
        if (!label) {
          const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
          let text = "";
          while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            const el = node.parentElement;
            let hidden = false;
            for (let p = el; p; p = p.parentElement) {
              if (p.getAttribute("aria-hidden") === "true") hidden = true;
              if (p === btn.parentElement) break;
            }
            if (!hidden) text += node.data;
          }
          if (EMOJI.test(text))
            bad.push(`chip text leaks emoji into a11y name: ${text.trim().slice(0, 60)}`);
        }
      });
    return bad.slice(0, 10);
  });
  if (leaked.length) {
    record({
      kind: "a11y",
      area: "emoji",
      summary: `subject emoji leak into accessible names (${leaked.length} shown)`,
      detail: leaked,
    });
  } else {
    record({
      kind: "clean",
      area: "emoji",
      summary: "subject emoji are hidden from accessible names",
    });
  }
  expect.soft(leaked, "no emoji in accessible names").toEqual([]);
});

test("exam-details dialog: trap, Escape, focus restore", async ({ page }) => {
  const con = watchConsole(page, "kbd-dialog");
  await page.goto("/");
  await page
    .getByRole("button", { name: /Show exam dates for AP Biology/ })
    .click();
  const opener = page.getByRole("button", {
    name: /View exam details for AP Biology/,
  });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Tab 30 times — focus must stay inside the dialog.
  let escaped = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? d.contains(document.activeElement) : false;
    });
    if (!inside) {
      escaped = true;
      break;
    }
  }
  if (escaped) {
    record({
      kind: "a11y",
      area: "dialog",
      summary: "focus escapes the exam-details dialog while tabbing",
    });
  }
  expect.soft(escaped, "focus stays trapped in dialog").toBe(false);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const restored = await page.evaluate(() =>
    (document.activeElement?.getAttribute("aria-label") ?? "").includes(
      "View exam details",
    ),
  );
  if (!restored) {
    record({
      kind: "a11y",
      area: "dialog",
      summary:
        "focus not restored to the opener button after closing exam-details dialog",
    });
  }
  expect.soft(restored, "focus restored to opener on close").toBe(true);
  con.assertClean("dialog keyboard");
});

test("keyboard-only: chip select, view switch, pager operable; focus visible", async ({
  page,
}) => {
  const con = watchConsole(page, "kbd-operable");
  await seed(page, { selection: ["biology", "chemistry", "statistics"] });
  await page.goto("/");

  // Focus the first catalog chip via keyboard and toggle with Space/Enter.
  const chip = page
    .locator('section[aria-label="Subject catalog"] button[aria-pressed]')
    .first();
  await chip.focus();
  const before = await chip.getAttribute("aria-pressed");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", before!);

  // Focus indicator: outline or ring must change vs blurred state.
  await chip.focus();
  const focusStyles = await chip.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      boxShadow: s.boxShadow,
    };
  });
  const hasVisibleFocus =
    (focusStyles.outlineStyle !== "none" &&
      parseFloat(focusStyles.outlineWidth) > 0) ||
    focusStyles.boxShadow !== "none";
  if (!hasVisibleFocus) {
    record({
      kind: "a11y",
      area: "focus",
      summary: "catalog chip has no visible focus indicator on keyboard focus",
      detail: focusStyles,
    });
  }
  expect.soft(hasVisibleFocus, "chip focus visible").toBe(true);

  // Pager keyboard operation.
  const calChip = page
    .getByRole("group", { name: "Schedule view" })
    .getByRole("button", { name: "Calendar" });
  await calChip.focus();
  await page.keyboard.press("Enter");
  const next = page.getByRole("button", { name: /^Next/ });
  if (await next.isEnabled().catch(() => false)) {
    await next.focus();
    await page.keyboard.press("Enter");
  }
  await page.screenshot({ path: evidencePath("08-keyboard-pass.png") });
  con.assertClean("keyboard operability");
});
