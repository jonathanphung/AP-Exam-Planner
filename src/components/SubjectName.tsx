import type { Category } from "@/data/schema";
import { emojiForSubject } from "@/lib/subject-emoji";

/**
 * Renders a subject's decorative emoji (issue #20) followed by its name, from
 * the single source of truth in `src/lib/subject-emoji.ts`.
 *
 * Used at every surface that shows a subject name (catalog grid, schedule list,
 * info panel, conflict dialog), so all agree and a single map edit updates them
 * all. The component owns the assistive-tech contract: the emoji span is
 * `aria-hidden`, so a screen reader announces only "AP Biology", never
 * "AP Biology dna double helix" (AC3). Callers keep their own text styling on
 * the wrapping element; this only injects the leading glyph + a space.
 */
interface SubjectNameProps {
  /** Subject id — primary key into the emoji map. */
  id: string;
  /** Visible subject name (already the plain, sourced dataset name). */
  name: string;
  /** Category, used only for the fallback emoji when `id` is unmapped. */
  category?: Category;
}

export function SubjectName({ id, name, category }: SubjectNameProps) {
  const emoji = emojiForSubject({ id, category });
  return (
    <>
      <span aria-hidden="true" className="select-none">
        {emoji}
      </span>{" "}
      {name}
    </>
  );
}
