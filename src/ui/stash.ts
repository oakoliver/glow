// stash.ts — File browser / stash view for the Glow TUI
// Port of charmbracelet/glow/ui/stash.go

import * as fs from 'node:fs';
import { newStyle, stringWidth } from '@oakoliver/lipgloss';
import {
  type Msg,
  type Cmd,
  KeyPressMsg,
  KeyCode,
  KeyMod,
  WindowSizeMsg,
  Batch,
  Tick,
} from '@oakoliver/bubbletea';
import {
  SpinnerModel,
  newSpinner,
  TextInputModel,
  newTextInput,
  PaginatorModel,
  newPaginator,
  PaginatorType,
} from '@oakoliver/bubbles';

import {
  type Markdown,
  relativeTime,
  sortMarkdowns,
  buildFilterValue,
  normalize,
} from './markdown.js';
import {
  greenFg,
  fuchsiaFg,
  dimFuchsiaFg,
  grayFg,
  midGrayFg,
  brightGrayFg,
  dimBrightGrayFg,
  redFg,
  errorTitleStyle,
  subtleStyle,
  cream,
  red,
  fuchsia,
  yellowGreen,
  darkGray,
} from './styles.js';
import { stashItemView, type StashItemContext, truncateWithTail } from './stashitem.js';
import {
  renderHelp,
  type HelpViewContext,
  concatStringSlices,
  MIN_HELP_VIEW_HEIGHT,
} from './stashhelp.js';
import { openEditor } from './editor.js';
import type { Config } from '../config.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const stashIndent = 1;
const stashViewItemHeight = 3;
const stashViewTopPadding = 5;
const stashViewBottomPadding = 3;
const stashViewHorizontalPadding = 6;
const ellipsis = '\u2026';
const statusMessageTimeout = 3000;

// --------------------------------------------------------------------------
// Enums / types
// --------------------------------------------------------------------------

export const enum StashViewState {
  Ready = 0,
  LoadingDocument = 1,
  ShowingError = 2,
}

export const enum SectionKey {
  DocumentsSection = 0,
  FilterSection = 1,
}

export const enum FilterState {
  Unfiltered = 0,
  Filtering = 1,
  FilterApplied = 2,
}

export const enum StatusMessageType {
  Normal = 0,
  Subtle = 1,
  Error = 2,
}

export interface StatusMessage {
  status: StatusMessageType;
  message: string;
}

/** Format a status message string with styling based on its type. */
export function formatStatusMessage(s: StatusMessage): string {
  switch (s.status) {
    case StatusMessageType.Error:
      return redFg(s.message);
    case StatusMessageType.Subtle:
      return subtleStyle().render(s.message);
    case StatusMessageType.Normal:
    default:
      return greenFg(s.message);
  }
}

export interface Section {
  key: SectionKey;
  paginator: PaginatorModel;
  cursor: number;
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

export class FilteredMarkdownMsg {
  readonly _tag = 'FilteredMarkdownMsg';
  constructor(public readonly markdowns: Markdown[]) {}
}

export class FetchedMarkdownMsg {
  readonly _tag = 'FetchedMarkdownMsg';
  constructor(public readonly markdown: Markdown) {}
}

export class LocalFileSearchFinished {
  readonly _tag = 'LocalFileSearchFinished';
}

export class StatusMessageTimeoutMsg {
  readonly _tag = 'StatusMessageTimeoutMsg';
  constructor(public readonly context: number) {}
}

export class ErrMsg {
  readonly _tag = 'ErrMsg';
  constructor(public readonly err: Error) {}
}

// --------------------------------------------------------------------------
// Standalone commands
// --------------------------------------------------------------------------

/** Read a markdown file from disk and return its content. */
export function loadLocalMarkdown(md: Markdown): Cmd {
  return async () => {
    try {
      const body = fs.readFileSync(md.localPath, 'utf-8');
      const loaded: Markdown = { ...md, body };
      return new FetchedMarkdownMsg(loaded);
    } catch (err) {
      return new ErrMsg(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

/** Fuzzy filter markdowns against the filter input value. */
export function filterMarkdowns(m: StashModel): Cmd {
  return () => {
    const term = normalize(m.filterInput.value().toLowerCase());
    if (term === '') {
      return new FilteredMarkdownMsg([...m.markdowns]);
    }
    const filtered = m.markdowns.filter((md) => {
      const val = md.filterValue || normalize(md.note);
      return fuzzyMatch(val.toLowerCase(), term);
    });
    return new FilteredMarkdownMsg(filtered);
  };
}

/** Simple fuzzy match: all needle chars must appear in order in haystack. */
function fuzzyMatch(haystack: string, needle: string): boolean {
  let hi = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    let found = false;
    while (hi < haystack.length) {
      if (haystack[hi] === c) {
        hi++;
        found = true;
        break;
      }
      hi++;
    }
    if (!found) return false;
  }
  return true;
}

// --------------------------------------------------------------------------
// Helper functions
// --------------------------------------------------------------------------

/** Render the Glow logo. */
export function glowLogoView(): string {
  return newStyle()
    .foreground(cream())
    .background(fuchsia())
    .padding(0, 1)
    .render(' Glow ');
}

/** Render an error view. */
export function errorView(err: Error, fatal: boolean): string {
  const title = fatal ? 'Error' : 'Heads Up';
  const header = errorTitleStyle().render(` ${title} `);
  const msg = newStyle().foreground(red()).render(err.message);
  return `${header}\n\n${msg}`;
}

/** Indent every line of a string by n spaces. */
export function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/** Create a new paginator configured for the stash view. */
export function newStashPaginator(): PaginatorModel {
  const p = newPaginator();
  p.type = PaginatorType.Dots;
  p.activeDot = fuchsiaFg('\u2022');
  p.inactiveDot = subtleStyle().render('\u2022');
  return p;
}

// --------------------------------------------------------------------------
// StashModel
// --------------------------------------------------------------------------

export class StashModel {
  width = 0;
  height = 0;
  cfg: Config;
  cwd = '';
  err: Error | null = null;

  spinner: SpinnerModel;
  filterInput: TextInputModel;

  viewState: StashViewState = StashViewState.Ready;
  filterState: FilterState = FilterState.Unfiltered;
  showFullHelp = false;
  showStatusMessage = false;
  statusMessage: StatusMessage = { status: StatusMessageType.Normal, message: '' };
  statusMessageTimer: ReturnType<typeof setTimeout> | null = null;
  statusMessageContext = 0;

  sections: Section[];
  sectionIndex = 0;

  loaded = false;
  markdowns: Markdown[] = [];
  filteredMarkdowns: Markdown[] = [];

  constructor(cfg: Config) {
    this.cfg = cfg;

    this.spinner = newSpinner();
    this.filterInput = newTextInput();
    this.filterInput.prompt = 'Find: ';
    this.filterInput.charLimit = 64;

    // Build sections
    this.sections = [
      { key: SectionKey.DocumentsSection, paginator: newStashPaginator(), cursor: 0 },
      { key: SectionKey.FilterSection, paginator: newStashPaginator(), cursor: 0 },
    ];
  }

  // -- Accessors --

  currentSection(): Section {
    return this.sections[this.sectionIndex];
  }

  paginator(): PaginatorModel {
    return this.currentSection().paginator;
  }

  cursor(): number {
    return this.currentSection().cursor;
  }

  setCursor(i: number): void {
    this.currentSection().cursor = i;
  }

  shouldSpin(): boolean {
    return !this.loaded || this.viewState === StashViewState.LoadingDocument;
  }

  // -- Layout --

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.filterInput.setWidth(w - stashViewHorizontalPadding * 2 - 1);
    this.updatePagination();
  }

  // -- Filtering --

  resetFiltering(): void {
    this.filterState = FilterState.Unfiltered;
    this.filterInput.reset();
    this.filteredMarkdowns = [];
    this.sectionIndex = SectionKey.DocumentsSection;
    this.updatePagination();
  }

  filterApplied(): boolean {
    return this.filterState === FilterState.FilterApplied;
  }

  shouldUpdateFilter(): boolean {
    return (
      this.filterState === FilterState.Filtering ||
      this.filterState === FilterState.FilterApplied
    );
  }

  // -- Pagination --

  updatePagination(): void {
    const visible = this.getVisibleMarkdowns();
    const availableHeight =
      this.height - stashViewTopPadding - stashViewBottomPadding;
    const perPage = Math.max(1, Math.floor(availableHeight / stashViewItemHeight));

    this.paginator().perPage = perPage;
    this.paginator().setTotalPages(visible.length);

    // Clamp cursor
    if (this.cursor() >= visible.length && visible.length > 0) {
      this.setCursor(visible.length - 1);
    }
  }

  markdownIndex(): number {
    const [start] = this.paginator().getSliceBounds(this.getVisibleMarkdowns().length);
    return start + this.cursor();
  }

  selectedMarkdown(): Markdown | null {
    const visible = this.getVisibleMarkdowns();
    const idx = this.markdownIndex();
    if (idx < 0 || idx >= visible.length) return null;
    return visible[idx];
  }

  // -- Data --

  addMarkdowns(mds: Markdown[] | Markdown, ...rest: Markdown[]): void {
    const items = Array.isArray(mds) ? mds : [mds, ...rest];
    for (const md of items) {
      buildFilterValue(md);
      this.markdowns.push(md);
    }
    sortMarkdowns(this.markdowns);
    this.updatePagination();
  }

  /** Alias for setSize — used by GlowModel (ui.ts interface). */
  resize(w: number, h: number): void {
    this.setSize(w, h);
  }

  /** Whether the stash is currently in filtering mode. */
  get isFiltering(): boolean {
    return this.filterState === FilterState.Filtering;
  }

  /** Re-apply the current filter after markdowns change. */
  updateFilter(): void {
    if (this.shouldUpdateFilter()) {
      const query = normalize(this.filterInput.value());
      if (query === '') {
        this.filteredMarkdowns = [...this.markdowns];
      } else {
        this.filteredMarkdowns = this.markdowns.filter((md) => {
          return md.filterValue.includes(query);
        });
      }
      this.updatePagination();
    }
  }

  getVisibleMarkdowns(): Markdown[] {
    if (this.filterState === FilterState.Filtering || this.filterState === FilterState.FilterApplied) {
      return this.filteredMarkdowns;
    }
    return this.markdowns;
  }

  // -- Actions --

  openMarkdown(md: Markdown): Cmd {
    this.viewState = StashViewState.LoadingDocument;
    return loadLocalMarkdown(md);
  }

  hideStatusMessage(): void {
    this.showStatusMessage = false;
    if (this.statusMessageTimer !== null) {
      clearTimeout(this.statusMessageTimer);
      this.statusMessageTimer = null;
    }
  }

  // -- Cursor movement --

  moveCursorUp(): void {
    const c = this.cursor();
    if (c > 0) {
      this.setCursor(c - 1);
    } else {
      // Go to previous page
      if (this.paginator().page > 0) {
        this.paginator().prevPage();
        const perPage = this.paginator().itemsOnPage(this.getVisibleMarkdowns().length);
        this.setCursor(Math.max(0, perPage - 1));
      }
    }
  }

  moveCursorDown(): void {
    const visible = this.getVisibleMarkdowns();
    const itemsOnPage = this.paginator().itemsOnPage(visible.length);
    const c = this.cursor();

    if (c < itemsOnPage - 1) {
      this.setCursor(c + 1);
    } else if (!this.paginator().onLastPage()) {
      this.paginator().nextPage();
      this.setCursor(0);
    }
  }

  // -- Update --

  update(msg: Msg): [StashModel, Cmd] {
    const cmds: Cmd[] = [];

    // Handle window resize
    if (msg instanceof WindowSizeMsg) {
      this.setSize(msg.width, msg.height);
      return [this, null];
    }

    // Handle status message timeout
    if (msg instanceof StatusMessageTimeoutMsg) {
      if (msg.context === this.statusMessageContext) {
        this.hideStatusMessage();
      }
      return [this, null];
    }

    // Handle error messages
    if (msg instanceof ErrMsg) {
      this.err = msg.err;
      this.viewState = StashViewState.ShowingError;
      return [this, null];
    }

    // Handle fetched markdown
    if (msg instanceof FetchedMarkdownMsg) {
      this.viewState = StashViewState.Ready;
      return [this, null];
    }

    // Handle filtered markdown results
    if (msg instanceof FilteredMarkdownMsg) {
      this.filteredMarkdowns = msg.markdowns;
      this.updatePagination();
      return [this, null];
    }

    // Handle local file search finished
    if (msg instanceof LocalFileSearchFinished) {
      this.loaded = true;
      return [this, null];
    }

    // Update spinner
    if (this.shouldSpin()) {
      const [sp, spCmd] = this.spinner.update(msg);
      this.spinner = sp;
      if (spCmd) cmds.push(spCmd);
    }

    // Key handling
    if (msg instanceof KeyPressMsg) {
      // Error state: any key dismisses
      if (this.viewState === StashViewState.ShowingError) {
        this.viewState = StashViewState.Ready;
        return [this, null];
      }

      if (this.filterState === FilterState.Filtering) {
        return this.handleFiltering(msg);
      }

      return this.handleDocumentBrowsing(msg);
    }

    return [this, cmds.length > 0 ? Batch(...cmds) : null];
  }

  // -- Key handling: browsing --

  handleDocumentBrowsing(msg: KeyPressMsg): [StashModel, Cmd] {
    const cmds: Cmd[] = [];

    switch (msg.text) {
      case 'q':
        // Quit is handled by the parent model
        break;

      case 'k':
        this.moveCursorUp();
        break;

      case 'j':
        this.moveCursorDown();
        break;

      case '/':
        this.filterState = FilterState.Filtering;
        this.sectionIndex = SectionKey.FilterSection;
        this.filterInput.cursorEnd();
        this.filterInput.focus();
        this.updatePagination();
        break;

      case '?':
        this.showFullHelp = !this.showFullHelp;
        this.updatePagination();
        break;

      case 'e': {
        const md = this.selectedMarkdown();
        if (md) {
          cmds.push(openEditor(md.localPath));
        }
        break;
      }

      default:
        break;
    }

    // Special key codes
    switch (msg.code) {
      case KeyCode.Enter: {
        const md = this.selectedMarkdown();
        if (md) {
          cmds.push(this.openMarkdown(md));
        }
        break;
      }

      case KeyCode.Up:
        this.moveCursorUp();
        break;

      case KeyCode.Down:
        this.moveCursorDown();
        break;

      case KeyCode.Home:
        this.paginator().page = 0;
        this.setCursor(0);
        break;

      case KeyCode.End: {
        const visible = this.getVisibleMarkdowns();
        this.paginator().page = Math.max(0, this.paginator().totalPages - 1);
        const itemsOnLastPage = this.paginator().itemsOnPage(visible.length);
        this.setCursor(Math.max(0, itemsOnLastPage - 1));
        break;
      }

      default:
        break;
    }

    // Ctrl+key combos
    if (msg.mod & KeyMod.Ctrl) {
      if (msg.text === 'c') {
        // Handled by parent
      }
    }

    // Update paginator with the message
    const [pg, pgCmd] = this.paginator().update(msg);
    this.currentSection().paginator = pg;
    if (pgCmd) cmds.push(pgCmd);

    return [this, cmds.length > 0 ? Batch(...cmds) : null];
  }

  // -- Key handling: filtering --

  handleFiltering(msg: KeyPressMsg): [StashModel, Cmd] {
    const cmds: Cmd[] = [];

    switch (msg.code) {
      case KeyCode.Escape:
        if (this.filterInput.value() === '') {
          this.resetFiltering();
        } else {
          this.filterState = FilterState.FilterApplied;
          this.filterInput.blur();
        }
        return [this, null];

      case KeyCode.Enter:
        if (this.filterInput.value() !== '') {
          this.filterState = FilterState.FilterApplied;
          this.filterInput.blur();
        } else {
          this.resetFiltering();
        }
        return [this, null];

      case KeyCode.Tab:
        if (this.filterInput.value() !== '') {
          this.filterState = FilterState.FilterApplied;
          this.filterInput.blur();
        }
        return [this, null];

      default:
        break;
    }

    // Update text input
    const [ti, tiCmd] = this.filterInput.update(msg);
    this.filterInput = ti;
    if (tiCmd) cmds.push(tiCmd);

    // Re-filter markdowns after text change
    cmds.push(filterMarkdowns(this));

    return [this, cmds.length > 0 ? Batch(...cmds) : null];
  }

  // -- View --

  view(): string {
    if (this.viewState === StashViewState.ShowingError && this.err) {
      return indent(errorView(this.err, false), stashIndent);
    }

    if (this.markdowns.length === 0 && this.loaded) {
      return indent(this.emptyView(), stashIndent);
    }

    return this.populatedView();
  }

  private emptyView(): string {
    const logo = glowLogoView();
    let s = logo + '\n\n';

    if (this.loaded) {
      s += subtleStyle().render('No markdown files found.') + '\n\n';
      s += subtleStyle().render('Try running in a directory with markdown files or');
      s += '\n' + subtleStyle().render('pass a path to a directory containing markdown files.');
    } else {
      s += this.spinner.view() + ' Scanning for markdown files…';
    }

    return s;
  }

  helpView(): string {
    const ctx: HelpViewContext = {
      showFullHelp: this.showFullHelp,
      width: this.width,
      horizontalPadding: stashViewHorizontalPadding,
    };

    let groups: string[][];

    if (this.filterState === FilterState.Filtering) {
      groups = [
        ['enter', 'apply', 'esc', 'cancel'],
      ];
    } else if (this.filterApplied()) {
      groups = [
        ['enter', 'open', '/', 'filter', 'esc', 'clear filter', '?', 'help'],
      ];
    } else {
      const nav = ['↑/k', 'up', '↓/j', 'down', '/', 'filter', 'enter', 'open'];
      const actions = ['e', 'edit', '?', 'toggle help', 'q', 'quit'];
      groups = this.showFullHelp ? [nav, actions] : [concatStringSlices(nav, actions)];
    }

    const [helpStr] = renderHelp(ctx, groups);
    return helpStr;
  }

  headerView(): string {
    let s = '';

    if (this.showStatusMessage) {
      s += formatStatusMessage(this.statusMessage);
    } else if (this.filterState === FilterState.Filtering) {
      s += this.filterInput.view();
    } else if (this.filterApplied()) {
      const count = this.filteredMarkdowns.length;
      const label = count === 1 ? 'match' : 'matches';
      s += dimBrightGrayFg(`Filter: `) + fuchsiaFg(this.filterInput.value());
      s += dimBrightGrayFg(` (${count} ${label})`);
    } else {
      const logo = glowLogoView();
      const loading = this.shouldSpin() ? ` ${this.spinner.view()} Scanning…` : '';
      s += logo + loading;
    }

    return indent(s, stashIndent);
  }

  populatedView(): string {
    const visible = this.getVisibleMarkdowns();

    // Header
    let s = '\n' + this.headerView() + '\n\n';

    // No results
    if (visible.length === 0) {
      if (this.filterState === FilterState.Filtering || this.filterApplied()) {
        s += indent(subtleStyle().render('No matches.'), stashIndent + stashViewHorizontalPadding);
      }
      s += '\n\n';
      s += indent(this.helpView(), stashIndent);
      return s;
    }

    // Item list
    const [start, end] = this.paginator().getSliceBounds(visible.length);
    const pageItems = visible.slice(start, end);

    const ctx: StashItemContext = {
      width: this.width,
      horizontalPadding: stashViewHorizontalPadding,
      filterValue: this.filterInput.value(),
      isFiltering: this.filterState === FilterState.Filtering,
      isFilterApplied: this.filterApplied(),
      singleFilteredItem: this.filteredMarkdowns.length === 1,
      sectionKey: this.currentSection().key,
      filterSectionKey: SectionKey.FilterSection,
      statusMessage: this.statusMessage.message,
      stashingStatusMessage: '',
    };

    for (let i = 0; i < pageItems.length; i++) {
      const md = pageItems[i];
      const isSelected = i === this.cursor();
      const relTime = relativeTime(md.modtime);
      s += indent(stashItemView(ctx, i, md, isSelected, relTime), stashIndent + stashViewHorizontalPadding);
      if (i < pageItems.length - 1) {
        s += '\n';
      }
    }

    // Pad remaining lines
    const renderedItems = pageItems.length;
    const maxItems = this.paginator().perPage;
    const remaining = maxItems - renderedItems;
    if (remaining > 0) {
      s += '\n'.repeat(remaining * stashViewItemHeight);
    }

    // Pagination dots
    if (this.paginator().totalPages > 1) {
      s += '\n' + indent(this.paginator().view(), stashIndent + stashViewHorizontalPadding);
    }

    // Help
    s += '\n\n' + indent(this.helpView(), stashIndent);

    return s;
  }
}
