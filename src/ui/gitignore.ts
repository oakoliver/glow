// gitignore.ts — .gitignore matching used by the local file finder
// Port of github.com/sabhiram/go-gitignore @ d3107576ba94 (the version
// pinned by muesli/gitcha v0.3.0, which glow v3.0.0 uses). The Go library
// translates every .gitignore line into a regular expression; this port does
// the same, step by step, so that quirks (e.g. "?" being matched literally)
// behave exactly as they do upstream.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface IgnorePattern {
  pattern: RegExp;
  negate: boolean;
}

const magicStar = '#$~';

/** Replace every match of `re` with the literal string `repl`. */
function replaceAllLiteral(s: string, re: RegExp, repl: string): string {
  return s.replace(re, () => repl);
}

/**
 * Translate a single .gitignore line into a regexp (or null for comments,
 * blank lines and lines that don't compile) and whether it is negated.
 */
function getPatternFromLine(line: string): [RegExp | null, boolean] {
  // Trim OS-specific carriage returns.
  line = line.replace(/\r+$/, '');

  // Strip comments [Rule 2]
  if (line.startsWith('#')) {
    return [null, false];
  }

  // Trim string [Rule 3]
  line = line.replace(/^ +| +$/g, '');

  if (line === '') {
    return [null, false];
  }

  let negatePattern = false;
  if (line[0] === '!') {
    negatePattern = true;
    line = line.slice(1);
  }

  // Handle [Rule 2, 4], when # or ! is escaped with a \
  if (/^(\#|\!)/.test(line)) {
    line = line.slice(1);
  }

  // If we encounter a foo/*.blah in a folder, prepend the / char
  if (/([^\/+])\/.*\*\./.test(line) && line[0] !== '/') {
    line = '/' + line;
  }

  // Handle escaping the "." char
  line = replaceAllLiteral(line, /\./g, '\\.');

  // Handle "/**/" usage
  if (line.startsWith('/**/')) {
    line = line.slice(1);
  }
  line = replaceAllLiteral(line, /\/\*\*\//g, '(/|/.+/)');
  line = replaceAllLiteral(line, /\*\*\//g, '(|.' + magicStar + '/)');
  line = replaceAllLiteral(line, /\/\*\*/g, '(|/.' + magicStar + ')');

  // Handle escaping the "*" char
  line = replaceAllLiteral(line, /\\\*/g, '\\' + magicStar);
  line = replaceAllLiteral(line, /\*/g, '([^/]*)');

  // Handle escaping the "?" char
  line = line.split('?').join('\\?');

  line = line.split(magicStar).join('*');

  let expr: string;
  if (line.endsWith('/')) {
    expr = line + '(|.*)$';
  } else {
    expr = line + '(|/.*)$';
  }
  if (expr.startsWith('/')) {
    expr = '^(|/)' + expr.slice(1);
  } else {
    expr = '^(|.*/)' + expr;
  }

  try {
    return [new RegExp(expr), negatePattern];
  } catch {
    // Go's regexp.Compile error is discarded upstream, yielding a nil pattern.
    return [null, negatePattern];
  }
}

/** A compiled list of .gitignore patterns. */
export class GitIgnore {
  private readonly patterns: IgnorePattern[] = [];

  /** Compile a GitIgnore from individual .gitignore lines. */
  static compileLines(...lines: string[]): GitIgnore {
    const gi = new GitIgnore();
    for (const line of lines) {
      const [pattern, negate] = getPatternFromLine(line);
      if (pattern !== null) {
        gi.patterns.push({ pattern, negate });
      }
    }
    return gi;
  }

  /** Compile a GitIgnore from a .gitignore file. Throws if it can't be read. */
  static compileFile(fpath: string): GitIgnore {
    const buffer = fs.readFileSync(fpath, 'utf-8');
    return GitIgnore.compileLines(...buffer.split('\n'));
  }

  /** Returns true if the given path is targeted by the compiled patterns. */
  matchesPath(f: string): boolean {
    // Replace OS-specific path separator.
    f = f.split(path.sep).join('/');

    let matchesPath = false;
    for (const ip of this.patterns) {
      if (ip.pattern.test(f)) {
        if (!ip.negate) {
          matchesPath = true;
        } else if (matchesPath) {
          matchesPath = false;
        }
      }
    }
    return matchesPath;
  }
}
