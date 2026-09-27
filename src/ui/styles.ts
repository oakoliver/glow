// styles.ts — Adaptive color palette and lipgloss styles for the Glow TUI
// Port of charmbracelet/glow/ui/styles.go (glow v3)
//
// In glow v3 styles are no longer package-level values resolved against a
// process-wide "is the terminal dark?" guess. Instead a Styles value is built
// for a given background, and the TUI rebuilds it when Bubble Tea reports the
// terminal's background color (BackgroundColorMsg). Until then the TUI
// defaults to a dark background.

import { newStyle, lightDark, type Style } from '@oakoliver/lipgloss';

/** A render function, like Go's `lipgloss.Style.Render` method value. */
export type RenderFunc = (...strs: string[]) => string;

/** Styles contains all styles used in the UI. */
export interface Styles {
  /** Whether these styles were resolved for a dark background. */
  isDark: boolean;

  fuchsia: string;

  dimNormalFg: RenderFunc;
  brightGrayFg: RenderFunc;
  dimBrightGrayFg: RenderFunc;
  grayFg: RenderFunc;
  midGrayFg: RenderFunc;
  darkGrayFg: Style;
  greenFg: RenderFunc;
  semiDimGreenFg: RenderFunc;
  dimGreenFg: RenderFunc;
  fuchsiaFg: RenderFunc;
  dimFuchsiaFg: RenderFunc;
  dullFuchsiaFg: RenderFunc;
  dimDullFuchsiaFg: RenderFunc;
  redFg: RenderFunc;

  tabStyle: Style;
  selectedTabStyle: Style;
  errorTitleStyle: Style;
  subtleStyle: Style;
  paginationStyle: Style;

  statusBarScrollPosStyle: RenderFunc;
  statusBarNoteStyle: RenderFunc;
  statusBarHelpStyle: RenderFunc;
  statusBarMessageStyle: RenderFunc;
  statusBarMessageScrollPosStyle: RenderFunc;
  statusBarMessageHelpStyle: RenderFunc;
  helpViewStyle: RenderFunc;
  lineNumberStyle: RenderFunc;

  dividerDot: Style;
  dividerBar: Style;
  logoStyle: Style;
  stashSpinnerStyle: Style;
  stashInputPromptStyle: Style;

  /** Returns the light or dark color variant for this background. */
  adaptive(light: string, dark: string): string;
}

function renderFn(style: Style): RenderFunc {
  return (...strs: string[]) => style.render(...strs);
}

/** Build all styles for the given terminal background. */
export function newStyles(isDark: boolean): Styles {
  const ld = lightDark(isDark);
  const adaptive = (light: string, dark: string): string => ld(light, dark) as string;

  // Colors
  const normalDim = adaptive('#A49FA5', '#777777');
  const gray = adaptive('#909090', '#626262');
  const midGray = adaptive('#B2B2B2', '#4A4A4A');
  const darkGray = adaptive('#DDDADA', '#3C3C3C');
  const brightGray = adaptive('#847A85', '#979797');
  const dimBrightGray = adaptive('#C2B8C2', '#4D4D4D');
  const cream = adaptive('#FFFDF5', '#FFFDF5');
  const yellowGreen = adaptive('#04B575', '#ECFD65');
  const fuchsia = adaptive('#EE6FF8', '#EE6FF8');
  const dimFuchsia = adaptive('#F1A8FF', '#99519E');
  const dullFuchsia = adaptive('#F793FF', '#AD58B4');
  const dimDullFuchsia = adaptive('#F6C9FF', '#7B4380');
  const green = '#04B575';
  const red = adaptive('#FF4672', '#ED567A');
  const semiDimGreen = adaptive('#35D79C', '#036B46');
  const dimGreen = adaptive('#72D2B0', '#0B5137');

  // Pager colors
  const mintGreen = adaptive('#89F0CB', '#89F0CB');
  const darkGreen = adaptive('#1C8760', '#1C8760');
  const lineNumberFg = adaptive('#656565', '#7D7D7D');
  const statusBarNoteFg = adaptive('#656565', '#7D7D7D');
  const statusBarBg = adaptive('#E6E6E6', '#242424');

  const darkGrayFg = newStyle().foreground(darkGray);
  const subtleStyle = newStyle().foreground(adaptive('#9B9B9B', '#5C5C5C'));

  return {
    isDark,
    fuchsia,
    adaptive,

    // Render-func styles
    dimNormalFg: renderFn(newStyle().foreground(normalDim)),
    brightGrayFg: renderFn(newStyle().foreground(brightGray)),
    dimBrightGrayFg: renderFn(newStyle().foreground(dimBrightGray)),
    grayFg: renderFn(newStyle().foreground(gray)),
    midGrayFg: renderFn(newStyle().foreground(midGray)),
    darkGrayFg,
    greenFg: renderFn(newStyle().foreground(green)),
    semiDimGreenFg: renderFn(newStyle().foreground(semiDimGreen)),
    dimGreenFg: renderFn(newStyle().foreground(dimGreen)),
    fuchsiaFg: renderFn(newStyle().foreground(fuchsia)),
    dimFuchsiaFg: renderFn(newStyle().foreground(dimFuchsia)),
    dullFuchsiaFg: renderFn(newStyle().foreground(dullFuchsia)),
    dimDullFuchsiaFg: renderFn(newStyle().foreground(dimDullFuchsia)),
    redFg: renderFn(newStyle().foreground(red)),

    // Named styles
    tabStyle: newStyle().foreground(adaptive('#909090', '#626262')),
    selectedTabStyle: newStyle().foreground(adaptive('#333333', '#979797')),
    errorTitleStyle: newStyle().foreground(cream).background(red).padding(0, 1),
    subtleStyle,
    paginationStyle: subtleStyle,

    // Pager styles
    statusBarScrollPosStyle: renderFn(
      newStyle().foreground(adaptive('#949494', '#5A5A5A')).background(statusBarBg),
    ),
    statusBarNoteStyle: renderFn(newStyle().foreground(statusBarNoteFg).background(statusBarBg)),
    statusBarHelpStyle: renderFn(
      newStyle().foreground(statusBarNoteFg).background(adaptive('#DCDCDC', '#323232')),
    ),
    statusBarMessageStyle: renderFn(newStyle().foreground(mintGreen).background(darkGreen)),
    statusBarMessageScrollPosStyle: renderFn(newStyle().foreground(mintGreen).background(darkGreen)),
    statusBarMessageHelpStyle: renderFn(newStyle().foreground('#B6FFE4').background(green)),
    helpViewStyle: renderFn(
      newStyle().foreground(statusBarNoteFg).background(adaptive('#f2f2f2', '#1B1B1B')),
    ),
    lineNumberStyle: renderFn(newStyle().foreground(lineNumberFg)),

    // Stash styles
    dividerDot: darkGrayFg.setString(' • '),
    dividerBar: darkGrayFg.setString(' │ '),
    logoStyle: newStyle().foreground('#ECFD65').background(fuchsia).bold(true),
    stashSpinnerStyle: newStyle().foreground(gray),
    stashInputPromptStyle: newStyle().foreground(yellowGreen).marginRight(1),
  };
}
