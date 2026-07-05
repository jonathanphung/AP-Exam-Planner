import { CatalogGrid } from "@/components/CatalogGrid";
import { ScheduleView } from "@/components/ScheduleView";

export default function Home() {
  return (
    <>
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            AP Exam Planner
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Find your AP subjects and build your &ldquo;My Exams&rdquo; list.
          </p>
        </div>
      </header>
      <main
        className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-10"
        aria-label="Exam planner"
      >
        <CatalogGrid />
        <ScheduleView />
      </main>
    </>
  );
}
