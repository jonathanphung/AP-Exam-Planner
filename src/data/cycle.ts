import apData from "./ap-2027.json";

/**
 * The one place the app names the exam cycle.
 *
 * The dataset JSON is the annual swap point (PRD §8). Before this module
 * existed, the cycle leaked into hand-written strings — a footer line, an
 * empty-state heading, an export filename, the page description — so an annual
 * swap silently left "May 2026" copy sitting next to 2027 dates. Everything
 * user-visible that names the cycle now reads it from the dataset instead, so
 * the swap re-labels those surfaces with no edit here.
 *
 * Nothing is derived that College Board does not publish: {@link CYCLE} is the
 * dataset's `cycle` field verbatim, and {@link CYCLE_YEAR} is just its year.
 */

/** Dataset cycle label, verbatim — e.g. `"May 2027"`. */
export const CYCLE: string = (apData as { cycle: string }).cycle;

/** Four-digit year of {@link CYCLE} — e.g. `"2027"`. Used for file names. */
export const CYCLE_YEAR: string = CYCLE.split(" ")[1];
