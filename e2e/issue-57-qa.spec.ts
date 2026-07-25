import { test, expect, type Page, type Locator } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #57) — even out the collapsed subject-pill height so a
 * one-line name and a two-line name render at the SAME collapsed height within
 * a grid row.
 *
 * Builder's change: the collapsed select-toggle body's `min-h-11` (44px) →
 * `min-h-14` (56px), reserving two lines of `text-sm leading-snug` so the label
 * is vertically centered inside a normalized box. It is a MIN-height (a floor),
 * so a genuinely three-line name still grows its own cell; the section grid
 * stays `items-start` (issue #24's vertical-only-expansion bounce), so that
 * growth never stretches neighbors.
 *
 * The canonical row from the screenshot is STEM indices 3/4/5:
 *   AP Chemistry (1 line) · AP Computer Science A (1 line) ·
 *   AP Computer Science Principles (2 lines @ the narrow 3-col width).
 * At 1920 (3-col) those three chips are one grid row; at 1024 (2-col) CS A +
 * CS Principles share a row; on mobile each is its own row but the reservation
 * still normalizes every collapsed pill to the same height.
 *
 * One observable browser-level assertion per acceptance criterion. Evidence
 * (committed to the issue branch, embedded on the issue/PR):
 *   - desktop.png / tablet.png / mobile.png       — standard super-board viewports
 *   - row-3col-{light,dark}-desktop.png           — the even three-pill row, both themes
 *   - row-2col-light-tablet.png / row-mobile-*.png — the row at 2-col + mobile
 *   - expanded-neighbors-desktop.png              — CS Principles expanded, neighbors unmoved
 *   - selected-row-{light,dark}-desktop.png       — selected + unselected at the new height
 */

const EVIDENCE_DIR = evidenceDir("issue-57-qa-v1");

const RESERVED_PX = 56; // min-h-14 = 3.5rem
const TOUCH_FLOOR = 44; // issue #8 AC5 / issue #22

// The three canonical pills from the screenshot.
const CHEMISTRY = "AP Chemistry"; // 1 line
const CS_A = "AP Computer Science A"; // 1 line
const CS_PRINCIPLES = "AP Computer Science Principles"; // 2 lines @ 3-col

const catalog = (page: Page) =>
  page.locator('section[aria-label="Subject catalog"]');
const stemList = (page: Page) =>
  catalog(page)
    .getByRole("region", { name: /^STEM/ })
    .locator("ul");
// The collapsed chip body — the select toggle whose height is being normalized.
const body = (page: Page, name: string) =>
  catalog(page)
    .locator("li")
    .filter({
      has: page.getByRole("button", { name: `Show exam dates for ${name}` }),
    })
    .locator("button[aria-pressed]");
// The visible pill card (border box), i.e. the whole collapsed li chip.
const card = (page: Page, name: string) =>
  catalog(page)
    .locator("li")
    .filter({
      has: page.getByRole("button", { name: `Show exam dates for ${name}` }),
    })
    .locator("> div");
// The name span (last child of the body button; first child is the ✓ indicator).
const nameSpan = (page: Page, name: string) =>
  body(page, name).locator("> span").last();
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });

const boxOf = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
};

const goto = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(
    catalog(page).getByRole("navigation", { name: "Jump to category" }),
  ).toBeVisible();
  // Bring the STEM section (all three pills) into view.
  await expandButton(page, CS_PRINCIPLES).scrollIntoViewIfNeeded();
};

const gridColumnCount = (list: Locator) =>
  list.evaluate(
    (el) =>
      getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean)
        .length,
  );

// ── AC1 + AC3 — one-line and two-line collapsed pills are the same height ────

test.describe("issue #57 — collapsed subject-pill height is normalized", () => {
  test("AC1 — @1920 (3-col): the Chemistry / CS A / CS Principles row is even in height", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);
    expect(await gridColumnCount(stemList(page)), "STEM is 3-col at 1920").toBe(
      3,
    );

    const chem = await boxOf(body(page, CHEMISTRY));
    const csa = await boxOf(body(page, CS_A));
    const csp = await boxOf(body(page, CS_PRINCIPLES));

    // Same grid row: the three collapsed bodies share a top edge.
    expect(Math.abs(chem.y - csa.y), "Chemistry/CS A same row").toBeLessThan(1);
    expect(Math.abs(chem.y - csp.y), "Chemistry/CS Principles same row").toBeLessThan(
      1,
    );

    // The two-line name genuinely wraps taller than the one-line name…
    const chemName = await boxOf(nameSpan(page, CHEMISTRY));
    const cspName = await boxOf(nameSpan(page, CS_PRINCIPLES));
    expect(
      cspName.height,
      "CS Principles name wraps taller than one line",
    ).toBeGreaterThan(chemName.height + 5);

    // …yet the collapsed bodies render at the SAME height (the bug is gone).
    expect(Math.abs(chem.height - csp.height), "Chemistry vs CS Principles body height").toBeLessThan(
      0.5,
    );
    expect(Math.abs(chem.height - csa.height), "Chemistry vs CS A body height").toBeLessThan(
      0.5,
    );
    // And the whole visible pill (card border box) is even too.
    const chemCard = await boxOf(card(page, CHEMISTRY));
    const cspCard = await boxOf(card(page, CS_PRINCIPLES));
    expect(Math.abs(chemCard.height - cspCard.height), "card border-box height").toBeLessThan(
      0.5,
    );

    // The reserved height is the two-line box (min-h-14 = 56px).
    expect(chem.height, "collapsed body reserves two lines").toBeGreaterThanOrEqual(
      RESERVED_PX - 0.5,
    );
  });

  test("AC1 — @1024 (2-col): CS A (1-line) + CS Principles (2-line) share a row, even height", async ({
    page,
  }) => {
    await goto(page, 1024, 768);
    expect(await gridColumnCount(stemList(page)), "STEM is 2-col at 1024").toBe(
      2,
    );

    const csa = await boxOf(body(page, CS_A));
    const csp = await boxOf(body(page, CS_PRINCIPLES));
    expect(Math.abs(csa.y - csp.y), "CS A / CS Principles same row @2-col").toBeLessThan(
      1,
    );
    expect(Math.abs(csa.height - csp.height), "even height @2-col").toBeLessThan(
      0.5,
    );
  });

  test("AC1 — @375 (1-col mobile): every collapsed pill is normalized to the reserved height", async ({
    page,
  }) => {
    await goto(page, 375, 667);
    expect(await gridColumnCount(stemList(page)), "STEM is 1-col at 375").toBe(1);

    const chem = await boxOf(body(page, CHEMISTRY));
    const csp = await boxOf(body(page, CS_PRINCIPLES));
    // On mobile each pill is its own row; the reservation still makes the
    // one-line and two-line pills the same collapsed height.
    expect(Math.abs(chem.height - csp.height), "1-line vs 2-line mobile height").toBeLessThan(
      0.5,
    );
    expect(chem.height, "reserved height on mobile").toBeGreaterThanOrEqual(
      RESERVED_PX - 0.5,
    );
  });

  test("AC3 — the collapsed body stays ≥44px (issue #8 AC5 touch-target floor)", async ({
    page,
  }) => {
    // The reservation only ever RAISES the box (56 > 44), never below the floor.
    for (const [w, h] of [
      [1920, 1080],
      [1024, 768],
      [375, 667],
    ] as const) {
      await goto(page, w, h);
      for (const name of [CHEMISTRY, CS_A, CS_PRINCIPLES]) {
        const b = await boxOf(body(page, name));
        expect(b.height, `${name} @${w} ≥44px`).toBeGreaterThanOrEqual(
          TOUCH_FLOOR,
        );
      }
    }
  });

  // ── AC2 — expansion stays vertical-only (the #24 bounce invariants) ────────

  test("AC2 — expanding the two-line chip does not stretch/resize its row neighbors, width unchanged", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);

    const cspCard = card(page, CS_PRINCIPLES);
    const arrow = expandButton(page, CS_PRINCIPLES);

    const cspBefore = await boxOf(cspCard);
    const chemBefore = await boxOf(card(page, CHEMISTRY));
    const csaBefore = await boxOf(card(page, CS_A));
    const arrowBefore = await boxOf(arrow);
    const gridColBefore = await cspCard.evaluate(
      (el) => getComputedStyle(el.parentElement as Element).gridColumn,
    );

    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");

    const cspAfter = await boxOf(cspCard);
    // Vertical-only: same width + left edge + top edge; height strictly grows.
    expect(Math.abs(cspAfter.width - cspBefore.width), "width changed on expand").toBeLessThan(
      0.5,
    );
    expect(Math.abs(cspAfter.x - cspBefore.x), "left edge moved on expand").toBeLessThan(
      0.5,
    );
    expect(Math.abs(cspAfter.y - cspBefore.y), "top edge moved on expand").toBeLessThan(
      0.5,
    );
    expect(cspAfter.height, "expanded chip grows downward").toBeGreaterThan(
      cspBefore.height + 20,
    );

    // Same-row neighbors are byte-for-byte unmoved (no horizontal reflow /
    // no stretch-to-match — the #24 bounce that `items-start` protects).
    const chemAfter = await boxOf(card(page, CHEMISTRY));
    const csaAfter = await boxOf(card(page, CS_A));
    for (const [before, after, label] of [
      [chemBefore, chemAfter, "Chemistry"],
      [csaBefore, csaAfter, "CS A"],
    ] as const) {
      expect(Math.abs(after.x - before.x), `${label} x moved`).toBeLessThan(0.5);
      expect(Math.abs(after.y - before.y), `${label} y moved`).toBeLessThan(0.5);
      expect(Math.abs(after.width - before.width), `${label} width changed`).toBeLessThan(
        0.5,
      );
      expect(Math.abs(after.height - before.height), `${label} height changed`).toBeLessThan(
        0.5,
      );
    }

    // No column-spanning: the expanded chip keeps its grid placement.
    const gridColAfter = await cspCard.evaluate(
      (el) => getComputedStyle(el.parentElement as Element).gridColumn,
    );
    expect(gridColAfter, "grid-column changed on expand").toBe(gridColBefore);

    // Arrow stays put so expand + collapse hit the same spot.
    const arrowAfter = await boxOf(arrow);
    expect(Math.abs(arrowAfter.x - arrowBefore.x), "arrow x moved").toBeLessThan(
      0.5,
    );
    expect(Math.abs(arrowAfter.y - arrowBefore.y), "arrow y moved").toBeLessThan(
      0.5,
    );
  });

  // ── AC4 — the full accessible name is never truncated ──────────────────────

  test("AC4 — full name renders (no clamp/ellipsis) and aria semantics are unchanged", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);

    const cspBody = body(page, CS_PRINCIPLES);
    // The full name is present in the accessible text — not clipped to
    // "AP Computer Science…".
    await expect(cspBody).toContainText(CS_PRINCIPLES);

    const span = nameSpan(page, CS_PRINCIPLES);
    const clip = await span.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        overflowHidden: cs.overflow === "hidden",
        ellipsis: cs.textOverflow === "ellipsis",
        lineClamp:
          (cs as unknown as { webkitLineClamp?: string }).webkitLineClamp ??
          cs.getPropertyValue("-webkit-line-clamp"),
        // No vertical clipping: full wrapped content fits its own box.
        clipped: el.scrollHeight > el.clientHeight + 1,
      };
    });
    expect(clip.overflowHidden, "name span overflow:hidden").toBe(false);
    expect(clip.ellipsis, "name span text-overflow:ellipsis").toBe(false);
    expect(
      clip.lineClamp === "" || clip.lineClamp === "none",
      `name span -webkit-line-clamp: ${clip.lineClamp}`,
    ).toBe(true);
    expect(clip.clipped, "name is vertically clipped").toBe(false);

    // aria-pressed (select) semantics intact.
    await expect(cspBody).toHaveAttribute("aria-pressed", "false");
    // Expand control's accessible name is stable across state (announced via
    // aria-expanded, not a label swap).
    const arrow = expandButton(page, CS_PRINCIPLES);
    await expect(arrow).toHaveAttribute("aria-expanded", "false");
    const labelCollapsed = await arrow.getAttribute("aria-label");
    await arrow.click();
    await expect(arrow).toHaveAttribute("aria-expanded", "true");
    expect(
      await arrow.getAttribute("aria-label"),
      "expand control aria-label is stable",
    ).toBe(labelCollapsed);
  });

  // ── AC6 — the reservation is a floor, not a clamp (graceful 3-line) ────────

  test("AC6 — min-height is a floor: a genuinely taller name would grow, never clip", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);
    const cssState = await body(page, CS_PRINCIPLES).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        minHeight: cs.minHeight,
        height: cs.height,
        maxHeight: cs.maxHeight,
        overflow: cs.overflow,
      };
    });
    // 56px reserved as a MIN, with no competing fixed/max height or overflow
    // clip — so a 3-line name (none exist in the 2026 dataset at 3-col, but
    // could arrive later) grows its own cell taller instead of being clipped.
    expect(cssState.minHeight, "min-height reservation").toBe(`${RESERVED_PX}px`);
    expect(cssState.maxHeight, "no max-height clamp").toBe("none");
    expect(cssState.overflow, "body does not clip overflow").not.toBe("hidden");

    // Prove growth directly: force a 3-line name by widening the label text
    // and assert the collapsed body grows past the reservation (never clipped).
    const grown = await body(page, CS_PRINCIPLES).evaluate((el) => {
      const span = el.querySelector("span:last-child") as HTMLElement;
      const original = span.textContent;
      span.textContent =
        "AP Computer Science Principles and Advanced Placement Studies Seminar";
      const h = el.getBoundingClientRect().height;
      const clipped = span.scrollHeight > span.clientHeight + 1;
      span.textContent = original;
      return { h, clipped };
    });
    expect(grown.h, "a longer 3-line name grows the cell taller").toBeGreaterThan(
      RESERVED_PX + 5,
    );
    expect(grown.clipped, "the longer name is not clipped").toBe(false);
  });

  // ── AC5 — selected state at the new height ─────────────────────────────────

  test("AC5 — selecting a chip does not change its collapsed height (both states even)", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);
    const cspBody = body(page, CS_PRINCIPLES);
    const before = await boxOf(cspBody);
    await cspBody.click();
    await expect(cspBody).toHaveAttribute("aria-pressed", "true");
    const after = await boxOf(cspBody);
    expect(Math.abs(after.height - before.height), "selected height unchanged").toBeLessThan(
      0.5,
    );
    // Still even with its one-line row neighbor while selected.
    const chem = await boxOf(body(page, CHEMISTRY));
    expect(Math.abs(after.height - chem.height), "selected vs unselected neighbor").toBeLessThan(
      0.5,
    );
  });
});

// ── AC8 — evidence capture ──────────────────────────────────────────────────

test.describe("issue #57 — visual evidence", () => {
  test("row evidence — the three-pill row, light + dark, 3-col + 2-col + mobile", async ({
    page,
  }) => {
    // 3-col desktop, light.
    await goto(page, 1920, 1080);
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/row-3col-light-desktop.png`,
    });
    // Selected variant (CS Principles selected) at the new height, light.
    await body(page, CS_PRINCIPLES).click();
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/selected-row-light-desktop.png`,
    });

    // 3-col desktop, dark.
    await page.emulateMedia({ colorScheme: "dark" });
    await goto(page, 1920, 1080);
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/row-3col-dark-desktop.png`,
    });
    await body(page, CS_PRINCIPLES).click();
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/selected-row-dark-desktop.png`,
    });
    await page.emulateMedia({ colorScheme: "light" });

    // 2-col tablet, light.
    await goto(page, 1024, 768);
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/row-2col-light-tablet.png`,
    });

    // Mobile 1-col, light + dark.
    await goto(page, 375, 667);
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/row-mobile-light.png`,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await goto(page, 375, 667);
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/row-mobile-dark.png`,
    });
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("expanded evidence — CS Principles expanded, row neighbors unmoved", async ({
    page,
  }) => {
    await goto(page, 1920, 1080);
    await expandButton(page, CS_PRINCIPLES).click();
    await expect(expandButton(page, CS_PRINCIPLES)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await stemList(page).screenshot({
      path: `${EVIDENCE_DIR}/expanded-neighbors-desktop.png`,
    });
  });

  test("standard super-board viewports — full page", async ({ page }) => {
    for (const [name, w, h] of [
      ["desktop", 1920, 1080],
      ["tablet", 1024, 768],
      ["mobile", 375, 667],
    ] as const) {
      await goto(page, w, h);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/${name}.png`,
        fullPage: true,
      });
    }
  });
});
