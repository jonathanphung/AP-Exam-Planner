import type { Category } from "../data/schema";

/**
 * Shared design tokens + DOM helpers for the designed PNG export cards (issue
 * #56 + Jon's pre-merge bounce).
 *
 * There are now TWO designed card variants that fan out one PNG per non-empty
 * testing week — the LIST card (`export-png.ts`) and the CALENDAR week-grid
 * card (`export-png-calendar.ts`). They are deliberately "the same export in
 * two formats", so their palette, neutrals, font, off-screen rasterization, and
 * theme handling live here in ONE place rather than being duplicated (and
 * drifting) across the two renderers.
 *
 * Everything here is authored as explicit inline CSS values (hex, px) — no
 * Tailwind utility classes — so `html-to-image`'s style-inlining pass has a
 * concrete value for every property and the export renders identically whether
 * or not the app stylesheet is present. The palette MIRRORS the app's tokens
 * (the issue-#30 pastel category hues in `CalendarView`'s `CATEGORY_STYLES` and
 * the Tailwind slate neutrals) so a card reads as the same product.
 */

export type ExportTheme = "light" | "dark";

export interface ThemeTokens {
  pageBg: string;
  cardBorder: string;
  heading: string;
  body: string;
  muted: string;
  rowBg: string;
  rowBorder: string;
  divider: string;
  /** Inner hour gridlines on the calendar grid (lighter than `divider`). */
  gridLine: string;
  /** Regular-week header accent (app primary blue). */
  regularAccent: string;
  regularHeaderBg: string;
  regularHeaderText: string;
  /** Late-testing header accent (warm amber — distinct from the pastels). */
  lateAccent: string;
  lateHeaderBg: string;
  lateHeaderText: string;
}

export const THEMES: Record<ExportTheme, ThemeTokens> = {
  light: {
    pageBg: "#ffffff",
    cardBorder: "#e2e8f0", // slate-200
    heading: "#0f172a", // slate-900
    body: "#334155", // slate-700
    muted: "#64748b", // slate-500
    rowBg: "#f8fafc", // slate-50
    rowBorder: "#e2e8f0",
    divider: "#e2e8f0",
    gridLine: "#f1f5f9", // slate-100
    regularAccent: "#2563eb", // blue-600 (app primary)
    regularHeaderBg: "#eff6ff", // blue-50
    regularHeaderText: "#1e3a8a", // blue-900
    lateAccent: "#d97706", // amber-600
    lateHeaderBg: "#fffbeb", // amber-50
    lateHeaderText: "#92400e", // amber-800
  },
  dark: {
    pageBg: "#020618", // slate-950
    cardBorder: "#1e293b", // slate-800
    heading: "#f1f5f9", // slate-100
    body: "#cbd5e1", // slate-300
    muted: "#94a3b8", // slate-400
    rowBg: "#0f172a", // slate-900
    rowBorder: "#1e293b",
    divider: "#1e293b",
    gridLine: "#1e293b", // slate-800
    regularAccent: "#60a5fa", // blue-400
    regularHeaderBg: "#172554", // blue-950
    regularHeaderText: "#bfdbfe", // blue-200
    lateAccent: "#fb923c", // warm amber/orange-400
    lateHeaderBg: "#451a03", // amber-950
    lateHeaderText: "#fde68a", // amber-200
  },
};

export interface CategoryPaletteEntry {
  /** Accent dot / left border. */
  accent: string;
  /** Soft chip / block fill. */
  fill: string;
  /** On-fill text. */
  text: string;
}

/**
 * Category → { accent, fill, text }. MIRRORS the issue-#30 pastel palette in
 * `CalendarView`'s `CATEGORY_STYLES` (the single design source) so the export
 * reads as the same product. Duplicated here as explicit hex — not imported —
 * because those live as Tailwind class strings inside a client component, and
 * this DOM library must not depend on it.
 */
export const CATEGORY_PALETTE: Record<
  ExportTheme,
  Record<Category, CategoryPaletteEntry>
> = {
  light: {
    STEM: { accent: "#5E74C0", fill: "#C7CEEA", text: "#28345E" },
    Humanities: { accent: "#CBA53A", fill: "#F7DC8D", text: "#5C4708" },
    Languages: { accent: "#7EB84A", fill: "#C9E89B", text: "#38541A" },
    Arts: { accent: "#EF5D6A", fill: "#FF9AA2", text: "#7A1E28" },
    "Career Kickstart": { accent: "#9866C0", fill: "#CDB4DB", text: "#4A2C63" },
  },
  dark: {
    STEM: { accent: "#8296DC", fill: "#2A3458", text: "#DCE3F7" },
    Humanities: { accent: "#E3C766", fill: "#52420F", text: "#F6E6A8" },
    Languages: { accent: "#A0D172", fill: "#2B4A1C", text: "#DCEFBE" },
    Arts: { accent: "#F98A93", fill: "#52222A", text: "#FBC7CC" },
    "Career Kickstart": { accent: "#B98FD8", fill: "#402A58", text: "#E4CFF0" },
  },
};

export const NEUTRAL_ACCENT: Record<ExportTheme, string> = {
  light: "#94a3b8", // slate-400
  dark: "#475569", // slate-600
};

export const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const DEFAULT_FOOTER_URL = "apexamplanner.vercel.app";

export type Style = Partial<CSSStyleDeclaration>;

/** Tiny DOM builder: element + inline style + optional text. */
export function el(tag: string, style: Style, text?: string): HTMLElement {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Accent color for a (possibly-unknown) category in the given theme. */
export function categoryAccent(
  category: Category | null,
  theme: ExportTheme,
): string {
  return category ? CATEGORY_PALETTE[theme][category].accent : NEUTRAL_ACCENT[theme];
}

/**
 * Rasterize a designed card node to a solid-background PNG blob at
 * `pixelRatio: 2`. Shared by both card variants.
 *
 * Positioning goes on a WRAPPER, never the captured node: `html-to-image`
 * clones the node's own inline styles into its SVG `<foreignObject>`, so a
 * `position: fixed; left: -100000px` on the node itself would push the whole
 * card off the capture canvas and rasterize a blank image. The wrapper holds
 * it off-screen while the un-positioned card renders at the origin; it never
 * flashes on screen and never affects page layout.
 */
export async function captureCardPng(
  node: HTMLElement,
  theme: ExportTheme,
): Promise<Blob> {
  // Imported lazily so this module (and the pure card MODELS that only need the
  // palette) never pull the DOM-only `html-to-image` dependency at import time.
  const { toBlob } = await import("html-to-image");
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-100000px";
  holder.style.top = "0";
  holder.style.pointerEvents = "none";
  holder.appendChild(node);
  document.body.appendChild(holder);
  try {
    const blob = await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: THEMES[theme].pageBg,
    });
    if (!blob) {
      throw new Error("PNG rasterization produced no image data");
    }
    return blob;
  } finally {
    holder.remove();
  }
}
