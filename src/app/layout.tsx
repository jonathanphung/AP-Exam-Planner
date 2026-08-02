import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import {
  BING_SITE_VERIFICATION,
  GOOGLE_SITE_VERIFICATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  siteJsonLd,
} from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/*
 * Site metadata (issue #104). Every string here comes from `src/lib/site.ts`:
 * the origin is written once (so canonical / robots / sitemap / JSON-LD can
 * never drift apart) and the title + description read the cycle label from the
 * dataset accessor rather than hand-writing it.
 *
 * `metadataBase` is what turns the relative `"/"` values below into the
 * absolute URLs the Open Graph spec requires, and it is also what makes the
 * `src/app/opengraph-image.png` file convention emit an absolute `og:image`.
 * That image (plus its `opengraph-image.alt.txt` sidecar) is injected by Next
 * — deliberately NOT listed under `openGraph.images`, so exactly one og:image
 * tag ships and the file stays the single source for the preview card. Next
 * points `twitter:image` at the same asset, so `summary_large_image` needs no
 * second copy of the PNG.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  /*
   * Verification tags (issue #116): each spread contributes its key only when
   * the env var is set, so an unset variable renders no tag rather than an
   * empty one. See the constants' doc in `src/lib/site.ts` for the rollout.
   */
  verification: {
    ...(GOOGLE_SITE_VERIFICATION ? { google: GOOGLE_SITE_VERIFICATION } : undefined),
    ...(BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": BING_SITE_VERIFICATION } }
      : undefined),
  },
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

/*
 * `WebApplication` structured data (issue #104). Serialised once at module
 * scope — the object is static, so there is nothing to recompute per request.
 * `<` is escaped because a `</script>` sequence inside a JSON string would end
 * the block early; the payload has none today, and this keeps it that way if
 * the copy ever grows one.
 */
const JSON_LD = JSON.stringify(siteJsonLd()).replace(/</g, "\\u003c");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Structured data. Renders nothing — no layout or paint impact. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON_LD }}
        />
        {children}
        <Footer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
