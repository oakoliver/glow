// stashhelp.ts — Help view rendering for the stash (file listing)
// Port of charmbracelet/glow/ui/stashhelp.go

import { stringWidth } from '@oakoliver/lipgloss';
import {
  greenFg,
  semiDimGreenFg,
  grayFg,
  midGrayFg,
  subtleStyle,
} from './styles.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** A single entry in a help column: key + description. */
interface HelpEntry {
  key: string;
  val: string;
}

/** A group of help entries forming one column. */
type HelpColumn = HelpEntry[];

// --------------------------------------------------------------------------
// HelpColumn construction
// --------------------------------------------------------------------------

/**
 * Create a help column from pairs of strings [key, val, key, val, ...].
 * Must have an even number of items.
 */
export function newHelpColumn(pairs: string[]): HelpColumn {
  if (pairs.length % 2 !== 0) {
    throw new Error('help text group must have an even number of items');
  }
  const col: HelpColumn = [];
  for (let i = 0; i < pairs.length; i += 2) {
    col.push({ key: pairs[i], val: pairs[i + 1] });
  }
  return col;
}

// --------------------------------------------------------------------------
// HelpColumn rendering
// --------------------------------------------------------------------------

/** Render a help column into rows, padded to the given height. */
function renderColumn(col: HelpColumn, height: number): string[] {
  const [keyWidth, valWidth] = maxWidths(col);
  const rows: string[] = [];

  for (let i = 0; i < height; i++) {
    let k = '';
    let v = '';

    if (i < col.length) {
      const entry = col[i];
      k = entry.key;
      v = entry.val;

      if (k === 's') {
        k = greenFg(k);
        v = semiDimGreenFg(v);
      } else {
        k = grayFg(k);
        v = midGrayFg(v);
      }
    }

    const kPad = ' '.repeat(Math.max(0, keyWidth - stringWidth(k)));
    const vPad = ' '.repeat(Math.max(0, valWidth - stringWidth(v)));
    rows.push(`${k}${kPad}  ${v}${vPad}`);
  }

  return rows;
}

/** Find the widest key and value in a column. */
function maxWidths(col: HelpColumn): [number, number] {
  let maxKey = 0;
  let maxVal = 0;
  for (const entry of col) {
    const kw = stringWidth(entry.key);
    const vw = stringWidth(entry.val);
    if (kw > maxKey) maxKey = kw;
    if (vw > maxVal) maxVal = vw;
  }
  return [maxKey, maxVal];
}

// --------------------------------------------------------------------------
// Merge columns
// --------------------------------------------------------------------------

const MINIMUM_HEIGHT = 3;

/** Merge rendered columns side by side. */
function mergeColumns(cols: string[][]): string {
  let tallestCol = 0;
  for (const c of cols) {
    if (c.length > tallestCol) tallestCol = c.length;
  }
  if (tallestCol < MINIMUM_HEIGHT) tallestCol = MINIMUM_HEIGHT;

  const lines: string[] = [];
  for (let i = 0; i < tallestCol; i++) {
    let line = '';
    for (let j = 0; j < cols.length; j++) {
      const col = cols[j];
      if (i >= col.length) continue;
      if (j === 0) {
        line += '  '; // gutter
      } else {
        line += '    '; // gap
      }
      line += col[i];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Help view interfaces
// --------------------------------------------------------------------------

export interface HelpViewContext {
  /** Whether to show the full help view. */
  showFullHelp: boolean;
  /** Total width for rendering. */
  width: number;
  /** Horizontal padding. */
  horizontalPadding: number;
}

// --------------------------------------------------------------------------
// Mini help view
// --------------------------------------------------------------------------

/**
 * Build a single-line mini help view from pairs of [key, val, key, val, ...].
 * Truncates if the view would exceed available width.
 */
export function miniHelpView(ctx: HelpViewContext, entries: string[]): string {
  if (entries.length === 0) return '';

  const truncationChar = subtleStyle().render('\u2026');
  const truncationWidth = stringWidth(truncationChar);

  const leftGutter = '  ';
  const maxWidth = ctx.width - ctx.horizontalPadding - truncationWidth - stringWidth(leftGutter);
  let s = leftGutter;

  const dividerDot = grayFg(' \u2022 ');

  for (let i = 0; i < entries.length; i += 2) {
    const k = grayFg(entries[i]);
    const v = midGrayFg(entries[i + 1]);

    let next = `${k} ${v}`;
    if (i < entries.length - 2) {
      next += dividerDot;
    }

    if (stringWidth(s) + stringWidth(next) >= maxWidth) {
      s += truncationChar;
      break;
    }

    s += next;
  }

  return s;
}

// --------------------------------------------------------------------------
// Full help view
// --------------------------------------------------------------------------

/** Build a multi-line full help view from groups of key/val pairs. */
export function fullHelpView(groups: string[][]): string {
  const columns: HelpColumn[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    columns.push(newHelpColumn(g));
  }

  let tallestCol = 0;
  for (const c of columns) {
    if (c.length > tallestCol) tallestCol = c.length;
  }

  const renderedCols: string[][] = [];
  for (const c of columns) {
    renderedCols.push(renderColumn(c, tallestCol));
  }

  return mergeColumns(renderedCols);
}

// --------------------------------------------------------------------------
// Render help (dispatch between mini and full)
// --------------------------------------------------------------------------

export const MIN_HELP_VIEW_HEIGHT = 5;

/**
 * Render either the mini or full help view.
 * Returns [rendered string, height in lines].
 */
export function renderHelp(
  ctx: HelpViewContext,
  groups: string[][],
): [string, number] {
  if (ctx.showFullHelp) {
    const str = fullHelpView(groups);
    const numLines = str.split('\n').length;
    return [str, Math.max(numLines, MIN_HELP_VIEW_HEIGHT)];
  }

  // Flatten groups into a single array for mini view
  const flat: string[] = [];
  for (const g of groups) {
    flat.push(...g);
  }
  return [miniHelpView(ctx, flat), 1];
}

// --------------------------------------------------------------------------
// Concat helper
// --------------------------------------------------------------------------

export function concatStringSlices(...slices: string[][]): string[] {
  const result: string[] = [];
  for (const s of slices) {
    result.push(...s);
  }
  return result;
}
