// ui.ts — Core TUI model for the Glow app
// Port of charmbracelet/glow/ui/ui.go (glow v3 / Bubble Tea v2)

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type Model,
  type Msg,
  type Cmd,
  Program,
  View,
  NewView,
  KeyPressMsg,
  WindowSizeMsg,
  BackgroundColorMsg,
  RequestBackgroundColor,
  MouseMode,
  Quit,
  Suspend,
  Batch,
} from '@oakoliver/bubbletea';

import type { Config } from '../config.js';
import { removeFrontmatter } from '../utils.js';
import { type Markdown, newMarkdown, buildFilterValue } from './markdown.js';
import { newStyles } from './styles.js';
import { type CommonModel, errorView } from './common.js';
import { FoundMarkdownsMsg } from './filewalk.js';
import {
  StashModel,
  StashViewState,
  FilterState,
  FetchedMarkdownMsg,
  FilteredMarkdownMsg,
  LocalFileSearchFinished,
  ErrMsg,
  filterMarkdowns,
  findLocalFiles,
} from './stash.js';
import { PagerModel, ContentRenderedMsg, renderWithGlamour } from './pager.js';

export type { CommonModel } from './common.js';
export { errorView, indent } from './common.js';
export { FetchedMarkdownMsg, FilteredMarkdownMsg } from './stash.js';
export { ContentRenderedMsg } from './pager.js';

// --------------------------------------------------------------------------
// State enum
// --------------------------------------------------------------------------

export const enum State {
  ShowStash = 0,
  ShowDocument = 1,
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

  constructor(common: CommonModel, state: State, stash: StashModel, pager: PagerModel) {
    this.common = common;
    this.state = state;
    this.fatalErr = null;
    this.stash = stash;
    this.pager = pager;
  }

  init(): Cmd {
    const cmds: Cmd[] = [this.stash.spinnerTick(), RequestBackgroundColor];

    switch (this.state) {
      case State.ShowStash:
        cmds.push(findLocalFiles(this.common));
        break;
      case State.ShowDocument: {
        const md = this.pager.currentDocument;
        if (!md) break;
        if (md.localPath) {
          let content: string;
          try {
            content = fs.readFileSync(md.localPath, 'utf-8');
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            return () => new ErrMsg(e);
          }
          md.body = removeFrontmatter(content);
        }
        cmds.push(renderWithGlamour(this.pager, md));
        break;
      }
    }

    return Batch(...cmds);
  }

  update(msg: Msg): [Model, Cmd] {
    // If there's been an error, any key exits
    if (this.fatalErr !== null) {
      if (msg instanceof KeyPressMsg) {
        return [this, Quit];
      }
    }

    const cmds: Cmd[] = [];

    if (msg instanceof BackgroundColorMsg) {
      this.common.styles = newStyles(msg.isDark());
      this.stash.setStyles(this.common.styles);
    } else if (msg instanceof KeyPressMsg) {
      switch (msg.toString()) {
        case 'esc':
          if (
            this.state === State.ShowDocument ||
            this.stash.viewState === StashViewState.LoadingDocument
          ) {
            return [this, Batch(...this.unloadDocument())];
          }
          break;

        case 'r':
          if (this.state === State.ShowStash) {
            // pass through all keys if we're editing the filter
            if (this.stash.filterState === FilterState.Filtering) {
              const [stash, cmd] = this.stash.update(msg);
              this.stash = stash;
              return [this, cmd];
            }
            this.stash.markdowns = [];
            return [this, this.init()];
          }
          break;

        case 'q':
          if (this.state === State.ShowStash) {
            // pass through all keys if we're editing the filter
            if (this.stash.filterState === FilterState.Filtering) {
              const [stash, cmd] = this.stash.update(msg);
              this.stash = stash;
              return [this, cmd];
            }
          }
          return [this, Quit];

        case 'left':
        case 'h':
        case 'delete':
          if (this.state === State.ShowDocument) {
            cmds.push(...this.unloadDocument());
            return [this, Batch(...cmds)];
          }
          break;

        case 'ctrl+z':
          return [this, Suspend];

        // Ctrl+C always quits no matter where in the application you are.
        case 'ctrl+c':
          return [this, Quit];

        default:
          break;
      }
    } else if (msg instanceof WindowSizeMsg) {
      // Window size is received when starting up and on every resize
      this.common.width = msg.width;
      this.common.height = msg.height;
      this.stash.setSize(msg.width, msg.height);
      this.pager.setSize(msg.width, msg.height);
    } else if (msg instanceof FetchedMarkdownMsg) {
      // We've loaded a markdown file's contents for rendering
      const md = msg.markdown;
      md.body = removeFrontmatter(md.body);
      this.pager.currentDocument = md;
      cmds.push(renderWithGlamour(this.pager, md));
    } else if (msg instanceof ContentRenderedMsg) {
      this.state = State.ShowDocument;
    } else if (msg instanceof LocalFileSearchFinished) {
      // Always pass these messages to the stash so we can keep it updated
      // about activity, even if the user isn't currently viewing the stash.
      const [stash, cmd] = this.stash.update(msg);
      this.stash = stash;
      return [this, cmd];
    } else if (msg instanceof FoundMarkdownsMsg) {
      this.stash.addMarkdowns(msg.markdowns);
      if (this.stash.filterApplied()) {
        for (const md of msg.markdowns) buildFilterValue(md);
      }
      if (this.stash.shouldUpdateFilter()) {
        cmds.push(filterMarkdowns(this.stash));
      }
      // The file walk is synchronous, so the search is finished here.
      cmds.push(() => new LocalFileSearchFinished());
    } else if (msg instanceof FilteredMarkdownMsg) {
      if (this.state === State.ShowDocument) {
        const [stash, cmd] = this.stash.update(msg);
        this.stash = stash;
        cmds.push(cmd);
      }
    }

    // Process children
    switch (this.state) {
      case State.ShowStash: {
        const [stash, cmd] = this.stash.update(msg);
        this.stash = stash;
        cmds.push(cmd);
        break;
      }
      case State.ShowDocument: {
        const [pager, cmd] = this.pager.update(msg);
        this.pager = pager;
        cmds.push(cmd);
        break;
      }
    }

    return [this, Batch(...cmds)];
  }

  view(): View {
    let content: string;
    if (this.fatalErr !== null) {
      content = errorView(this.common.styles, this.fatalErr, true);
    } else if (this.state === State.ShowDocument) {
      content = this.pager.view();
    } else {
      content = this.stash.view();
    }

    const v = NewView(content);
    v.altScreen = true;
    if (this.common.cfg.enableMouse) {
      v.mouseMode = MouseMode.CellMotion;
    }
    return v;
  }

  /**
   * Unloads a document from the pager. Note that while this method alters
   * the model we also need to send along any commands returned.
   */
  unloadDocument(): Cmd[] {
    this.state = State.ShowStash;
    this.stash.viewState = StashViewState.Ready;
    this.pager.unload();
    this.pager.showHelp = false;

    const batch: Cmd[] = [];
    if (!this.stash.shouldSpin()) {
      batch.push(this.stash.spinnerTick());
    }
    return batch;
  }
}

// --------------------------------------------------------------------------
// Factory: newGlowModel
// --------------------------------------------------------------------------

export function newGlowModel(
  cfg: Config,
  stashFactory: (common: CommonModel) => StashModel = (common) => new StashModel(cfg, common),
  pagerFactory: (common: CommonModel) => PagerModel = (common) => new PagerModel(cfg, common),
  content?: string,
): GlowModel {
  const cwd = process.cwd();

  const common: CommonModel = {
    cfg,
    cwd,
    width: 0,
    height: 0,
    styles: newStyles(true),
  };

  const stash = stashFactory(common);
  const pager = pagerFactory(common);
  const m = new GlowModel(common, State.ShowStash, stash, pager);

  let p = cfg.path;
  if (!p && content !== undefined && content !== '') {
    m.state = State.ShowDocument;
    const md = newMarkdown('', '', content, new Date());
    buildFilterValue(md);
    pager.currentDocument = md;
    return m;
  }

  if (!p) {
    p = '.';
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch (err) {
    m.fatalErr = err instanceof Error ? err : new Error(String(err));
    return m;
  }

  if (stat.isDirectory()) {
    m.state = State.ShowStash;
    common.cwd = path.resolve(p);
  } else {
    m.state = State.ShowDocument;
    const md: Markdown = newMarkdown(p, stripAbsolutePath(p, cwd), '', stat.mtime);
    buildFilterValue(md);
    pager.currentDocument = md;
  }

  return m;
}

// --------------------------------------------------------------------------
// NewProgram
// --------------------------------------------------------------------------

/**
 * Returns a new Tea program. Alt screen and mouse mode are declared by the
 * model's View (Bubble Tea v2), not via program options.
 */
export function NewProgram(
  cfg: Config,
  stashFactory?: (common: CommonModel) => StashModel,
  pagerFactory?: (common: CommonModel) => PagerModel,
  content?: string,
): Program {
  const model = newGlowModel(cfg, stashFactory, pagerFactory, content);
  return new Program(model);
}

// --------------------------------------------------------------------------
// View helpers
// --------------------------------------------------------------------------

/** Remove the cwd prefix from an absolute path to produce a relative display path. */
export function stripAbsolutePath(fullPath: string, cwd: string): string {
  const resolved = path.resolve(fullPath);
  const resolvedCwd = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (resolved.startsWith(resolvedCwd)) {
    return resolved.slice(resolvedCwd.length);
  }
  return resolved;
}
