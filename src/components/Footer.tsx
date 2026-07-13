import apData from "@/data/ap-2026.json";
import { SupportLinks } from "@/components/SupportLinks";

// Read the cycle from the dataset so the annual swap (a future `ap-2027.json`)
// re-labels the attribution automatically — the JSON stays the single swap
// point, mirroring how ScheduleView derives its banner from `dataset.cycle`.
const CYCLE = (apData as { cycle: string }).cycle;

/**
 * Site-wide footer: the support pair (mobile/tablet), data attribution, and a
 * plain non-affiliation notice.
 *
 * It deliberately does NOT repeat the schedule's coordinator note
 * (`COORDINATOR_NOTE` in ConflictDialog) — that disclaimer is specific to the
 * late-testing swap flow and already renders inside ScheduleView (#5).
 *
 * Issue #60 — Option A of the card's two mobile options: below `lg`, "Send us
 * Feedback" + the GitHub mark render HERE instead of as a third row inside the
 * sidebar card. Chosen over Option B ("adjacent to the footer") because the
 * footer's centered block is the page's existing chrome slot — a detached
 * full-width row directly above it would read as a stray band between the
 * planner and the footer. At `lg` this instance is `display: none` (the desktop
 * copy is pinned to the bottom of the sidebar column), so exactly one of each
 * control is in the accessibility tree at any viewport.
 *
 * The support pair renders as the **quiet meta row** (Jon bounce, pass 1):
 * BELOW the attribution copy, no divider rule, one small muted centered line in
 * the footer's own type. The first cut put it *above* the attribution behind a
 * hairline — which manufactured a section boundary the content doesn't earn and
 * made the pair read as two stray controls competing with the footer. Reading
 * order now goes attribution → non-affiliation notice → support row, and the
 * separation is carried by spacing alone.
 *
 * `Footer` itself stays a server component (it reads `apData` at build time);
 * `SupportLinks` is the "use client" island it embeds.
 */
export function Footer() {
  return (
    <footer
      data-testid="site-footer"
      className="mt-auto border-t border-slate-200 dark:border-slate-800"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-6 text-center text-xs text-slate-600 dark:text-slate-400">
        <div className="flex flex-col gap-1">
          <p className="break-words">
            {`Data: College Board AP calendar and score-distribution reports — ${CYCLE} cycle`}
          </p>
          <p>Not affiliated with College Board.</p>
        </div>

        {/* Support pair — mobile/tablet only (`lg:hidden`), the quiet meta row.
            No rule: the gap alone separates it from the copy above. `-mb-2`
            claws back part of the padding that grows the controls' hit areas to
            ≥44px, so the footer's own `py-6` still reads as the bottom breathing
            room instead of doubling up. */}
        <SupportLinks
          variant="footer"
          testId="footer-support-links"
          className="mt-1 -mb-2 flex items-center justify-center lg:hidden"
        />
      </div>
    </footer>
  );
}
