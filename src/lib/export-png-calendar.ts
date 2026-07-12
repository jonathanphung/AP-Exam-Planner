import { CATEGORIES, type Category } from "../data/schema";
import type { CalendarCard, CalendarOffGridRow } from "./calendar-cards";
import {
  hourLabel,
  monthDayLabel,
  SETUP_BUFFER_MINUTES,
  weekdayLabel,
  type CalendarBlock,
} from "./calendar";
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
 * Late-testing treatment: the header reuses the export's amber late tokens
 * (same as the list card) rather than the site's violet badge, so the two PNG
 * variants stay consistent with EACH OTHER while still marking the late week as
 * visually distinct.
 */

export interface CalendarCardRenderOptions {
  /** Active theme — decides the palette + the solid PNG background. */
  theme: ExportTheme;
  /** Dataset cycle, e.g. "May 2026" (shown in the header). */
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

/** Time-axis gutter width (the site's 3.5rem). */
const AXIS_W = 56;
/** Fixed day-column width (px) — wide enough for a subject name + clock. */
const DAY_W = 132;

const ROOT_PAD = 28;
const BODY_PAD_X = 24;

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
  });
  examSeg.append(
    el(
      "div",
      { fontWeight: "600", wordBreak: "break-word" },
      block.subjectName,
    ),
  );
  examSeg.append(
    el(
      "div",
      { marginTop: "2px" },
      block.approximate
        ? `${block.startClock} · length pending`
        : `${block.startClock} – ${block.endClock}`,
    ),
  );
  if (block.approximate) {
    examSeg.append(
      el("div", { marginTop: "1px", fontStyle: "italic" }, "Length pending"),
    );
  }
  if (block.movedToLate) {
    examSeg.append(
      el(
        "div",
        { marginTop: "1px", fontStyle: "italic", fontWeight: "500" },
        "Moved to late testing",
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
function renderGrid(card: CalendarCard, tokens: ThemeTokens, theme: ExportTheme): HTMLElement {
  const days = card.week.days;
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
  card: CalendarCard,
  tokens: ThemeTokens,
  theme: ExportTheme,
): HTMLElement | null {
  const used = new Set<Category>();
  for (const day of card.week.days)
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

/** "Not placed on the grid" strip — off-grid dated entries + undated subjects. */
function renderOffGridStrip(
  offGrid: readonly CalendarOffGridRow[],
  undatedNames: readonly string[],
  cycle: string,
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
      "Not placed on the grid",
    ),
  );
  strip.append(
    el(
      "div",
      { fontSize: "11px", color: tokens.muted, lineHeight: "1.4" },
      `Deadlines without a clock time and subjects without a published ${cycle} exam date are listed here instead of being placed at a guessed position.`,
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
  const gridW = AXIS_W + card.week.days.length * DAY_W;
  const rootW = gridW + 2 + 2 * BODY_PAD_X + 2 * ROOT_PAD;

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
  if (card.late) {
    identity.append(
      el(
        "span",
        {
          fontSize: "11px",
          fontWeight: "700",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: headerText,
          border: `1px solid ${accent}`,
          padding: "2px 8px",
          borderRadius: "9999px",
        },
        "Late window",
      ),
    );
  }
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

  const blockCount = card.week.days.reduce((n, d) => n + d.blocks.length, 0);
  const countText =
    blockCount > 0
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
  const legend = renderLegend(card, tokens, options.theme);
  if (legend) body.append(legend);
  body.append(renderGrid(card, tokens, options.theme));
  const strip = renderOffGridStrip(
    card.offGrid,
    options.undatedNames,
    options.cycle,
    tokens,
    options.theme,
  );
  if (strip) body.append(strip);
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
