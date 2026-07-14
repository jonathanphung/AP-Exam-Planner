import { test, expect } from "@playwright/test";
import {
  watchConsole,
  seed,
  record,
  evidencePath,
  pressViewChip,
  ALL_IDS,
} from "./helpers";

/**
 * Sweep 10 — touch targets ≥ 44×44 px at 375px mobile for every interactive
 * element (issue #39 explicitly includes the slimmed toolbar pills).
 * Measures the effective hit area: bounding box padded by any ::before
 * pseudo-element expansion is not measurable, so we report raw boxes and
 * note elements between 24 and 44 px for human triage.
 */

async function measure(page: import("@playwright/test").Page, state: string) {
  const offenders = await page.evaluate(() => {
    const out: Array<{
      state?: string;
      name: string;
      w: number;
      h: number;
      tag: string;
    }> = [];
    const els = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, [role="button"], [role="radio"], [role="menuitem"]',
    );
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // hidden
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      // Inline text links inside prose are exempt per WCAG 2.5.8.
      const inProse =
        el.tagName === "A" && el.closest("p, li") && style.display === "inline";
      if (inProse) return;
      if (r.width < 44 || r.height < 44) {
        const name =
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").trim().slice(0, 40);
        out.push({
          name,
          w: Math.round(r.width),
          h: Math.round(r.height),
          tag: el.tagName.toLowerCase(),
        });
      }
    });
    return out;
  });
  return offenders.map((o) => ({ ...o, state }));
}

test("touch targets at 375px across key states", async ({ page }) => {
  test.setTimeout(120_000);
  const con = watchConsole(page, "touch");
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, { selection: ALL_IDS.slice(0, 8) });
  await page.goto("/");

  const all: Array<Record<string, unknown>> = [];
  all.push(...(await measure(page, "catalog")));

  await pressViewChip(page, "List");
  // A seeded conflict pops a modal prompt on entering List — measure its
  // controls too, then dismiss so the view switcher is clickable again.
  if (await page.getByRole("dialog").isVisible().catch(() => false)) {
    all.push(...(await measure(page, "conflict-modal")));
    await page.keyboard.press("Escape");
  }
  all.push(...(await measure(page, "list")));

  await pressViewChip(page, "Calendar");
  all.push(...(await measure(page, "calendar")));

  // Dedupe by name+size.
  const seen = new Set<string>();
  const unique = all.filter((o) => {
    const k = `${o.name}|${o.w}x${o.h}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length) {
    record({
      kind: "a11y",
      area: "touch-targets",
      summary: `${unique.length} interactive elements < 44×44 at 375px`,
      detail: unique,
    });
  } else {
    record({
      kind: "clean",
      area: "touch-targets",
      summary: "all interactive elements ≥ 44×44 at 375px",
    });
  }
  await page.screenshot({
    path: evidencePath("10-mobile-375-calendar.png"),
    fullPage: false,
  });
  // Soft-fail only if there are many sub-24px targets (hard AA fail).
  const hardFails = unique.filter(
    (o) => (o.w as number) < 24 || (o.h as number) < 24,
  );
  expect.soft(hardFails, "no targets below 24px minimum").toEqual([]);
  con.assertClean("touch targets");
});
