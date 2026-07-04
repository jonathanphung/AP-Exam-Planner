import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AP Exam Planner",
  description:
    "Plan your May 2026 AP exam schedule: official dates and sessions, portfolio deadlines, conflict detection, and calendar export.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
