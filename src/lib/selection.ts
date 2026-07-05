import { useCallback, useSyncExternalStore } from "react";

/**
 * "My Exams" selection store.
 *
 * A tiny module-level store (no React context/provider needed) exposing the
 * set of selected AP subject ids, persisted to localStorage under
 * `apx.selection.v1`. Every component that calls {@link useSelection} shares
 * the same state via `useSyncExternalStore`, so later cards (schedule,
 * conflicts, ICS export) can read/mutate the same selection.
 *
 * SSR-safe: the server and the first client render both see an empty snapshot,
 * so there is no hydration mismatch; the persisted selection is loaded on the
 * client immediately after mount.
 */

/** localStorage key — versioned per PROJECT.md ("apx.<name>.vN"). */
export const SELECTION_STORAGE_KEY = "apx.selection.v1";

type Listener = () => void;

const EMPTY: readonly string[] = Object.freeze([]);

/** Canonical client-side selection. Replaced (never mutated) on every change. */
let current: readonly string[] = EMPTY;
let hydrated = false;
const listeners = new Set<Listener>();

function readStorage(): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const ids = Array.from(
      new Set(parsed.filter((v): v is string => typeof v === "string")),
    );
    return ids.length ? Object.freeze(ids) : EMPTY;
  } catch {
    // Corrupt/unavailable storage — start from an empty selection.
    return EMPTY;
  }
}

function writeStorage(ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode / quota) — selection stays in-memory.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  current = readStorage();
}

function setSelection(ids: readonly string[]): void {
  current = ids.length ? Object.freeze([...ids]) : EMPTY;
  writeStorage(current);
  emit();
}

function subscribe(listener: Listener): () => void {
  // Hydrate from localStorage on the first subscription. React re-reads the
  // snapshot immediately after subscribe runs, so the persisted selection
  // appears on the first commit without any hydration mismatch.
  ensureHydrated();
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === SELECTION_STORAGE_KEY) {
      current = readStorage();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): readonly string[] {
  return current;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

/** Add `id` to the selection (no-op if already selected). */
export function addSelection(id: string): void {
  ensureHydrated();
  if (current.includes(id)) return;
  setSelection([...current, id]);
}

/** Remove `id` from the selection (no-op if not selected). */
export function removeSelection(id: string): void {
  ensureHydrated();
  if (!current.includes(id)) return;
  setSelection(current.filter((existing) => existing !== id));
}

/** Toggle `id`: select it if absent, deselect it if present. */
export function toggleSelection(id: string): void {
  ensureHydrated();
  if (current.includes(id)) removeSelection(id);
  else addSelection(id);
}

/** Clear the entire selection. */
export function clearSelection(): void {
  ensureHydrated();
  if (current.length === 0) return;
  setSelection(EMPTY);
}

export interface SelectionApi {
  /** Stable, ordered list of selected subject ids. */
  readonly selectedIds: readonly string[];
  /** Number of selected subjects. */
  readonly selectedCount: number;
  /** Whether `id` is currently selected. */
  isSelected: (id: string) => boolean;
  /** Toggle selection for `id`. */
  toggle: (id: string) => void;
  /** Select `id`. */
  add: (id: string) => void;
  /** Deselect `id`. */
  remove: (id: string) => void;
  /** Clear the whole selection. */
  clear: () => void;
}

/**
 * React hook returning the shared "My Exams" selection and its mutators.
 * Safe to call from any client component; all callers stay in sync.
 */
export function useSelection(): SelectionApi {
  const selectedIds = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds],
  );

  return {
    selectedIds,
    selectedCount: selectedIds.length,
    isSelected,
    toggle: toggleSelection,
    add: addSelection,
    remove: removeSelection,
    clear: clearSelection,
  };
}
