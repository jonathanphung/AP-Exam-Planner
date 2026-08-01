import { test, expect } from "@playwright/test";
// Issue #104 gave the document title a dataset-derived cycle label, so the
// expected string is read from the same constant the layout renders rather
// than re-spelled here (a hand-written copy would go stale on the next swap).
import { SITE_TITLE } from "../src/lib/site";

test("home page renders the AP Exam Planner header and title", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");

  await expect(page).toHaveTitle(SITE_TITLE);
  await expect(
    page.getByRole("heading", { level: 1, name: "AP Exam Planner" }),
  ).toBeVisible();

  expect(
    pageErrors,
    `Unexpected page errors: ${pageErrors.join(", ")}`,
  ).toEqual([]);

  // Ignore any favicon fetch noise; assert the page is otherwise clean.
  const meaningfulErrors = consoleErrors.filter(
    (text) => !/favicon/i.test(text),
  );
  expect(
    meaningfulErrors,
    `Unexpected console errors: ${meaningfulErrors.join(", ")}`,
  ).toEqual([]);
});
