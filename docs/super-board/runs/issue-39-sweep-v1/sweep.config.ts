import { defineConfig, devices } from "@playwright/test";

/**
 * Issue #39 adversarial sweep config. Runs against an ALREADY RUNNING
 * production server on :3100 (pnpm build && PORT=3100 pnpm start).
 * Not part of the regular e2e suite — invoked as:
 *   pnpm exec playwright test --config sweep/sweep.config.ts
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  workers: 4,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
