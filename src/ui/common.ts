// common.ts — State and view helpers shared by the Glow TUI models
// Port of the commonModel / errorView / indent / glowLogoView pieces of
// charmbracelet/glow/ui/ui.go and ui/stash.go (glow v3)

import type { Config } from '../config.js';
import type { Styles } from './styles.js';

/** State shared between the top-level model, the stash and the pager. */
export interface CommonModel {
  cfg: Config;
  cwd: string;
  width: number;
  height: number;
  /**
   * Current styles. Built for a dark background at startup and rebuilt when
   * Bubble Tea reports the terminal's background color.
   */
  styles: Styles;
}

/** Render the Glow logo with the given styles. */
export function glowLogoView(styles: Styles): string {
  return styles.logoStyle.render(' Glow ');
}

/** Render an error view with a styled title, the error and an exit hint. */
export function errorView(styles: Styles, err: Error, fatal: boolean): string {
  let exitMsg = 'press any key to ';
  exitMsg += fatal ? 'exit' : 'return';
  const s = `${styles.errorTitleStyle.render('ERROR')}\n\n${err.message}\n\n${styles.subtleStyle.render(exitMsg)}`;
  return '\n' + indent(s, 3);
}

/** Add `n` spaces of indentation to each line of `s`. */
export function indent(s: string, n: number): string {
  if (n <= 0) return s;
  const prefix = ' '.repeat(n);
  return s
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}
