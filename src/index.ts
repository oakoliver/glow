// index.ts — Barrel exports for @oakoliver/glow library usage
// Re-exports the public API surface for programmatic use.

// ─── Source type ─────────────────────────────────────────────────────────────
export type { Source } from './source.js';

// ─── Config ──────────────────────────────────────────────────────────────────
export {
  type Config,
  defaultConfig,
  getConfigDir,
  getCacheDir,
  getConfigFilePath,
  ensureConfigFile,
  parseSimpleYaml,
  loadConfigFile,
} from './config.js';

// ─── Utilities ───────────────────────────────────────────────────────────────
export {
  removeFrontmatter,
  removeFrontmatterBytes,
  expandPath,
  wrapCodeBlock,
  isMarkdownFile,
  glamourStyle,
} from './utils.js';

// ─── URL handling ────────────────────────────────────────────────────────────
export { readmeURL, isURL } from './url.js';

// ─── GitHub / GitLab ─────────────────────────────────────────────────────────
export { findGitHubREADME } from './github.js';
export { findGitLabREADME } from './gitlab.js';

// ─── CLI styles ──────────────────────────────────────────────────────────────
export { keyword, paragraph } from './style.js';

// ─── UI: Types & Models ─────────────────────────────────────────────────────
export {
  GlowModel,
  newGlowModel,
  NewProgram,
  State,
  FetchedMarkdownMsg,
  ContentRenderedMsg,
  FilteredMarkdownMsg,
  errorView,
  indent,
  stripAbsolutePath,
} from './ui/ui.js';

export type { CommonModel, StashModel as StashModelInterface, PagerModel as PagerModelInterface } from './ui/ui.js';

// ─── UI: Stash ───────────────────────────────────────────────────────────────
export { StashModel } from './ui/stash.js';

// ─── UI: Pager ───────────────────────────────────────────────────────────────
export { PagerModel } from './ui/pager.js';

// ─── UI: Markdown ────────────────────────────────────────────────────────────
export {
  type Markdown,
  newMarkdown,
  normalize,
  buildFilterValue,
  relativeTime,
  sortMarkdowns,
} from './ui/markdown.js';

// ─── UI: Styles ──────────────────────────────────────────────────────────────
export {
  adaptiveColor,
  cream,
  yellowGreen,
  green,
  fuchsia,
  dimFuchsia,
  red,
  darkGray,
  greenFg,
  fuchsiaFg,
  dimFuchsiaFg,
  grayFg,
  midGrayFg,
  brightGrayFg,
  dimBrightGrayFg,
  redFg,
  semiDimGreenFg,
  subtleStyle,
  errorTitleStyle,
} from './ui/styles.js';

// ─── UI: File walking ────────────────────────────────────────────────────────
export { findMarkdowns, FoundMarkdownsMsg } from './ui/filewalk.js';

// ─── UI: Editor ──────────────────────────────────────────────────────────────
export { EditorFinishedMsg, openEditor } from './ui/editor.js';

// ─── UI: Stash item rendering ───────────────────────────────────────────────
export { stashItemView, truncateWithTail } from './ui/stashitem.js';

// ─── UI: Help rendering ─────────────────────────────────────────────────────
export { renderHelp, newHelpColumn } from './ui/stashhelp.js';
export type { HelpViewContext } from './ui/stashhelp.js';
