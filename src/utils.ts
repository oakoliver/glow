// utils.ts — Utility functions for Glow
// Port of charmbracelet/glow/utils/utils.go

import * as path from 'node:path';
import * as os from 'node:os';
import {
  withStandardStyle,
  withStylePath,
  withStyles,
  withStylesFromJSONFile,
  DarkStyle,
  LightStyle,
  PinkStyle,
  NoTTYStyle,
  DraculaStyle,
  TokyoNightStyle,
  AutoStyleName,
  DarkStyleName,
  LightStyleName,
  PinkStyleName,
  NoTTYStyleName,
  DraculaStyleName,
  TokyoNightStyleName,
} from '@oakoliver/glamour';
import type { TermRendererOption, StyleConfig } from '@oakoliver/glamour';
import { shellFields, type Getenv } from './shell.js';

// --------------------------------------------------------------------------
// RemoveFrontmatter
// --------------------------------------------------------------------------

const yamlPattern = /^---\r?\n(\s*\r?\n)?/gm;

function detectFrontmatter(content: string): [number, number] {
  yamlPattern.lastIndex = 0;
  const matches: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = yamlPattern.exec(content)) !== null) {
    matches.push([m.index, m.index + m[0].length]);
    if (matches.length >= 2) break;
  }
  if (matches.length > 1) {
    return [matches[0][0], matches[1][1]];
  }
  return [-1, -1];
}

/** Remove YAML front matter from markdown content. */
export function removeFrontmatter(content: string): string {
  const [start, end] = detectFrontmatter(content);
  if (start === 0) {
    return content.slice(end);
  }
  return content;
}

/** Remove YAML front matter from a Buffer. */
export function removeFrontmatterBytes(content: Buffer): Buffer {
  const str = content.toString('utf-8');
  const result = removeFrontmatter(str);
  return Buffer.from(result, 'utf-8');
}

// --------------------------------------------------------------------------
// ExpandPath
// --------------------------------------------------------------------------

/** Expand ~ and environment variables in a path. */
export function expandPath(p: string): string {
  // Expand tilde
  if (p.startsWith('~/') || p === '~') {
    p = path.join(os.homedir(), p.slice(1));
  }
  // Expand environment variables ($VAR or ${VAR})
  p = p.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, unbraced) => {
    const name = braced || unbraced;
    return process.env[name] || '';
  });
  return p;
}

// --------------------------------------------------------------------------
// WrapCodeBlock
// --------------------------------------------------------------------------

/** Wrap a string in a fenced code block with the given language/extension. */
export function wrapCodeBlock(s: string, language: string): string {
  // Strip leading dot from extension
  if (language.startsWith('.')) {
    language = language.slice(1);
  }
  return '```' + language + '\n' + s + '```';
}

// --------------------------------------------------------------------------
// IsMarkdownFile
// --------------------------------------------------------------------------

const markdownExtensions = ['.md', '.mdown', '.mkdn', '.mkd', '.markdown'];

/** Returns whether the filename has a markdown extension. */
export function isMarkdownFile(filename: string): boolean {
  const ext = path.extname(filename);
  if (ext === '') {
    // By default, assume it's a markdown file.
    return true;
  }
  for (const v of markdownExtensions) {
    if (ext.toLowerCase() === v.toLowerCase()) {
      return true;
    }
  }
  // Has an extension but not markdown — assume it's a code file.
  return false;
}

// --------------------------------------------------------------------------
// GlamourStyle
// --------------------------------------------------------------------------

/**
 * Returns a glamour TermRendererOption based on the given style.
 * When rendering a pure code block, modifies the style to remove indentation.
 *
 * glow v3 (Glamour v2): the "auto" style no longer sniffs the terminal for
 * markdown documents; it always resolves to the standard "dark" style.
 */
export function glamourStyle(style: string, isCode: boolean): TermRendererOption {
  if (!isCode) {
    if (style === AutoStyleName) {
      return withStandardStyle(DarkStyleName);
    }
    return withStylePath(style);
  }

  // If we are rendering a pure code block, we need to modify the style to
  // remove the indentation.
  let styleConfig: StyleConfig;

  switch (style) {
    case AutoStyleName: {
      // lipgloss.HasDarkBackground(os.Stdin, os.Stdout) — we can't query the
      // terminal synchronously here, so detect via COLORFGBG (default dark).
      styleConfig = structuredClone(hasDarkBackground() ? DarkStyle : LightStyle);
      break;
    }
    case DarkStyleName:
      styleConfig = structuredClone(DarkStyle);
      break;
    case LightStyleName:
      styleConfig = structuredClone(LightStyle);
      break;
    case PinkStyleName:
      styleConfig = structuredClone(PinkStyle);
      break;
    case NoTTYStyleName:
      styleConfig = structuredClone(NoTTYStyle);
      break;
    case DraculaStyleName:
      styleConfig = structuredClone(DraculaStyle);
      break;
    case TokyoNightStyleName:
      styleConfig = structuredClone(TokyoNightStyle);
      break;
    default:
      return withStylesFromJSONFile(style);
  }

  // Remove code block margin for code file rendering
  if (styleConfig.code_block) {
    styleConfig.code_block.margin = 0;
  }

  return withStyles(styleConfig);
}

// --------------------------------------------------------------------------
// hasDarkBackground
// --------------------------------------------------------------------------

/**
 * Best-effort synchronous terminal background detection via $COLORFGBG
 * ("fg;bg", where a bg of 0-6 or 8 is dark). Defaults to dark.
 */
export function hasDarkBackground(env: string | undefined = process.env.COLORFGBG): boolean {
  if (!env) return true;
  const parts = env.split(';');
  const bg = parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(bg)) return true;
  return bg < 7 || bg === 8;
}

// --------------------------------------------------------------------------
// parsePagerCommand
// --------------------------------------------------------------------------

/**
 * Resolve the $PAGER command into program + args. Defaults to `less -r`.
 * glow v2.1.2+: parsed with shell syntax (quotes, escapes, $VARs) instead
 * of splitting on spaces.
 */
export function parsePagerCommand(
  pagerCmd: string | undefined,
  env: Getenv = (k) => process.env[k] ?? '',
): string[] {
  const cmd = pagerCmd || 'less -r';
  let fields: string[];
  try {
    fields = shellFields(cmd, env);
  } catch {
    throw new Error(`unable to parse PAGER command: ${cmd}`);
  }
  if (fields.length === 0) {
    throw new Error(`unable to parse PAGER command: ${cmd}`);
  }
  return fields;
}
