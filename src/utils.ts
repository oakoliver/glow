// utils.ts — Utility functions for Glow
// Port of charmbracelet/glow/utils/utils.go

import * as path from 'node:path';
import * as os from 'node:os';
import {
  TermRenderer,
  withAutoStyle,
  withStylePath,
  withStyles,
  withStylesFromJSON,
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
 */
export function glamourStyle(style: string, isCode: boolean): TermRendererOption {
  if (!isCode) {
    if (style === AutoStyleName) {
      return withAutoStyle();
    }
    return withStylePath(style);
  }

  // If we are rendering a pure code block, we need to modify the style to
  // remove the indentation.
  let styleConfig: StyleConfig;

  switch (style) {
    case AutoStyleName: {
      // Detect dark/light — default to dark
      const isDark = process.env.COLORFGBG
        ? !process.env.COLORFGBG.endsWith(';0')
        : true;
      styleConfig = structuredClone(isDark ? DarkStyle : LightStyle);
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
      return withStylesFromJSON(style);
  }

  // Remove code block margin for code file rendering
  if (styleConfig.code_block) {
    styleConfig.code_block.margin = 0;
  }

  return withStyles(styleConfig);
}
