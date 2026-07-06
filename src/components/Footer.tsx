import apData from "@/data/ap-2026.json";

// Read the cycle from the dataset so the annual swap (a future `ap-2027.json`)
// re-labels the attribution automatically — the JSON stays the single swap
// point, mirroring how ScheduleView derives its banner from `dataset.cycle`.
const CYCLE = (apData as { cycle: string }).cycle;

/**
 * Site-wide footer: data attribution + a plain non-affiliation notice.
 *
 * It deliberately does NOT repeat the schedule's coordinator note
 * (`COORDINATOR_NOTE` in ConflictDialog) — that disclaimer is specific to the
 * late-testing swap flow and already renders inside ScheduleView (#5).
 */
export function Footer() {
  return (
    <footer
      data-testid="site-footer"
      className="mt-auto border-t border-slate-200 dark:border-slate-800"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-6 text-center text-xs text-slate-600 dark:text-slate-400">
        <p className="break-words">
          {`Data: College Board AP calendar and score-distribution reports — ${CYCLE} cycle`}
        </p>
        <p>Not affiliated with College Board.</p>
      </div>
    </footer>
  );
}
