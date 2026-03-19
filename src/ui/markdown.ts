// markdown.ts — Markdown type, filter normalization, relative time
// Port of charmbracelet/glow/ui/markdown.go

// --------------------------------------------------------------------------
// Markdown type
// --------------------------------------------------------------------------

/** Represents a local markdown document in the stash. */
export interface Markdown {
  /** Full path of a local markdown file. */
  localPath: string;

  /**
   * Value we filter against. Exists so we can maintain positions of filtered
   * items if notes are edited while a filter is active. Ephemeral — only
   * referenced during filtering.
   */
  filterValue: string;

  /** The raw markdown body. */
  body: string;

  /** Display name / note (usually the filename without extension). */
  note: string;

  /** File modification time. */
  modtime: Date;
}

/** Create a new Markdown with the given fields. */
export function newMarkdown(
  localPath: string,
  note: string,
  body: string,
  modtime: Date,
): Markdown {
  return { localPath, note, body, modtime, filterValue: '' };
}

// --------------------------------------------------------------------------
// Filter value normalization
// --------------------------------------------------------------------------

/**
 * Normalize text to aid filtering. Removes diacritics ("ö" → "o") using
 * Unicode NFD decomposition, then strips combining marks (Mn category).
 */
export function normalize(input: string): string {
  // NFD decompose, then remove combining marks (\u0300-\u036f)
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

/** Build the filterValue for a markdown by normalizing its note. */
export function buildFilterValue(md: Markdown): void {
  md.filterValue = normalize(md.note);
}

// --------------------------------------------------------------------------
// Relative time
// --------------------------------------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

interface Magnitude {
  /** If diff < d, use this format. */
  d: number;
  /** Format string with %d for the value and %s for the direction. */
  format: string;
  /** Divisor to compute the value, or 0 for literal format. */
  divBy: number;
}

const magnitudes: Magnitude[] = [
  { d: SECOND, format: 'now', divBy: 0 },
  { d: 2 * SECOND, format: '1 second %s', divBy: 0 },
  { d: MINUTE, format: '%d seconds %s', divBy: SECOND },
  { d: 2 * MINUTE, format: '1 minute %s', divBy: 0 },
  { d: HOUR, format: '%d minutes %s', divBy: MINUTE },
  { d: 2 * HOUR, format: '1 hour %s', divBy: 0 },
  { d: DAY, format: '%d hours %s', divBy: HOUR },
  { d: 2 * DAY, format: '1 day %s', divBy: 0 },
  { d: WEEK, format: '%d days %s', divBy: DAY },
  { d: 2 * WEEK, format: '1 week %s', divBy: 0 },
  { d: MONTH, format: '%d weeks %s', divBy: WEEK },
  { d: 2 * MONTH, format: '1 month %s', divBy: 0 },
  { d: YEAR, format: '%d months %s', divBy: MONTH },
  { d: 18 * MONTH, format: '1 year %s', divBy: 0 },
  { d: 2 * YEAR, format: '2 years %s', divBy: 0 },
  { d: Number.MAX_SAFE_INTEGER, format: '%d years %s', divBy: YEAR },
];

/**
 * Return the time in a human-readable format relative to now.
 * Matches the Go glow behavior: < 1 minute → "just now",
 * < 1 week → relative ("3 hours ago"), else → formatted date.
 */
export function relativeTime(then: Date): string {
  const now = Date.now();
  const diff = now - then.getTime();

  if (diff < MINUTE) {
    return 'just now';
  }

  if (diff < WEEK) {
    return customRelTime(diff, 'ago');
  }

  // Format as "02 Jan 2006 15:04 MST"
  return formatDate(then);
}

function customRelTime(diffMs: number, direction: string): string {
  for (const mag of magnitudes) {
    if (diffMs < mag.d) {
      if (mag.divBy === 0) {
        return mag.format.replace('%s', direction);
      }
      const val = Math.floor(diffMs / mag.divBy);
      return mag.format.replace('%d', String(val)).replace('%s', direction);
    }
  }
  return 'a long while ago';
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');

  // Get timezone abbreviation
  const tz = Intl.DateTimeFormat('en', { timeZoneName: 'short' })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value ?? 'UTC';

  return `${day} ${month} ${year} ${hours}:${mins} ${tz}`;
}

// --------------------------------------------------------------------------
// Sort
// --------------------------------------------------------------------------

/** Sort markdowns by note (path), stable sort. */
export function sortMarkdowns(mds: Markdown[]): void {
  mds.sort((a, b) => {
    if (a.note < b.note) return -1;
    if (a.note > b.note) return 1;
    return 0;
  });
}
