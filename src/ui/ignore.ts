// ignore.ts — OS-specific ignore patterns for file walking
// Port of charmbracelet/glow/ui/ignore_darwin.go + ignore_general.go

import * as path from 'node:path';
import type { Config } from '../config.js';

/**
 * Returns the list of patterns to ignore when walking the filesystem.
 * On macOS, includes ~/Library. On all platforms, includes GOPATH,
 * node_modules, and dotfiles/dotdirectories.
 */
export function ignorePatterns(cfg: Config): string[] {
  const patterns: string[] = [];

  // macOS-specific
  if (process.platform === 'darwin') {
    patterns.push(path.join(cfg.homeDir, 'Library'));
  }

  // Common across all platforms. An empty GOPATH is harmless: gitcha joins
  // separator-less patterns onto the walked directory, which never matches.
  patterns.push(cfg.gopath);
  patterns.push('node_modules');
  patterns.push('.*'); // dotfiles / dotdirectories

  return patterns;
}
