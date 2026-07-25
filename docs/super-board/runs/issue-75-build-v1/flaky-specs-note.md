# Issue #78's two red specs — which failure mode each one had

Required by #78 AC3, written by the issue #75 Builder (the two cards ship as
one branch). Keep this file: the next full-suite run should be able to tell a
new regression from this known pair without re-deriving the diagnosis.

**Both were spec-side races on React hydration. Neither was a product defect.**
Both specs measured or clicked while the page was still the server-rendered
snapshot, and both are intermittent for that reason — whether they fail depends
on whether hydration wins the race on that run.

---

## 1. `e2e/issue-41-theme-toggle.spec.ts:190` — "an explicit choice stops following the OS"

**Failure mode: a dead click, swallowed before React could dispatch it.** Not a
first-click race in the component.

The test emulated an OS-dark preference, called `goto("/")`, and clicked the
toggle on the next line. `goto()` resolves on `load`; the button is
server-rendered and fully "actionable" to Playwright well before React is ready
to route events into it, so the click was lost. The label then settled to the
hydrated `dark` and the assertion expecting `light` failed — which reads
exactly like a product bug and is not one.

**Evidence that the click never reached the app:** after the lost click,
`localStorage["apx.theme.v1"]` was still `null`. The store is only ever written
from inside the click handler (`toggleThemePreference` → `setThemePreference`),
so a `null` there means the handler never ran.

**Evidence that the component is sound:** `toggleThemePreference()` calls
`ensureHydrated()` and recomputes from live state (`matchMedia` + storage), so
it does not depend on the rendered snapshot. Measured directly: with the click
delivered while the button still rendered the *stale* SSR label ("Theme: light"
on an OS-dark machine), the store still wrote `light` — the correct answer,
i.e. the opposite of the resolved `dark`. There is no window in which a
delivered click produces the wrong preference.

**Why its twin at `:141` passed in the same run** — the answer #78 asked for:
`:141` asserts `toHaveAttribute("aria-label", nameFor("dark"))` *before* it
clicks. On an OS-dark machine that label can only appear after hydration (the
server snapshot is `light`), so that assertion accidentally works as a
hydration gate. `:190` has no such pre-click assertion. The two set up
`emulateMedia` / `goto` identically; the difference is entirely that one waits
for a post-hydration observable and the other does not.

**Fix:** retry-until-effect, the pattern `e2e/support/view-chip.ts` already
mandates for this suite — `activateThemeToggle()` in `e2e/support/hydration.ts`.
A toggle is not idempotent, so a naive retry could double-flip; the
post-condition is therefore *"the stored preference changed"*, which every
successful activation satisfies and a swallowed one never does. Applied to all
24 toggle activations and the 3 collapse-control presses in the file.

**Rejected alternatives**, both measured and both insufficient:

| Gate | Why it fails |
|---|---|
| Assert the toggle's label before clicking (the `:141` accident) | Only gates when the label is expected to change at hydration. On an OS-light machine the server and hydrated snapshots are identical, so it passes against a dead button. |
| Wait for React's `__reactProps$…` marker with a bound `onClick` | Measured: the marker was attached and the very next click was still swallowed (`apx.theme.v1` still `null`). Props land on the node before the root will dispatch into that subtree. |

**Verification:** 10 consecutive full-file runs at `--workers=1` and 10 at
`--workers=2`, all green (log: `theme-toggle-10x.txt` in this folder).

---

## 2. `e2e/issue-60-qa.spec.ts:147` — AC2, "precondition: sidebar content must overflow the column"

**Failure mode: the precondition was measured against the pre-hydration DOM.**
The region does still overflow; the spec was looking too early.

`seedManySchedules()` writes 25 schedules into `localStorage` via
`addInitScript`, but the schedules store is `useSyncExternalStore`-backed: the
server render and the first client render both show the default *single*
schedule, and the seeded 25 only appear once hydration adopts the client
snapshot. The spec's only wait before measuring was
`getByRole("button", { name: /^Collapse sidebar$/ }).waitFor()` — and that
button is server-rendered, so it is satisfied immediately and gates nothing.

**Measured, same page, same viewport (1440×800):**

| moment | schedule-row buttons in `#sidebar-sections` | `scrollHeight` | `clientHeight` |
|---|---|---|---|
| at the spec's old measuring point | 4 | 615 | 615 |
| after hydration settles | 76 | 1501 | 615 |

So `scrollHeight === clientHeight === 615` — the exact numbers in the #78
report — is the one-schedule layout. Nothing about the sidebar drifted; no
re-anchoring to a taller seed or a shorter viewport was needed.

**Fix:** wait for the *seeded* content before measuring — the last seeded
schedule's row must be attached. That is a genuine post-hydration observable,
unlike the collapse button.

**Note for whoever touches `support/hydration.ts` next:** the React props
marker (rejected above) would NOT have fixed this one either, and for a
different reason. The marker fires at the hydration commit; a
`useSyncExternalStore` value is adopted in the effect right after it. Gating on
event-readiness and gating on store-content are different moments, so the
theme spec and this one need different gates on purpose.

---

## Three more `toBe(0)` overflow assertions, red on `main`, corrected here

Found while running the above; same root cause as each other, unrelated to
hydration. Not listed in #78, but they are `main`-is-red failures in the same
files, so they are fixed in this pass rather than left to bounce a later card.

- `e2e/issue-60-qa.spec.ts` AC4 (mobile 375 + tablet 768)
- `e2e/issue-60-qa.spec.ts` AC2 (the tail-end overflow check)
- `e2e/issue-49-qa.spec.ts` AC8 (mobile 375, dialog open, dark)

All assert `documentElement.scrollWidth - documentElement.clientWidth === 0`
and all receive `-10`. Issue #49 added `html { scrollbar-gutter: stable }`,
which reserves the scrollbar strip *inside* the root's content box;
`clientWidth` reports the full viewport and does not subtract that reservation.
So whenever the scrollbar itself occupies no layout width — every default
Playwright run, since Chromium is launched with `--hide-scrollbars`, and also
while a dialog's scroll lock is applied — the delta rests at −10, the gutter
width. Horizontal *overflow* is a POSITIVE delta; the assertions are now
`toBeLessThanOrEqual(0)` with the reasoning inline at each site. Confirmed
pre-existing: `issue-49-qa` AC8 reproduces identically with `src/lib/modal.ts`
reverted to the old `overflow: hidden` lock.

## Out of scope (unchanged from #78)

The 6 `browserType.launch: Chromium distribution 'chrome' is not found`
failures need Google Chrome on the runner, not a code change.
`e2e/issue-49-real-chrome.spec.ts` runs on this host — Chrome is installed at
`C:\Program Files\Google\Chrome\Application\chrome.exe` — and its result is
recorded in the PR handoff.
