// filewalk.ts — .gitignore-aware file walking for Glow TUI
// Replaces Go's muesli/gitcha dependency with zero-dep implementation

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isMarkdownFile } from '../utils.js';
import { ignorePatterns } from './ignore.js';
import type { Config } from '../config.js';
import { type Markdown, newMarkdown, buildFilterValue } from './markdown.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Message sent when a batch of markdown files has been found. */
export class FoundMarkdownsMsg {
  readonly _tag = 'FoundMarkdownsMsg';
  constructor(public readonly markdowns: Markdown[]) {}
}

// --------------------------------------------------------------------------
// .gitignore parsing
// --------------------------------------------------------------------------

interface IgnoreRule {
  /** Pattern to match against (relative path components). */
  pattern: string;
  /** Whether the rule is negated (prefixed with !). */
  negated: boolean;
  /** Whether the pattern ends with / (directory-only). */
  directoryOnly: boolean;
  /** The regex compiled from the glob pattern. */
  regex: RegExp;
}

/** Parse a .gitignore file into a list of rules. */
function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();
    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    // Remove trailing spaces (unless escaped)
    line = line.replace(/(?<!\\)\s+$/, '');
    if (line === '') continue;

    const directoryOnly = line.endsWith('/');
    if (directoryOnly) {
      line = line.slice(0, -1);
    }

    const regex = globToRegex(line);
    rules.push({ pattern: line, negated, directoryOnly, regex });
  }

  return rules;
}

/** Convert a simple gitignore glob to a regex. */
function globToRegex(pattern: string): RegExp {
  let reg = '';
  let i = 0;

  // If pattern doesn't contain /, it matches the basename only
  const matchBasename = !pattern.includes('/');

  // Remove leading /
  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  }

  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          reg += '(?:.*/)?';
          i += 3;
          continue;
        }
        reg += '.*';
        i += 2;
        continue;
      }
      reg += '[^/]*';
      i++;
    } else if (c === '?') {
      reg += '[^/]';
      i++;
    } else if (c === '[') {
      // Character class
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        reg += '\\[';
        i++;
      } else {
        reg += pattern.slice(i, end + 1);
        i = end + 1;
      }
    } else if (c === '\\') {
      // Escape next char
      if (i + 1 < pattern.length) {
        reg += '\\' + pattern[i + 1];
        i += 2;
      } else {
        reg += '\\\\';
        i++;
      }
    } else if ('.+^${}()|'.includes(c)) {
      reg += '\\' + c;
      i++;
    } else {
      reg += c;
      i++;
    }
  }

  if (matchBasename) {
    // Match against basename only
    return new RegExp(`(?:^|/)${reg}$`);
  }

  return new RegExp(`^${reg}(?:$|/)`);
}

/** Test if a relative path matches the ignore rules. */
function isIgnored(relPath: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDir) continue;

    if (rule.regex.test(relPath)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

// --------------------------------------------------------------------------
// Simple pattern matching for ignore patterns
// --------------------------------------------------------------------------

/** Test if a path matches a simple ignore pattern. */
function matchesSimplePattern(filePath: string, pattern: string): boolean {
  // If pattern starts with dot, match any path component that starts with dot
  if (pattern === '.*') {
    const parts = filePath.split(path.sep);
    return parts.some(p => p.startsWith('.') && p.length > 1);
  }

  // Exact path prefix match
  if (filePath.startsWith(pattern)) return true;

  // Basename match (e.g., "node_modules" matches anywhere)
  const basename = path.basename(filePath);
  if (basename === pattern) return true;

  // Check path components
  const parts = filePath.split(path.sep);
  return parts.includes(pattern);
}

// --------------------------------------------------------------------------
// File walker
// --------------------------------------------------------------------------

/**
 * Walk a directory tree, finding markdown files. Respects .gitignore files
 * found along the way, plus the global ignore patterns for the platform.
 *
 * @param rootDir  The directory to walk
 * @param cfg      The Glow config (for ignore patterns, showAllFiles)
 * @returns        Array of Markdown entries found
 */
export function findMarkdowns(rootDir: string, cfg: Config): Markdown[] {
  const results: Markdown[] = [];
  const globalIgnores = cfg.showAllFiles ? [] : ignorePatterns(cfg);

  walkDir(rootDir, rootDir, [], globalIgnores, cfg.showAllFiles, results);
  return results;
}

function walkDir(
  dir: string,
  rootDir: string,
  parentRules: IgnoreRule[],
  globalIgnores: string[],
  showAll: boolean,
  results: Markdown[],
): void {
  // Load .gitignore in this directory
  let rules = [...parentRules];
  const gitignorePath = path.join(dir, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      rules = [...rules, ...parseGitignore(content)];
    }
  } catch {
    // Ignore read errors
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    // Check global ignore patterns
    if (!showAll) {
      let globallyIgnored = false;
      for (const pattern of globalIgnores) {
        if (matchesSimplePattern(fullPath, pattern) || matchesSimplePattern(relPath, pattern)) {
          globallyIgnored = true;
          break;
        }
      }
      if (globallyIgnored) continue;
    }

    const isDir = entry.isDirectory();

    // Check .gitignore rules
    if (!showAll && isIgnored(relPath, isDir, rules)) {
      continue;
    }

    if (isDir) {
      // Skip symlinks to directories to avoid loops
      if (entry.isSymbolicLink()) continue;
      walkDir(fullPath, rootDir, rules, globalIgnores, showAll, results);
    } else {
      // Check if it's a markdown file (or showAll with any file)
      if (isMarkdownFile(entry.name)) {
        try {
          const stat = fs.statSync(fullPath);
          const note = path.relative(rootDir, fullPath);
          const body = ''; // Body is loaded lazily
          results.push(newMarkdown(fullPath, note, body, stat.mtime));
          buildFilterValue(results[results.length - 1]);
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// Async command for use with bubbletea
// --------------------------------------------------------------------------

/**
 * Create a bubbletea Cmd that walks the filesystem and returns found markdowns.
 */
export function findMarkdownsCmd(rootDir: string, cfg: Config): () => FoundMarkdownsMsg {
  return () => {
    const mds = findMarkdowns(rootDir, cfg);
    return new FoundMarkdownsMsg(mds);
  };
}
