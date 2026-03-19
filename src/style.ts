// style.ts — CLI help styles for Glow
// Port of charmbracelet/glow/style.go

import { newStyle } from '@oakoliver/lipgloss';

/** Render text as a keyword (green on terminal). */
export function keyword(s: string): string {
  return newStyle().foreground('#04B575').render(s);
}

/** Render text as a paragraph with width and left padding. */
export function paragraph(s: string): string {
  return newStyle().width(78).padding(0, 0, 0, 2).render(s);
}
