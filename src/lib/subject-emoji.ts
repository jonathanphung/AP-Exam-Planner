import type { Category } from "@/data/schema";

/**
 * Decorative subject emoji — single source of truth (issue #20).
 *
 * A purely visual aid: a topically relevant emoji shown next to each subject
 * name so the catalog and schedules are faster to scan. It is NOT College Board
 * data, so — per the PROJECT.md data rule (the annually-swapped
 * `src/data/ap-2026.json` holds only sourced values, `"pending"` for anything
 * unpublished) — it deliberately lives here in a pure `src/lib` lookup, keyed by
 * subject `id`, rather than as a field in the sourced dataset. This keeps the
 * emoji out of the annual data swap and off the `"pending"` rule entirely.
 *
 * Every rendered surface resolves its emoji through {@link emojiForSubject}, so
 * adding or changing one entry here updates the catalog grid, schedule list,
 * info panel, conflict dialog (and the future calendar view, issue #19) at once.
 *
 * Coverage is complete for every subject shipped in `ap-2026.json` (a unit test
 * pins this); a category fallback guarantees any future/unmapped subject still
 * renders a sensible emoji instead of a blank. Glyphs are broadly-supported,
 * unambiguous codepoints (no skin-tone modifiers, nothing niche that renders as
 * tofu on older systems).
 */

/** Hand-picked emoji per subject `id`. Complete for the shipped dataset. */
export const SUBJECT_EMOJI: Readonly<Record<string, string>> = {
  // STEM
  biology: "🧬",
  "calculus-ab": "➗",
  "calculus-bc": "♾️",
  chemistry: "🧪",
  "computer-science-a": "💻",
  "computer-science-principles": "🖥️",
  "environmental-science": "🌱",
  "physics-1": "⚛️",
  "physics-2": "🌡️",
  "physics-c-electricity-and-magnetism": "🧲",
  "physics-c-mechanics": "⚙️",
  precalculus: "📐",
  statistics: "📊",

  // Humanities
  "african-american-studies": "✊",
  "comparative-government-and-politics": "🏛️",
  "english-language-and-composition": "✍️",
  "english-literature-and-composition": "📖",
  "european-history": "🏰",
  "human-geography": "🗺️",
  macroeconomics: "🏦",
  microeconomics: "🛒",
  psychology: "🧠",
  research: "🔎",
  seminar: "💬",
  "united-states-government-and-politics": "🇺🇸",
  "united-states-history": "🗽",
  "world-history-modern": "🌍",

  // Languages
  "chinese-language-and-culture": "🇨🇳",
  "french-language-and-culture": "🇫🇷",
  "german-language-and-culture": "🇩🇪",
  "italian-language-and-culture": "🇮🇹",
  "japanese-language-and-culture": "🇯🇵",
  latin: "📜",
  "spanish-language-and-culture": "🇪🇸",
  "spanish-literature-and-culture": "📚",

  // Arts
  "art-history": "🖼️",
  "music-theory": "🎼",
  "2-d-art-and-design": "🎨",
  "3-d-art-and-design": "🏺",
  drawing: "✏️",

  // Career Kickstart
  "business-with-personal-finance": "💼",
  cybersecurity: "🛡️",
};

/**
 * Fallback by category for any subject id not in {@link SUBJECT_EMOJI} — e.g. a
 * subject added to a future dataset before its bespoke emoji is picked. Keeps
 * coverage total so a name never renders blank.
 */
export const CATEGORY_EMOJI: Readonly<Record<Category, string>> = {
  STEM: "🔬",
  Humanities: "📚",
  Languages: "🗣️",
  Arts: "🎨",
  "Career Kickstart": "💼",
};

/** Last-resort glyph if a subject has neither a mapped id nor a known category. */
export const FALLBACK_EMOJI = "🎓";

/**
 * Resolve the decorative emoji for a subject. Prefers the hand-picked per-id
 * emoji; falls back to the subject's category; finally to a generic glyph.
 * Always returns a non-empty string.
 */
export function emojiForSubject(subject: {
  id: string;
  category?: Category;
}): string {
  const direct = SUBJECT_EMOJI[subject.id];
  if (direct) return direct;
  if (subject.category) {
    const byCategory = CATEGORY_EMOJI[subject.category];
    if (byCategory) return byCategory;
  }
  return FALLBACK_EMOJI;
}
