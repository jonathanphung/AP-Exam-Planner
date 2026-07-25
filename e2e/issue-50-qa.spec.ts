import { test, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir } from "./support/evidence";

/**
 * super-board QA (issue #50) — replace the U+2197 `↗` character with an
 * inline SVG `ArrowUpRightIcon` so the external-link affordance renders
 * identically on every platform (Windows gave the character emoji
 * presentation via Segoe UI Emoji).
 *
 * One observable, browser-level test per acceptance criterion:
 *
 *   AC1 — shared icon contract: every affordance is the same inline SVG —
 *         `aria-hidden="true"`, `stroke="currentColor"`, `fill="none"`, no
 *         hardcoded fills — and its *computed* stroke color equals the
 *         link/button text color in BOTH themes (the currentColor
 *         inheritance that makes the icon theme-proof).
 *   AC2 — the ↗ character is gone from the rendered app: no text node in
 *         the DOM contains U+2197 on desktop (dialog open) or mobile
 *         (disclosures open). Source-level `grep -rn "↗" src/` cleanliness
 *         is verified in the evidence REPORT.md.
 *   AC3 — sized/aligned to the text: the SVG box is 1em (14px in the
 *         `text-sm` context both call sites render in), sits inside the
 *         link's line box at the same 4px `gap-1` as the old glyph, and the
 *         link still renders on ONE line. Collapsed-sidebar behavior
 *         unchanged (resources section hides entirely in the w-10 rail).
 *   AC4 — the #29 hover rule survives: hovering underlines the label span
 *         only — never the icon, and the anchor itself carries no underline
 *         (text-decoration propagation guard).
 *   AC5 — accessibility unchanged: icon is `aria-hidden`; the sr-only
 *         "(opens in a new tab)" hint still forms part of each link's
 *         accessible name; app-level contrast/focus regression is covered by
 *         the axe scan in e2e/a11y.spec.ts in the same suite run.
 *   AC6 — no sidebar layout shift: the expanded panel is still 320px
 *         (w-80) and every resource label fits untruncated on one line at
 *         1024/1440/1920, exactly as sized for the old glyph (#29 rule).
 *   AC7 — every external link exposes exactly ONE visible affordance (one
 *         SVG arrow, zero text arrows); evidence screenshots light+dark ×
 *         desktop/tablet/mobile plus College Board button closeups.
 *
 * Screenshots land in the `issue-50-qa-v1` evidence folder resolved by
 * `evidenceDir()` (e2e/support/evidence.ts); a lane capturing committed
 * evidence points that at docs/super-board/runs/ so they render inline on the
 * issue / PR.
 */

const EVIDENCE_DIR = evidenceDir("issue-50-qa-v1");

const SIDEBAR = '[data-testid="resources-sidebar"]';
// Scoped to the resources panel: the #29 footer row added non-resource
// external links (GitHub mark) to the sidebar.
const RESOURCE_LINKS = `${SIDEBAR} #resources-panel a[target='_blank']`;
const EXPECTED_LINK_COUNT = 8;
const ARROW_SVG = 'svg[aria-hidden="true"]';

const DESKTOP = { width: 1920, height: 1080 };
const TABLET = { width: 1024, height: 768 };
const MOBILE = { width: 375, height: 667 };

// The icon is `h-[1em] w-[1em]`, so at each call site its box must resolve
// to exactly the surrounding computed font-size — 16px in the sidebar links
// (they inherit the root size; the Builder docblock's "both call sites are
// text-sm" is wrong for this site, but the em sizing is what makes the icon
// correct there anyway) and 14px in the `text-sm` College Board button.
// `gap-1` on both the sidebar anchor and the College Board button = 4px.
const EXPECTED_GAP_PX = 4;

const dialog = (page: Page) => page.getByRole("dialog");
const expandButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Show exam dates for ${name}` });
const infoButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `View exam details for ${name}` });
const collegeBoardLink = (page: Page) =>
  dialog(page).getByRole("link", { name: /Official College Board page/ });

/** Open the exam-details dialog that hosts the College Board button. */
async function openInfoPanel(page: Page, name = "AP Biology") {
  await expandButton(page, name).click();
  await infoButton(page, name).click();
  await expect(dialog(page)).toBeVisible();
  await expect(collegeBoardLink(page)).toBeVisible();
}

/** Reveal the mobile RESOURCES disclosure (collapsed by default, #23/#29). */
async function openMobileResources(page: Page) {
  const toggle = page.getByRole("button", { name: "Resources" });
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass();
}

const computedColor = (el: SVGElement | HTMLElement) =>
  getComputedStyle(el).color;
const computedStroke = (el: SVGElement | HTMLElement) =>
  getComputedStyle(el).stroke;
const decoration = (el: SVGElement | HTMLElement) =>
  getComputedStyle(el).textDecorationLine;

/**
 * AC1 core: `container` (a resource link or the CB button) carries exactly
 * one arrow SVG whose attributes follow the icon pattern and whose computed
 * stroke matches the container's computed text color.
 */
async function assertIconContract(container: Locator, label: string) {
  const svg = container.locator(ARROW_SVG);
  await expect(svg, `${label}: exactly one aria-hidden svg`).toHaveCount(1);
  await expect(svg).toHaveAttribute("stroke", "currentColor");
  await expect(svg).toHaveAttribute("fill", "none");
  // No hardcoded fill anywhere inside — the paths are stroke-only.
  expect(
    await svg.evaluate(
      (el) =>
        [el, ...el.querySelectorAll("*")].filter((n) => {
          const f = n.getAttribute("fill");
          return f !== null && f !== "none";
        }).length,
      undefined,
    ),
    `${label}: no descendant may hardcode a fill`,
  ).toBe(0);
  // currentColor actually resolved: computed stroke === the text color the
  // icon sits next to (this is what keeps it correct in both themes).
  const rgbTriple = (cssColor: string) =>
    cssColor
      .replace(/^rgba?\(/, "")
      .replace(/\)$/, "")
      .split(/[,\s/]+/)
      .slice(0, 3)
      .join(",");
  const linkColor = await container.evaluate(computedColor);
  const strokeColor = await svg.evaluate(computedStroke);
  expect(
    rgbTriple(strokeColor),
    `${label}: stroke (${strokeColor}) must inherit the text color (${linkColor})`,
  ).toBe(rgbTriple(linkColor));
}

// ── AC1 + AC5 — icon contract + accessible name, light theme ───────────────

test("AC1/AC5 — all 8 resource links + College Board button use the shared aria-hidden currentColor SVG; sr-only new-tab hint intact (light)", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
  for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
    const link = links.nth(i);
    const label = (await link.locator("span").first().textContent())!.trim();
    await assertIconContract(link, `resource "${label}"`);
    // AC5: the affordance stays out of the a11y tree, the sr-only hint stays
    // in it — the accessible name is label + hint, with no arrow anywhere.
    await expect(link.locator(".sr-only")).toHaveText("(opens in a new tab)");
    const accName = await link.evaluate(
      (el) => (el as HTMLElement).ariaLabel ?? el.textContent!,
    );
    expect(accName).toContain("(opens in a new tab)");
    expect(accName).not.toContain("↗");
  }

  // College Board button inside the exam-details dialog.
  await openInfoPanel(page);
  const cb = collegeBoardLink(page);
  await assertIconContract(cb, "College Board button");
  await expect(cb.locator(".sr-only")).toHaveText("(opens in a new tab)");
  await expect(cb).toHaveAttribute("target", "_blank");
  await expect(cb).toHaveAttribute("rel", "noopener noreferrer");
});

// ── AC1 — currentColor inheritance holds in the dark theme ─────────────────

test("AC1 — dark theme: icon stroke tracks the dark-mode link/button color (currentColor, no hardcoded fills)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const first = page.locator(RESOURCE_LINKS).first();
  await assertIconContract(first, "resource link (dark)");
  // The dark link color differs from light (text-blue-300 vs text-blue-700),
  // so passing here proves inheritance, not a lucky constant.
  const darkColor = await first.evaluate(computedColor);
  expect(darkColor).not.toBe("rgb(29, 78, 216)"); // blue-700 (light theme)

  await openInfoPanel(page);
  await assertIconContract(collegeBoardLink(page), "College Board button (dark)");
});

// ── AC2 — the ↗ character no longer renders anywhere ───────────────────────

test("AC2 — no U+2197 text node renders: desktop with dialog open", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await openInfoPanel(page);
  const arrows = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode())
      if (walker.currentNode.nodeValue?.includes("↗")) count++;
    return count;
  });
  expect(arrows, "no text node may contain U+2197").toBe(0);
});

test("AC2 — no U+2197 text node renders: mobile with disclosures open", async ({
  page,
}) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await openMobileResources(page);
  const arrows = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode())
      if (walker.currentNode.nodeValue?.includes("↗")) count++;
    return count;
  });
  expect(arrows).toBe(0);
});

// ── AC3 — geometry: 1em box, same 4px gap, inside the line box ─────────────

test("AC3 — icon box is exactly 1em of each call site's font (16px sidebar, 14px CB button), 4px gap after the label, inside the link's single line box", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");

  const fontPx = (el: SVGElement | HTMLElement) =>
    parseFloat(getComputedStyle(el).fontSize);
  const linePx = (el: SVGElement | HTMLElement) =>
    parseFloat(getComputedStyle(el).lineHeight);

  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
  for (const i of [0, EXPECTED_LINK_COUNT - 1]) {
    const link = links.nth(i);
    const svg = link.locator(ARROW_SVG);
    const label = link.locator("span").first();
    const [linkBox, svgBox, labelBox] = await Promise.all([
      link.boundingBox(),
      svg.boundingBox(),
      label.boundingBox(),
    ]);
    // 1em of the text it follows (sidebar links inherit the 16px root size —
    // pinned so a silent font-context change fails loudly).
    const em = await link.evaluate(fontPx);
    expect(em).toBe(16);
    expect(svgBox!.width).toBeCloseTo(em, 0);
    expect(svgBox!.height).toBeCloseTo(em, 0);
    // Same `gap-1` spacing the character had.
    expect(svgBox!.x - (labelBox!.x + labelBox!.width)).toBeCloseTo(
      EXPECTED_GAP_PX,
      0,
    );
    // Reads as part of the link: vertically inside the anchor's line box…
    expect(svgBox!.y).toBeGreaterThanOrEqual(linkBox!.y - 0.5);
    expect(svgBox!.y + svgBox!.height).toBeLessThanOrEqual(
      linkBox!.y + linkBox!.height + 0.5,
    );
    // …and the anchor is one line box (leading-snug: 22px at 16px font —
    // identical to the pre-#50 row, the character sat in the same line box),
    // not a wrap.
    const line = await label.evaluate(linePx);
    expect(linkBox!.height).toBeLessThanOrEqual(line + 1);
  }

  // College Board button (items-center flex, explicit text-sm): icon 1em
  // (14px) and vertically centered next to the text.
  await openInfoPanel(page);
  const cb = collegeBoardLink(page);
  const cbEm = await cb.evaluate(fontPx);
  expect(cbEm).toBe(14);
  const [cbBox, cbSvgBox] = await Promise.all([
    cb.boundingBox(),
    cb.locator(ARROW_SVG).boundingBox(),
  ]);
  expect(cbSvgBox!.width).toBeCloseTo(cbEm, 0);
  expect(cbSvgBox!.height).toBeCloseTo(cbEm, 0);
  const svgMid = cbSvgBox!.y + cbSvgBox!.height / 2;
  const btnMid = cbBox!.y + cbBox!.height / 2;
  expect(Math.abs(svgMid - btnMid)).toBeLessThanOrEqual(1);
});

test("AC3 — collapsed sidebar unchanged: resources (and their icons) fully hide in the w-10 rail, restore on expand", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const sidebar = page.locator(SIDEBAR);
  const links = page.locator(RESOURCE_LINKS);
  await expect(links.first()).toBeVisible();

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(links.first()).toBeHidden();
  expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(48);

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(links.first()).toBeVisible();
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
});

// ── AC4 — #29 hover rule: underline on the label, never the icon ───────────

test("AC4 — hover underlines the label span only; anchor and SVG never carry the underline", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);

  for (const i of [0, EXPECTED_LINK_COUNT - 1]) {
    const link = links.nth(i);
    const label = link.locator("span").first();
    const svg = link.locator(ARROW_SVG);
    const text = (await label.textContent())!.trim();

    expect(await label.evaluate(decoration)).not.toContain("underline");
    await link.hover();
    expect(
      await label.evaluate(decoration),
      `"${text}": label must underline on hover`,
    ).toContain("underline");
    expect(
      await svg.evaluate(decoration),
      `"${text}": the icon must NOT underline on hover`,
    ).not.toContain("underline");
    expect(
      await link.evaluate(decoration),
      `"${text}": the anchor must not carry the underline`,
    ).not.toContain("underline");
  }
});

// ── AC6 — no layout shift: w-80 panel, every label one un-truncated line ────

for (const width of [1024, 1440, 1920]) {
  test(`AC6 — expanded sidebar is 320px and every resource label fits one line untruncated at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/");

    const sidebar = page.locator(SIDEBAR);
    expect(
      (await sidebar.boundingBox())!.width,
      "expanded panel must stay w-80 (320px)",
    ).toBeCloseTo(320, 0);

    const links = page.locator(RESOURCE_LINKS);
    await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
    for (let i = 0; i < EXPECTED_LINK_COUNT; i++) {
      const link = links.nth(i);
      const label = link.locator("span").first();
      const text = (await label.textContent())!.trim();
      // Untruncated: the `truncate` span has no clipped overflow.
      const { clientWidth, scrollWidth } = await label.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
      expect(
        scrollWidth,
        `"${text}" must not truncate at ${width}px`,
      ).toBeLessThanOrEqual(clientWidth);
      // One line: link box no taller than the label's single line box
      // (leading-snug 22px — same as the pre-#50 row).
      const line = await label.evaluate((el) =>
        parseFloat(getComputedStyle(el).lineHeight),
      );
      expect(
        (await link.boundingBox())!.height,
        `"${text}" must stay on one line at ${width}px`,
      ).toBeLessThanOrEqual(line + 1);
    }
  });
}

// ── AC7 — exactly one visible affordance per external link ─────────────────

test("AC7 — each external link exposes exactly one visible affordance: one SVG arrow, zero text arrows", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await openInfoPanel(page);

  const externals: { loc: Locator; label: string }[] = [
    { loc: collegeBoardLink(page), label: "College Board button" },
  ];
  const links = page.locator(RESOURCE_LINKS);
  await expect(links).toHaveCount(EXPECTED_LINK_COUNT);
  for (let i = 0; i < EXPECTED_LINK_COUNT; i++)
    externals.push({ loc: links.nth(i), label: `resource link ${i}` });

  for (const { loc, label } of externals) {
    await expect(loc.locator(ARROW_SVG), label).toHaveCount(1);
    expect((await loc.innerText()).includes("↗"), label).toBe(false);
  }
});

// ── AC7 — evidence screenshots: light + dark × desktop/tablet/mobile ────────

for (const scheme of ["light", "dark"] as const) {
  const suffix = scheme === "dark" ? "-dark" : "";

  test(`evidence — standard viewports, ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });

    // Desktop 1920x1080 — sidebar resources in view.
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await expect(page.locator(RESOURCE_LINKS)).toHaveCount(
      EXPECTED_LINK_COUNT,
    );
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop${suffix}.png` });
    // Closeup of the sidebar panel itself so the SVG arrows are inspectable.
    await page
      .locator(SIDEBAR)
      .screenshot({ path: `${EVIDENCE_DIR}/sidebar-closeup${suffix}.png` });

    // College Board button inside the exam-details dialog.
    await openInfoPanel(page);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/collegeboard-desktop${suffix}.png`,
    });
    await page.keyboard.press("Escape");

    // Tablet 1024x768 (lg breakpoint: desktop presentation).
    await page.setViewportSize(TABLET);
    await page.screenshot({ path: `${EVIDENCE_DIR}/tablet${suffix}.png` });

    // Mobile 375x667 — fresh load (the mobile layout mounts via a
    // post-hydration matchMedia hook), resources disclosure opened so the
    // links show.
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await openMobileResources(page);
    await expect(page.locator(RESOURCE_LINKS).first()).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile${suffix}.png`,
      fullPage: false,
    });

    // Mobile College Board button (light run only keeps file count sane —
    // the dark desktop closeup already proves the dark dialog).
    if (scheme === "light") {
      await openInfoPanel(page);
      await collegeBoardLink(page).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/collegeboard-mobile.png`,
      });
    }
  });
}
