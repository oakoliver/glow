// filewalk.ts — local markdown file discovery for the Glow TUI
// Port of findLocalFiles / localFileToMarkdown in charmbracelet/glow/ui/ui.go

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findAllFilesExcept, findFilesExcept, type SearchResult } from './gitcha.js';
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
// File finder
// --------------------------------------------------------------------------

/**
 * Glob patterns of the files listed in the stash. Upstream: `markdownExtensions`
 * in glow/ui/ui.go (note: these are patterns, unlike the extension list in
 * utils.IsMarkdownFile, so files without an extension are not listed).
 */
export const markdownExtensions = ['*.md', '*.mdown', '*.mkdn', '*.mkd', '*.markdown'];

/**
 * Find the markdown files under rootDir, as glow v3.0.0's findLocalFiles does:
 * with ShowAllFiles, every matching file (hidden files, node_modules and
 * .gitignored paths included); otherwise skipping the platform ignore patterns
 * (dotfiles and dot-directories, node_modules, $GOPATH, ~/Library on macOS)
 * and whatever the enclosing git repository's .gitignore excludes.
 *
 * Throws if rootDir can't be resolved (upstream reports an errMsg).
 */
export function findMarkdowns(rootDir: string, cfg: Config): Markdown[] {
  const results = cfg.showAllFiles
    ? findAllFilesExcept(rootDir, markdownExtensions, null)
    : findFilesExcept(rootDir, markdownExtensions, ignorePatterns(cfg));
  return results.map((res) => localFileToMarkdown(rootDir, res));
}

/**
 * Convert a file finder result to a Markdown document (upstream:
 * localFileToMarkdown). Body is loaded lazily.
 */
export function localFileToMarkdown(cwd: string, res: SearchResult): Markdown {
  const md = newMarkdown(res.path, stripAbsolutePath(res.path, cwd), '', res.info.mtime);
  buildFilterValue(md);
  return md;
}

/** Upstream stripAbsolutePath: resolve symlinks on both paths, drop the cwd prefix. */
function stripAbsolutePath(fullPath: string, cwd: string): string {
  const evalSymlinks = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return '';
    }
  };
  const fp = evalSymlinks(fullPath);
  const cp = evalSymlinks(cwd);
  return fp.split(cp + path.sep).join('');
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
