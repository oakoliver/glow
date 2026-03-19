// pager.ts — Document pager for the Glow TUI
// Port of charmbracelet/glow/ui/pager.go

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { newStyle, stringWidth, Right } from '@oakoliver/lipgloss';
import { TermRenderer, withWordWrap, withPreservedNewLines, withOptions } from '@oakoliver/glamour';
import type { Msg, Cmd } from '@oakoliver/bubbletea';
import { KeyPressMsg, KeyCode, KeyMod, WindowSizeMsg, Batch } from '@oakoliver/bubbletea';
import { ViewportModel, newViewport, withViewportWidth, withViewportHeight } from '@oakoliver/bubbles';
import type { Markdown } from './markdown.js';
import { adaptiveColor } from './styles.js';
import { EditorFinishedMsg } from './editor.js';
import type { Config } from '../config.js';
import { glamourStyle, isMarkdownFile, wrapCodeBlock, removeFrontmatter } from '../utils.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const statusBarHeight = 1;
const lineNumberWidth = 4;

// --------------------------------------------------------------------------
// Pager-specific colors
// --------------------------------------------------------------------------

const mintGreen = () => adaptiveColor('#89F0CB', '#89F0CB');
const darkGreen = () => adaptiveColor('#1C8760', '#1C8760');
const lineNumberFg = () => adaptiveColor('#4A4A4A', '#4A4A4A');
const statusBarNoteFg = () => adaptiveColor('#7B7B7B', '#656565');
const statusBarBg = () => adaptiveColor('#E6E6E6', '#242424');

// --------------------------------------------------------------------------
// Pager-specific styles
// --------------------------------------------------------------------------

function statusBarScrollPosStyle() {
  return newStyle()
    .foreground(mintGreen())
    .background(darkGreen())
    .padding(0, 1);
}

function statusBarNoteStyle() {
  return newStyle()
    .foreground(statusBarNoteFg())
    .background(statusBarBg())
    .padding(0, 1);
}

function statusBarHelpStyle() {
  return newStyle()
    .foreground(statusBarNoteFg())
    .background(statusBarBg())
    .padding(0, 1);
}

function statusBarMessageStyle() {
  return newStyle()
    .foreground(mintGreen())
    .background(darkGreen());
}

function statusBarMessageScrollPosStyle() {
  return newStyle()
    .foreground(mintGreen())
    .background(darkGreen())
    .padding(0, 1);
}

function statusBarMessageHelpStyle() {
  return newStyle()
    .foreground(darkGreen())
    .background(mintGreen())
    .padding(0, 1);
}

function helpViewStyle() {
  return newStyle().padding(1, 2);
}

function lineNumberStyle() {
  return newStyle()
    .foreground(lineNumberFg())
    .width(lineNumberWidth)
    .align(Right)
    .padding(0, 1, 0, 0);
}

// --------------------------------------------------------------------------
// Glow logo (inline — avoids circular dependency with stash)
// --------------------------------------------------------------------------

function glowLogoView() {
  return newStyle()
    .foreground(mintGreen())
    .background(darkGreen())
    .padding(0, 1)
    .render(' Glow ');
}

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
  readonly _tag = 'StatusMessageTimeoutMsg';
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
  width = 0;
  height = 0;
  viewport: ViewportModel;
  state: PagerState = PagerState.Browse;
  showHelp = false;
  statusMessage = '';
  statusMessageTimer: ReturnType<typeof setTimeout> | null = null;
  currentDocument: Markdown | null = null;
  cfg: Config;
  watcher: fs.FSWatcher | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.viewport = newViewport();
  }

  // -- Sizing ---------------------------------------------------------------

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;

    let viewportHeight = h - statusBarHeight;
    if (this.showHelp) {
      viewportHeight -= helpHeight();
    }

    this.viewport.setWidth(w);
    this.viewport.setHeight(Math.max(0, viewportHeight));
  }

  // -- Content --------------------------------------------------------------

  setContent(s: string): void {
    this.viewport.setContent(s);
  }

  // -- Help toggle ----------------------------------------------------------

  toggleHelp(): void {
    this.showHelp = !this.showHelp;
    this.setSize(this.width, this.height);
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
        }, 2000);
      });
  }

  // -- Unload ---------------------------------------------------------------

  unload(): void {
    this.viewport.setContent('');
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // -- Update ---------------------------------------------------------------

  update(msg: Msg): [PagerModel, Cmd | null] {
    const cmds: Cmd[] = [];

    if (msg instanceof KeyPressMsg) {
      // q / esc — quit pager
      if (msg.text === 'q' || msg.code === KeyCode.Escape) {
        if (this.showHelp) {
          this.toggleHelp();
          return [this, null];
        }
        return [this, null]; // parent handles navigation
      }

      // home / g — go to top
      if (msg.code === KeyCode.Home || (msg.text === 'g' && !msg.mod)) {
        this.viewport.gotoTop();
        return [this, null];
      }

      // end / G — go to bottom
      if (msg.code === KeyCode.End || (msg.text === 'G' && !msg.mod)) {
        this.viewport.gotoBottom();
        return [this, null];
      }

      // d — half page down
      if (msg.text === 'd' && !msg.mod) {
        this.viewport.halfPageDown();
        return [this, null];
      }

      // u — half page up
      if (msg.text === 'u' && !msg.mod) {
        this.viewport.halfPageUp();
        return [this, null];
      }

      // e — open in editor
      if (msg.text === 'e' && !msg.mod) {
        if (this.currentDocument?.localPath) {
          const { openEditor } = require('./editor.js') as typeof import('./editor.js');
          const cmd = openEditor(this.currentDocument.localPath);
          return [this, cmd];
        }
        return [this, null];
      }

      // c — copy to clipboard
      if (msg.text === 'c' && !msg.mod) {
        if (this.currentDocument?.body) {
          copyToClipboard(this.currentDocument.body);
          const cmd = this.showStatusMsg('Copied to clipboard');
          return [this, cmd];
        }
        return [this, null];
      }

      // r — reload
      if (msg.text === 'r' && !msg.mod) {
        if (this.currentDocument?.localPath) {
          const cmd = reloadDocument(this.currentDocument.localPath);
          return [this, cmd];
        }
        return [this, null];
      }

      // ? — toggle help
      if (msg.text === '?') {
        this.toggleHelp();
        return [this, null];
      }

      // Pass remaining keys to viewport
      const [vp, vpCmd] = this.viewport.update(msg);
      this.viewport = vp;
      if (vpCmd) cmds.push(vpCmd);
      return [this, cmds.length > 0 ? Batch(...cmds) : null];
    }

    if (msg instanceof ContentRenderedMsg) {
      this.setContent(msg.content);
      return [this, null];
    }

    if (msg instanceof ReloadMsg) {
      if (this.currentDocument?.localPath) {
        try {
          const body = fs.readFileSync(this.currentDocument.localPath, 'utf-8');
          this.currentDocument.body = body;
          const cmd = renderWithGlamour(this, this.currentDocument);
          return [this, cmd];
        } catch {
          const cmd = this.showStatusMsg('Could not reload file');
          return [this, cmd];
        }
      }
      return [this, null];
    }

    if (msg instanceof EditorFinishedMsg) {
      if (msg.err) {
        const cmd = this.showStatusMsg(`Editor error: ${msg.err.message}`);
        return [this, cmd];
      }
      // Reload after editing
      if (this.currentDocument?.localPath) {
        const cmd = reloadDocument(this.currentDocument.localPath);
        return [this, cmd];
      }
      return [this, null];
    }

    if (msg instanceof WindowSizeMsg) {
      this.setSize(msg.width, msg.height);
      return [this, null];
    }

    if (msg instanceof StatusMessageTimeoutMsg) {
      this.state = PagerState.Browse;
      this.statusMessage = '';
      return [this, null];
    }

    // Pass unhandled messages to viewport
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
    const isStatusMessage = this.state === PagerState.StatusMessage;

    // Scroll percentage
    const percent = `${Math.round(this.viewport.scrollPercent() * 100)}%`;

    // Logo
    const logo = glowLogoView();

    // Note
    const note = this.currentDocument?.note ?? '';

    let bar: string;

    if (isStatusMessage) {
      const scrollPos = statusBarMessageScrollPosStyle().render(percent);
      const helpNote = statusBarMessageHelpStyle().render(' ? ');
      const msgText = statusBarMessageStyle().render(' ' + this.statusMessage + ' ');
      const usedWidth =
        stringWidth(logo) + stringWidth(scrollPos) + stringWidth(helpNote) + stringWidth(msgText);
      const gap = Math.max(0, this.width - usedWidth);
      const filler = statusBarMessageStyle().render(' '.repeat(gap));
      bar = logo + msgText + filler + scrollPos + helpNote;
    } else {
      const scrollPos = statusBarScrollPosStyle().render(percent);
      const helpNote = statusBarHelpStyle().render(' ? ');
      const noteText = statusBarNoteStyle().render(truncate(note, this.width / 2));
      const usedWidth =
        stringWidth(logo) + stringWidth(scrollPos) + stringWidth(helpNote) + stringWidth(noteText);
      const gap = Math.max(0, this.width - usedWidth);
      const filler = statusBarNoteStyle().render(' '.repeat(gap));
      bar = logo + noteText + filler + scrollPos + helpNote;
    }

    return bar;
  }

  // -- Help view ------------------------------------------------------------

  helpView(): string {
    const col1 = [
      ['g/home', 'go to top'],
      ['G/end', 'go to bottom'],
      ['d', 'half page down'],
      ['u', 'half page up'],
    ];
    const col2 = [
      ['e', 'open in editor'],
      ['c', 'copy to clipboard'],
      ['r', 'reload'],
      ['esc', 'back'],
    ];

    const maxKeyW1 = Math.max(...col1.map(([k]) => stringWidth(k)));
    const maxKeyW2 = Math.max(...col2.map(([k]) => stringWidth(k)));

    const renderCol = (col: string[][], maxKeyW: number): string[] =>
      col.map(([k, v]) => {
        const keyPad = ' '.repeat(Math.max(0, maxKeyW - stringWidth(k)));
        return `  ${newStyle().foreground(mintGreen()).render(k)}${keyPad}  ${newStyle().foreground(statusBarNoteFg()).render(v)}`;
      });

    const left = renderCol(col1, maxKeyW1);
    const right = renderCol(col2, maxKeyW2);

    const lines: string[] = [];
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i++) {
      const l = i < left.length ? left[i] : '';
      const r = i < right.length ? right[i] : '';
      lines.push(l + '    ' + r);
    }

    return helpViewStyle().render(lines.join('\n'));
  }
}

// --------------------------------------------------------------------------
// Help height helper
// --------------------------------------------------------------------------

function helpHeight(): number {
  // 4 entries + 2 padding lines
  return 6;
}

// --------------------------------------------------------------------------
// Clipboard
// --------------------------------------------------------------------------

function copyToClipboard(text: string): void {
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

export function watchFile(model: PagerModel): void {
  if (!model.currentDocument?.localPath) return;

  const filePath = model.currentDocument.localPath;
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);

  if (model.watcher !== null) {
    model.watcher.close();
    model.watcher = null;
  }

  try {
    model.watcher = fs.watch(dir, (_eventType, filename) => {
      if (filename === basename) {
        // The parent update loop should handle ReloadMsg
      }
    });
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
      }
      try {
        model.watcher = fs.watch(dir, (_eventType, filename) => {
          if (filename === basename) {
            resolve(new ReloadMsg());
          }
        });
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
        const result = glamourRender(m, md.body);
        resolve(new ContentRenderedMsg(result));
      } catch {
        resolve(new ContentRenderedMsg(md.body));
      }
    });
}

/** Render markdown content through glamour with line numbers and truncation. */
function glamourRender(m: PagerModel, markdown: string): string {
  // Determine available width
  let contentWidth = m.width;
  if (m.cfg.glamourMaxWidth > 0 && m.cfg.glamourMaxWidth < contentWidth) {
    contentWidth = m.cfg.glamourMaxWidth;
  }

  const isCode = m.currentDocument
    ? !isMarkdownFile(m.currentDocument.localPath)
    : false;

  // If it is not a markdown file, wrap in a code block
  let body = removeFrontmatter(markdown);
  if (isCode && m.currentDocument) {
    const ext = path.extname(m.currentDocument.localPath);
    body = wrapCodeBlock(body, ext);
  }

  // Render with glamour
  const styleOpt = glamourStyle(m.cfg.glamourStyle, isCode);
  const options = [styleOpt, withWordWrap(contentWidth)];
  if (m.cfg.preserveNewLines) {
    options.push(withPreservedNewLines());
  }

  const renderer = new TermRenderer(...options);
  let rendered = renderer.render(body);

  // Add line numbers if configured
  if (m.cfg.showLineNumbers) {
    rendered = addLineNumbers(rendered);
  }

  // Truncate lines to width
  if (contentWidth > 0) {
    const truncStyle = newStyle().maxWidth(contentWidth);
    const lines = rendered.split('\n');
    rendered = lines.map((line) => truncStyle.render(line)).join('\n');
  }

  return rendered;
}

/** Prepend line numbers to each line of rendered content. */
function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  const style = lineNumberStyle();
  return lines
    .map((line, i) => style.render(String(i + 1)) + line)
    .join('\n');
}

// --------------------------------------------------------------------------
// Truncate helper
// --------------------------------------------------------------------------

function truncate(s: string, maxWidth: number): string {
  if (stringWidth(s) <= maxWidth) return s;
  const chars = [...s];
  let w = 0;
  let result = '';
  for (const ch of chars) {
    const cw = stringWidth(ch);
    if (w + cw > maxWidth - 1) {
      result += '\u2026';
      break;
    }
    result += ch;
    w += cw;
  }
  return result;
}
