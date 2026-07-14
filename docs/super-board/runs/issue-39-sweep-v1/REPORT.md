# Issue #39 — Full-site adversarial QA sweep (v1)

Sweep run 2026-07-13 against a production build (`pnpm build` + `PORT=3100 pnpm start`,
commit 3a36f4d) with a confirmation smoke pass against the live site
(https://apexamplanner.vercel.app). Harness: Playwright + @axe-core/playwright,
56 sweep tests in `specs/` (run with `pnpm exec playwright test --config sweep/sweep.config.ts`
after copying `specs/` + `sweep.config.ts` to a `sweep/` folder at repo root).
Raw structured findings: `findings.ndjson`.

## Verdict

The app held up. **One product finding filed** (schedule-name validation,
enhancement). Everything else survived adversarial input, limit testing, and
the accessibility audit. Details below so the coverage is auditable.

## What was attempted, and what happened

### Feature exercise (all clean)
- **Catalog:** all 42 subjects expand and expose the details tier; category
  quick-nav jumps to each of the 5 categories; select/deselect toggles are
  deterministic under 10x spam, double-click, and expand+select interleave.
- **Search:** no-match shows the "No subjects match your search." empty state;
  whitespace-only treated as empty (all subjects); 5000-char query, regex
  metachars (`( [ \ * .*`), `<script>`, `%`, and rapid typing all safe;
  matching still correct afterwards.
- **Schedule views:** List/Calendar switcher, calendar default on load,
  week pager to both boundaries (spam-clicked disabled ends), event block
  click -> details popup, Escape closes. Conflict prompt renders inline in
  List view and pops as a modal (with scrim) on entering List with unresolved
  conflicts — dismissable with Escape, prompt body stays inline.
- **Conflicts:** biology+latin same-slot conflict resolved via "Keep AP
  Biology"; List, Calendar, and ICS all agree afterwards (Latin ->
  2026-05-18 PM late slot, 12:00 floating local; Biology stays 2026-05-04 AM
  08:00). Double-click on the Keep button is a no-op. Hand-corrupted
  resolutions (`{"latin":"moved"}` — wrong shape) are discarded and the
  conflict re-prompts (self-heal verified, zero page errors).
- **My Schedules:** create/rename/delete/switch; per-schedule isolation of
  selections confirmed; last remaining schedule's delete disabled; 6-schedule
  rapid create then delete-down-to-one clean. 300-char emoji name accepted and
  ellipsized without layout damage. **Duplicate names accepted — filed.**
- **Sidebar:** collapse persists across reload; resources + footer links
  inventoried.
- **Export:** trigger disabled at zero selections; ICS at 1, 2, and 42
  subjects parses with ical.js (42 events = 36 exams + 6 portfolio
  deadlines); DTSTART is floating local (no UTC `Z`); JSON and TXT exports
  contain the selection.
- **Persistence:** reload restore; multi-tab sync (selection in tab A mirrors
  to tab B via storage events); 8 corrupted-storage cases (malformed JSON,
  wrong types, unknown ids, nonexistent active-schedule id, garbage theme)
  all degrade gracefully — no white screen, zero page errors; localStorage
  **disabled** (SecurityError getter) and **quota-full** (QuotaExceededError
  on setItem) both leave the app usable.

### Limit testing (all clean)
- All 42 subjects selected: catalog, List, Calendar (all 3 weeks traversed),
  export menu all responsive; no layout collapse; full-page screenshots in
  this folder.
- No horizontal page scroll at 320 / 375 / 768 / 1024 / 1920 px, in default
  catalog AND all-42 List/Calendar; very short window (1280x450) and 200%
  zoom equivalent (640x450) also clean.
- Offline after load: selection, view switching, export menu all work; zero
  unhandled rejections.
- **Zero console errors and zero page errors across every test above** (every
  page in the harness carried console/pageerror watchers).

### Accessibility audit
- **axe (WCAG 2.x A/AA)**: catalog, all-selected List, Calendar, conflict
  prompt, exam-details dialog, sidebar collapsed — light AND dark — **zero
  violations in all 12 scans** (`axe-*.json`, all empty arrays).
- **Keyboard:** exactly one h1; one main landmark; no heading-level skips;
  exam-details dialog traps focus (30-Tab probe), closes on Escape, restores
  focus to opener; chips toggle with Enter/Space; visible focus ring on
  chips; pager keyboard-operable.
- **Semantics:** subject emoji do not leak into accessible names; calendar
  blocks carry full accessible names ("AP Biology, AM session, 8:00 AM to
  11:00 AM (3 h), plus 30 minutes setup buffer"); conflict state announced in
  text ("unresolved time conflict, action needed"), not color alone.
- **Touch targets at 375px:** flagged List/Calendar/Export pills measure
  32px tall, but each carries a `::before` pseudo-element expanding the hit
  area to 44px (verified via computed style) — **not** a violation; all other
  interactive elements >=44x44.
- Caveats reported honestly: no real screen-reader pass (semantic checks
  only); text-size-only zoom not testable in this harness (viewport-scaled
  200% zoom equivalent used instead).

### External links
- All 51 unique external URLs (42 College Board course/exam pages incl. the 5
  exceptions, sidebar resources, footer) returned **HTTP 200**
  (`link-check.txt`; initial 429s were the checker's own burst rate-limiting,
  each retried individually with 6s spacing).

### Data honesty
- `business-with-personal-finance` details dialog shows the literal
  "pending" for unpublished values — the hard data rule holds.

### Live site
- https://apexamplanner.vercel.app: same conflict-flow behavior as the local
  production build, zero console errors (`live-site-conflict.png`).

## Issues filed
- 1 enhancement: My Schedules accepts duplicate and unbounded-length names
  (see the summary comment on #39 for the number).

## Non-findings (deliberately not filed)
- Conflict prompt hidden in default Calendar view (unresolved blocks carry
  orange "action needed" styling; prompt modal appears on entering List) —
  designed behavior per issue #19 iterations.
- Whitespace-only search showing all subjects — correct interpretation.
- 300-char schedule names ellipsize cleanly — folded into the one filed issue
  as a secondary AC rather than filed separately.
