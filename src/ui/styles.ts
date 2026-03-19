// styles.ts — Adaptive color palette and lipgloss styles for Glow TUI
// Port of charmbracelet/glow/ui/styles.go

import { newStyle } from '@oakoliver/lipgloss';

// --------------------------------------------------------------------------
// Adaptive colors
// --------------------------------------------------------------------------

/**
 * Pick a color based on whether the terminal is dark or light.
 * We detect this via COLORFGBG env — if absent, default to dark.
 */
function isDarkTerminal(): boolean {
  const env = process.env.COLORFGBG;
  if (!env) return true;
  return !env.endsWith(';0');
}

/** Pick the light or dark variant of a color pair. */
export function adaptiveColor(light: string, dark: string): string {
  return isDarkTerminal() ? dark : light;
}

// --------------------------------------------------------------------------
// Color constants (using AdaptiveColor logic)
// --------------------------------------------------------------------------

export const normalDim = () => adaptiveColor('#A49FA5', '#777777');
export const gray = () => adaptiveColor('#909090', '#626262');
export const midGray = () => adaptiveColor('#B2B2B2', '#4A4A4A');
export const darkGray = () => adaptiveColor('#DDDADA', '#3C3C3C');
export const brightGray = () => adaptiveColor('#847A85', '#979797');
export const dimBrightGray = () => adaptiveColor('#C2B8C2', '#4D4D4D');
export const cream = () => adaptiveColor('#FFFDF5', '#FFFDF5');
export const yellowGreen = () => adaptiveColor('#04B575', '#ECFD65');
export const fuchsia = () => adaptiveColor('#EE6FF8', '#EE6FF8');
export const dimFuchsia = () => adaptiveColor('#F1A8FF', '#99519E');
export const dullFuchsia = () => adaptiveColor('#F793FF', '#AD58B4');
export const dimDullFuchsia = () => adaptiveColor('#F6C9FF', '#7B4380');
export const green = () => '#04B575';
export const red = () => adaptiveColor('#FF4672', '#ED567A');
export const semiDimGreen = () => adaptiveColor('#35D79C', '#036B46');
export const dimGreen = () => adaptiveColor('#72D2B0', '#0B5137');

// --------------------------------------------------------------------------
// Style render functions
// --------------------------------------------------------------------------

/** Render text with normalDim foreground. */
export function dimNormalFg(s: string): string {
  return newStyle().foreground(normalDim()).render(s);
}

/** Render text with brightGray foreground. */
export function brightGrayFg(s: string): string {
  return newStyle().foreground(brightGray()).render(s);
}

/** Render text with dimBrightGray foreground. */
export function dimBrightGrayFg(s: string): string {
  return newStyle().foreground(dimBrightGray()).render(s);
}

/** Render text with gray foreground. */
export function grayFg(s: string): string {
  return newStyle().foreground(gray()).render(s);
}

/** Render text with midGray foreground. */
export function midGrayFg(s: string): string {
  return newStyle().foreground(midGray()).render(s);
}

/** Get a style with darkGray foreground (not a render fn — used with .Render). */
export function darkGrayStyle() {
  return newStyle().foreground(darkGray());
}

/** Render text with green foreground. */
export function greenFg(s: string): string {
  return newStyle().foreground(green()).render(s);
}

/** Render text with semiDimGreen foreground. */
export function semiDimGreenFg(s: string): string {
  return newStyle().foreground(semiDimGreen()).render(s);
}

/** Render text with dimGreen foreground. */
export function dimGreenFg(s: string): string {
  return newStyle().foreground(dimGreen()).render(s);
}

/** Render text with fuchsia foreground. */
export function fuchsiaFg(s: string): string {
  return newStyle().foreground(fuchsia()).render(s);
}

/** Render text with dimFuchsia foreground. */
export function dimFuchsiaFg(s: string): string {
  return newStyle().foreground(dimFuchsia()).render(s);
}

/** Render text with dullFuchsia foreground. */
export function dullFuchsiaFg(s: string): string {
  return newStyle().foreground(dullFuchsia()).render(s);
}

/** Render text with dimDullFuchsia foreground. */
export function dimDullFuchsiaFg(s: string): string {
  return newStyle().foreground(dimDullFuchsia()).render(s);
}

/** Render text with red foreground. */
export function redFg(s: string): string {
  return newStyle().foreground(red()).render(s);
}

// --------------------------------------------------------------------------
// Compound styles
// --------------------------------------------------------------------------

/** Tab style — gray foreground. */
export function tabStyle() {
  return newStyle().foreground(adaptiveColor('#909090', '#626262'));
}

/** Selected tab style — brighter foreground. */
export function selectedTabStyle() {
  return newStyle().foreground(adaptiveColor('#333333', '#979797'));
}

/** Error title — cream on red with padding. */
export function errorTitleStyle() {
  return newStyle().foreground(cream()).background(red()).padding(0, 1);
}

/** Subtle / faded style. */
export function subtleStyle() {
  return newStyle().foreground(adaptiveColor('#9B9B9B', '#5C5C5C'));
}

/** Pagination style (alias for subtleStyle). */
export const paginationStyle = subtleStyle;
