import { describe, expect, it } from "vitest";
import { parsePreference, resolveTheme, toggledPreference } from "./theme";

/**
 * Unit tests for the theme store's pure core (issue #41; revised for Jon's
 * 2026-07-09 bounce — the control is now a two-state light ↔ dark toggle, not a
 * three-way cycle).
 *
 * Like `schedules.test.ts`, these pin the deterministic state machine —
 * preference parsing (incl. malformed → System), preference → resolved theme
 * (the `system` branch keyed off the OS `prefers-color-scheme`), and the toggle
 * mapping (resolved theme → its explicit opposite, which is what a click
 * writes). The store shell (localStorage persistence, the pre-paint apply, live
 * `matchMedia` system-change handling, the `.dark`/`color-scheme` writes, the
 * React hook) runs against a real browser in the Playwright suite
 * (`e2e/issue-41-theme-toggle.spec.ts`), which is where "persistence across
 * reload" and "System follows an emulated OS change" are observably verified.
 */

describe("parsePreference — malformed stored values degrade to System", () => {
  it("accepts the three valid preferences verbatim", () => {
    expect(parsePreference("light")).toBe("light");
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("system")).toBe("system");
  });

  it("treats a missing value (null) as System (first-visit default)", () => {
    expect(parsePreference(null)).toBe("system");
  });

  it("degrades any malformed / unknown value to System, never throws", () => {
    for (const raw of ["", "System", "LIGHT", "Dark", "auto", "0", "{}", "null"]) {
      expect(parsePreference(raw)).toBe("system");
    }
  });
});

describe("resolveTheme — preference + OS state → concrete theme", () => {
  it("honors an explicit light/dark regardless of the OS setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS in System mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("toggledPreference — a click writes the opposite of the resolved theme", () => {
  it("maps the resolved theme to its explicit opposite", () => {
    expect(toggledPreference("light")).toBe("dark");
    expect(toggledPreference("dark")).toBe("light");
  });

  it("never returns system — there is no route back to system from a click", () => {
    expect(toggledPreference("light")).not.toBe("system");
    expect(toggledPreference("dark")).not.toBe("system");
  });
});

describe("first click out of the system default picks the opposite of the OS theme", () => {
  it("OS dark → resolved dark → first click writes explicit light", () => {
    const resolved = resolveTheme("system", true);
    expect(resolved).toBe("dark");
    expect(toggledPreference(resolved)).toBe("light");
  });

  it("OS light → resolved light → first click writes explicit dark", () => {
    const resolved = resolveTheme("system", false);
    expect(resolved).toBe("light");
    expect(toggledPreference(resolved)).toBe("dark");
  });

  it("the explicit choice then resolves verbatim, ignoring the OS", () => {
    // After the first click writes `light`, the OS flipping to dark must not
    // change the resolved theme (explicit preferences don't follow the OS).
    const explicit = toggledPreference(resolveTheme("system", true)); // "light"
    expect(resolveTheme(explicit, true)).toBe("light");
    expect(resolveTheme(explicit, false)).toBe("light");
  });
});
