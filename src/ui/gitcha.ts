// gitcha.ts — find files in a directory tree, respecting .gitignore
// Port of github.com/muesli/gitcha v0.3.0 (used by glow v3.0.0's file
// listing), together with the parts of Go's path/filepath it relies on
// (Walk and Match), so that the same files are found in the same order.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { GitIgnore } from './gitignore.js';

/** Combines the absolute path of a file with its (lstat) file info. */
export interface SearchResult {
  path: string;
  info: fs.Stats;
}

// --------------------------------------------------------------------------
// Go path/filepath.Match
// --------------------------------------------------------------------------

/** Error returned by `match` when the pattern is malformed (filepath.ErrBadPattern). */
export class ErrBadPattern extends Error {
  constructor() {
    super('syntax error in pattern');
  }
}

const separator = path.sep;
// On Windows, Go's filepath.Match treats '\\' as a path separator, not an escape.
const escapeEnabled = path.sep !== '\\';

function scanChunk(pattern: string): [boolean, string, string] {
  let star = false;
  while (pattern.length > 0 && pattern[0] === '*') {
    pattern = pattern.slice(1);
    star = true;
  }
  let inrange = false;
  let i = 0;
  scan: for (i = 0; i < pattern.length; i++) {
    switch (pattern[i]) {
      case '\\':
        if (escapeEnabled && i + 1 < pattern.length) i++;
        break;
      case '[':
        inrange = true;
        break;
      case ']':
        inrange = false;
        break;
      case '*':
        if (!inrange) break scan;
        break;
    }
  }
  return [star, pattern.slice(0, i), pattern.slice(i)];
}

/** Length (in UTF-16 units) of the code point at the start of s. */
function runeLen(s: string): number {
  const cp = s.codePointAt(0);
  return cp !== undefined && cp > 0xffff ? 2 : 1;
}

function getEsc(chunk: string): [number, string] {
  if (chunk.length === 0 || chunk[0] === '-' || chunk[0] === ']') {
    throw new ErrBadPattern();
  }
  if (chunk[0] === '\\' && escapeEnabled) {
    chunk = chunk.slice(1);
    if (chunk.length === 0) throw new ErrBadPattern();
  }
  const r = chunk.codePointAt(0)!;
  const nchunk = chunk.slice(runeLen(chunk));
  if (nchunk.length === 0) throw new ErrBadPattern();
  return [r, nchunk];
}

/** Returns [rest, ok]; throws ErrBadPattern for malformed chunks. */
function matchChunk(chunk: string, s: string): [string, boolean] {
  let failed = false;
  while (chunk.length > 0) {
    if (!failed && s.length === 0) failed = true;
    switch (chunk[0]) {
      case '[': {
        let r = -1;
        if (!failed) {
          r = s.codePointAt(0)!;
          s = s.slice(runeLen(s));
        }
        chunk = chunk.slice(1);
        let negated = false;
        if (chunk.length > 0 && chunk[0] === '^') {
          negated = true;
          chunk = chunk.slice(1);
        }
        let matched = false;
        let nrange = 0;
        for (;;) {
          if (chunk.length > 0 && chunk[0] === ']' && nrange > 0) {
            chunk = chunk.slice(1);
            break;
          }
          let lo: number;
          let hi: number;
          [lo, chunk] = getEsc(chunk);
          hi = lo;
          if (chunk[0] === '-') {
            [hi, chunk] = getEsc(chunk.slice(1));
          }
          if (lo <= r && r <= hi) matched = true;
          nrange++;
        }
        if (matched === negated) failed = true;
        break;
      }
      case '?':
        if (!failed) {
          if (s[0] === separator) failed = true;
          s = s.slice(runeLen(s));
        }
        chunk = chunk.slice(1);
        break;
      default: {
        if (chunk[0] === '\\' && escapeEnabled) {
          chunk = chunk.slice(1);
          if (chunk.length === 0) throw new ErrBadPattern();
        }
        if (!failed) {
          if (chunk[0] !== s[0]) failed = true;
          s = s.slice(1);
        }
        chunk = chunk.slice(1);
      }
    }
  }
  if (failed) return ['', false];
  return [s, true];
}

/**
 * Reports whether name matches the shell pattern (Go's filepath.Match).
 * Throws ErrBadPattern when the pattern is malformed.
 */
export function match(pattern: string, name: string): boolean {
  outer: while (pattern.length > 0) {
    let star: boolean;
    let chunk: string;
    [star, chunk, pattern] = scanChunk(pattern);
    if (star && chunk === '') {
      // Trailing * matches rest of string unless it has a separator.
      return !name.includes(separator);
    }
    const [t, ok] = matchChunk(chunk, name);
    if (ok && (t.length === 0 || pattern.length > 0)) {
      name = t;
      continue;
    }
    if (star) {
      for (let i = 0; i < name.length && name[i] !== separator; i++) {
        const [t2, ok2] = matchChunk(chunk, name.slice(i + 1));
        if (ok2) {
          if (pattern.length === 0 && t2.length > 0) continue;
          name = t2;
          continue outer;
        }
      }
    }
    // Before returning false, check that the rest of the pattern is valid.
    while (pattern.length > 0) {
      [, chunk, pattern] = scanChunk(pattern);
      matchChunk(chunk, '');
    }
    return false;
  }
  return name.length === 0;
}

// --------------------------------------------------------------------------
// Go path/filepath.Walk
// --------------------------------------------------------------------------

const SkipDir = Symbol('SkipDir');
type WalkResult = typeof SkipDir | undefined;

/** Go sorts directory entries by byte order (sort.Strings). */
function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function walk(p: string, info: fs.Stats, fn: (p: string, info: fs.Stats) => WalkResult): WalkResult {
  if (!info.isDirectory()) {
    return fn(p, info);
  }
  let names: string[] | null;
  try {
    names = fs.readdirSync(p).sort(compareBytes);
  } catch {
    names = null;
  }
  const r = fn(p, info);
  if (names === null || r !== undefined) return r;
  for (const name of names) {
    const filename = path.join(p, name);
    let fileInfo: fs.Stats;
    try {
      fileInfo = fs.lstatSync(filename);
    } catch {
      // Upstream hands a nil FileInfo to the callback here, which gitcha
      // can't use; the entry is skipped.
      continue;
    }
    const err = walk(filename, fileInfo, fn);
    if (err !== undefined && (!fileInfo.isDirectory() || err !== SkipDir)) {
      return err;
    }
  }
  return undefined;
}

// --------------------------------------------------------------------------
// gitcha
// --------------------------------------------------------------------------

/**
 * Returns the directory of the git repository `p` is a member of, or ''.
 */
export function gitRepoForPath(p: string): string {
  let dir = path.resolve(p);
  for (;;) {
    try {
      if (fs.statSync(path.join(dir, '.git')).isDirectory()) return dir;
    } catch {
      // not here
    }
    // reached root?
    if (dir === path.dirname(dir)) return '';
    dir = path.dirname(dir);
  }
}

/** Returns true when a path is part of a git repository. */
export function isPathInGit(p: string): boolean {
  return gitRepoForPath(p).length > 0;
}

/** Finds all files from list in p. Does not respect any .gitignore files. */
export function findAllFiles(p: string, list: string[]): SearchResult[] {
  return searchFiles(p, list, [], false);
}

/** Finds all files from list in p, except ignorePatterns. Ignores .gitignore files. */
export function findAllFilesExcept(p: string, list: string[], ignorePatterns: string[] | null): SearchResult[] {
  return searchFiles(p, list, ignorePatterns ?? [], false);
}

/** Finds files from list in p, respecting the repository's .gitignore. */
export function findFiles(p: string, list: string[]): SearchResult[] {
  return searchFiles(p, list, [], true);
}

/**
 * Finds files from list in p, excluding any matches in ignorePatterns and
 * respecting the repository's .gitignore.
 */
export function findFilesExcept(p: string, list: string[], ignorePatterns: string[] | null): SearchResult[] {
  return searchFiles(p, list, ignorePatterns ?? [], true);
}

/**
 * Walks `root` (after resolving symlinks) and returns every entry whose base
 * name matches one of the `list` patterns (case-insensitively). Entries that
 * are .gitignored (by the .gitignore at the root of their git repository, when
 * respectGitIgnore is set) or that match `ignorePatterns` are skipped, along
 * with everything below them. Throws if `root` can't be resolved.
 */
function searchFiles(
  root: string,
  list: string[],
  ignorePatterns: string[],
  respectGitIgnore: boolean,
): SearchResult[] {
  root = fs.realpathSync(path.resolve(root));
  const st = fs.statSync(root);
  if (!st.isDirectory()) {
    return [];
  }

  const results: SearchResult[] = [];
  let lastGit = '';
  let gi: GitIgnore | null = null;

  let rootInfo: fs.Stats;
  try {
    rootInfo = fs.lstatSync(root);
  } catch {
    return results;
  }

  walk(root, rootInfo, (p, info) => {
    if (respectGitIgnore) {
      const git = gitRepoForPath(p);
      if (git !== '' && git !== p) {
        if (lastGit !== git) {
          lastGit = git;
          try {
            gi = GitIgnore.compileFile(path.join(git, '.gitignore'));
          } catch {
            gi = null;
          }
        }
        if (gi !== null && gi.matchesPath(p.startsWith(lastGit) ? p.slice(lastGit.length) : p)) {
          return info.isDirectory() ? SkipDir : undefined;
        }
      }
    }

    for (let pattern of ignorePatterns) {
      // If there's no path separator in the pattern try to match against
      // the directory we're currently walking.
      if (!pattern.includes(path.sep)) {
        const dir = path.dirname(p);
        if (dir === '.') continue;
        pattern = path.join(dir, pattern);
      }
      let matched: boolean;
      try {
        matched = match(pattern, p);
      } catch {
        continue;
      }
      if (matched && info.isDirectory()) return SkipDir;
      if (matched) return undefined;
    }

    for (const v of list) {
      const base = path.basename(p);
      let matched = base.toLowerCase() === v.toLowerCase();
      if (!matched) {
        try {
          matched = match(v.toLowerCase(), base.toLowerCase());
        } catch {
          matched = false;
        }
      }
      if (matched) {
        results.push({ path: path.resolve(p), info });
        // only match each path once
        return undefined;
      }
    }
    return undefined;
  });

  return results;
}
