import { useSyncExternalStore } from "react";

/**
 * Theme store (issue #41) — light / dark / system, remembered client-side
 * under the versioned key `apx.theme.v1` (per PROJECT.md's `apx.<name>.vN`
 * convention, alongside `apx.selection.v1` / `apx.resolutions.v1` /
 * `apx.schedules.v1` / `apx.sidebar.v1`). No account, no server.
 *
 * The app ships complete dark-mode styling; before this issue every `dark:`
 * utility compiled to `@media (prefers-color-scheme: dark)`, so the theme
 * silently followed the OS with no way to override. Issue #41 flips Tailwind
 * to the class-based dark variant (see `globals.css`) and this store owns the
 * mapping from the user's *preference* to the resolved `light`/`dark` theme
 * and the `.dark` class + `color-scheme` on `<html>`.
 *
 * SSR-safety mirrors the other stores (`sidebar.ts` / `schedules.ts`): the
 * server and the first client render both see the stable default snapshot
 * (`system` / `light`), so there is no hydration mismatch; the persisted
 * preference hydrates right after mount. A tiny inline script in
 * `src/app/layout.tsx` applies the stored preference to `<html>` BEFORE first
 * paint (no FOUC) — this store keeps it in sync afterwards:
 *   • in `system` mode it follows live OS changes (matchMedia change events);
 *   • it ignores OS changes while an explicit `light`/`dark` is chosen;
 *   • cross-tab edits sync via the `storage` event, like `schedules.ts`.
 *
 * The pure core (`parsePreference`, `resolveTheme`, `toggledPreference`) is
 * unit-tested in `theme.test.ts`; the DOM/storage shell (pre-paint apply,
 * persistence, live system-change) is exercised by the Playwright suite in a
 * real browser, exactly as `schedules.ts` documents for its shell.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** localStorage key — versioned per PROJECT.md ("apx.<name>.vN").
 *  MUST stay in sync with the inline pre-paint script in `layout.tsx`. */
export const THEME_STORAGE_KEY = "apx.theme.v1";

/**
 * Coerce an unknown stored value into a valid preference. Anything that is not
 * exactly one of the three known strings (null, "", legacy junk, a truncated
 * write) degrades to `system` — the first-visit default — rather than
 * crashing or forcing a wrong theme (issue #41 AC: malformed → System).
 */
export function parsePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : "system";
}

/**
 * Resolve a preference to a concrete theme given whether the OS currently
 * prefers dark. `light`/`dark` are honored verbatim; `system` follows the OS.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * The explicit preference a toggle click writes: always the opposite of the
 * currently *resolved* theme (issue #41, Jon's 2026-07-09 bounce). This is
 * what makes the first click out of the `system` default land on the opposite
 * of whatever the OS was showing, and every click after that flip light ↔
 * dark. The return type excludes `system` — a click can never land back on it,
 * so there is no route back to system from the UI (intentional, per the
 * bounce).
 */
export function toggledPreference(resolved: ResolvedTheme): "light" | "dark" {
  return resolved === "dark" ? "light" : "dark";
}

export interface ThemeState {
  /** What the user picked: light, dark, or system. */
  readonly preference: ThemePreference;
  /** The concrete theme in effect right now. */
  readonly resolved: ResolvedTheme;
}

type Listener = () => void;

// Stable server / pre-hydration snapshot: matches the first client render so
// there is no hydration mismatch (the button renders off `preference`, which
// is `system` on the server and until the stored value hydrates on mount).
const SERVER_SNAPSHOT: ThemeState = Object.freeze({
  preference: "system",
  resolved: "light",
});

let preference: ThemePreference = "system";
let resolved: ResolvedTheme = "light";
let snapshot: ThemeState = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<Listener>();

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Recompute the cached snapshot object, but only allocate a new one when a
 *  value actually changed (referential stability for useSyncExternalStore). */
function refreshSnapshot(): void {
  if (snapshot.preference !== preference || snapshot.resolved !== resolved) {
    snapshot = Object.freeze({ preference, resolved });
  }
}

/** Reflect the resolved theme onto the document: the `.dark` class drives the
 *  Tailwind class variant; `color-scheme` makes native UI (scrollbars, form
 *  controls, autofill) render correctly. Idempotent — safe to re-apply. */
function applyToDocument(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function readStorage(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  preference = readStorage();
  resolved = resolveTheme(preference, systemPrefersDark());
  // The inline pre-paint script already applied this before first paint; keep
  // the document authoritative in case anything raced it.
  applyToDocument(resolved);
  refreshSnapshot();
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Re-resolve from the current preference + live OS state, apply to the
 *  document, and notify subscribers if anything changed. */
function recompute(): void {
  const nextResolved = resolveTheme(preference, systemPrefersDark());
  const changed = nextResolved !== resolved || snapshot.preference !== preference;
  resolved = nextResolved;
  applyToDocument(resolved);
  refreshSnapshot();
  if (changed) emit();
}

function subscribe(listener: Listener): () => void {
  ensureHydrated();
  listeners.add(listener);

  // Follow live OS changes while in `system` mode (ignored otherwise); the
  // class is written synchronously here so a `prefers-color-scheme` flip is
  // reflected on `<html>` without waiting on a React render.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (preference === "system") recompute();
  };
  media.addEventListener("change", onSystemChange);

  // Cross-tab: another tab wrote the theme key (or cleared storage) — re-read.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      preference = readStorage();
      recompute();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ThemeState {
  return snapshot;
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

/** Set the theme preference, persist it, and apply it to the document. */
export function setThemePreference(next: ThemePreference): void {
  ensureHydrated();
  if (next !== preference) {
    preference = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode / quota) — the choice lasts for
      // this session only, still applied to the document below.
    }
  }
  recompute();
}

/**
 * Toggle the resolved theme: write the explicit opposite of whatever is
 * resolved right now. From the `system` default the first call lands on the
 * opposite of the OS theme and stops following the OS; afterwards it flips
 * light ↔ dark. Returns the new (always explicit) preference.
 */
export function toggleThemePreference(): "light" | "dark" {
  ensureHydrated();
  const next = toggledPreference(resolved);
  setThemePreference(next);
  return next;
}

export interface ThemeApi extends ThemeState {
  /** Set an explicit preference. */
  setPreference: (preference: ThemePreference) => void;
  /** Flip to the opposite of the resolved theme (writes an explicit
   *  light/dark preference and stops following the OS); returns the new one. */
  toggle: () => "light" | "dark";
}

/**
 * React hook over the shared theme store. Safe to call from any client
 * component; all callers stay in sync. Server + first client render see
 * `system` / `light`; the stored preference hydrates right after mount.
 */
export function useTheme(): ThemeApi {
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return {
    preference: state.preference,
    resolved: state.resolved,
    setPreference: setThemePreference,
    toggle: toggleThemePreference,
  };
}
