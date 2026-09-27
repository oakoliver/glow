// stash.ts — File browser / stash view for the Glow TUI
// Port of charmbracelet/glow/ui/stash.go (glow v3)

import * as fs from 'node:fs';
import { stringWidth } from '@oakoliver/lipgloss';
import { type Msg, type Cmd, KeyPressMsg, Batch } from '@oakoliver/bubbletea';
import {
  SpinnerModel,
  newSpinner,
  Line as SpinnerLine,
  TextInputModel,
  newTextInput,
  textInputBlink,
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
import { newStyles, type Styles } from './styles.js';
import { type CommonModel, errorView, glowLogoView, indent } from './common.js';
import { stashItemView, type StashItemContext, truncateWithTail } from './stashitem.js';
import { renderHelp, type HelpViewContext, concatStringSlices } from './stashhelp.js';
import { openEditor } from './editor.js';
import { findMarkdowns, FoundMarkdownsMsg } from './filewalk.js';
import type { Config } from '../config.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const stashIndent = 1;
const stashViewItemHeight = 3; // height of stash entry, including gap
const stashViewTopPadding = 5; // logo, status bar, gaps
const stashViewBottomPadding = 3; // pagination and gaps, but not help
const stashViewHorizontalPadding = 6;
const ellipsis = '…';

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

const stashingStatusMessage: StatusMessage = {
  status: StatusMessageType.Normal,
  message: 'Stashing...',
};

/** Format a status message string with styling based on its type. */
export function formatStatusMessage(s: StatusMessage, styles: Styles = newStyles(true)): string {
  switch (s.status) {
    case StatusMessageType.Subtle:
      return styles.dimGreenFg(s.message);
    case StatusMessageType.Error:
      return styles.redFg(s.message);
    case StatusMessageType.Normal:
    default:
      return styles.greenFg(s.message);
  }
}

export interface Section {
  key: SectionKey;
  paginator: PaginatorModel;
  cursor: number;
}

/** Returns a new section with a dot paginator. */
function newSection(key: SectionKey): Section {
  const p = newPaginator();
  p.type = PaginatorType.Dots;
  return { key, paginator: p, cursor: 0 };
}

/** Returns the default set of sections. */
export function newSections(): Record<SectionKey, Section> {
  return {
    [SectionKey.DocumentsSection]: newSection(SectionKey.DocumentsSection),
    [SectionKey.FilterSection]: newSection(SectionKey.FilterSection),
  };
}

/**
 * english.Plural(n, singular, "") from go-humanize: "1 document",
 * "2 documents", "0 documents".
 */
export function plural(n: number, singular: string, pluralForm = ''): string {
  const word = n === 1 ? singular : pluralForm || singular + 's';
  return `${n} ${word}`;
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
    if (!md.localPath) {
      return new ErrMsg(new Error('could not load file: missing path'));
    }
    try {
      md.body = fs.readFileSync(md.localPath, 'utf-8');
      return new FetchedMarkdownMsg(md);
    } catch (err) {
      return new ErrMsg(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

/** Fuzzy filter markdowns against the filter input value. */
export function filterMarkdowns(m: StashModel): Cmd {
  const value = m.filterInput.value();
  const applied = m.filterApplied();
  const mds = [...m.markdowns];
  return () => {
    if (value === '' || !applied) {
      return new FilteredMarkdownMsg(mds); // return everything
    }
    const term = normalize(value).toLowerCase();
    const filtered = mds.filter((md) => {
      const val = md.filterValue || normalize(md.note);
      return fuzzyMatch(val.toLowerCase(), term);
    });
    return new FilteredMarkdownMsg(filtered);
  };
}

/** Cmd that searches the working directory for markdown files. */
export function findLocalFiles(common: CommonModel): Cmd {
  return () => new FoundMarkdownsMsg(findMarkdowns(common.cwd, common.cfg));
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
// StashModel
// --------------------------------------------------------------------------

export class StashModel {
  common: CommonModel;
  err: Error | null = null;

  spinner: SpinnerModel;
  filterInput: TextInputModel;

  viewState: StashViewState = StashViewState.Ready;
  filterState: FilterState = FilterState.Unfiltered;
  showFullHelp = false;
  showStatusMessage = false;
  statusMessage: StatusMessage = { status: StatusMessageType.Normal, message: '' };
  statusMessageTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Available document sections we can cycle through. We use an array,
   * rather than a map, because order is important.
   */
  sections: Section[];

  /** Index of the section we're currently looking at. */
  sectionIndex = 0;

  /** Tracks if docs were loaded. */
  loaded = false;

  /** The master set of markdown documents we're working with. */
  markdowns: Markdown[] = [];

  /** Markdown documents we're currently displaying (ephemeral). */
  filteredMarkdowns: Markdown[] = [];

  constructor(cfg: Config, common?: CommonModel) {
    this.common = common ?? {
      cfg,
      cwd: process.cwd(),
      width: 0,
      height: 0,
      styles: newStyles(true),
    };
    const styles = this.common.styles;

    this.spinner = newSpinner();
    this.spinner.spinner = SpinnerLine;
    this.spinner.style = styles.stashSpinnerStyle;

    this.filterInput = newTextInput();
    this.filterInput.prompt = 'Find:';
    // The filter input is rendered inline into the larger stash view, so draw
    // the cursor as part of the string rather than moving the real one.
    this.filterInput.setVirtualCursor(true);
    this.styleFilterInput(styles);
    this.filterInput.focus();

    this.sections = [newSections()[SectionKey.DocumentsSection]];
    this.stylePaginators(styles);
  }

  get cfg(): Config {
    return this.common.cfg;
  }

  get width(): number {
    return this.common.width;
  }

  get height(): number {
    return this.common.height;
  }

  // -- Styles --

  /** Updates the paginators with the current styles. */
  stylePaginators(styles: Styles): void {
    for (const s of this.sections) {
      s.paginator.activeDot = styles.brightGrayFg('•');
      s.paginator.inactiveDot = styles.darkGrayFg.render('•');
    }
  }

  private styleFilterInput(styles: Styles): void {
    const tsi = this.filterInput.styles();
    tsi.focused.prompt = styles.stashInputPromptStyle;
    tsi.blurred.prompt = styles.stashInputPromptStyle;
    tsi.cursor.color = styles.fuchsia;
    this.filterInput.setStyles(tsi);
  }

  /** Apply new styles (e.g. after the terminal reported its background). */
  setStyles(styles: Styles): void {
    this.common.styles = styles;
    this.spinner.style = styles.stashSpinnerStyle;
    this.styleFilterInput(styles);
    this.stylePaginators(styles);
  }

  // -- Accessors --

  loadingDone(): boolean {
    return this.loaded;
  }

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

  /** Whether or not the spinner should be spinning. */
  shouldSpin(): boolean {
    return !this.loadingDone() || this.viewState === StashViewState.LoadingDocument;
  }

  /** Cmd that starts the spinner. */
  spinnerTick(): Cmd {
    return () => this.spinner.tick();
  }

  // -- Layout --

  setSize(width: number, height: number): void {
    this.common.width = width;
    this.common.height = height;
    this.filterInput.setWidth(
      width - stashViewHorizontalPadding * 2 - stringWidth(this.filterInput.prompt),
    );
    this.updatePagination();
  }

  /** Alias for setSize. */
  resize(w: number, h: number): void {
    this.setSize(w, h);
  }

  // -- Filtering --

  resetFiltering(): void {
    this.filterState = FilterState.Unfiltered;
    this.filterInput.reset();
    this.filteredMarkdowns = [];

    sortMarkdowns(this.markdowns);

    // If the filtered section is present (it's always at the end) slice it
    // out of the sections array to remove it from the UI.
    if (this.sections[this.sections.length - 1].key === SectionKey.FilterSection) {
      this.sections = this.sections.slice(0, -1);
    }

    // If the current section is out of bounds return to the first section.
    if (this.sectionIndex > this.sections.length - 1) {
      this.sectionIndex = 0;
    }

    this.updatePagination();
  }

  /** Is a filter currently being applied? */
  filterApplied(): boolean {
    return this.filterState !== FilterState.Unfiltered;
  }

  /** Whether the stash is currently editing the filter. */
  get isFiltering(): boolean {
    return this.filterState === FilterState.Filtering;
  }

  /** Should we be updating the filter? */
  shouldUpdateFilter(): boolean {
    return this.filterApplied();
  }

  // -- Pagination --

  /** Update pagination according to the amount of markdowns for the current state. */
  updatePagination(): void {
    const [, helpHeight] = this.helpView();

    const availableHeight =
      this.common.height - stashViewTopPadding - helpHeight - stashViewBottomPadding;

    this.paginator().perPage = Math.max(1, Math.floor(availableHeight / stashViewItemHeight));

    const pages = this.getVisibleMarkdowns().length;
    this.paginator().setTotalPages(pages < 1 ? 1 : pages);

    // Make sure the page stays in bounds
    if (this.paginator().page >= this.paginator().totalPages - 1) {
      this.paginator().page = Math.max(0, this.paginator().totalPages - 1);
    }
  }

  /** Returns the index of the currently selected markdown item. */
  markdownIndex(): number {
    return this.paginator().page * this.paginator().perPage + this.cursor();
  }

  /** Return the current selected markdown in the stash. */
  selectedMarkdown(): Markdown | null {
    const i = this.markdownIndex();
    const mds = this.getVisibleMarkdowns();
    if (i < 0 || mds.length === 0 || mds.length <= i) {
      return null;
    }
    return mds[i];
  }

  // -- Data --

  /** Adds markdown documents to the model. */
  addMarkdowns(mds: Markdown[] | Markdown, ...rest: Markdown[]): void {
    const items = Array.isArray(mds) ? mds : [mds, ...rest];
    if (items.length === 0) return;

    this.markdowns.push(...items);
    if (!this.filterApplied()) {
      sortMarkdowns(this.markdowns);
    }

    this.updatePagination();
  }

  /** Returns the markdowns that should be currently shown. */
  getVisibleMarkdowns(): Markdown[] {
    if (
      this.filterState === FilterState.Filtering ||
      this.currentSection().key === SectionKey.FilterSection
    ) {
      return this.filteredMarkdowns;
    }
    return this.markdowns;
  }

  // -- Actions --

  /** Command for opening a markdown document in the pager. Alters the model. */
  openMarkdown(md: Markdown): Cmd {
    this.viewState = StashViewState.LoadingDocument;
    return Batch(loadLocalMarkdown(md), this.spinnerTick());
  }

  hideStatusMessage(): void {
    this.showStatusMessage = false;
    this.statusMessage = { status: StatusMessageType.Normal, message: '' };
    if (this.statusMessageTimer !== null) {
      clearTimeout(this.statusMessageTimer);
      this.statusMessageTimer = null;
    }
  }

  // -- Cursor movement --

  moveCursorUp(): void {
    this.setCursor(this.cursor() - 1);
    if (this.cursor() < 0 && this.paginator().page === 0) {
      // Stop
      this.setCursor(0);
      return;
    }

    if (this.cursor() >= 0) {
      return;
    }
    // Go to previous page
    this.paginator().prevPage();

    this.setCursor(this.paginator().itemsOnPage(this.getVisibleMarkdowns().length) - 1);
  }

  moveCursorDown(): void {
    const itemsOnPage = this.paginator().itemsOnPage(this.getVisibleMarkdowns().length);

    this.setCursor(this.cursor() + 1);
    if (this.cursor() < itemsOnPage) {
      return;
    }

    if (!this.paginator().onLastPage()) {
      this.paginator().nextPage();
      this.setCursor(0);
      return;
    }

    // During filtering the cursor position can exceed the number of
    // itemsOnPage. It's more intuitive to start the cursor at the topmost
    // position when moving it down in this scenario.
    if (this.cursor() > itemsOnPage) {
      this.setCursor(0);
      return;
    }
    this.setCursor(itemsOnPage - 1);
  }

  // -- Update --

  update(msg: Msg): [StashModel, Cmd] {
    const cmds: Cmd[] = [];

    if (msg instanceof ErrMsg) {
      this.err = msg.err;
    } else if (msg instanceof LocalFileSearchFinished) {
      // We're finished searching for local files
      this.loaded = true;
    } else if (msg instanceof FilteredMarkdownMsg) {
      this.filteredMarkdowns = msg.markdowns;
      this.setCursor(0);
      return [this, null];
    } else if (isSpinnerTick(msg)) {
      if (this.shouldSpin()) {
        const [sp, cmd] = this.spinner.update(msg);
        this.spinner = sp;
        cmds.push(cmd);
      }
    } else if (msg instanceof StatusMessageTimeoutMsg) {
      this.hideStatusMessage();
    }

    if (this.filterState === FilterState.Filtering) {
      cmds.push(this.handleFiltering(msg));
      return [this, Batch(...cmds)];
    }

    // Updates per the current state
    switch (this.viewState) {
      case StashViewState.Ready:
        cmds.push(this.handleDocumentBrowsing(msg));
        break;
      case StashViewState.ShowingError:
        // Any key exits the error view
        if (msg instanceof KeyPressMsg) {
          this.viewState = StashViewState.Ready;
        }
        break;
      default:
        break;
    }

    return [this, Batch(...cmds)];
  }

  // -- Key handling: browsing --

  /** Updates for when a user is browsing the markdown listing. */
  handleDocumentBrowsing(msg: Msg): Cmd {
    const cmds: Cmd[] = [];

    const numDocs = this.getVisibleMarkdowns().length;

    if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'k':
        case 'ctrl+k':
        case 'up':
          this.moveCursorUp();
          break;

        case 'j':
        case 'ctrl+j':
        case 'down':
          this.moveCursorDown();
          break;

        // Go to the very start
        case 'home':
        case 'g':
          this.paginator().page = 0;
          this.setCursor(0);
          break;

        // Go to the very end
        case 'end':
        case 'G':
          this.paginator().page = this.paginator().totalPages - 1;
          this.setCursor(this.paginator().itemsOnPage(numDocs) - 1);
          break;

        // Clear filter (if applicable)
        case 'esc':
          if (this.filterApplied()) {
            this.resetFiltering();
          }
          break;

        // Next section
        case 'tab':
        case 'L':
          if (this.sections.length === 0 || this.filterState === FilterState.Filtering) break;
          this.sectionIndex++;
          if (this.sectionIndex >= this.sections.length) {
            this.sectionIndex = 0;
          }
          this.updatePagination();
          break;

        // Previous section
        case 'shift+tab':
        case 'H':
          if (this.sections.length === 0 || this.filterState === FilterState.Filtering) break;
          this.sectionIndex--;
          if (this.sectionIndex < 0) {
            this.sectionIndex = this.sections.length - 1;
          }
          this.updatePagination();
          break;

        case 'F':
          this.loaded = false;
          return findLocalFiles(this.common);

        // Edit document in EDITOR
        case 'e': {
          const md = this.selectedMarkdown();
          // In case no file is available
          if (md === null) {
            return null;
          }
          return openEditor(md.localPath, 0);
        }

        // Open document
        case 'enter': {
          this.hideStatusMessage();
          if (numDocs === 0) break;
          const md = this.selectedMarkdown();
          if (md) cmds.push(this.openMarkdown(md));
          break;
        }

        // Filter your notes
        case '/':
          this.hideStatusMessage();

          // Build values we'll filter against
          for (const md of this.markdowns) {
            buildFilterValue(md);
          }

          this.filteredMarkdowns = this.markdowns;

          this.paginator().page = 0;
          this.setCursor(0);
          this.filterState = FilterState.Filtering;
          this.filterInput.cursorEnd();
          this.filterInput.focus();
          return textInputBlink;

        // Toggle full help
        case '?':
          this.showFullHelp = !this.showFullHelp;
          this.updatePagination();
          break;

        // Show errors
        case '!':
          if (this.err !== null && this.viewState === StashViewState.Ready) {
            this.viewState = StashViewState.ShowingError;
            return null;
          }
          break;

        default:
          break;
      }
    }

    // Update paginator.
    const [pg, pgCmd] = this.paginator().update(msg);
    this.currentSection().paginator = pg;
    cmds.push(pgCmd);

    // Extra paginator keystrokes
    if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'b':
        case 'u':
          this.paginator().prevPage();
          break;
        case 'f':
        case 'd':
          this.paginator().nextPage();
          break;
        default:
          break;
      }
    }

    // Keep the index in bounds when paginating
    const itemsOnPage = this.paginator().itemsOnPage(this.getVisibleMarkdowns().length);
    if (this.cursor() > itemsOnPage - 1) {
      this.setCursor(Math.max(0, itemsOnPage - 1));
    }

    return Batch(...cmds);
  }

  // -- Key handling: filtering --

  /** Updates for when a user is in the filter editing interface. */
  handleFiltering(msg: Msg): Cmd {
    const cmds: Cmd[] = [];

    if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'esc':
          // Cancel filtering
          this.resetFiltering();
          break;

        case 'enter':
        case 'tab':
        case 'shift+tab':
        case 'ctrl+k':
        case 'up':
        case 'ctrl+j':
        case 'down': {
          this.hideStatusMessage();

          if (this.markdowns.length === 0) break;

          const h = this.getVisibleMarkdowns();

          // If we've filtered down to nothing, clear the filter
          if (h.length === 0) {
            this.viewState = StashViewState.Ready;
            this.resetFiltering();
            break;
          }

          // When there's only one filtered markdown left we can just "open"
          // it directly
          if (h.length === 1) {
            this.viewState = StashViewState.Ready;
            this.resetFiltering();
            cmds.push(this.openMarkdown(h[0]));
            break;
          }

          // Add new section if it's not present
          if (this.sections[this.sections.length - 1].key !== SectionKey.FilterSection) {
            const section = newSections()[SectionKey.FilterSection];
            section.paginator.activeDot = this.common.styles.brightGrayFg('•');
            section.paginator.inactiveDot = this.common.styles.darkGrayFg.render('•');
            this.sections.push(section);
          }
          this.sectionIndex = this.sections.length - 1;

          this.filterInput.blur();

          this.filterState = FilterState.FilterApplied;
          if (this.filterInput.value() === '') {
            this.resetFiltering();
          }
          break;
        }

        default:
          break;
      }
    }

    // Update the filter text input component
    const currentFilterVal = this.filterInput.value();
    const [ti, inputCmd] = this.filterInput.update(msg);
    this.filterInput = ti;
    const newFilterVal = this.filterInput.value();
    cmds.push(inputCmd);

    // If the filtering input has changed, request updated filtering
    if (newFilterVal !== currentFilterVal) {
      cmds.push(filterMarkdowns(this));
    }

    // Update pagination
    this.updatePagination();

    return Batch(...cmds);
  }

  // -- View --

  view(): string {
    const styles = this.common.styles;
    const width = this.common.width;
    let s = '';

    switch (this.viewState) {
      case StashViewState.ShowingError:
        return errorView(styles, this.err ?? new Error('unknown error'), false);

      case StashViewState.LoadingDocument:
        s += ' ' + this.spinner.view() + ' Loading document...';
        break;

      case StashViewState.Ready: {
        const loadingIndicator = this.shouldSpin() ? this.spinner.view() : ' ';

        const header = this.headerView();

        // Rules for the logo, filter and status message.
        let logoOrFilter = ' ';
        if (this.showStatusMessage && this.filterState === FilterState.Filtering) {
          logoOrFilter += formatStatusMessage(this.statusMessage, styles);
        } else if (this.filterState === FilterState.Filtering) {
          logoOrFilter += this.filterInput.view();
        } else {
          logoOrFilter += glowLogoView(styles);
          if (this.showStatusMessage) {
            logoOrFilter += '  ' + formatStatusMessage(this.statusMessage, styles);
          }
        }
        logoOrFilter = truncateWithTail(logoOrFilter, Math.max(0, width - 1), ellipsis);

        const [help, helpHeight] = this.helpView();

        const populatedView = this.populatedView();
        const populatedViewHeight = (populatedView.match(/\n/g) ?? []).length + 2;

        // We need to fill any empty height with newlines so the footer
        // reaches the bottom.
        const availHeight =
          this.common.height -
          stashViewTopPadding -
          populatedViewHeight -
          helpHeight -
          stashViewBottomPadding;
        const blankLines = '\n'.repeat(Math.max(0, availHeight));

        let pagination = '';
        if (this.paginator().totalPages > 1) {
          pagination = this.paginator().view();

          // If the dot pagination is wider than the width of the window use
          // the arabic paginator.
          if (stringWidth(pagination) > width - stashViewHorizontalPadding) {
            const p = this.paginator();
            const prevType = p.type;
            p.type = PaginatorType.Arabic;
            pagination = styles.paginationStyle.render(p.view());
            p.type = prevType;
          }
        }

        s +=
          `${loadingIndicator}${logoOrFilter}\n\n  ${header}\n\n${populatedView}\n\n` +
          `${blankLines}  ${pagination}\n\n${help}`;
        break;
      }

      default:
        break;
    }

    return '\n' + indent(s, stashIndent);
  }

  headerView(): string {
    const styles = this.common.styles;
    const localCount = this.markdowns.length;

    const sections: string[] = [];

    // Filter results
    if (this.filterState === FilterState.Filtering) {
      if (localCount === 0) {
        return styles.grayFg('Nothing found.');
      }
      sections.push(`${localCount} local`);

      return sections.map((s) => styles.grayFg(s)).join(styles.dividerDot.toString());
    }

    // Tabs
    for (let i = 0; i < this.sections.length; i++) {
      const v = this.sections[i];
      let s = '';

      switch (v.key) {
        case SectionKey.DocumentsSection:
          s = plural(localCount, 'document', '');
          break;
        case SectionKey.FilterSection:
          s = `${this.filteredMarkdowns.length} “${this.filterInput.value()}”`;
          break;
      }

      if (this.sectionIndex === i && this.sections.length > 1) {
        s = styles.selectedTabStyle.render(s);
      } else {
        s = styles.tabStyle.render(s);
      }
      sections.push(s);
    }

    return sections.join(styles.dividerBar.toString());
  }

  populatedView(): string {
    const mds = this.getVisibleMarkdowns();
    const styles = this.common.styles;
    let b = '';

    // Empty states
    if (mds.length === 0) {
      const f = (s: string) => {
        b += '  ' + styles.grayFg(s);
      };

      switch (this.sections[this.sectionIndex].key) {
        case SectionKey.DocumentsSection:
          if (this.loadingDone()) {
            f('No files found.');
          } else {
            f('Looking for local files...');
          }
          break;
        case SectionKey.FilterSection:
          return '';
      }
    }

    if (mds.length > 0) {
      const [start, end] = this.paginator().getSliceBounds(mds.length);
      const docs = mds.slice(start, end);

      const ctx: StashItemContext = {
        width: this.common.width,
        horizontalPadding: stashViewHorizontalPadding,
        filterValue: this.filterInput.value(),
        isFiltering: this.filterState === FilterState.Filtering,
        isFilterApplied: this.filterState === FilterState.FilterApplied,
        singleFilteredItem:
          this.filterState === FilterState.Filtering && this.getVisibleMarkdowns().length === 1,
        sectionKey: this.currentSection().key,
        filterSectionKey: SectionKey.FilterSection,
        statusMessage: this.statusMessage.message,
        stashingStatusMessage: stashingStatusMessage.message,
        styles,
      };

      for (let i = 0; i < docs.length; i++) {
        const md = docs[i];
        b += stashItemView(ctx, i, md, i === this.cursor(), relativeTime(md.modtime));
        if (i !== docs.length - 1) {
          b += '\n\n';
        }
      }
    }

    // If there aren't enough items to fill up this page (always the last
    // page) then we need to add some newlines to fill up the space where
    // stash items would have been.
    const itemsOnPage = this.paginator().itemsOnPage(mds.length);
    if (itemsOnPage < this.paginator().perPage) {
      let n = (this.paginator().perPage - itemsOnPage) * stashViewItemHeight;
      if (mds.length === 0) {
        n -= stashViewItemHeight - 1;
      }
      b += '\n'.repeat(Math.max(0, n));
    }

    return b;
  }

  // -- Help --

  /**
   * Returns either the mini or full help view depending on the state of the
   * model, as well as the total height of the help view.
   */
  helpView(): [string, number] {
    const numDocs = this.getVisibleMarkdowns().length;

    // Help for when we're filtering
    if (this.filterState === FilterState.Filtering) {
      let h: string[];
      switch (numDocs) {
        case 0:
          h = ['enter/esc', 'cancel'];
          break;
        case 1:
          h = ['enter', 'open', 'esc', 'cancel'];
          break;
        default:
          h = ['enter', 'confirm', 'esc', 'cancel', 'ctrl+j/ctrl+k ↑/↓', 'choose'];
          break;
      }
      return this.renderHelp(h);
    }

    let navHelp: string[] = [];
    let filterHelp: string[];
    const selectionHelp: string[] = [];
    const editHelp: string[] = [];
    const sectionHelp: string[] = [];
    const appHelp: string[] = [];

    if (numDocs > 0 && this.showFullHelp) {
      navHelp = ['enter', 'open', 'j/k ↑/↓', 'choose'];
    }

    if (this.sections.length > 1) {
      if (this.showFullHelp) {
        navHelp.push('tab/shift+tab', 'section');
      } else {
        navHelp.push('tab', 'section');
      }
    }

    if (this.paginator().totalPages > 1) {
      navHelp.push('h/l ←/→', 'page');
    }

    // If we're browsing a filtered set
    if (this.filterApplied()) {
      filterHelp = ['/', 'edit search', 'esc', 'clear filter'];
    } else {
      filterHelp = ['/', 'find'];
    }

    // If there are errors
    if (this.err !== null) {
      appHelp.push('!', 'errors');
    }

    appHelp.push('r', 'refresh');

    if (numDocs > 0) {
      appHelp.push('e', 'edit');
    }

    appHelp.push('q', 'quit');

    // Detailed help
    if (this.showFullHelp) {
      appHelp.push('?', 'close help');
      return this.renderHelp(
        navHelp,
        filterHelp,
        concatStringSlices(selectionHelp, editHelp),
        sectionHelp,
        appHelp,
      );
    }

    // Mini help
    appHelp.push('?', 'more');
    return this.renderHelp(navHelp, filterHelp, selectionHelp, editHelp, sectionHelp, appHelp);
  }

  /** Returns the rendered help view and line height for the given groups. */
  renderHelp(...groups: string[][]): [string, number] {
    const ctx: HelpViewContext = {
      showFullHelp: this.showFullHelp,
      width: this.common.width,
      horizontalPadding: stashViewHorizontalPadding,
      styles: this.common.styles,
    };
    return renderHelp(ctx, groups);
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function isSpinnerTick(msg: Msg): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'spinner.tick'
  );
}
