// v3.test.ts — Tests for the glow v2.1.2 / v3.0.0 sync
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { stripAnsi } from '@oakoliver/lipgloss';
import {
  TermRenderer,
  withStandardStyle,
  withWordWrap,
  DarkStyle,
} from '@oakoliver/glamour';
import {
  BackgroundColorMsg,
  BatchMsg,
  KeyPressMsg,
  KeyCode,
  MouseMode,
  RequestBackgroundColor,
  View,
  WindowSizeMsg,
} from '@oakoliver/bubbletea';

import { shellFields } from '../src/shell.js';
import { glamourStyle, hasDarkBackground, parsePagerCommand } from '../src/utils.js';
import { defaultConfig, loadConfigFile, type Config } from '../src/config.js';
import { newStyles } from '../src/ui/styles.js';
import { errorView } from '../src/ui/common.js';
import { StashModel, plural } from '../src/ui/stash.js';
import { PagerModel, glamourRender } from '../src/ui/pager.js';
import { newGlowModel, GlowModel, State } from '../src/ui/ui.js';
import { newMarkdown, type Markdown } from '../src/ui/markdown.js';

const env = (vars: Record<string, string>) => (k: string) => vars[k] ?? '';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-v3-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cfgWith(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), ...overrides };
}

function md(note: string, body = ''): Markdown {
  return newMarkdown(path.join(tmp, note), note, body, new Date());
}

// ==========================================================================
// $PAGER parsing (glow v2.1.2, "use shell.Fields to parse $PAGER command")
// ==========================================================================

describe('shellFields', () => {
  test('splits on blanks', () => {
    expect(shellFields('less  -r\t-X', env({}))).toEqual(['less', '-r', '-X']);
  });

  test('double and single quotes keep spaces', () => {
    expect(shellFields(`"/opt/my pager/less" -R 'a b'`, env({}))).toEqual([
      '/opt/my pager/less',
      '-R',
      'a b',
    ]);
  });

  test('backslash escapes a space outside quotes', () => {
    expect(shellFields('/opt/my\\ pager/bat --plain', env({}))).toEqual([
      '/opt/my pager/bat',
      '--plain',
    ]);
  });

  test('expands $VAR and ${VAR}', () => {
    expect(shellFields('$P --x=${OPT}', env({ P: 'most', OPT: 'y' }))).toEqual(['most', '--x=y']);
  });

  test('unquoted expansions are field-split, quoted ones are not', () => {
    const e = env({ ARGS: '-R -S' });
    expect(shellFields('less $ARGS', e)).toEqual(['less', '-R', '-S']);
    expect(shellFields('less "$ARGS"', e)).toEqual(['less', '-R -S']);
  });

  test('empty variables are treated as unset', () => {
    expect(shellFields('less $EMPTY -r', env({}))).toEqual(['less', '-r']);
    expect(shellFields('${PAGER_BIN:-less} -r', env({}))).toEqual(['less', '-r']);
    expect(shellFields('${PAGER_BIN:-less}', env({ PAGER_BIN: 'bat' }))).toEqual(['bat']);
    expect(shellFields('less ""', env({}))).toEqual(['less', '']);
  });

  test('double-quote escapes', () => {
    expect(shellFields('"a\\"b" "\\$x"', env({ x: 'no' }))).toEqual(['a"b', '$x']);
  });

  test('tilde and brace expansion', () => {
    expect(shellFields('~/bin/pager', env({ HOME: '/home/me' }))).toEqual(['/home/me/bin/pager']);
    expect(shellFields('x{a,b}y', env({}))).toEqual(['xay', 'xby']);
    expect(shellFields('f{1..3}', env({}))).toEqual(['f1', 'f2', 'f3']);
  });

  test('invalid syntax throws', () => {
    expect(() => shellFields('"unterminated', env({}))).toThrow();
    expect(() => shellFields("'unterminated", env({}))).toThrow();
    expect(() => shellFields('less | cat', env({}))).toThrow();
    expect(() => shellFields('$(echo less)', env({}))).toThrow();
  });
});

describe('parsePagerCommand', () => {
  test('defaults to less -r', () => {
    expect(parsePagerCommand(undefined, env({}))).toEqual(['less', '-r']);
    expect(parsePagerCommand('', env({}))).toEqual(['less', '-r']);
  });

  test('handles paths with spaces', () => {
    expect(parsePagerCommand('"C:/Program Files/less.exe" -R', env({}))).toEqual([
      'C:/Program Files/less.exe',
      '-R',
    ]);
  });

  test('errors like upstream on unparsable or empty commands', () => {
    expect(() => parsePagerCommand('"oops', env({}))).toThrow('unable to parse PAGER command: "oops');
    expect(() => parsePagerCommand('$NOTHING', env({}))).toThrow(
      'unable to parse PAGER command: $NOTHING',
    );
  });
});

// ==========================================================================
// Glamour v2 style resolution (glow v3 utils.GlamourStyle)
// ==========================================================================

describe('glamourStyle (glow v3)', () => {
  const sample = '# Title\n\nSome **bold** text.\n';

  test('"auto" resolves to the standard dark style for markdown', () => {
    const prev = process.env.COLORFGBG;
    process.env.COLORFGBG = '0;15'; // a light terminal must not matter
    try {
      const auto = new TermRenderer(glamourStyle('auto', false), withWordWrap(40)).render(sample);
      const dark = new TermRenderer(withStandardStyle('dark'), withWordWrap(40)).render(sample);
      expect(auto).toBe(dark);
    } finally {
      if (prev === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = prev;
    }
  });

  test('JSON style files are loaded from disk for code files', () => {
    const file = path.join(tmp, 'style.json');
    fs.writeFileSync(file, JSON.stringify(DarkStyle));
    const out = new TermRenderer(glamourStyle(file, true), withWordWrap(40)).render(
      '```go\npackage main\n```',
    );
    expect(stripAnsi(out)).toContain('package main');
  });

  test('code files render without the code block margin', () => {
    const out = new TermRenderer(glamourStyle('notty', true), withWordWrap(0)).render(
      '```go\npackage main\n```',
    );
    const line = stripAnsi(out).split('\n').find((l) => l.includes('package main'))!;
    const withMargin = new TermRenderer(withStandardStyle('notty'), withWordWrap(0)).render(
      '```go\npackage main\n```',
    );
    const marginLine = stripAnsi(withMargin).split('\n').find((l) => l.includes('package main'))!;
    expect(line.indexOf('package')).toBeLessThan(marginLine.indexOf('package'));
  });
});

describe('hasDarkBackground', () => {
  test('parses COLORFGBG', () => {
    expect(hasDarkBackground('15;0')).toBe(true);
    expect(hasDarkBackground('0;15')).toBe(false);
    expect(hasDarkBackground('0;7')).toBe(false);
    expect(hasDarkBackground('default;default')).toBe(true);
    expect(hasDarkBackground(undefined)).toBe(true);
  });
});

// ==========================================================================
// Config
// ==========================================================================

describe('config (glow v2.1.2 / v3)', () => {
  test('showLineNumbers and preserveNewLines load from the config file', () => {
    const file = path.join(tmp, 'glow.yml');
    fs.writeFileSync(file, 'showLineNumbers: true\npreserveNewLines: true\nwidth: 60\n');
    const cfg = loadConfigFile(file);
    expect(cfg.showLineNumbers).toBe(true);
    expect(cfg.preserveNewLines).toBe(true);
    expect(cfg.width).toBe(60);
  });

  test('defaults when config file is missing', () => {
    const cfg = loadConfigFile(path.join(tmp, 'missing.yml'));
    expect(cfg.showLineNumbers).toBe(false);
    expect(cfg.style).toBe('auto');
  });

  test('GLOW_HIGH_PERFORMANCE_PAGER is gone, GLOW_ENABLE_GLAMOUR remains', () => {
    const prev = process.env.GLOW_ENABLE_GLAMOUR;
    process.env.GLOW_ENABLE_GLAMOUR = 'false';
    try {
      const cfg = defaultConfig() as unknown as Record<string, unknown>;
      expect(cfg.glamourEnabled).toBe(false);
      expect(cfg.highPerformancePager).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.GLOW_ENABLE_GLAMOUR;
      else process.env.GLOW_ENABLE_GLAMOUR = prev;
    }
  });
});

// ==========================================================================
// Styles resolved from the terminal background (glow v3 ui/styles.go)
// ==========================================================================

describe('newStyles', () => {
  test('adaptive picks light or dark variants', () => {
    expect(newStyles(true).adaptive('#111111', '#EEEEEE')).toBe('#EEEEEE');
    expect(newStyles(false).adaptive('#111111', '#EEEEEE')).toBe('#111111');
  });

  test('dark and light styles render differently', () => {
    const dark = newStyles(true);
    const light = newStyles(false);
    expect(dark.isDark).toBe(true);
    expect(light.isDark).toBe(false);
    expect(dark.grayFg('x')).not.toBe(light.grayFg('x'));
    expect(stripAnsi(dark.grayFg('x'))).toBe('x');
  });

  test('divider styles carry their strings', () => {
    const s = newStyles(true);
    expect(stripAnsi(s.dividerDot.toString())).toBe(' • ');
    expect(stripAnsi(s.dividerBar.toString())).toBe(' │ ');
  });

  test('errorView matches upstream layout', () => {
    const s = newStyles(true);
    const fatal = stripAnsi(errorView(s, new Error('boom'), true));
    expect(fatal).toBe('\n    ERROR \n   \n   boom\n   \n   press any key to exit');
    expect(stripAnsi(errorView(s, new Error('x'), false))).toContain('press any key to return');
  });
});

// ==========================================================================
// Stash (file listing)
// ==========================================================================

describe('stash header ("adaptive documents", glow v3)', () => {
  test('plural helper mirrors english.Plural', () => {
    expect(plural(0, 'document')).toBe('0 documents');
    expect(plural(1, 'document')).toBe('1 document');
    expect(plural(2, 'document')).toBe('2 documents');
  });

  test('header says "1 document" for a single file', () => {
    const s = new StashModel(cfgWith());
    s.setSize(80, 24);
    s.addMarkdowns([md('a.md')]);
    expect(stripAnsi(s.headerView())).toBe('1 document');
    s.addMarkdowns([md('b.md')]);
    expect(stripAnsi(s.headerView())).toBe('2 documents');
  });

  test('header says "0 documents" when empty', () => {
    const s = new StashModel(cfgWith());
    s.setSize(80, 24);
    expect(stripAnsi(s.headerView())).toBe('0 documents');
  });

  test('view renders the header and logo', () => {
    const s = new StashModel(cfgWith());
    s.setSize(80, 24);
    s.loaded = true;
    s.addMarkdowns([md('only.md')]);
    const v = stripAnsi(s.view());
    expect(v).toContain(' Glow ');
    expect(v).toContain('1 document');
    expect(v).not.toContain('1 documents');
    expect(v).toContain('only.md');
  });
});

describe('stash help', () => {
  test('"e edit" only shows when documents are available', () => {
    const s = new StashModel(cfgWith());
    s.setSize(120, 24);
    expect(stripAnsi(s.helpView()[0])).not.toContain('e edit');
    s.addMarkdowns([md('a.md')]);
    expect(stripAnsi(s.helpView()[0])).toContain('e edit');
  });

  test('"e" with no documents does nothing', () => {
    const s = new StashModel(cfgWith());
    s.setSize(80, 24);
    const cmd = s.handleDocumentBrowsing(new KeyPressMsg({ code: 'e'.codePointAt(0)!, text: 'e', mod: 0 }));
    expect(cmd).toBeNull();
  });

  test('paginator dots use the styles', () => {
    const s = new StashModel(cfgWith());
    const light = newStyles(false);
    s.setStyles(light);
    expect(s.paginator().activeDot).toBe(light.brightGrayFg('•'));
    expect(s.paginator().inactiveDot).toBe(light.darkGrayFg.render('•'));
  });

  test('filter prompt is "Find:" with a margin', () => {
    const s = new StashModel(cfgWith());
    expect(s.filterInput.prompt).toBe('Find:');
    expect(s.filterInput.virtualCursor()).toBe(true);
    expect(stripAnsi(s.filterInput.view()).startsWith('Find: ')).toBe(true);
  });
});

// ==========================================================================
// Top-level model: background color + declarative View (Bubble Tea v2)
// ==========================================================================

describe('GlowModel (glow v3)', () => {
  function stashModelIn(dir: string, overrides: Partial<Config> = {}): GlowModel {
    return newGlowModel(cfgWith({ path: dir, ...overrides }));
  }

  test('starts with dark styles and requests the background color', () => {
    const m = stashModelIn(tmp);
    expect(m.common.styles.isDark).toBe(true);
    const cmd = m.init();
    expect(cmd).not.toBeNull();
    const msg = cmd!();
    expect(msg).toBeInstanceOf(BatchMsg);
    expect((msg as BatchMsg).cmds).toContain(RequestBackgroundColor);
  });

  test('BackgroundColorMsg rebuilds styles and restyles paginators', () => {
    const m = stashModelIn(tmp);
    m.update(new BackgroundColorMsg('#ffffff'));
    expect(m.common.styles.isDark).toBe(false);
    expect(m.stash.common.styles.isDark).toBe(false);
    expect(m.pager.common.styles.isDark).toBe(false);
    expect(m.stash.paginator().activeDot).toBe(newStyles(false).brightGrayFg('•'));

    m.update(new BackgroundColorMsg('#000000'));
    expect(m.common.styles.isDark).toBe(true);
  });

  test('view declares alt screen and mouse mode', () => {
    const m = stashModelIn(tmp);
    const v = m.view();
    expect(v).toBeInstanceOf(View);
    expect(v.altScreen).toBe(true);
    expect(v.mouseMode).toBe(MouseMode.None);

    const withMouse = stashModelIn(tmp, { enableMouse: true });
    expect(withMouse.view().mouseMode).toBe(MouseMode.CellMotion);
  });

  test('a missing path is a fatal error rendered in the view', () => {
    const m = newGlowModel(cfgWith({ path: path.join(tmp, 'nope.md') }));
    expect(m.fatalErr).not.toBeNull();
    expect(stripAnsi(m.view().content)).toContain('press any key to exit');
  });

  test('a file path starts in the document state', () => {
    const file = path.join(tmp, 'doc.md');
    fs.writeFileSync(file, '# Doc\n');
    const m = newGlowModel(cfgWith({ path: file }));
    expect(m.state).toBe(State.ShowDocument);
    expect(m.pager.currentDocument?.localPath).toBe(file);
  });

  test('q quits from the document view too', () => {
    const m = newGlowModel(cfgWith(), undefined, undefined, '# hi');
    expect(m.state).toBe(State.ShowDocument);
    const [, cmd] = m.update(new KeyPressMsg({ code: 'q'.codePointAt(0)!, text: 'q', mod: 0 }));
    expect(cmd).not.toBeNull();
    expect(cmd!()).toMatchObject({ _tag: 'QuitMsg' });
  });

  test('esc returns from the document to the stash', () => {
    const m = newGlowModel(cfgWith(), undefined, undefined, '# hi');
    m.update(new KeyPressMsg({ code: KeyCode.Escape, text: '', mod: 0 }));
    expect(m.state).toBe(State.ShowStash);
  });
});

// ==========================================================================
// Pager
// ==========================================================================

describe('pager (glow v3)', () => {
  function pagerWith(overrides: Partial<Config>, doc: Markdown): PagerModel {
    const p = new PagerModel(cfgWith({ glamourStyle: 'notty', glamourMaxWidth: 40, ...overrides }));
    p.setSize(60, 20);
    p.currentDocument = doc;
    return p;
  }

  test('showLineNumbers prefixes 4-wide line numbers', () => {
    const p = pagerWith({ showLineNumbers: true }, md('doc.md'));
    const out = stripAnsi(glamourRender(p, '# One\n\ntwo\n')).split('\n');
    expect(out[0].startsWith('   1')).toBe(true);
    expect(out[1].startsWith('   2')).toBe(true);
  });

  test('no line numbers by default for markdown', () => {
    const p = pagerWith({}, md('doc.md'));
    const out = stripAnsi(glamourRender(p, '# One\n'));
    expect(out.startsWith('   1')).toBe(false);
    expect(out).toContain('# One');
  });

  test('code files get line numbers and no wrapping', () => {
    const p = pagerWith({}, md('main.go'));
    const out = stripAnsi(glamourRender(p, 'package main\n\nfunc main() {}\n')).split('\n');
    expect(out[0]).toBe('   1package main');
  });

  test('GLOW_ENABLE_GLAMOUR=false returns the raw markdown', () => {
    const p = pagerWith({ glamourEnabled: false }, md('doc.md'));
    expect(glamourRender(p, '# raw *md*')).toBe('# raw *md*');
  });

  test('status bar has logo, note, percent and help', () => {
    const p = pagerWith({}, md('notes/doc.md'));
    p.setContent('line');
    const bar = stripAnsi(p.statusBarView());
    expect(bar.startsWith(' Glow  notes/doc.md ')).toBe(true);
    expect(bar.endsWith(' 100%  ? Help ')).toBe(true);
    expect(bar.length).toBe(60);
  });

  test('help view is padded to the full width', () => {
    const p = pagerWith({}, md('doc.md'));
    const lines = stripAnsi(p.helpView()).split('\n');
    expect(lines).toHaveLength(7);
    for (const l of lines) expect(l.length).toBe(60);
    expect(lines[4]).toContain('f/pgdn   page down           e       edit this document');
  });

  test('toggling help shrinks the viewport', () => {
    const p = pagerWith({}, md('doc.md'));
    expect(p.viewport.height()).toBe(19);
    p.toggleHelp();
    expect(p.viewport.height()).toBe(19 - 1 - 6);
    p.toggleHelp();
    expect(p.viewport.height()).toBe(19);
  });

  test('window size re-renders the document', async () => {
    const p = pagerWith({}, md('doc.md', '# Resized'));
    const [, cmd] = p.update(new WindowSizeMsg(50, 10));
    expect(cmd).not.toBeNull();
    const msg = await cmd!();
    expect(stripAnsi((msg as { content: string }).content)).toContain('# Resized');
  });
});

// ==========================================================================
// CLI end-to-end
// ==========================================================================

describe('CLI (glow v3)', () => {
  const cli = path.join(import.meta.dir, '..', 'src', 'cli.ts');

  function run(args: string[], opts: { env?: Record<string, string>; input?: string } = {}) {
    return spawnSync(process.execPath, [cli, ...args], {
      input: opts.input,
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, GLOW_CONFIG_HOME: tmp, ...opts.env },
      encoding: 'utf-8',
    });
  }

  test('renders a file to stdout with the notty style when piped', () => {
    const file = path.join(tmp, 'cli.md');
    fs.writeFileSync(file, '---\ntitle: t\n---\n# Heading\n\nfirst line\nsecond line\n');
    const r = run(['-w', '40', file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Heading');
    expect(r.stdout).not.toContain('title: t');
    // Like upstream, the CLI always preserves newlines. Expected bytes are
    // upstream glow v3.0.0's output for the same file (`glow -w 40 cli.md`).
    const pad = (s: string) => s.padEnd(38, ' ');
    expect(r.stdout).toBe(
      `\n${pad('  # Heading')}\n${pad('')}\n${pad('  first line')}\n${pad('  second line')}\n\n`,
    );
  });

  test('reads markdown from a stdin pipe', () => {
    const r = run(['-s', 'notty'], { input: '# From stdin\n' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# From stdin');
  });

  test('pipes through $PAGER parsed with shell syntax', () => {
    const file = path.join(tmp, 'pager.md');
    fs.writeFileSync(file, '# Paged\n');
    const r = run(['-p', file], { env: { PAGER: `"${process.execPath}" -e 'process.stdin.pipe(process.stdout)'` } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('# Paged');
  });

  test('reports unparsable $PAGER commands', () => {
    const file = path.join(tmp, 'pager2.md');
    fs.writeFileSync(file, '# Paged\n');
    const r = run(['-p', file], { env: { PAGER: '"less -r' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unable to parse PAGER command: "less -r');
  });

  test('--version reports 2.0.0', () => {
    const r = run(['--version']);
    expect(r.stdout.trim()).toBe('glow version 2.0.0');
  });
});
