import {
  weekCardNotes,
  type WeekCard,
  type WeekCardNote,
  type WeekCardRow,
} from "./week-cards";
import { EXAM_NOTE_LABEL } from "./schedule";
import {
  captureCardPng,
  categoryAccent,
  DEFAULT_FOOTER_URL,
  el,
  FONT_STACK,
  THEMES,
  type ExportTheme,
  type ThemeTokens,
} from "./export-card-theme";

export type { ExportTheme };

/**
 * Per-week LIST-view PNG schedule cards (issue #56; decluttered per Jon's
 * pre-merge bounce) — the DOM + pixel layer.
 *
 * This REPLACED issue #51's `captureSchedulePng`, which screenshotted whatever
 * view was on screen. There is no "screenshot the current view" behavior any
 * more: we build a deliberately DESIGNED card node per testing week (see
 * `week-cards.ts` for which weeks emit and what their rows are) and rasterize
 * THAT node. One layout, N renders — a single design that can't drift into a
 * second implementation.
 *
 * The menu now offers TWO designed variants — this LIST card and the CALENDAR
 * week-grid card (`export-png-calendar.ts`). Their shared palette, neutrals,
 * font, and off-screen rasterization live in `export-card-theme.ts` so the two
 * read as the same export in two formats.
 *
 * Declutter (Jon's bounce): each exam row shows the subject name (with a small
 * leading category-color dot as a minimal accent), the day/session/clock, and
 * nothing else. The old category chip ("STEM"/"Humanities"/…) and the "Moved to
 * late testing" pill are GONE: the chip only ate horizontal room, and a moved
 * exam already appears on its own "Late Testing" week card, so its placement
 * there is the signal — no information is lost.
 *
 * Note budget (issue #91): a row is identity + timing + at most a one-line note
 * MARKER. The verbatim note text — the portfolio submission notes and the
 * published exam qualifier — lives in the card's "Notes" strip below the rows,
 * printed once per distinct note and attributed to every subject that carries
 * it. Before this, each row inlined both strings in full: the 310-character
 * PPR note is byte-identical across all six AP language subjects, so a
 * six-language card printed the same paragraph six times and the May dates the
 * card exists to communicate were the smallest thing on it. The calendar
 * variant reached the same shape from the other direction (#71's "Published
 * notes" strip), so the two exports now defer notes the same way.
 *
 * Rasterization mechanism (builder decision, issue #56) — an off-screen DOM
 * node + `html-to-image`, NOT a hand-drawn `<canvas>`: the card is authored in
 * ordinary DOM/CSS (readable, tweakable) with fully INLINE styles, and
 * `toBlob` clones the node, inlines its styles through an SVG `<foreignObject>`,
 * and paints it to a canvas. See `captureCardPng` in `export-card-theme.ts`.
 *
 * Fidelity + guarantees carried over from #51: `pixelRatio: 2` (crisp on HiDPI
 * / when pasted into docs), a solid per-theme background (never transparent),
 * and fully client-side / zero network (system-font stack, no external images,
 * so the style/font inlining fetches nothing).
 */

export interface WeekCardRenderOptions {
  /** Active theme — decides the card's palette + the solid PNG background. */
  theme: ExportTheme;
  /** Dataset cycle, e.g. "May 2027" (shown in the header). */
  cycle: string;
  /** Active schedule name, shown in the footer (e.g. "Schedule 1"). */
  scheduleName: string;
  /** Selected subjects with no dated exam — surfaced as a footnote, never dropped. */
  undatedNames: readonly string[];
  /** Credit line so a shared card is traceable back to the app. */
  footerUrl?: string;
}

/** Fixed card width — a comfortable share/paste width (px, pre-pixelRatio). */
const CARD_WIDTH = 680;

/**
 * Row-marker / notes-strip label for a portfolio submission note (issue #91).
 *
 * The sibling of {@link EXAM_NOTE_LABEL}, and written to the same rule: the
 * label only NAMES what the text is, it never paraphrases or summarises it.
 * Export-local because the on-screen list view has room to print the note in
 * place and needs no marker — only the fixed-width rasterized card does.
 */
export const PORTFOLIO_NOTE_LABEL = "Portfolio note";

/** The printed label for each note kind — the only kind→copy mapping. */
const NOTE_LABEL: Record<WeekCardNote["kind"], string> = {
  portfolio: PORTFOLIO_NOTE_LABEL,
  exam: EXAM_NOTE_LABEL,
};

/** The right-hand "when" descriptor for a row (day · session · clock). */
function rowWhen(row: WeekCardRow): string {
  const parts: string[] = [`${row.weekday}, ${row.monthDay}`];
  if (row.kind === "portfolio") {
    parts.push("Portfolio deadline");
    return parts.join("  ·  ");
  }
  if (row.session) parts.push(`${row.session} session`);
  if (row.startClock) {
    parts.push(
      row.endClock
        ? `${row.startClock} – ${row.endClock}`
        : `${row.startClock} · length pending`,
    );
  } else if (row.lengthPending) {
    parts.push("length pending");
  }
  return parts.join("  ·  ");
}

/**
 * One decluttered row: a color accent bar + a leading category dot + the
 * subject name and any note MARKER (left), and the day / session / clock
 * descriptor (right). No category chip and no "Moved to late testing" pill
 * (Jon's bounce), and no verbatim note paragraph (issue #91 — see the marker
 * comment below).
 */
function renderRow(
  row: WeekCardRow,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement {
  const accent = categoryAccent(row.category, theme);

  const wrapper = el("div", {
    display: "flex",
    alignItems: "stretch",
    gap: "14px",
    padding: "12px 16px",
    background: tokens.rowBg,
    border: `1px solid ${tokens.rowBorder}`,
    borderLeft: `4px solid ${accent}`,
    borderRadius: "10px",
  });

  // Left: leading category dot + subject name (+ any note marker).
  const left = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 auto",
    minWidth: "0",
  });

  const nameRow = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: "0",
  });
  const dot = el("span", {
    width: "10px",
    height: "10px",
    borderRadius: "9999px",
    background: accent,
    flex: "0 0 auto",
  });
  const name = el(
    "span",
    {
      fontSize: "16px",
      fontWeight: "600",
      color: tokens.heading,
      lineHeight: "1.2",
    },
    row.subjectName,
  );
  nameRow.append(dot, name);
  left.append(nameRow);

  // Note MARKERS, not the notes (issue #91). Issue #71 printed the published
  // qualifier here in full, reasoning that "a PNG has no popup or tooltip to
  // defer it to". That requirement — the text is never lost on the one surface
  // with no interaction — still holds and is still met: the verbatim text now
  // sits in the card's notes strip a few centimetres below, printed ONCE per
  // distinct note. What changed is that the row is no longer the place for it.
  // Inline, the portfolio note (310 chars for all six AP language subjects,
  // byte-identical) wrapped to five or six 12px lines PER ROW and buried the
  // May dates the card was exported for. The marker is the same construction
  // the calendar block face has used since #71 — a short derived label naming
  // what the text IS, never a paraphrase of it.
  const markers: string[] = [];
  if (row.note) markers.push(PORTFOLIO_NOTE_LABEL);
  if (row.examNote) markers.push(EXAM_NOTE_LABEL);
  if (markers.length > 0) {
    left.append(
      el(
        "span",
        {
          fontSize: "11px",
          fontStyle: "italic",
          fontWeight: "500",
          color: tokens.muted,
          lineHeight: "1.3",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        markers.join("  ·  "),
      ),
    );
  }

  // Right: the day / session / clock descriptor.
  const when = el(
    "div",
    {
      flex: "0 0 auto",
      textAlign: "right",
      fontSize: "13px",
      fontWeight: "500",
      color: tokens.body,
      lineHeight: "1.4",
      whiteSpace: "nowrap",
    },
    rowWhen(row),
  );

  wrapper.append(left, when);
  return wrapper;
}

/**
 * "Notes" strip (issue #91) — the verbatim text every row above deferred, each
 * distinct note printed ONCE and attributed to every subject that carries it.
 *
 * Construction: the card's own undated-footnote idiom (dashed rule + muted
 * 12px), holding the calendar card's "Published notes" content model
 * (`renderNotesStrip` in `export-png-calendar.ts`). The two variants deliberately
 * differ in ONE way: this strip also carries portfolio notes, because the list
 * card is where portfolio deadlines get a full row, whereas the calendar puts
 * them in its off-grid strip under a derived label. Hence the heading is the
 * honest superset "Notes" rather than the calendar's `Published notes` — the
 * per-entry label ({@link NOTE_LABEL}) says which kind each entry is.
 *
 * Returns null when the card has no notes, so a card of plain exams gets no
 * empty strip.
 */
function renderNotesStrip(
  notes: readonly WeekCardNote[],
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement | null {
  if (notes.length === 0) return null;

  const strip = el("div", {
    marginTop: "6px",
    paddingTop: "12px",
    borderTop: `1px dashed ${tokens.divider}`,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  });
  strip.append(
    el(
      "div",
      { fontSize: "13px", fontWeight: "600", color: tokens.body },
      "Notes",
    ),
  );

  const list = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });
  for (const note of notes) {
    const row = el("div", {
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      fontSize: "12px",
      lineHeight: "1.4",
      color: tokens.muted,
      minWidth: "0",
    });
    row.append(
      el("span", {
        width: "8px",
        height: "8px",
        borderRadius: "9999px",
        background: categoryAccent(note.category, theme),
        flex: "0 0 auto",
        marginTop: "5px",
      }),
    );
    const text = el("span", { minWidth: "0" });
    // "<subjects> — <label>: <verbatim>". The label sits INSIDE the sentence
    // (not only in the heading) so `Published note: <text>` stays contiguous —
    // #71's disclosure contract, which e2e/issue-71-qa.spec.ts pins on the
    // rasterized DOM.
    text.append(
      el(
        "span",
        { fontWeight: "600", color: tokens.body },
        `${note.subjectNames.join(", ")} — `,
      ),
    );
    text.append(
      el(
        "span",
        { fontWeight: "600", color: tokens.body },
        `${NOTE_LABEL[note.kind]}: `,
      ),
    );
    text.append(el("span", {}, note.text));
    row.append(text);
    list.append(row);
  }
  strip.append(list);
  return strip;
}

/**
 * Build the designed list-card DOM node for one week. Pure DOM (not attached) —
 * the caller attaches it off-screen for rasterization.
 */
export function renderWeekCardNode(
  card: WeekCard,
  options: WeekCardRenderOptions,
): HTMLElement {
  const tokens = THEMES[options.theme];
  const accent = card.late ? tokens.lateAccent : tokens.regularAccent;
  const headerBg = card.late ? tokens.lateHeaderBg : tokens.regularHeaderBg;
  const headerText = card.late
    ? tokens.lateHeaderText
    : tokens.regularHeaderText;

  const root = el("div", {
    boxSizing: "border-box",
    width: `${CARD_WIDTH}px`,
    background: tokens.pageBg,
    padding: "28px",
    fontFamily: FONT_STACK,
    color: tokens.body,
  });

  const cardBox = el("div", {
    boxSizing: "border-box",
    border: `1px solid ${tokens.cardBorder}`,
    borderTop: `5px solid ${accent}`,
    borderRadius: "16px",
    overflow: "hidden",
  });

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el("div", {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "20px 24px",
    background: headerBg,
  });

  const headerLeft = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  const identity = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  });
  identity.append(
    el(
      "span",
      { fontSize: "22px", fontWeight: "700", color: tokens.heading },
      card.label,
    ),
  );
  headerLeft.append(identity);
  headerLeft.append(
    el(
      "span",
      { fontSize: "15px", fontWeight: "600", color: headerText },
      card.rangeLabel,
    ),
  );
  headerLeft.append(
    el(
      "span",
      { fontSize: "13px", color: tokens.muted },
      `${options.cycle} AP Exams`,
    ),
  );

  const examCount = card.rows.filter((r) => r.kind === "exam").length;
  const countText =
    examCount > 0
      ? `${examCount} exam${examCount === 1 ? "" : "s"}`
      : `${card.rows.length} item${card.rows.length === 1 ? "" : "s"}`;
  const headerRight = el(
    "div",
    {
      flex: "0 0 auto",
      alignSelf: "center",
      textAlign: "right",
      fontSize: "13px",
      fontWeight: "600",
      color: headerText,
    },
    countText,
  );

  header.append(headerLeft, headerRight);
  cardBox.append(header);

  // ── Body: rows ─────────────────────────────────────────────────────────────
  const body = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "20px 24px",
    background: tokens.pageBg,
  });
  for (const row of card.rows) {
    body.append(renderRow(row, tokens, options.theme));
  }

  // Notes strip — the verbatim text the rows deferred, de-duplicated (#91).
  const notesStrip = renderNotesStrip(
    weekCardNotes(card.rows),
    tokens,
    options.theme,
  );
  if (notesStrip) body.append(notesStrip);

  // Undated footnote — a selection is never silently dropped.
  if (options.undatedNames.length > 0) {
    body.append(
      el(
        "div",
        {
          marginTop: "6px",
          paddingTop: "12px",
          borderTop: `1px dashed ${tokens.divider}`,
          fontSize: "12px",
          color: tokens.muted,
          lineHeight: "1.4",
        },
        `Also selected (no ${options.cycle} date): ${options.undatedNames.join(", ")}`,
      ),
    );
  }
  cardBox.append(body);

  // ── Footer: credit + schedule name ─────────────────────────────────────────
  const footer = el("div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 24px",
    borderTop: `1px solid ${tokens.divider}`,
    background: tokens.pageBg,
    fontSize: "12px",
    color: tokens.muted,
  });
  footer.append(
    el("span", { fontWeight: "600", color: tokens.body }, options.scheduleName),
  );
  footer.append(el("span", {}, options.footerUrl ?? DEFAULT_FOOTER_URL));
  cardBox.append(footer);

  root.append(cardBox);
  return root;
}

/**
 * Rasterize one week LIST card to a solid-background PNG blob at `pixelRatio: 2`.
 */
export async function captureWeekCardPng(
  card: WeekCard,
  options: WeekCardRenderOptions,
): Promise<Blob> {
  const node = renderWeekCardNode(card, options);
  return captureCardPng(node, options.theme);
}
