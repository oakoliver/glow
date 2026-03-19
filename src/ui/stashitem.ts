// stashitem.ts — Individual file list item rendering with fuzzy highlighting
// Port of charmbracelet/glow/ui/stashitem.go

import { newStyle } from '@oakoliver/lipgloss';
import { stringWidth } from '@oakoliver/lipgloss';
import {
  greenFg,
  dimGreenFg,
  semiDimGreenFg,
  dullFuchsiaFg,
  fuchsiaFg,
  dimFuchsiaFg,
  dimDullFuchsiaFg,
  dimNormalFg,
  dimBrightGrayFg,
  grayFg,
  midGrayFg,
  brightGrayFg,
  fuchsia,
  adaptiveColor,
} from './styles.js';
import { normalize, type Markdown } from './markdown.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const verticalLine = '\u2502'; // │
const fileListingStashIcon = '\u2022 '; // •

// --------------------------------------------------------------------------
// Fuzzy match highlighting
// --------------------------------------------------------------------------

/** Style filtered text, highlighting matched characters. */
export function styleFilteredText(
  haystack: string,
  needles: string,
  defaultStyleFn: (s: string) => string,
  matchedStyleFn: (s: string) => string,
): string {
  if (!needles) return defaultStyleFn(haystack);

  const normalizedHay = normalize(haystack);

  // Simple fuzzy matching: find positions of each needle char in order
  const matchedIndexes = fuzzyMatchIndexes(normalizedHay.toLowerCase(), needles.toLowerCase());
  if (matchedIndexes.length === 0) {
    return defaultStyleFn(haystack);
  }

  const matchSet = new Set(matchedIndexes);
  let result = '';
  const chars = [...haystack]; // handle multi-byte chars
  for (let i = 0; i < chars.length; i++) {
    if (matchSet.has(i)) {
      result += matchedStyleFn(chars[i]);
    } else {
      result += defaultStyleFn(chars[i]);
    }
  }
  return result;
}

/** Find the indexes of fuzzy matched characters. */
function fuzzyMatchIndexes(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  let hi = 0;
  for (let ni = 0; ni < needle.length && hi < haystack.length; ni++) {
    const c = needle[ni];
    while (hi < haystack.length) {
      if (haystack[hi] === c) {
        indexes.push(hi);
        hi++;
        break;
      }
      hi++;
    }
  }
  // Only a match if all needle chars were found
  return indexes.length === needle.length ? indexes : [];
}

// --------------------------------------------------------------------------
// Truncate with tail
// --------------------------------------------------------------------------

/** Truncate a string to maxWidth, appending tail if truncated. Uses ANSI-aware width. */
export function truncateWithTail(s: string, maxWidth: number, tail: string = '\u2026'): string {
  if (maxWidth <= 0) return '';
  const w = stringWidth(s);
  if (w <= maxWidth) return s;

  const tailW = stringWidth(tail);
  const target = maxWidth - tailW;
  if (target <= 0) return tail.slice(0, maxWidth);

  // Strip ANSI and truncate by visible width
  let visWidth = 0;
  let result = '';
  const chars = [...s];
  for (const ch of chars) {
    const cw = stringWidth(ch);
    if (visWidth + cw > target) break;
    result += ch;
    visWidth += cw;
  }
  return result + tail;
}

// --------------------------------------------------------------------------
// Stash item types needed (forward declarations)
// --------------------------------------------------------------------------

export interface StashItemContext {
  /** Total width available for rendering. */
  width: number;
  horizontalPadding: number;
  /** Current filter input value. */
  filterValue: string;
  /** Whether we're actively filtering. */
  isFiltering: boolean;
  /** Whether filter is applied (not editing). */
  isFilterApplied: boolean;
  /** Whether there's a single filtered item. */
  singleFilteredItem: boolean;
  /** Current section key. */
  sectionKey: number;
  /** Filter section key constant. */
  filterSectionKey: number;
  /** Status message (for stashing state). */
  statusMessage: string;
  /** The stashing status message string to compare against. */
  stashingStatusMessage: string;
}

// --------------------------------------------------------------------------
// Stash item view
// --------------------------------------------------------------------------

/**
 * Render a single stash item into lines.
 * Returns two lines: title line and date line.
 */
export function stashItemView(
  ctx: StashItemContext,
  index: number,
  md: Markdown,
  isSelected: boolean,
  relTime: string,
): string {
  const truncateTo = Math.max(0, ctx.width - ctx.horizontalPadding * 2);
  let gutter: string;
  let title = truncateWithTail(md.note, truncateTo);
  let date = relTime;
  const icon = '';
  let separator = '';

  const singleFiltered = ctx.singleFilteredItem;
  const isStashing = ctx.statusMessage === ctx.stashingStatusMessage;

  if ((isSelected && !ctx.isFiltering) || singleFiltered) {
    // Selected item
    if (isStashing) {
      gutter = greenFg(verticalLine);
      title = greenFg(title);
      date = semiDimGreenFg(date);
      separator = semiDimGreenFg(separator);
    } else {
      gutter = dullFuchsiaFg(verticalLine);

      if (
        (ctx.sectionKey === ctx.filterSectionKey && ctx.isFilterApplied) ||
        singleFiltered
      ) {
        const defaultFn = (s: string) => newStyle().foreground(fuchsia()).render(s);
        const matchFn = (s: string) => newStyle().foreground(fuchsia()).underline(true).render(s);
        title = styleFilteredText(title, ctx.filterValue, defaultFn, matchFn);
      } else {
        title = fuchsiaFg(title);
      }
      date = dimFuchsiaFg(date);
      separator = dullFuchsiaFg(separator);
    }
  } else {
    gutter = ' ';
    if (isStashing) {
      title = greenFg(title);
      date = semiDimGreenFg(date);
      separator = semiDimGreenFg(separator);
    } else if (ctx.isFiltering && ctx.filterValue === '') {
      title = dimNormalFg(title);
      date = dimBrightGrayFg(date);
      separator = dimBrightGrayFg(separator);
    } else {
      const defaultFn = (s: string) =>
        newStyle().foreground(adaptiveColor('#1a1a1a', '#dddddd')).render(s);
      const matchFn = (s: string) =>
        newStyle().foreground(adaptiveColor('#1a1a1a', '#dddddd')).underline(true).render(s);
      title = styleFilteredText(title, ctx.filterValue, defaultFn, matchFn);
      date = grayFg(date);
      separator = brightGrayFg(separator);
    }
  }

  const line1 = `${gutter} ${icon}${separator}${separator}${title}`;
  const line2 = `${gutter} ${date}`;
  return `${line1}\n${line2}`;
}
