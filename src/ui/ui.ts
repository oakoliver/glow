// ui.ts — Core TUI model for the Glow app
// Port of charmbracelet/glow/ui/ui.go

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type Model,
  type Msg,
  type Cmd,
  Program,
  KeyPressMsg,
  KeyCode,
  KeyMod,
  WindowSizeMsg,
  Quit,
  Suspend,
  Batch,
  WithAltScreen,
  WithMouseMode,
  MouseMode,
} from '@oakoliver/bubbletea';
import {
  TermRenderer,
  withWordWrap,
  withAutoStyle,
  withStylePath,
} from '@oakoliver/glamour';

import type { Config } from '../config.js';
import { removeFrontmatter } from '../utils.js';
import { type Markdown, newMarkdown, buildFilterValue } from './markdown.js';
import { errorTitleStyle, subtleStyle } from './styles.js';
import { findMarkdowns, FoundMarkdownsMsg } from './filewalk.js';

// --------------------------------------------------------------------------
// State enum
// --------------------------------------------------------------------------

export const enum State {
  ShowStash = 0,
  ShowDocument = 1,
}

// --------------------------------------------------------------------------
// Sibling model interfaces (forward declarations)
// --------------------------------------------------------------------------

/**
 * StashModel — the file list / stash view.
 * The actual implementation lives in ./stash.ts; we define the interface
 * here so ui.ts can compile independently.
 */
export interface StashModel {
  markdowns: Markdown[];
  filteredMarkdowns: Markdown[];
  isFiltering: boolean;
  update(msg: Msg): [StashModel, Cmd];
  view(): string;
  addMarkdowns(mds: Markdown[]): void;
  updateFilter(): void;
  resize(width: number, height: number): void;
}

/**
 * PagerModel — the document rendering view.
 * The actual implementation lives in ./pager.ts.
 */
export interface PagerModel {
  currentDocument: Markdown | null;
  update(msg: Msg): [PagerModel, Cmd];
  view(): string;
  setContent(rendered: string): void;
  setSize(width: number, height: number): void;
  unload(): void;
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/** Sent when markdown content has been fetched (e.g. read from disk). */
export class FetchedMarkdownMsg {
  readonly _tag = 'FetchedMarkdownMsg';
  constructor(
    public readonly markdown: Markdown,
    public readonly body: string,
  ) {}
}

/** Sent when glamour has finished rendering markdown content. */
export class ContentRenderedMsg {
  readonly _tag = 'ContentRenderedMsg';
  constructor(public readonly content: string) {}
}

/** Sent after filtering markdowns in the stash. */
export class FilteredMarkdownMsg {
  readonly _tag = 'FilteredMarkdownMsg';
  constructor(public readonly markdowns: Markdown[]) {}
}

// --------------------------------------------------------------------------
// CommonModel
// --------------------------------------------------------------------------

export interface CommonModel {
  cfg: Config;
  cwd: string;
  width: number;
  height: number;
}

// --------------------------------------------------------------------------
// GlowModel
// --------------------------------------------------------------------------

export class GlowModel implements Model {
  common: CommonModel;
  state: State;
  fatalErr: Error | null;
  stash: StashModel;
  pager: PagerModel;

  constructor(
    common: CommonModel,
    state: State,
    stash: StashModel,
    pager: PagerModel,
  ) {
    this.common = common;
    this.state = state;
    this.fatalErr = null;
    this.stash = stash;
    this.pager = pager;
  }

  init(): Cmd {
    if (this.state === State.ShowStash) {
      return findLocalFiles(this.common);
    }

    if (this.state === State.ShowDocument && this.pager.currentDocument) {
      const md = this.pager.currentDocument;
      return fetchAndRenderMarkdown(md, this.common);
    }

    return null;
  }

  update(msg: Msg): [Model, Cmd] {
    const cmds: Cmd[] = [];

    // If there's a fatal error, any key press quits
    if (this.fatalErr !== null) {
      if (msg instanceof KeyPressMsg) {
        return [this, Quit];
      }
      return [this, null];
    }

    // Global key handling
    if (msg instanceof KeyPressMsg) {
      const isCtrl = (msg.mod & (4 as KeyMod)) !== 0; // KeyMod.Ctrl = 4

      // ctrl+c → quit
      if (isCtrl && msg.text === 'c') {
        return [this, Quit];
      }

      // ctrl+z → suspend
      if (isCtrl && msg.text === 'z') {
        return [this, Suspend];
      }

      // escape — if showing document, go back to stash
      if (msg.code === (27 as number) && this.state === State.ShowDocument) {
        return unloadDocument(this);
      }

      // left / h / backspace — go back from document
      if (this.state === State.ShowDocument) {
        if (
          msg.code === (259 as number) || // KeyCode.Left
          msg.text === 'h' ||
          msg.code === (127 as number) // KeyCode.Delete (backspace)
        ) {
          return unloadDocument(this);
        }
      }

      // Stash-specific keys (only when not filtering)
      if (this.state === State.ShowStash && !this.stash.isFiltering) {
        // q → quit
        if (msg.text === 'q') {
          return [this, Quit];
        }

        // r → refresh files
        if (msg.text === 'r') {
          cmds.push(findLocalFiles(this.common));
        }
      }
    }

    // Window size
    if (msg instanceof WindowSizeMsg) {
      this.common.width = msg.width;
      this.common.height = msg.height;
      this.stash.resize(msg.width, msg.height);
      this.pager.setSize(msg.width, msg.height);
      return [this, null];
    }

    // FetchedMarkdownMsg — set on pager and render
    if (msg instanceof FetchedMarkdownMsg) {
      const md = msg.markdown;
      md.body = msg.body;
      this.pager.currentDocument = md;
      cmds.push(renderWithGlamour(md.body, this.common));
      return [this, Batch(...cmds)];
    }

    // ContentRenderedMsg — switch to document view
    if (msg instanceof ContentRenderedMsg) {
      this.pager.setContent(msg.content);
      this.state = State.ShowDocument;
      return [this, Batch(...cmds)];
    }

    // FoundMarkdownsMsg — add results to stash
    if (msg instanceof FoundMarkdownsMsg) {
      this.stash.addMarkdowns(msg.markdowns);
      this.stash.updateFilter();
      return [this, Batch(...cmds)];
    }

    // FilteredMarkdownMsg — pass to stash
    if (msg instanceof FilteredMarkdownMsg) {
      this.stash.filteredMarkdowns = msg.markdowns;
      return [this, null];
    }

    // Delegate to active child model
    if (this.state === State.ShowDocument) {
      const [updatedPager, pagerCmd] = this.pager.update(msg);
      this.pager = updatedPager;
      cmds.push(pagerCmd);
    } else {
      const [updatedStash, stashCmd] = this.stash.update(msg);
      this.stash = updatedStash;
      cmds.push(stashCmd);
    }

    return [this, Batch(...cmds)];
  }

  view(): string {
    if (this.fatalErr !== null) {
      return errorView(this.fatalErr, true);
    }

    if (this.state === State.ShowDocument) {
      return this.pager.view();
    }

    return this.stash.view();
  }
}

// --------------------------------------------------------------------------
// Helper: unload document and go back to stash
// --------------------------------------------------------------------------

function unloadDocument(m: GlowModel): [GlowModel, Cmd] {
  m.state = State.ShowStash;
  m.pager.unload();
  m.pager.currentDocument = null;
  return [m, null];
}

// --------------------------------------------------------------------------
// Factory: newGlowModel
// --------------------------------------------------------------------------

export function newGlowModel(
  cfg: Config,
  stashFactory: (common: CommonModel) => StashModel,
  pagerFactory: (common: CommonModel) => PagerModel,
  content?: string,
): GlowModel {
  const cwd = process.cwd();

  const common: CommonModel = {
    cfg,
    cwd,
    width: 80,
    height: 24,
  };

  // Auto-detect glamour style from COLORFGBG when set to "auto"
  if (cfg.glamourStyle === 'auto') {
    const env = process.env.COLORFGBG;
    if (env && env.endsWith(';0')) {
      cfg.glamourStyle = 'light';
    } else {
      cfg.glamourStyle = 'dark';
    }
  }

  const stash = stashFactory(common);
  const pager = pagerFactory(common);

  let state: State = State.ShowStash;

  // If raw content is provided and no path, start in document view
  if (content !== undefined && !cfg.path) {
    state = State.ShowDocument;
    const md = newMarkdown('', 'stdin', content, new Date());
    buildFilterValue(md);
    pager.currentDocument = md;
  } else if (cfg.path) {
    try {
      const stat = fs.statSync(cfg.path);

      if (stat.isDirectory()) {
        // Path is a directory — start in stash, searching that dir
        state = State.ShowStash;
        common.cwd = path.resolve(cfg.path);
      } else if (stat.isFile()) {
        // Path is a file — start in document view
        state = State.ShowDocument;
        const relNote = stripAbsolutePath(cfg.path, cwd);
        const md = newMarkdown(
          path.resolve(cfg.path),
          relNote,
          '', // body loaded lazily in init
          stat.mtime,
        );
        buildFilterValue(md);
        pager.currentDocument = md;
      }
    } catch {
      // If stat fails, default to stash view
      state = State.ShowStash;
    }
  }

  return new GlowModel(common, state, stash, pager);
}

// --------------------------------------------------------------------------
// NewProgram
// --------------------------------------------------------------------------

export function NewProgram(
  cfg: Config,
  stashFactory: (common: CommonModel) => StashModel,
  pagerFactory: (common: CommonModel) => PagerModel,
  content?: string,
): Program {
  const model = newGlowModel(cfg, stashFactory, pagerFactory, content);
  const opts = [WithAltScreen()];

  if (cfg.enableMouse) {
    opts.push(WithMouseMode(MouseMode.CellMotion));
  }

  return new Program(model, ...opts);
}

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

/** Cmd that discovers local markdown files. */
function findLocalFiles(common: CommonModel): Cmd {
  return () => {
    const mds = findMarkdowns(common.cwd, common.cfg);
    return new FoundMarkdownsMsg(mds);
  };
}

/** Cmd that reads a file from disk and returns FetchedMarkdownMsg. */
function fetchAndRenderMarkdown(md: Markdown, common: CommonModel): Cmd {
  return () => {
    let body = md.body;
    if (!body && md.localPath) {
      body = fs.readFileSync(md.localPath, 'utf-8');
    }
    body = removeFrontmatter(body);
    return new FetchedMarkdownMsg(md, body);
  };
}

/** Cmd that renders markdown content with glamour and returns ContentRenderedMsg. */
function renderWithGlamour(body: string, common: CommonModel): Cmd {
  return () => {
    const width = common.cfg.glamourMaxWidth > 0
      ? Math.min(common.cfg.glamourMaxWidth, common.width)
      : common.width;

    const styleOpt = common.cfg.glamourStyle === 'auto'
      ? withAutoStyle()
      : withStylePath(common.cfg.glamourStyle);

    const renderer = new TermRenderer(styleOpt, withWordWrap(width));
    const rendered = renderer.render(body);
    return new ContentRenderedMsg(rendered);
  };
}

// --------------------------------------------------------------------------
// View helpers
// --------------------------------------------------------------------------

/** Render an error view with a styled title and message. */
export function errorView(err: Error, fatal: boolean): string {
  const title = fatal ? 'Fatal Error' : 'Error';
  const styledTitle = errorTitleStyle().render(` ${title} `);
  const styledMsg = subtleStyle().render(err.message);
  return `\n  ${styledTitle}\n\n` + indent(styledMsg, 2) + '\n\n';
}

/** Add `n` spaces of indentation to each line of `s`. */
export function indent(s: string, n: number): string {
  const prefix = ' '.repeat(n);
  return s
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

/** Remove the cwd prefix from an absolute path to produce a relative display path. */
export function stripAbsolutePath(fullPath: string, cwd: string): string {
  const resolved = path.resolve(fullPath);
  const resolvedCwd = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (resolved.startsWith(resolvedCwd)) {
    return resolved.slice(resolvedCwd.length);
  }
  return resolved;
}
