import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * super-board QA (issue #9) — README + in-app data attribution footer.
 *
 * One observable assertion per acceptance-criterion clause:
 *   AC1 — README what/why + feature list + stack + pnpm quickstart + data/swap note.
 *   AC2 — README embeds real screenshots under docs/screenshots/ via relative paths.
 *   AC3 — site-wide footer shows the two attribution lines, does not duplicate
 *         the schedule's coordinator note.
 *   AC4 — footer renders at 375 / 1024 / 1920 px with no horizontal overflow,
 *         no overlap, negligible layout shift; screenshots captured for evidence.
 *
 * Screenshots land in the run evidence folder and are committed to the issue
 * branch so they render inline on the issue / PR.
 */

const REPO_ROOT = resolve(__dirname, "..");
const EVIDENCE_DIR = "docs/super-board/runs/issue-9-qa-v1";

const ATTRIBUTION =
  "Data: College Board AP calendar and score-distribution reports — May 2026 cycle";
const NON_AFFILIATION = "Not affiliated with College Board.";
const COORDINATOR_NOTE =
  "This is a planning choice — the actual late-testing swap is arranged through your school’s AP coordinator.";

// ── AC1: README content ────────────────────────────────────────────────────
test("AC1 — README has what/why, feature list, stack, pnpm quickstart, and the data/swap note", () => {
  const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");

  // what/why intro
  expect(readme).toMatch(/AP Exam Planner/);
  expect(readme).toMatch(/May 2026/);
  expect(readme.toLowerCase()).toContain("portfolio piece");

  // feature list — one assertion per required clause
  expect(readme.toLowerCase()).toMatch(/catalog/); // catalog + selection
  expect(readme.toLowerCase()).toMatch(/portfolio deadline/); // schedule w/ portfolio deadlines
  expect(readme.toLowerCase()).toMatch(/late-testing/); // conflict -> late-testing resolution
  expect(readme.toLowerCase()).toMatch(/info panel|pass rate|calculator/); // exam info panel
  expect(readme.toLowerCase()).toMatch(/\.ics|ics (calendar )?export/); // ICS export

  // stack
  expect(readme).toMatch(/Next\.js/);
  expect(readme).toMatch(/Tailwind/);
  expect(readme.toLowerCase()).toContain("pnpm");

  // pnpm quickstart commands
  expect(readme).toMatch(/pnpm install/);
  expect(readme).toMatch(/pnpm dev/);
  expect(readme).toMatch(/pnpm build/);
  expect(readme).toMatch(/pnpm test:e2e/);

  // data note + swap point
  expect(readme).toContain("src/data/ap-2026.json");
  expect(readme.toLowerCase()).toMatch(/2027/);
});

// ── AC2: README embeds real screenshots via relative paths ──────────────────
test("AC2 — README embeds committed screenshots under docs/screenshots/ via relative paths", () => {
  const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");

  // Collect every markdown image reference: ![alt](path)
  const refs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  const shotRefs = refs.filter((p) => p.includes("docs/screenshots/"));

  expect(
    shotRefs.length,
    `Expected >=1 docs/screenshots/ image in README; found ${refs.length} image refs total`,
  ).toBeGreaterThan(0);

  for (const ref of shotRefs) {
    // Relative path (renders on GitHub) — not absolute, not an external URL.
    expect(ref.startsWith("http"), `Screenshot ref should be relative, got: ${ref}`).toBe(false);
    expect(ref.startsWith("/"), `Screenshot ref should be relative, got: ${ref}`).toBe(false);
    // The referenced file is actually committed.
    expect(
      existsSync(resolve(REPO_ROOT, ref)),
      `README references ${ref} but the file does not exist`,
    ).toBe(true);
  }
});

// ── AC3: site-wide attribution footer ───────────────────────────────────────
test("AC3 — footer shows both attribution lines and does not duplicate the coordinator note", async ({
  page,
}) => {
  await page.goto("/");

  const footer = page.locator('footer[data-testid="site-footer"]');
  await expect(footer).toBeVisible();

  await expect(footer.getByText(ATTRIBUTION, { exact: false })).toBeVisible();
  await expect(footer.getByText(NON_AFFILIATION, { exact: false })).toBeVisible();

  // The footer must NOT repeat the schedule's coordinator disclaimer.
  const footerText = (await footer.innerText()).trim();
  expect(footerText).not.toContain(COORDINATOR_NOTE);
  expect(footerText.toLowerCase()).not.toContain("coordinator");
});

// ── AC4: footer at the three standard viewports ─────────────────────────────
const viewports = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 375, height: 667 },
] as const;

for (const vp of viewports) {
  test(`AC4 — footer renders with no overflow/overlap/layout-shift (${vp.name} ${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/", { waitUntil: "networkidle" });

    const footer = page.locator('footer[data-testid="site-footer"]');
    await expect(footer).toBeVisible();

    // No horizontal overflow at this viewport (mobile 375 is the tight case).
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(
      scrollWidth,
      `Horizontal overflow at ${vp.width}px: scrollWidth=${scrollWidth}`,
    ).toBeLessThanOrEqual(vp.width + 1);

    // Footer box sits fully within the horizontal viewport (no clipping).
    const box = await footer.boundingBox();
    expect(box, "footer should have a bounding box").not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    }

    // No overlap: the footer's top edge is at or below the bottom of the
    // <main> content region (footer uses mt-auto below the flow, never fixed).
    const main = page.getByRole("main");
    const mainBox = await main.boundingBox();
    if (mainBox && box) {
      expect(
        box.y,
        `footer top (${box.y}) should be >= main bottom (${mainBox.y + mainBox.height})`,
      ).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
    }

    // Negligible cumulative layout shift (footer is static, server-rendered).
    const cls = await page.evaluate(
      () =>
        new Promise<number>((res) => {
          let total = 0;
          try {
            const po = new PerformanceObserver((list) => {
              for (const e of list.getEntries() as unknown as Array<{
                value: number;
                hadRecentInput: boolean;
              }>) {
                if (!e.hadRecentInput) total += e.value;
              }
            });
            po.observe({ type: "layout-shift", buffered: true });
            setTimeout(() => {
              po.disconnect();
              res(total);
            }, 500);
          } catch {
            res(0);
          }
        }),
    );
    expect(cls, `cumulative layout shift ${cls} should be < 0.1`).toBeLessThan(
      0.1,
    );

    await page.screenshot({
      path: `${EVIDENCE_DIR}/${vp.name}.png`,
      fullPage: true,
    });
  });
}
