// shell.ts — Shell-style field splitting for $PAGER
// Port of the subset of mvdan.cc/sh/v3/shell.Fields used by glow's main.go
// (glow v2.1.2+: "use shell.Fields to parse $PAGER command").
//
// Fields performs shell expansion on a string as if it were a command's
// arguments: quote removal, backslash escapes, parameter expansion ($VAR,
// ${VAR}, ${VAR:-word}, ${VAR-word}, ${VAR:+word}, ${VAR+word}, ${#VAR}),
// tilde expansion, brace expansion ({a,b}, {1..3}) and word splitting of
// unquoted expansions on $IFS.
//
// Like shell.Fields, empty variables are treated as unset, and command
// substitution, arithmetic expansion and globbing are not supported.
// Invalid syntax (unterminated quotes, shell operators) throws.

/** Environment lookup function, e.g. `(k) => process.env[k] ?? ''`. */
export type Getenv = (name: string) => string;

// A piece of a word before brace expansion and field splitting.
type Seg =
  // Literal text. `quoted` text is never split or brace-expanded.
  | { kind: 'lit'; text: string; quoted: boolean }
  // Result of an unquoted expansion: subject to IFS field splitting.
  | { kind: 'exp'; text: string }
  // Unquoted brace-expansion syntax characters.
  | { kind: 'brace'; ch: '{' | ',' | '}' };

const operatorChars = new Set(['|', '&', ';', '<', '>', '(', ')']);

const defaultEnv: Getenv = (name) => process.env[name] ?? '';

/**
 * Split `s` into fields using shell syntax, resolving variables with `env`.
 * Mirrors Go's `shell.Fields(s, env)`.
 */
export function shellFields(s: string, env: Getenv = defaultEnv): string[] {
  const words = parseWords(s, env);
  const out: string[] = [];
  for (const w of words) {
    for (const variant of braceExpand(w)) {
      out.push(...splitFields(variant, env));
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n';
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function parseWords(s: string, env: Getenv): Seg[][] {
  const words: Seg[][] = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    // Skip blanks between words
    while (i < n && isBlank(s[i])) i++;
    if (i >= n) break;

    // Comments start at an unquoted '#' at the beginning of a word
    if (s[i] === '#') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }

    const segs: Seg[] = [];
    const wordStart = i;

    while (i < n && !isBlank(s[i])) {
      const ch = s[i];

      if (operatorChars.has(ch)) {
        throw new Error(`${i + 1}: ${ch} can only be used as a separate command`);
      }

      // Tilde expansion at the start of a word: ~ or ~/...
      if (ch === '~' && i === wordStart && (i + 1 >= n || s[i + 1] === '/' || isBlank(s[i + 1]))) {
        segs.push({ kind: 'lit', text: env('HOME'), quoted: true });
        i++;
        continue;
      }

      if (ch === '\\') {
        if (i + 1 >= n) {
          // Trailing backslash is kept literally
          segs.push({ kind: 'lit', text: '\\', quoted: true });
          i++;
        } else if (s[i + 1] === '\n') {
          // Line continuation
          i += 2;
        } else {
          segs.push({ kind: 'lit', text: s[i + 1], quoted: true });
          i += 2;
        }
        continue;
      }

      if (ch === "'") {
        const end = s.indexOf("'", i + 1);
        if (end === -1) {
          throw new Error(`${i + 1}: reached EOF without closing quote '`);
        }
        segs.push({ kind: 'lit', text: s.slice(i + 1, end), quoted: true });
        i = end + 1;
        continue;
      }

      if (ch === '"') {
        let text = '';
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const c = s[j];
          if (c === '"') {
            closed = true;
            j++;
            break;
          }
          if (c === '\\' && j + 1 < n && '$`"\\\n'.includes(s[j + 1])) {
            if (s[j + 1] !== '\n') text += s[j + 1];
            j += 2;
            continue;
          }
          if (c === '$') {
            const [val, next] = parseDollar(s, j, env);
            text += val;
            j = next;
            continue;
          }
          if (c === '`') {
            throw new Error(`${j + 1}: command substitution is not supported`);
          }
          text += c;
          j++;
        }
        if (!closed) {
          throw new Error(`${i + 1}: reached EOF without closing quote "`);
        }
        segs.push({ kind: 'lit', text, quoted: true });
        i = j;
        continue;
      }

      if (ch === '$') {
        const [val, next] = parseDollar(s, i, env);
        // "$" on its own is a literal dollar sign
        if (next === i + 1 && val === '$') {
          segs.push({ kind: 'lit', text: '$', quoted: false });
        } else {
          segs.push({ kind: 'exp', text: val });
        }
        i = next;
        continue;
      }

      if (ch === '`') {
        throw new Error(`${i + 1}: command substitution is not supported`);
      }

      if (ch === '{' || ch === ',' || ch === '}') {
        segs.push({ kind: 'brace', ch });
        i++;
        continue;
      }

      // Plain unquoted literal run
      let j = i;
      while (
        j < n &&
        !isBlank(s[j]) &&
        !operatorChars.has(s[j]) &&
        !'\\\'"$`{,}'.includes(s[j])
      ) {
        j++;
      }
      segs.push({ kind: 'lit', text: s.slice(i, j), quoted: false });
      i = j;
    }

    words.push(segs);
  }

  return words;
}

/**
 * Parse a parameter expansion starting at s[i] === '$'.
 * Returns the expanded value and the index after the expansion.
 */
function parseDollar(s: string, i: number, env: Getenv): [string, number] {
  const next = s[i + 1];

  if (next === undefined) return ['$', i + 1];

  if (next === '(') {
    throw new Error(`${i + 1}: command substitution is not supported`);
  }

  if (next === '{') {
    const end = findClosingBrace(s, i + 2);
    if (end === -1) {
      throw new Error(`${i + 1}: reached EOF without matching \${ with }`);
    }
    const inner = s.slice(i + 2, end);
    return [expandBraced(inner, env), end + 1];
  }

  if (isNameStart(next)) {
    let j = i + 1;
    while (j < s.length && isNameChar(s[j])) j++;
    return [env(s.slice(i + 1, j)), j];
  }

  // Positional and special parameters are never set here
  if (/[0-9@*#?$!-]/.test(next)) {
    return ['', i + 2];
  }

  return ['$', i + 1];
}

function findClosingBrace(s: string, from: number): number {
  let depth = 1;
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '{') depth++;
    if (s[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function expandBraced(inner: string, env: Getenv): string {
  // ${#NAME} — length
  if (inner.startsWith('#') && inner.length > 1) {
    return String([...env(inner.slice(1))].length);
  }

  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+=?])(.*))?$/s.exec(inner);
  if (!m) {
    throw new Error(`invalid parameter expansion: \${${inner}}`);
  }
  const [, name, op, word = ''] = m;
  // Empty variables are treated as unset (as with shell.Fields)
  const val = env(name);
  const set = val !== '';

  switch (op) {
    case undefined:
      return val;
    case ':-':
    case '-':
    case ':=':
    case '=':
      return set ? val : expandWordText(word, env);
    case ':+':
    case '+':
      return set ? expandWordText(word, env) : '';
    case ':?':
    case '?':
      if (!set) throw new Error(`${name}: ${word || 'parameter null or not set'}`);
      return val;
    default:
      return val;
  }
}

/** Expand the "word" part of ${VAR:-word}, with quote removal. */
function expandWordText(word: string, env: Getenv): string {
  const words = parseWords(word, env);
  return words
    .map((segs) =>
      segs
        .map((seg) => (seg.kind === 'brace' ? seg.ch : seg.text))
        .join(''),
    )
    .join(' ');
}

// --------------------------------------------------------------------------
// Brace expansion
// --------------------------------------------------------------------------

function braceExpand(word: Seg[]): Seg[][] {
  // Find the first '{' that has a matching '}' with a top-level ',' or a
  // range between them.
  for (let open = 0; open < word.length; open++) {
    const seg = word[open];
    if (seg.kind !== 'brace' || seg.ch !== '{') continue;

    let depth = 0;
    const commas: number[] = [];
    let close = -1;
    for (let j = open + 1; j < word.length; j++) {
      const t = word[j];
      if (t.kind !== 'brace') continue;
      if (t.ch === '{') depth++;
      else if (t.ch === '}') {
        if (depth === 0) {
          close = j;
          break;
        }
        depth--;
      } else if (t.ch === ',' && depth === 0) {
        commas.push(j);
      }
    }
    if (close === -1) continue;

    const prefix = word.slice(0, open);
    const suffix = word.slice(close + 1);

    let alternatives: Seg[][] = [];
    if (commas.length > 0) {
      const bounds = [open, ...commas, close];
      for (let k = 0; k < bounds.length - 1; k++) {
        alternatives.push(word.slice(bounds[k] + 1, bounds[k + 1]));
      }
    } else {
      const inner = word.slice(open + 1, close);
      const range = braceRange(inner);
      if (range === null) continue;
      alternatives = range.map((text) => [{ kind: 'lit', text, quoted: true } as Seg]);
    }

    const result: Seg[][] = [];
    for (const alt of alternatives) {
      result.push(...braceExpand([...prefix, ...alt, ...suffix]));
    }
    return result;
  }

  return [word];
}

function braceRange(inner: Seg[]): string[] | null {
  if (inner.length !== 1 || inner[0].kind !== 'lit' || inner[0].quoted) return null;
  const m = /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])$/.exec(inner[0].text);
  if (!m) return null;
  const [, a, b] = m;
  const numeric = /\d/.test(a) && /\d/.test(b);
  if (!numeric && (/\d/.test(a) || /\d/.test(b))) return null;
  const from = numeric ? parseInt(a, 10) : a.charCodeAt(0);
  const to = numeric ? parseInt(b, 10) : b.charCodeAt(0);
  const step = from <= to ? 1 : -1;
  const out: string[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
    out.push(numeric ? String(v) : String.fromCharCode(v));
  }
  return out;
}

// --------------------------------------------------------------------------
// Field splitting
// --------------------------------------------------------------------------

function splitFields(word: Seg[], env: Getenv): string[] {
  const ifs = env('IFS') || ' \t\n';
  const fields: string[] = [];
  let cur = '';
  // Whether the current field has content that must be kept even if empty
  // (quoted text, e.g. "").
  let keep = false;

  for (const seg of word) {
    if (seg.kind === 'brace') {
      cur += seg.ch;
      keep = true;
      continue;
    }
    if (seg.kind === 'lit') {
      cur += seg.text;
      if (seg.quoted || seg.text !== '') keep = true;
      continue;
    }
    // Unquoted expansion: split on IFS
    for (const ch of seg.text) {
      if (ifs.includes(ch)) {
        if (keep || cur !== '') fields.push(cur);
        cur = '';
        keep = false;
      } else {
        cur += ch;
      }
    }
  }
  if (keep || cur !== '') fields.push(cur);
  return fields;
}
