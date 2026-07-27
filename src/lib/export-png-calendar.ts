import { CATEGORIES, type Category } from "../data/schema";
import type { CalendarCard, CalendarOffGridRow } from "./calendar-cards";
import {
  hourLabel,
  monthDayLabel,
  SETUP_BUFFER_MINUTES,
  weekdayLabel,
  type CalendarBlock,
  type CalendarWeekLayout,
} from "./calendar";
import { EXAM_NOTE_LABEL } from "./schedule";
import {
  captureCardPng,
  CATEGORY_PALETTE,
  DEFAULT_FOOTER_URL,
  el,
  FONT_STACK,
  NEUTRAL_ACCENT,
  THEMES,
  type ExportTheme,
  type ThemeTokens,
} from "./export-card-theme";

/**
 * Per-week CALENDAR-view PNG card (Jon's pre-merge bounce on issue #56) — the
 * DOM + pixel layer for the week-grid variant.
 *
 * Renders one designed week grid per non-empty testing week (see
 * `calendar-cards.ts` for the pure model), visually mirroring the site's
 * Calendar view (issue #19): day columns, an hourly time axis down the left,
 * and category-colored exam blocks positioned at their start hour spanning
 * their published duration (plus the same setup-buffer segment the site shows),
 * a category legend, and a "Not placed on the grid" strip for off-grid
 * deadlines / unplaceable entries. It shares the palette, neutrals, font,
 * theme, and off-screen rasterization with the LIST card via
 * `export-card-theme.ts`, so the two variants read as the same export.
 *
 * Fidelity mirrors the site's grid metrics ({@link HOUR_PX} etc.) so the export
 * and the on-screen view line up. As with the list card, everything is authored
 * as explicit inline CSS (no Tailwind), `pixelRatio: 2`, solid per-theme
 * background, fully client-side / zero network.
 *
 * Week 0 treatment (issue #97): the deadlines card has no window, so it has no
 * grid, no legend, and no published-notes strip (those describe exam blocks) —
 * only the deadline list, under its own heading, at the list card's width. This
 * is the "strip-only card" the ticket left to the builder: a grid whose every
 * cell is empty would be chrome pretending to be data, and the alternative
 * (leaving deadlines on Week 1) is the defect being fixed.
 *
 * Late-testing treatment: the header reuses the export's amber late tokens
 * (same as the list card) rather than the site's violet badge, so the two PNG
 * variants stay consistent with EACH OTHER while still marking the late week as
 * visually distinct.
 */

export interface CalendarCardRenderOptions {
  /** Active theme — decides the palette + the solid PNG background. */
  theme: ExportTheme;
  /** Dataset cycle, e.g. "May 2027" (shown in the header). */
  cycle: string;
  /** Active schedule name, shown in the footer. */
  scheduleName: string;
  /** Selected subjects with no dated exam — listed off-grid, never dropped. */
  undatedNames: readonly string[];
  /** Credit line so a shared card is traceable back to the app. */
  footerUrl?: string;
}

/** Pixel height of one axis hour — mirrors CalendarView's grid metric. */
const HOUR_PX = 44;
/** Vertical breathing gap absorbed by the buffer segment (mirrors the site). */
const BLOCK_GAP_PX = 4;

/*
 * ── Block-face height budget (issue #74) ──────────────────────────────────
 * Mirrors {@link nameLineBudget} in src/components/CalendarView.tsx with THIS
 * renderer's metrics (11px/1.2 body, 10px markers, 4px padding, 2px/1px row
 * gaps) — the two faces are deliberately kept in sync, see `QA-V2-4` in
 * e2e/issue-71-qa-v2.spec.ts.
 */
/** One line of the name / clock rows: 11px × the node's 1.2 line-height. */
const FACE_LINE_PX = 13.2;
/** One marker row: 10px × 1.2. */
const FACE_MARKER_PX = 12;
/** Gap above the clock row. */
const FACE_ROW_GAP_PX = 2;
/** Gap above a marker row. */
const FACE_MARKER_GAP_PX = 1;
/** The exam segment's vertical padding (top + bottom). */
const FACE_PAD_Y_PX = 8;
/** The clock keeps a two-line cap here too, so the budget reserves both. */
const CLOCK_MAX_LINES = 2;
/** Floor for the name budget — never fewer lines than the pre-#74 fixed cap. */
const NAME_MIN_LINES = 2;

/** Whole lines of subject name this block's face can afford (see above). */
function nameLineBudget(
  examHeight: number,
  hasQualifier: boolean,
  hasSecondaryMarkers: boolean,
): number {
  const reservedBelowName =
    FACE_ROW_GAP_PX +
    CLOCK_MAX_LINES * FACE_LINE_PX +
    (hasQualifier ? FACE_MARKER_GAP_PX + FACE_MARKER_PX : 0) +
    (hasSecondaryMarkers ? FACE_MARKER_GAP_PX + FACE_MARKER_PX : 0);
  return Math.max(
    NAME_MIN_LINES,
    Math.floor((examHeight - FACE_PAD_Y_PX - reservedBelowName) / FACE_LINE_PX),
  );
}

/** Time-axis gutter width (the site's 3.5rem). */
const AXIS_W = 56;
/** Fixed day-column width (px) — wide enough for a subject name + clock. */
const DAY_W = 132;

const ROOT_PAD = 28;
const BODY_PAD_X = 24;
/**
 * Width of the grid-less Week 0 deadlines card (issue #97) — the LIST card's
 * `CARD_WIDTH`, kept in sync deliberately so the two variants' deadlines cards
 * are the same shape.
 */
const DEADLINES_CARD_WIDTH = 680;

/** Category → block colors for the given theme (null category → neutral). */
function blockColors(
  category: Category | null,
  theme: ExportTheme,
): { fill: string; text: string; accent: string } {
  if (!category) {
    return {
      fill: THEMES[theme].rowBg,
      text: THEMES[theme].body,
      accent: NEUTRAL_ACCENT[theme],
    };
  }
  const c = CATEGORY_PALETTE[theme][category];
  return { fill: c.fill, text: c.text, accent: c.accent };
}

/** One positioned exam block (mirrors CalendarView's ExamBlock content). */
function renderBlock(
  block: CalendarBlock,
  axisStartHour: number,
  theme: ExportTheme,
): HTMLElement {
  const { fill, text, accent } = blockColors(block.category, theme);
  const top = (block.startHour - axisStartHour) * HOUR_PX + 1;
  const examHeight = (block.endHour - block.startHour) * HOUR_PX;
  const bufferHeight = (SETUP_BUFFER_MINUTES / 60) * HOUR_PX - BLOCK_GAP_PX;
  const cellInner = DAY_W - 1; // day cell has a 1px left border
  const laneWidth = cellInner / block.laneCount;
  const left = block.laneIndex * laneWidth + 1;
  const width = laneWidth - 3;

  const node = el("div", {
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${examHeight + bufferHeight}px`,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: "6px",
    borderLeft: `4px solid ${accent}`,
    background: fill,
    color: text,
    fontSize: "11px",
    lineHeight: "1.2",
  });

  // Exam segment (labeled portion = published span).
  const examSeg = el("div", {
    boxSizing: "border-box",
    height: `${examHeight}px`,
    overflow: "hidden",
    padding: "4px 6px",
    display: "flex",
    flexDirection: "column",
  });
  // Row order AND the height budget mirror the site's block face exactly (see
  // the ORDERING CONTRACT in src/components/CalendarView.tsx): the segment is a
  // fixed height with `overflow: hidden`, so the qualifier marker goes ABOVE the
  // markers that a non-text cue already carries, the secondary markers share one
  // line so the stack cannot grow with their count, every row below the name is
  // `flex-shrink: 0` (reserved), and the name spends the whole lines that are
  // left over instead of a fixed two-line cap.
  const secondaryMarkers = [
    block.movedToLate ? "Moved to late testing" : null,
    block.approximate ? "Length pending" : null,
  ].filter((marker): marker is string => marker !== null);
  const nameLines = nameLineBudget(
    examHeight,
    Boolean(block.examNote),
    secondaryMarkers.length > 0,
  );
  examSeg.append(
    el(
      "div",
      {
        fontWeight: "600",
        wordBreak: "break-word",
        flexShrink: "0",
        // `maxHeight` alongside the clamp: `html-to-image` rasterizes through a
        // cloned, style-inlined subtree, so the budget must hold even if the
        // vendor-prefixed clamp does not survive the round trip.
        maxHeight: `${nameLines * FACE_LINE_PX}px`,
        overflow: "hidden",
        display: "-webkit-box",
        webkitBoxOrient: "vertical",
        webkitLineClamp: `${nameLines}`,
      },
      block.subjectName,
    ),
  );
  examSeg.append(
    el(
      "div",
      {
        marginTop: `${FACE_ROW_GAP_PX}px`,
        flexShrink: "0",
        // Same two-line cap the site's clock row carries, ellipsis included, so
        // a narrow lane truncates identically in both renderers.
        maxHeight: `${CLOCK_MAX_LINES * FACE_LINE_PX}px`,
        overflow: "hidden",
        display: "-webkit-box",
        webkitBoxOrient: "vertical",
        webkitLineClamp: `${CLOCK_MAX_LINES}`,
      },
      // Clock only — "length pending" is carried by the marker row below and by
      // the block's dashed border, never twice on one face.
      block.approximate
        ? block.startClock
        : `${block.startClock} – ${block.endClock}`,
    ),
  );
  // Published-qualifier marker (issue #71) — the verbatim text is printed in the
  // card's notes strip below the grid, which is the only place on a fixed-size
  // block grid that can hold a paragraph without truncating it.
  if (block.examNote) {
    examSeg.append(
      el(
        "div",
        {
          marginTop: `${FACE_MARKER_GAP_PX}px`,
          flexShrink: "0",
          fontStyle: "italic",
          fontWeight: "500",
          fontSize: "10px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        EXAM_NOTE_LABEL,
      ),
    );
  }
  if (secondaryMarkers.length > 0) {
    examSeg.append(
      el(
        "div",
        {
          marginTop: `${FACE_MARKER_GAP_PX}px`,
          flexShrink: "0",
          fontStyle: "italic",
          fontWeight: "500",
          fontSize: "10px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        secondaryMarkers.join(" · "),
      ),
    );
  }
  node.append(examSeg);

  // Setup-buffer segment: dashed top + hatched fill + "+N min setup" (the
  // site's display-only product padding, kept visibly distinct).
  const buffer = el("div", {
    boxSizing: "border-box",
    height: `${bufferHeight}px`,
    overflow: "hidden",
    padding: "0 6px",
    fontSize: "9px",
    lineHeight: "1.5",
    borderTop: `1px dashed ${accent}`,
    backgroundImage: `repeating-linear-gradient(-45deg, transparent 0 5px, ${accent}55 5px 6px)`,
  });
  buffer.append(el("span", {}, `+${SETUP_BUFFER_MINUTES} min setup`));
  node.append(buffer);

  return node;
}

/** The week grid: day-header row + time-axis + day columns with blocks. */
function renderGrid(
  week: CalendarWeekLayout,
  card: CalendarCard,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement {
  const days = week.days;
  const n = days.length;
  const gridW = AXIS_W + n * DAY_W;
  const hours: number[] = [];
  for (let h = card.axisStartHour; h < card.axisEndHour; h += 1) hours.push(h);
  const bodyHeight = hours.length * HOUR_PX;
  const columns = `${AXIS_W}px repeat(${n}, ${DAY_W}px)`;

  const wrap = el("div", {
    boxSizing: "border-box",
    width: `${gridW}px`,
    border: `1px solid ${tokens.cardBorder}`,
    borderRadius: "10px",
    overflow: "hidden",
  });

  // Header row: empty axis gutter + weekday · date per day.
  const headerRow = el("div", {
    display: "grid",
    gridTemplateColumns: columns,
    borderBottom: `1px solid ${tokens.cardBorder}`,
  });
  headerRow.append(el("div", { background: tokens.pageBg }));
  for (const day of days) {
    const cell = el("div", {
      borderLeft: `1px solid ${tokens.divider}`,
      padding: "8px 6px",
      textAlign: "center",
    });
    const label = el("div", {
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.03em",
      color: tokens.muted,
    });
    label.append(
      el("span", {}, weekdayLabel(day.date)),
      el("span", { color: tokens.body, fontWeight: "600" }, `  ${monthDayLabel(day.date)}`),
    );
    cell.append(label);
    headerRow.append(cell);
  }
  wrap.append(headerRow);

  // Body row: axis gutter + day columns.
  const bodyRow = el("div", {
    display: "grid",
    gridTemplateColumns: columns,
  });

  const axis = el("div", {
    boxSizing: "border-box",
    height: `${bodyHeight}px`,
    background: tokens.pageBg,
  });
  for (const hour of hours) {
    axis.append(
      el(
        "div",
        {
          height: `${HOUR_PX}px`,
          paddingTop: "2px",
          paddingRight: "6px",
          textAlign: "right",
          fontSize: "10px",
          fontWeight: "500",
          color: tokens.muted,
        },
        hourLabel(hour),
      ),
    );
  }
  bodyRow.append(axis);

  for (const day of days) {
    const col = el("div", {
      position: "relative",
      boxSizing: "border-box",
      height: `${bodyHeight}px`,
      borderLeft: `1px solid ${tokens.divider}`,
    });
    // Hour gridlines (the header border marks the first line).
    hours.forEach((hour, index) => {
      col.append(
        el("div", {
          height: `${HOUR_PX}px`,
          borderTop: index === 0 ? "none" : `1px solid ${tokens.gridLine}`,
        }),
      );
    });
    // Positioned blocks overlay the gridlines.
    for (const block of day.blocks) {
      col.append(renderBlock(block, card.axisStartHour, theme));
    }
    bodyRow.append(col);
  }
  wrap.append(bodyRow);

  return wrap;
}

/** Category dot + label legend for the categories used in this week's blocks. */
function renderLegend(
  week: CalendarWeekLayout,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement | null {
  const used = new Set<Category>();
  for (const day of week.days)
    for (const block of day.blocks)
      if (block.category) used.add(block.category);
  const ordered = CATEGORIES.filter((c) => used.has(c));
  if (ordered.length === 0) return null;

  const legend = el("div", {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 16px",
  });
  for (const category of ordered) {
    const item = el("div", {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "12px",
      fontWeight: "500",
      color: tokens.body,
    });
    item.append(
      el("span", {
        width: "10px",
        height: "10px",
        borderRadius: "9999px",
        background: CATEGORY_PALETTE[theme][category].accent,
        flex: "0 0 auto",
      }),
      el("span", {}, category),
    );
    legend.append(item);
  }
  return legend;
}

/** One off-grid / undated row: category dot + name + reason label. */
function renderOffGridRow(
  name: string,
  category: Category | null,
  detail: string,
  detailColor: string,
  theme: ExportTheme,
): HTMLElement {
  const accent = category
    ? CATEGORY_PALETTE[theme][category].accent
    : NEUTRAL_ACCENT[theme];
  const row = el("div", {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: "4px 8px",
    fontSize: "12px",
  });
  const nameWrap = el("span", {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontWeight: "600",
    color: THEMES[theme].body,
  });
  nameWrap.append(
    el("span", {
      width: "8px",
      height: "8px",
      borderRadius: "9999px",
      background: accent,
      flex: "0 0 auto",
    }),
    el("span", {}, name),
  );
  row.append(nameWrap, el("span", { color: detailColor }, detail));
  return row;
}

/**
 * "Not placed on the grid" strip — off-grid dated entries + undated subjects.
 *
 * On the Week 0 deadlines card (`deadlines`, issue #97) the strip IS the card:
 * there is no grid beside it, so "Not placed on the grid" would name a thing
 * the reader cannot see. It gets the heading the card is about instead, and a
 * blurb that explains the deadline/exam split rather than the grid exclusion.
 */
function renderOffGridStrip(
  offGrid: readonly CalendarOffGridRow[],
  undatedNames: readonly string[],
  cycle: string,
  deadlines: boolean,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement | null {
  if (offGrid.length === 0 && undatedNames.length === 0) return null;

  const strip = el("div", {
    boxSizing: "border-box",
    border: `1px dashed ${tokens.divider}`,
    borderRadius: "10px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  });
  strip.append(
    el(
      "div",
      { fontSize: "13px", fontWeight: "600", color: tokens.body },
      deadlines ? "Portfolio deadlines" : "Not placed on the grid",
    ),
  );
  strip.append(
    el(
      "div",
      { fontSize: "11px", color: tokens.muted, lineHeight: "1.4" },
      deadlines
        ? `Submission deadlines have a date but no exam sitting, so they are listed here instead of on a ${cycle} exam week.`
        : `Deadlines without a clock time and subjects without a published ${cycle} exam date are listed here instead of being placed at a guessed position.`,
    ),
  );

  const list = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });
  for (const item of offGrid) {
    const detailColor =
      item.reason === "portfolio" ? tokens.lateAccent : tokens.muted;
    list.append(
      renderOffGridRow(item.subjectName, item.category, item.label, detailColor, theme),
    );
  }
  for (const name of undatedNames) {
    list.append(
      renderOffGridRow(name, null, `No ${cycle} exam date`, tokens.muted, theme),
    );
  }
  strip.append(list);
  return strip;
}

/**
 * "Published notes" strip (issue #71) — one entry per block on THIS week's grid
 * whose subject carries a verbatim `examNote`.
 *
 * Why the card needs it: the block face has room only for the
 * {@link EXAM_NOTE_LABEL} marker, and a PNG has no tooltip, no accessible name,
 * and no details dialog to defer the full text to. Without this strip the export
 * would show a bare "May 7 · PM" for an exam only pilot schools may sit. The
 * qualifier is printed verbatim from the dataset, never summarised.
 */
function renderNotesStrip(
  week: CalendarWeekLayout,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement | null {
  const noted: CalendarBlock[] = [];
  for (const day of week.days) {
    for (const block of day.blocks) if (block.examNote) noted.push(block);
  }
  if (noted.length === 0) return null;

  const strip = el("div", {
    boxSizing: "border-box",
    border: `1px solid ${tokens.divider}`,
    borderRadius: "10px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  });
  strip.append(
    el(
      "div",
      { fontSize: "13px", fontWeight: "600", color: tokens.body },
      `${EXAM_NOTE_LABEL}s`,
    ),
  );

  const list = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });
  for (const block of noted) {
    const accent = block.category
      ? CATEGORY_PALETTE[theme][block.category].accent
      : NEUTRAL_ACCENT[theme];
    const row = el("div", {
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      fontSize: "12px",
      lineHeight: "1.4",
      color: tokens.muted,
    });
    row.append(
      el("span", {
        width: "8px",
        height: "8px",
        borderRadius: "9999px",
        background: accent,
        flex: "0 0 auto",
        marginTop: "5px",
      }),
    );
    const text = el("span", { minWidth: "0" });
    text.append(
      el(
        "span",
        { fontWeight: "600", color: tokens.body },
        `${block.subjectName}: `,
      ),
    );
    text.append(el("span", {}, block.examNote!));
    row.append(text);
    list.append(row);
  }
  strip.append(list);
  return strip;
}

/**
 * Build the designed calendar-card DOM node for one week. Pure DOM (not
 * attached) — the caller attaches it off-screen for rasterization.
 */
export function renderCalendarCardNode(
  card: CalendarCard,
  options: CalendarCardRenderOptions,
): HTMLElement {
  const tokens = THEMES[options.theme];
  const accent = card.late ? tokens.lateAccent : tokens.regularAccent;
  const headerBg = card.late ? tokens.lateHeaderBg : tokens.regularHeaderBg;
  const headerText = card.late ? tokens.lateHeaderText : tokens.regularHeaderText;
  // A grid-less Week 0 card has no day columns to size from, so it takes the
  // LIST card's width — the two variants' deadline cards then rasterize to the
  // same shape, and a Week 0 next to a Week 1 calendar card is narrower, not
  // stretched to fit an absent grid.
  const rootW = card.week
    ? AXIS_W + card.week.days.length * DAY_W + 2 + 2 * BODY_PAD_X + 2 * ROOT_PAD
    : DEADLINES_CARD_WIDTH;

  const root = el("div", {
    boxSizing: "border-box",
    width: `${rootW}px`,
    background: tokens.pageBg,
    padding: `${ROOT_PAD}px`,
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

  // ── Header (same metadata as the list card) ────────────────────────────────
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

  // Count line — same rule as the list card (issue #97): a deadlines card says
  // "N deadlines", never "0 exams".
  const blockCount =
    card.week?.days.reduce((n, d) => n + d.blocks.length, 0) ?? 0;
  const countText = card.deadlines
    ? `${card.offGrid.length} deadline${card.offGrid.length === 1 ? "" : "s"}`
    : blockCount > 0
      ? `${blockCount} exam${blockCount === 1 ? "" : "s"}`
      : `${card.offGrid.length} item${card.offGrid.length === 1 ? "" : "s"}`;
  header.append(
    headerLeft,
    el(
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
    ),
  );
  cardBox.append(header);

  // ── Body: legend + grid + off-grid strip ───────────────────────────────────
  const body = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "20px 24px",
    background: tokens.pageBg,
  });
  // Week 0 has no window and therefore no grid or legend — its deadline strip
  // is the whole body (issue #97). Drawing an empty grid there would be chrome
  // pretending to be data.
  if (card.week) {
    const legend = renderLegend(card.week, tokens, options.theme);
    if (legend) body.append(legend);
    body.append(renderGrid(card.week, card, tokens, options.theme));
  }
  const strip = renderOffGridStrip(
    card.offGrid,
    options.undatedNames,
    options.cycle,
    card.deadlines,
    tokens,
    options.theme,
  );
  if (strip) body.append(strip);
  const notes = card.week
    ? renderNotesStrip(card.week, tokens, options.theme)
    : null;
  if (notes) body.append(notes);
  cardBox.append(body);

  // ── Footer: schedule name + credit ─────────────────────────────────────────
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
 * Rasterize one week CALENDAR card to a solid-background PNG blob at
 * `pixelRatio: 2`.
 */
export async function captureCalendarCardPng(
  card: CalendarCard,
  options: CalendarCardRenderOptions,
): Promise<Blob> {
  const node = renderCalendarCardNode(card, options);
  return captureCardPng(node, options.theme);
}
