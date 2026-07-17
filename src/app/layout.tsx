import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "AP Exam Planner",
  description:
    "Plan your May 2026 AP exam schedule: official dates and sessions, portfolio deadlines, conflict detection, and calendar export.",
};

/*
 * Pre-paint theme script (issue #41). Runs synchronously as the first thing in
 * <body>, BEFORE the app renders, so the stored preference is mapped onto the
 * <html> `.dark` class + `color-scheme` ahead of first paint — no flash of the
 * wrong theme (FOUC). `system` (the default) and an absent/malformed value
 * fall back to `prefers-color-scheme`, matching the store's `parsePreference`.
 * The key string MUST stay in sync with `THEME_STORAGE_KEY` in
 * `src/lib/theme.ts`. Because this mutates <html>, the element carries
 * `suppressHydrationWarning` (React would otherwise flag the server/client
 * className mismatch).
 */
const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("apx.theme.v1");if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
        <Footer />
        <SpeedInsights />
      </body>
    </html>
  );
}
