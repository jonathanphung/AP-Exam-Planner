import { CatalogGrid } from "@/components/CatalogGrid";
import { ScheduleViews } from "@/components/ScheduleViews";
import { Sidebar } from "@/components/Sidebar";

export default function Home() {
  return (
    // max-w-7xl (was 6xl): the #29 sidebar is wider (20rem expanded, so every
    // resource label fits on one line) — the bump keeps the main planner
    // column at least as wide as before the redesign.
    //
    // data-scroll-lock-anchor (issue #49): this is the centered shell whose
    // left edge must not move when a dialog locks background scroll. The
    // scroll-lock hook (src/lib/modal.ts) measures this element's box before
    // and after locking and pins it back to the same pixel, so the fix is
    // position-invariant instead of relying on a browser-specific width
    // inference (which double-compensated in real Chrome — see issue #49).
    <div
      data-scroll-lock-anchor
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:flex-row lg:items-start lg:gap-10 lg:py-10"
    >
      {/* Branded app panel (issue #29): branding + the page h1 live here now
          (the reference-style sidebar replaces the old page header), with the
          My Schedules switcher and the Resources links. Persistent left column
          on desktop; disclosure card near the top on mobile/tablet. */}
      <Sidebar />
      {/* min-w-0: the calendar grid inside ScheduleViews has a min-width;
          without it the flex item would refuse to shrink and push the page
          wider than the viewport at 375px. */}
      <main
        className="flex min-w-0 flex-1 flex-col gap-12"
        aria-label="Exam planner"
      >
        <CatalogGrid />
        <ScheduleViews />
      </main>
    </div>
  );
}
