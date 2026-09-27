// pager.ts — Document pager for the Glow TUI
// Port of charmbracelet/glow/ui/pager.go (glow v3)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { newStyle, stringWidth } from '@oakoliver/lipgloss';
import { TermRenderer, withWordWrap, withPreservedNewLines } from '@oakoliver/glamour';
import type { TermRendererOption } from '@oakoliver/glamour';
import type { Msg, Cmd } from '@oakoliver/bubbletea';
import { KeyPressMsg, KeyCode, WindowSizeMsg, Batch } from '@oakoliver/bubbletea';
import { ViewportModel, newViewport } from '@oakoliver/bubbles';
import type { Markdown } from './markdown.js';
import { newStyles } from './styles.js';
import { type CommonModel, glowLogoView } from './common.js';
import { EditorFinishedMsg, openEditor } from './editor.js';
import { truncateWithTail } from './stashitem.js';
import type { Config } from '../config.js';
import { glamourStyle, isMarkdownFile, wrapCodeBlock, removeFrontmatter } from '../utils.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const statusBarHeight = 1;
const lineNumberWidth = 4;
const statusMessageTimeout = 3000;
const ellipsis = '…';

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/** Emitted when glamour finishes rendering content. */
export class ContentRenderedMsg {
  readonly _tag = 'ContentRenderedMsg';
  constructor(public readonly content: string) {}
}

/** Request pager to reload the current document. */
export class ReloadMsg {
  readonly _tag = 'ReloadMsg';
}

/** Internal: status message display timer expired. */
class StatusMessageTimeoutMsg {
  readonly _tag = 'PagerStatusMessageTimeoutMsg';
}

// --------------------------------------------------------------------------
// PagerState
// --------------------------------------------------------------------------

export enum PagerState {
  Browse = 0,
  StatusMessage = 1,
}

// --------------------------------------------------------------------------
// PagerModel
// --------------------------------------------------------------------------

export class PagerModel {
  common: CommonModel;
  viewport: ViewportModel;
  state: PagerState = PagerState.Browse;
  showHelp = false;
  statusMessage = '';
  statusMessageTimer: ReturnType<typeof setTimeout> | null = null;
  currentDocument: Markdown | null = null;
  watcher: fs.FSWatcher | null = null;

  constructor(cfg: Config, common?: CommonModel) {
    this.common = common ?? { cfg, cwd: process.cwd(), width: 0, height: 0, styles: newStyles(true) };
    this.viewport = newViewport();
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

  // -- Sizing ---------------------------------------------------------------

  setSize(w: number, h: number): void {
    this.common.width = w;
    this.common.height = h;

    this.viewport.setWidth(w);
    this.viewport.setHeight(h - statusBarHeight);

    if (this.showHelp) {
      const pagerHelpHeight = (this.helpView().match(/\n/g) ?? []).length;
      this.viewport.setHeight(this.viewport.height() - (statusBarHeight + pagerHelpHeight));
    }
  }

  // -- Content --------------------------------------------------------------

  setContent(s: string): void {
    this.viewport.setContent(s);
  }

  // -- Help toggle ----------------------------------------------------------

  toggleHelp(): void {
    this.showHelp = !this.showHelp;
    this.setSize(this.common.width, this.common.height);
    if (this.viewport.pastBottom()) {
      this.viewport.gotoBottom();
    }
  }

  // -- Status message -------------------------------------------------------

  showStatusMsg(msg: string): Cmd {
    this.state = PagerState.StatusMessage;
    this.statusMessage = msg;

    if (this.statusMessageTimer !== null) {
      clearTimeout(this.statusMessageTimer);
    }

    return () =>
      new Promise<Msg>((resolve) => {
        this.statusMessageTimer = setTimeout(() => {
          resolve(new StatusMessageTimeoutMsg());
        }, statusMessageTimeout);
      });
  }

  // -- Unload ---------------------------------------------------------------

  unload(): void {
    if (this.showHelp) {
      this.toggleHelp();
    }
    if (this.statusMessageTimer !== null) {
      clearTimeout(this.statusMessageTimer);
      this.statusMessageTimer = null;
    }
    this.state = PagerState.Browse;
    this.viewport.setContent('');
    this.viewport.setYOffset(0);
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // -- Update ---------------------------------------------------------------

  update(msg: Msg): [PagerModel, Cmd | null] {
    const cmds: Cmd[] = [];

    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();

      switch (key) {
        case 'q':
        case 'esc':
          if (this.state !== PagerState.Browse) {
            this.state = PagerState.Browse;
            return [this, null];
          }
          break;

        case 'home':
        case 'g':
          this.viewport.gotoTop();
          break;

        case 'end':
        case 'G':
          this.viewport.gotoBottom();
          break;

        case 'd':
          this.viewport.halfPageDown();
          break;

        case 'u':
          this.viewport.halfPageUp();
          break;

        case 'e': {
          if (!this.currentDocument?.localPath) break;
          let lineno = roundToEven(this.viewport.totalLineCount() * this.viewport.scrollPercent());
          if (this.viewport.atTop()) {
            lineno = 0;
          }
          return [this, openEditor(this.currentDocument.localPath, lineno)];
        }

        case 'c':
          if (this.currentDocument) {
            copyToClipboard(this.currentDocument.body);
            cmds.push(this.showStatusMsg('Copied contents'));
          }
          break;

        case 'r':
          if (this.currentDocument?.localPath) {
            return [this, reloadDocument(this.currentDocument.localPath)];
          }
          return [this, null];

        case '?':
          this.toggleHelp();
          break;

        default:
          break;
      }
    } else if (msg instanceof ContentRenderedMsg) {
      this.setContent(msg.content);
      const watch = watchFileCmd(this);
      if (watch) cmds.push(watch);
    } else if (msg instanceof ReloadMsg) {
      if (this.currentDocument?.localPath) {
        try {
          const body = fs.readFileSync(this.currentDocument.localPath, 'utf-8');
          this.currentDocument.body = body;
          return [this, renderWithGlamour(this, this.currentDocument)];
        } catch {
          return [this, this.showStatusMsg('Could not reload file')];
        }
      }
      return [this, null];
    } else if (msg instanceof EditorFinishedMsg) {
      if (msg.err) {
        return [this, this.showStatusMsg(`Editor error: ${msg.err.message}`)];
      }
      // Reload after editing
      if (this.currentDocument?.localPath) {
        return [this, reloadDocument(this.currentDocument.localPath)];
      }
      return [this, null];
    } else if (msg instanceof WindowSizeMsg) {
      // We've received terminal dimensions, either for the first time or
      // after a resize: re-render for the new width.
      if (this.currentDocument) {
        return [this, renderWithGlamour(this, this.currentDocument)];
      }
      return [this, null];
    } else if (msg instanceof StatusMessageTimeoutMsg) {
      this.state = PagerState.Browse;
    }

    const [vp, vpCmd] = this.viewport.update(msg);
    this.viewport = vp;
    if (vpCmd) cmds.push(vpCmd);
    return [this, cmds.length > 0 ? Batch(...cmds) : null];
  }

  // -- View -----------------------------------------------------------------

  view(): string {
    let s = this.viewport.view() + '\n';
    s += this.statusBarView();
    if (this.showHelp) {
      s += '\n' + this.helpView();
    }
    return s;
  }

  // -- Status bar -----------------------------------------------------------

  statusBarView(): string {
    const showStatusMessage = this.state === PagerState.StatusMessage;
    const styles = this.common.styles;
    const width = this.common.width;

    // Logo
    const logo = glowLogoView(styles);

    // Scroll percent
    const percent = Math.max(0, Math.min(1, this.viewport.scrollPercent()));
    let scrollPercent = ` ${String(Math.round(percent * 100)).padStart(3, ' ')}% `;
    scrollPercent = showStatusMessage
      ? styles.statusBarMessageScrollPosStyle(scrollPercent)
      : styles.statusBarScrollPosStyle(scrollPercent);

    // "Help" note
    const helpNote = showStatusMessage
      ? styles.statusBarMessageHelpStyle(' ? Help ')
      : styles.statusBarHelpStyle(' ? Help ');

    // Note
    let note = showStatusMessage ? this.statusMessage : (this.currentDocument?.note ?? '');
    note = truncateWithTail(
      ' ' + note + ' ',
      Math.max(0, width - stringWidth(logo) - stringWidth(scrollPercent) - stringWidth(helpNote)),
      ellipsis,
    );
    note = showStatusMessage ? styles.statusBarMessageStyle(note) : styles.statusBarNoteStyle(note);

    // Empty space
    const padding = Math.max(
      0,
      width - stringWidth(logo) - stringWidth(note) - stringWidth(scrollPercent) - stringWidth(helpNote),
    );
    let emptySpace = ' '.repeat(padding);
    emptySpace = showStatusMessage
      ? styles.statusBarMessageStyle(emptySpace)
      : styles.statusBarNoteStyle(emptySpace);

    return logo + note + emptySpace + scrollPercent + helpNote;
  }

  // -- Help view ------------------------------------------------------------

  helpView(): string {
    const col1 = [
      'g/home  go to top',
      'G/end   go to bottom',
      'c       copy contents',
      'e       edit this document',
      'r       reload this document',
      'esc     back to files',
      'q       quit',
    ];

    let s = '\n';
    s += 'k/↑      up                  ' + col1[0] + '\n';
    s += 'j/↓      down                ' + col1[1] + '\n';
    s += 'b/pgup   page up             ' + col1[2] + '\n';
    s += 'f/pgdn   page down           ' + col1[3] + '\n';
    s += 'u        ½ page up           ' + col1[4] + '\n';
    s += 'd        ½ page down         ';

    if (col1.length > 5) {
      s += col1[5];
    }

    s = s
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n');

    // Fill up empty cells with spaces for background coloring
    const width = this.common.width;
    if (width > 0) {
      s = s
        .split('\n')
        .map((line) => line + ' '.repeat(Math.max(width - stringWidth(line), 0)))
        .join('\n');
    }

    return this.common.styles.helpViewStyle(s);
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Go's math.RoundToEven. */
function roundToEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) return r - 1;
  return r;
}

// --------------------------------------------------------------------------
// Clipboard
// --------------------------------------------------------------------------

function copyToClipboard(text: string): void {
  // Copy using OSC 52
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
    }
  } catch {
    // ignore
  }

  // Copy using native system clipboard
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    } else if (platform === 'linux') {
      try {
        execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      }
    } else if (platform === 'win32') {
      execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    }
  } catch {
    // Clipboard copy failed silently
  }
}

// --------------------------------------------------------------------------
// File watching (fsnotify replacement)
// --------------------------------------------------------------------------

/** Start watching the current document's directory (no message delivery). */
export function watchFile(model: PagerModel): void {
  if (!model.currentDocument?.localPath) return;

  const dir = path.dirname(model.currentDocument.localPath);

  if (model.watcher !== null) {
    model.watcher.close();
    model.watcher = null;
  }

  try {
    model.watcher = fs.watch(dir, () => {});
  } catch {
    // Could not watch directory
  }
}

/** Start watching and return a Cmd that emits ReloadMsg on file change. */
export function watchFileCmd(model: PagerModel): Cmd | null {
  if (!model.currentDocument?.localPath) return null;

  const filePath = model.currentDocument.localPath;
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);

  return () =>
    new Promise<Msg>((resolve) => {
      if (model.watcher !== null) {
        model.watcher.close();
        model.watcher = null;
      }
      try {
        const watcher = fs.watch(dir, (_eventType, filename) => {
          if (filename === basename) {
            watcher.close();
            if (model.watcher === watcher) model.watcher = null;
            resolve(new ReloadMsg());
          }
        });
        watcher.unref?.();
        model.watcher = watcher;
      } catch {
        // Silently fail if watch is not possible
      }
    });
}

// --------------------------------------------------------------------------
// Reload helper
// --------------------------------------------------------------------------

function reloadDocument(filePath: string): Cmd {
  return () =>
    new Promise<Msg>((resolve) => {
      try {
        fs.readFileSync(filePath, 'utf-8');
        resolve(new ReloadMsg());
      } catch {
        resolve(new StatusMessageTimeoutMsg());
      }
    });
}

// --------------------------------------------------------------------------
// Glamour rendering
// --------------------------------------------------------------------------

/** Command that renders markdown via glamour and returns ContentRenderedMsg. */
export function renderWithGlamour(m: PagerModel, md: Markdown): Cmd {
  return () =>
    new Promise<Msg>((resolve) => {
      try {
        resolve(new ContentRenderedMsg(glamourRender(m, md.body)));
      } catch {
        resolve(new ContentRenderedMsg(md.body));
      }
    });
}

/** This is where the magic happens. */
export function glamourRender(m: PagerModel, markdown: string): string {
  const cfg = m.common.cfg;
  const vpWidth = m.viewport.width();
  const trunc = newStyle().maxWidth(vpWidth - lineNumberWidth);

  if (!cfg.glamourEnabled) {
    return markdown;
  }

  const note = m.currentDocument?.note ?? '';
  const isCode = !isMarkdownFile(note);
  let width = Math.max(0, Math.min(cfg.glamourMaxWidth, vpWidth));
  if (isCode) {
    width = 0;
  }

  const options: TermRendererOption[] = [glamourStyle(cfg.glamourStyle, isCode), withWordWrap(width)];
  if (cfg.preserveNewLines) {
    options.push(withPreservedNewLines());
  }
  const r = new TermRenderer(...options);

  let body = removeFrontmatter(markdown);
  if (isCode) {
    body = wrapCodeBlock(body, path.extname(note));
  }

  let out = r.render(body);

  if (isCode) {
    out = out.trim();
  }

  // trim lines
  const lines = out.split('\n');

  let content = '';
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    if (isCode || cfg.showLineNumbers) {
      content += m.common.styles.lineNumberStyle(String(i + 1).padStart(lineNumberWidth, ' '));
      content += trunc.render(s);
    } else {
      content += s;
    }

    // don't add an artificial newline after the last split
    if (i + 1 < lines.length) {
      content += '\n';
    }
  }

  return content;
}
