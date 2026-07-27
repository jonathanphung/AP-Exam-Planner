import { useCallback, useSyncExternalStore } from "react";
import { slotKey, type SlotResolution } from "./conflicts";

/**
 * Multi-schedule store (issue #29) — the single owner of all plan state.
 *
 * A student can keep several draft exam plans ("Schedule 1", "ambitious
 * draft", …) and switch the whole app between them. Each schedule owns its
 * FULL plan state: the "My Exams" selection AND the conflict resolutions from
 * issue #5 — switching schedules never leaks one schedule's resolutions into
 * another.
 *
 * Persistence (design decision, documented per the issue's AC):
 *   Jon asked for "saved to the user's cookies, not through an account" — the
 *   intent being no-login persistence across visits on this device/browser.
 *   We implement it with the app's established versioned client-storage
 *   pattern: **localStorage under `apx.schedules.v1`**, not literal HTTP
 *   cookies, because (a) this is a static client-only app with no server to
 *   read a cookie (PROJECT.md: no network calls at runtime), (b) cookies are
 *   capped at ~4KB — too small for several schedules with resolutions — and
 *   would be pointlessly attached to every request, and (c) every existing
 *   store (`apx.selection.v1`, `apx.resolutions.v1`) already uses versioned
 *   localStorage keys, which the PROJECT.md conventions mandate. localStorage
 *   satisfies the actual requirement: no account, survives reload, stays on
 *   this device/browser.
 *
 * Migration: an existing visitor's `apx.selection.v1` + `apx.resolutions.v1`
 * are adopted as "Schedule 1" the first time this version loads (see
 * {@link migrateLegacyState}) — nobody's saved plan is lost.
 *
 * Legacy mirror: after every write, the ACTIVE schedule's selection and
 * resolutions are mirrored back to the legacy keys. The accumulated e2e suite
 * (issues #3/#5/#8/#19/#22) both seeds and asserts on those keys, and the
 * mirror keeps their contract intact: the legacy keys always describe the
 * currently-active schedule.
 *
 * Same SSR-safe `useSyncExternalStore` pattern as `selection.ts` /
 * `resolutions.ts` (which now delegate here): the server and first client
 * render see a stable default snapshot; the persisted state hydrates on the
 * client right after mount. Cross-tab sync piggybacks on the `storage` event
 * for `apx.schedules.v1`, exactly like the previous per-key stores.
 */

/** localStorage key — versioned per PROJECT.md ("apx.<name>.vN"). */
export const SCHEDULES_STORAGE_KEY = "apx.schedules.v1";

/** Legacy single-plan keys (pre-#29), now a mirror of the active schedule. */
export const LEGACY_SELECTION_KEY = "apx.selection.v1";
export const LEGACY_RESOLUTIONS_KEY = "apx.resolutions.v1";

export interface Schedule {
  /** Stable opaque id (never shown to the user). */
  readonly id: string;
  /** User-visible name, e.g. "Schedule 1". */
  readonly name: string;
  /** This schedule's "My Exams" subject ids. */
  readonly selection: readonly string[];
  /** This schedule's conflict resolutions (issue #5 late-testing moves). */
  readonly resolutions: readonly SlotResolution[];
}

export interface SchedulesState {
  /** Id of the schedule the whole app currently displays. */
  readonly activeId: string;
  /** All saved schedules, in display order. Never empty. */
  readonly schedules: readonly Schedule[];
}

type Listener = () => void;

const EMPTY_IDS: readonly string[] = Object.freeze([]);
const EMPTY_RESOLUTIONS: readonly SlotResolution[] = Object.freeze([]);

/** Default schedule name for a fresh visitor and for migrated legacy state. */
export const DEFAULT_SCHEDULE_NAME = "Schedule 1";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function freezeSchedule(schedule: {
  id: string;
  name: string;
  selection: readonly string[];
  resolutions: readonly SlotResolution[];
}): Schedule {
  return Object.freeze({
    id: schedule.id,
    name: schedule.name,
    selection: schedule.selection.length
      ? Object.freeze([...schedule.selection])
      : EMPTY_IDS,
    resolutions: schedule.resolutions.length
      ? Object.freeze(
          schedule.resolutions.map((r) =>
            Object.freeze({
              date: r.date,
              session: r.session,
              keeperId: r.keeperId,
              memberIds: Object.freeze([...r.memberIds]) as string[],
            }),
          ),
        )
      : EMPTY_RESOLUTIONS,
  });
}

function freezeState(state: {
  activeId: string;
  schedules: readonly Schedule[];
}): SchedulesState {
  return Object.freeze({
    activeId: state.activeId,
    schedules: Object.freeze([...state.schedules]),
  });
}

/** A fresh default: one empty "Schedule 1". */
export function createDefaultState(): SchedulesState {
  const first = freezeSchedule({
    id: generateId(),
    name: DEFAULT_SCHEDULE_NAME,
    selection: EMPTY_IDS,
    resolutions: EMPTY_RESOLUTIONS,
  });
  return freezeState({ activeId: first.id, schedules: [first] });
}

// ── Validation (shared by parse + migration) ────────────────────────────────

/** Sanitize an unknown value into a deduplicated subject-id list. */
export function sanitizeSelection(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY_IDS;
  const ids = Array.from(
    new Set(value.filter((v): v is string => typeof v === "string")),
  );
  return ids.length ? ids : EMPTY_IDS;
}

function isSlotResolution(value: unknown): value is SlotResolution {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    (r.session === "AM" || r.session === "PM") &&
    typeof r.keeperId === "string" &&
    Array.isArray(r.memberIds) &&
    r.memberIds.length >= 2 &&
    r.memberIds.every((id): id is string => typeof id === "string") &&
    r.memberIds.includes(r.keeperId)
  );
}

/**
 * Sanitize an unknown value into a valid resolution list — same rules as the
 * pre-#29 resolutions store: shape-checked, one resolution per slot
 * (first wins).
 */
export function sanitizeResolutions(
  value: unknown,
): readonly SlotResolution[] {
  if (!Array.isArray(value)) return EMPTY_RESOLUTIONS;
  const seen = new Set<string>();
  const resolutions = value.filter((entry): entry is SlotResolution => {
    if (!isSlotResolution(entry)) return false;
    const key = slotKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return resolutions.length ? resolutions : EMPTY_RESOLUTIONS;
}

/**
 * Parse the persisted `apx.schedules.v1` payload. Returns `null` when the raw
 * value is absent or unusable (caller then migrates legacy state instead).
 * Individually malformed schedules are dropped; an unknown `activeId` falls
 * back to the first schedule.
 */
export function parseSchedulesState(raw: string | null): SchedulesState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.schedules)) return null;

  const seenIds = new Set<string>();
  const schedules: Schedule[] = [];
  for (const entry of obj.schedules) {
    if (typeof entry !== "object" || entry === null) continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== "string" || s.id.length === 0) continue;
    if (seenIds.has(s.id)) continue;
    const name =
      typeof s.name === "string" && s.name.trim().length > 0
        ? s.name.trim()
        : `Schedule ${schedules.length + 1}`;
    seenIds.add(s.id);
    schedules.push(
      freezeSchedule({
        id: s.id,
        name,
        selection: sanitizeSelection(s.selection),
        resolutions: sanitizeResolutions(s.resolutions),
      }),
    );
  }
  if (schedules.length === 0) return null;

  const activeId =
    typeof obj.activeId === "string" && seenIds.has(obj.activeId)
      ? obj.activeId
      : schedules[0].id;
  return freezeState({ activeId, schedules });
}

/**
 * Adopt a pre-#29 visitor's plan as "Schedule 1" (issue #29 migration AC).
 * `selectionRaw` / `resolutionsRaw` are the raw localStorage payloads of the
 * legacy keys (or null). Corrupt legacy payloads degrade to empty state —
 * exactly what the legacy stores themselves did.
 */
export function migrateLegacyState(
  selectionRaw: string | null,
  resolutionsRaw: string | null,
): SchedulesState {
  let selection: readonly string[] = EMPTY_IDS;
  let resolutions: readonly SlotResolution[] = EMPTY_RESOLUTIONS;
  try {
    selection = sanitizeSelection(
      selectionRaw ? JSON.parse(selectionRaw) : null,
    );
  } catch {
    selection = EMPTY_IDS;
  }
  try {
    resolutions = sanitizeResolutions(
      resolutionsRaw ? JSON.parse(resolutionsRaw) : null,
    );
  } catch {
    resolutions = EMPTY_RESOLUTIONS;
  }
  const first = freezeSchedule({
    id: generateId(),
    name: DEFAULT_SCHEDULE_NAME,
    selection,
    resolutions,
  });
  return freezeState({ activeId: first.id, schedules: [first] });
}

// ── Name validation (issue #62) ─────────────────────────────────────────────

/**
 * Maximum schedule-name length (issue #62). 60 comfortably fits any
 * human-meaningful plan label ("Ambitious retake plan — spring 2027") while
 * capping the pathological growth the #39 sweep flagged (a 300-char emoji name
 * was accepted into `apx.schedules.v1`).
 *
 * Counting unit: the store measures with `[...name].length` (Unicode code
 * points) so one multi-byte emoji counts as one character. The UI pairs this
 * with `maxLength={MAX_SCHEDULE_NAME_LENGTH}` on the rename input, which
 * measures UTF-16 code units — always ≤-permissive than code points — so the
 * input can never accept a name the store would then reject for length.
 */
export const MAX_SCHEDULE_NAME_LENGTH = 60;

/** Why a proposed schedule name was rejected (issue #62). */
export type ScheduleNameError = "blank" | "too-long" | "duplicate";

/**
 * Validate a proposed schedule name against the store rules (issue #62):
 * non-blank after trim, ≤ {@link MAX_SCHEDULE_NAME_LENGTH} code points, and not
 * an exact duplicate of another schedule's name.
 *
 * Design decision (AC1) — duplicates are REJECTED, not auto-suffixed
 * ("Schedule 1 (2)"). For an inline single-field rename, rejection with inline
 * feedback is the more predictable behavior: the app never silently mutates the
 * label the user typed, and it reuses the same `role="alert"` surface the
 * length constraint already needs. Match is exact after trim and
 * case-sensitive (per the AC wording "exactly matches … after trim") — "Schedule
 * 1" and "schedule 1" are visually and audibly distinct, so only truly
 * identical labels collide.
 *
 * `selfId` excludes the schedule being renamed, so re-committing a schedule's
 * own (unchanged) name is never a false "duplicate".
 *
 * Returns `null` when the name is acceptable, otherwise the specific reason.
 */
export function validateScheduleName(
  name: string,
  schedules: readonly Pick<Schedule, "id" | "name">[],
  selfId?: string,
): ScheduleNameError | null {
  const trimmed = name.trim();
  if (!trimmed) return "blank";
  if ([...trimmed].length > MAX_SCHEDULE_NAME_LENGTH) return "too-long";
  const duplicate = schedules.some(
    (s) => s.id !== selfId && s.name.trim() === trimmed,
  );
  return duplicate ? "duplicate" : null;
}

// ── Pure state transitions (unit-tested in schedules.test.ts) ───────────────

/** "Schedule N" auto-name: one past the highest existing "Schedule k". */
export function nextScheduleName(
  schedules: readonly Pick<Schedule, "name">[],
): string {
  let max = 0;
  for (const { name } of schedules) {
    const match = /^Schedule (\d+)$/.exec(name.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Schedule ${max + 1}`;
}

/**
 * Append a new empty schedule and make it active.
 *
 * A caller-supplied `name` is honored only when it passes the same rules as a
 * rename (issue #62): non-blank, within the length cap, and not a duplicate.
 * Otherwise — including the common no-arg "New schedule" click — we fall back to
 * the auto "Schedule N" name, which is unique by construction. Create can never
 * fail (the button must always produce a schedule), so an invalid explicit name
 * degrades to the safe auto-name rather than minting a duplicate/over-length
 * label.
 */
export function withScheduleCreated(
  state: SchedulesState,
  name?: string,
): SchedulesState {
  const requested = name?.trim();
  const usable = requested && !validateScheduleName(requested, state.schedules);
  const schedule = freezeSchedule({
    id: generateId(),
    name: usable ? requested : nextScheduleName(state.schedules),
    selection: EMPTY_IDS,
    resolutions: EMPTY_RESOLUTIONS,
  });
  return freezeState({
    activeId: schedule.id,
    schedules: [...state.schedules, schedule],
  });
}

/**
 * Matches a name's existing " (copy)" / " (copy N)" suffix, so duplicating a
 * copy re-derives from the ORIGINAL base — "plan (copy)" forks to
 * "plan (copy 2)", never to the unboundedly-growing "plan (copy) (copy)".
 */
const COPY_SUFFIX_RE = / \(copy(?: \d+)?\)$/;

/**
 * Unique display name for a duplicate of `sourceName` (issue #88):
 * `<base> (copy)`, then `<base> (copy 2)`, … where `<base>` is the source name
 * with any existing copy-suffix stripped.
 *
 * Why auto-suffixing here does NOT contradict issue #62's reject-duplicates
 * decision: #62's rule ("duplicates are REJECTED, not auto-suffixed") is
 * explicitly scoped to the inline rename — the app never silently mutates a
 * label the user TYPED. A Duplicate click types nothing, so there is no
 * user-entered label to protect and no field to bounce a rejection back to;
 * deriving a unique name is the only behavior that lets the click always
 * succeed. The invariant #62 actually guards — no duplicate / over-length name
 * ever reaches `apx.schedules.v1` — still holds: the generated name passes
 * {@link validateScheduleName} by construction.
 *
 * Length cap: the BASE is truncated (in code points, the store's counting
 * unit) so base + suffix always fits {@link MAX_SCHEDULE_NAME_LENGTH} — a
 * 60-character source still yields a valid, unique copy name rather than one
 * the store's own validation would reject.
 */
export function copyScheduleName(
  sourceName: string,
  schedules: readonly Pick<Schedule, "name">[],
): string {
  const base = sourceName.trim().replace(COPY_SUFFIX_RE, "");
  const existing = new Set(schedules.map((s) => s.name.trim()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    const room = MAX_SCHEDULE_NAME_LENGTH - suffix.length;
    // Truncate in code points and drop any whitespace the cut exposes so the
    // candidate never carries a double space before its suffix.
    const truncatedBase = [...base].slice(0, room).join("").trimEnd();
    const candidate = `${truncatedBase}${suffix}`;
    // Candidates for distinct n are distinct strings, so with finitely many
    // existing names this loop always terminates.
    if (!existing.has(candidate)) return candidate;
  }
}

/**
 * Split `name` into its base and its {@link COPY_SUFFIX_RE} copy-suffix (empty
 * string when the name is not a derived copy). Display-level companion to
 * {@link copyScheduleName}, single-sourcing the suffix grammar.
 *
 * Why the UI needs the split (QA v1 of issue #88): at the 375px viewport the
 * schedule row's name span gets ~99px, so end-truncation clipped exactly the
 * copy-suffix — "Schedule 1 (copy)" and "Schedule 1 (copy 2)" both painted as
 * "Schedule 1 (c…", making sibling copies pixel-identical. The row therefore
 * renders the base and the suffix separately: the base truncates, the suffix
 * — the only part that distinguishes copies — never does.
 */
export function splitCopySuffix(name: string): {
  base: string;
  suffix: string;
} {
  const match = COPY_SUFFIX_RE.exec(name);
  if (!match) return { base: name, suffix: "" };
  return { base: name.slice(0, match.index), suffix: match[0] };
}

/**
 * Fork schedule `id` (issue #88): insert a deep, independently-frozen copy of
 * its FULL plan state — selection AND resolutions (copying only the selection
 * would silently drop the user's conflict decisions, exactly the leak the
 * module doc forbids) — under a fresh id and a unique
 * {@link copyScheduleName}-derived name, directly after its source so the fork
 * sits next to the plan it came from. The copy becomes active (same
 * activation behavior as {@link withScheduleCreated}: the user clicked to get
 * a fork they can immediately edit). No-op for unknown ids, consistent with
 * the other transitions.
 */
export function withScheduleDuplicated(
  state: SchedulesState,
  id: string,
): SchedulesState {
  const index = state.schedules.findIndex((s) => s.id === id);
  if (index === -1) return state;
  const source = state.schedules[index];
  // freezeSchedule deep-copies the selection and every resolution (including
  // each memberIds array), so the copy shares no mutable structure with its
  // source — editing one can never alias into the other.
  const copy = freezeSchedule({
    id: generateId(),
    name: copyScheduleName(source.name, state.schedules),
    selection: source.selection,
    resolutions: source.resolutions,
  });
  const schedules = [...state.schedules];
  schedules.splice(index + 1, 0, copy);
  return freezeState({ activeId: copy.id, schedules });
}

/**
 * Rename a schedule. No-op for unknown ids, an unchanged name, or any name that
 * fails {@link validateScheduleName} — blank, over the length cap, or an exact
 * duplicate of another schedule (issue #62). The UI validates first and surfaces
 * the reason via `role="alert"`; this guard is the store-side safety net so a
 * duplicate/over-length label can never reach `apx.schedules.v1`.
 */
export function withScheduleRenamed(
  state: SchedulesState,
  id: string,
  name: string,
): SchedulesState {
  const index = state.schedules.findIndex((s) => s.id === id);
  if (index === -1) return state;
  if (validateScheduleName(name, state.schedules, id)) return state;
  const trimmed = name.trim();
  if (state.schedules[index].name === trimmed) return state;
  const schedules = [...state.schedules];
  schedules[index] = freezeSchedule({ ...schedules[index], name: trimmed });
  return freezeState({ activeId: state.activeId, schedules });
}

/**
 * Delete a schedule. Guard: the last remaining schedule cannot be deleted —
 * there is always at least one. Deleting the active schedule activates its
 * next neighbor (or the previous one when deleting the last item).
 */
export function withScheduleDeleted(
  state: SchedulesState,
  id: string,
): SchedulesState {
  if (state.schedules.length <= 1) return state;
  const index = state.schedules.findIndex((s) => s.id === id);
  if (index === -1) return state;
  const schedules = state.schedules.filter((s) => s.id !== id);
  const activeId =
    state.activeId === id
      ? schedules[Math.min(index, schedules.length - 1)].id
      : state.activeId;
  return freezeState({ activeId, schedules });
}

/** Switch the app to another schedule (no-op for unknown ids). */
export function withActiveSchedule(
  state: SchedulesState,
  id: string,
): SchedulesState {
  if (state.activeId === id) return state;
  if (!state.schedules.some((s) => s.id === id)) return state;
  return freezeState({ activeId: id, schedules: state.schedules });
}

/** Replace the ACTIVE schedule's selection. */
export function withActiveSelection(
  state: SchedulesState,
  selection: readonly string[],
): SchedulesState {
  const schedules = state.schedules.map((s) =>
    s.id === state.activeId
      ? freezeSchedule({ ...s, selection: sanitizeSelection([...selection]) })
      : s,
  );
  return freezeState({ activeId: state.activeId, schedules });
}

/** Replace the ACTIVE schedule's resolutions. */
export function withActiveResolutions(
  state: SchedulesState,
  resolutions: readonly SlotResolution[],
): SchedulesState {
  const schedules = state.schedules.map((s) =>
    s.id === state.activeId
      ? freezeSchedule({ ...s, resolutions })
      : s,
  );
  return freezeState({ activeId: state.activeId, schedules });
}

/** The active schedule record (state invariant: always present). */
export function activeSchedule(state: SchedulesState): Schedule {
  return (
    state.schedules.find((s) => s.id === state.activeId) ?? state.schedules[0]
  );
}

// ── Module-level store (same pattern as selection.ts / resolutions.ts) ─────

/**
 * Stable pre-hydration/server snapshot. The server and the first client
 * render both see this default, so there is no hydration mismatch; the
 * persisted state loads right after mount (in `subscribe`).
 */
const DEFAULT_STATE: SchedulesState = createDefaultState();

let current: SchedulesState = DEFAULT_STATE;
let hydrated = false;
const listeners = new Set<Listener>();

function readStorage(): SchedulesState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const parsed = parseSchedulesState(
      window.localStorage.getItem(SCHEDULES_STORAGE_KEY),
    );
    if (parsed) return parsed;
    // First load of the multi-schedule version: adopt the legacy single-plan
    // keys as "Schedule 1" (issue #29 migration AC).
    return migrateLegacyState(
      window.localStorage.getItem(LEGACY_SELECTION_KEY),
      window.localStorage.getItem(LEGACY_RESOLUTIONS_KEY),
    );
  } catch {
    // Storage unavailable (private mode / quota) — stay in-memory.
    return DEFAULT_STATE;
  }
}

function writeStorage(state: SchedulesState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SCHEDULES_STORAGE_KEY,
      JSON.stringify({
        activeId: state.activeId,
        schedules: state.schedules.map((s) => ({
          id: s.id,
          name: s.name,
          selection: s.selection,
          resolutions: s.resolutions,
        })),
      }),
    );
    // Legacy mirror — the pre-#29 keys always describe the active schedule,
    // preserving the persistence contract asserted by the accumulated e2e
    // suite (issues #3/#5) and easing rollback.
    const active = activeSchedule(state);
    window.localStorage.setItem(
      LEGACY_SELECTION_KEY,
      JSON.stringify(active.selection),
    );
    window.localStorage.setItem(
      LEGACY_RESOLUTIONS_KEY,
      JSON.stringify(active.resolutions),
    );
  } catch {
    // Storage unavailable — state stays in-memory for this session.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  current = readStorage();
  // Persist immediately so (a) the migrated shape exists for other tabs and
  // (b) the legacy mirror is consistent from the first paint.
  writeStorage(current);
}

function setState(state: SchedulesState): void {
  if (state === current) return;
  current = state;
  writeStorage(current);
  emit();
}

/** Subscribe to store changes (hydrates from localStorage on first use). */
export function subscribeSchedules(listener: Listener): () => void {
  ensureHydrated();
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    // Another tab wrote the schedules key (or cleared storage): re-read.
    if (event.key === SCHEDULES_STORAGE_KEY || event.key === null) {
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

export function getSchedulesSnapshot(): SchedulesState {
  return current;
}

export function getSchedulesServerSnapshot(): SchedulesState {
  return DEFAULT_STATE;
}

// ── Public mutators ─────────────────────────────────────────────────────────

/** Create a new empty schedule ("Schedule N"), make it active; returns its id. */
export function createSchedule(name?: string): string {
  ensureHydrated();
  const next = withScheduleCreated(current, name);
  setState(next);
  return next.activeId;
}

/** Rename schedule `id` (blank names are ignored). */
export function renameSchedule(id: string, name: string): void {
  ensureHydrated();
  setState(withScheduleRenamed(current, id, name));
}

/**
 * Duplicate schedule `id` into a uniquely named, deep-copied, active fork
 * (issue #88). Returns the copy's id — or, mirroring the transition's no-op
 * on an unknown id, the unchanged active id.
 */
export function duplicateSchedule(id: string): string {
  ensureHydrated();
  const next = withScheduleDuplicated(current, id);
  setState(next);
  return next.activeId;
}

/** Delete schedule `id` (the last remaining schedule is never deleted). */
export function deleteSchedule(id: string): void {
  ensureHydrated();
  setState(withScheduleDeleted(current, id));
}

/** Switch the whole app to schedule `id`. */
export function setActiveSchedule(id: string): void {
  ensureHydrated();
  setState(withActiveSchedule(current, id));
}

// ── Active-schedule accessors (used by selection.ts / resolutions.ts) ──────

export function getActiveSelection(): readonly string[] {
  return activeSchedule(current).selection;
}

export function setActiveSelection(selection: readonly string[]): void {
  ensureHydrated();
  setState(withActiveSelection(current, selection));
}

export function getActiveResolutions(): readonly SlotResolution[] {
  return activeSchedule(current).resolutions;
}

export function setActiveResolutions(
  resolutions: readonly SlotResolution[],
): void {
  ensureHydrated();
  setState(
    withActiveResolutions(
      current,
      resolutions.map((r) => ({
        date: r.date,
        session: r.session,
        keeperId: r.keeperId,
        memberIds: [...r.memberIds],
      })),
    ),
  );
}

// ── React hook ──────────────────────────────────────────────────────────────

export interface SchedulesApi {
  /** All saved schedules, in display order. */
  readonly schedules: readonly Schedule[];
  /** Id of the active schedule. */
  readonly activeId: string;
  /** The active schedule record. */
  readonly active: Schedule;
  /** Switch the app to schedule `id`. */
  setActive: (id: string) => void;
  /** Create a new empty schedule; returns its id. */
  create: () => string;
  /** Rename schedule `id`. */
  rename: (id: string, name: string) => void;
  /** Delete schedule `id` (no-op on the last remaining schedule). */
  remove: (id: string) => void;
  /**
   * Duplicate schedule `id` into a uniquely named copy of its full plan
   * (selection + resolutions) and make the copy active (issue #88).
   */
  duplicate: (id: string) => void;
}

/**
 * React hook over the shared schedules store. All callers stay in sync —
 * including with `useSelection()` / `useResolutions()`, which read the same
 * store scoped to the active schedule.
 */
export function useSchedules(): SchedulesApi {
  const state = useSyncExternalStore(
    subscribeSchedules,
    getSchedulesSnapshot,
    getSchedulesServerSnapshot,
  );

  const setActive = useCallback((id: string) => setActiveSchedule(id), []);
  const create = useCallback(() => createSchedule(), []);
  const rename = useCallback(
    (id: string, name: string) => renameSchedule(id, name),
    [],
  );
  const remove = useCallback((id: string) => deleteSchedule(id), []);
  const duplicate = useCallback((id: string) => {
    duplicateSchedule(id);
  }, []);

  return {
    schedules: state.schedules,
    activeId: state.activeId,
    active: activeSchedule(state),
    setActive,
    create,
    rename,
    remove,
    duplicate,
  };
}
