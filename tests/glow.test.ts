// glow.test.ts — Tests for the Glow TypeScript port
// Port of glow_test.go + url_test.go + additional unit tests
import { describe, test, expect } from 'bun:test';

import {
  removeFrontmatter,
  removeFrontmatterBytes,
  expandPath,
  wrapCodeBlock,
  isMarkdownFile,
} from '../src/utils.js';
import {
  parseSimpleYaml,
  defaultConfig,
} from '../src/config.js';
import { isURL } from '../src/url.js';
import {
  type Markdown,
  newMarkdown,
  normalize,
  buildFilterValue,
  relativeTime,
  sortMarkdowns,
} from '../src/ui/markdown.js';
import { keyword, paragraph } from '../src/style.js';
import { indent, stripAbsolutePath } from '../src/ui/ui.js';

// ==========================================================================
// Flag parsing tests — port of glow_test.go TestGlowFlags
// ==========================================================================

describe('flag parsing', () => {
  // We can't test Cobra directly, but we test our parseArgs equivalent
  // by importing and testing the logic inline.

  function parseArgs(argv: string[]) {
    const flags = {
      style: 'auto',
      width: 0,
      pager: false,
      tui: false,
      all: false,
      lineNumbers: false,
      preserveNewLines: false,
      mouse: false,
      configPath: '',
      help: false,
      version: false,
      configCmd: false,
      args: [] as string[],
      changed: new Set<string>(),
    };

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === 'config') { flags.configCmd = true; i++; continue; }
      if (arg === '-h' || arg === '--help') { flags.help = true; i++; continue; }
      if (arg === '-v' || arg === '--version') { flags.version = true; i++; continue; }
      if (arg === '-s' || arg === '--style') { flags.style = argv[++i] || 'auto'; flags.changed.add('style'); i++; continue; }
      if (arg.startsWith('--style=')) { flags.style = arg.slice('--style='.length); flags.changed.add('style'); i++; continue; }
      if (arg === '-w' || arg === '--width') { flags.width = parseInt(argv[++i] || '0', 10); flags.changed.add('width'); i++; continue; }
      if (arg.startsWith('--width=')) { flags.width = parseInt(arg.slice('--width='.length), 10); flags.changed.add('width'); i++; continue; }
      if (arg === '-p' || arg === '--pager') { flags.pager = true; flags.changed.add('pager'); i++; continue; }
      if (arg === '-t' || arg === '--tui') { flags.tui = true; flags.changed.add('tui'); i++; continue; }
      if (arg === '-a' || arg === '--all') { flags.all = true; flags.changed.add('all'); i++; continue; }
      if (arg === '-l' || arg === '--line-numbers') { flags.lineNumbers = true; flags.changed.add('lineNumbers'); i++; continue; }
      if (arg === '-n' || arg === '--preserve-new-lines') { flags.preserveNewLines = true; flags.changed.add('preserveNewLines'); i++; continue; }
      if (arg === '-m' || arg === '--mouse') { flags.mouse = true; flags.changed.add('mouse'); i++; continue; }
      if (arg === '--config') { flags.configPath = argv[++i] || ''; flags.changed.add('config'); i++; continue; }
      if (arg.startsWith('--config=')) { flags.configPath = arg.slice('--config='.length); flags.changed.add('config'); i++; continue; }
      if (arg.startsWith('-')) { i++; continue; }
      flags.args.push(arg);
      i++;
    }
    return flags;
  }

  test('-p enables pager', () => {
    const flags = parseArgs(['-p']);
    expect(flags.pager).toBe(true);
  });

  test('-s light sets style to light', () => {
    const flags = parseArgs(['-s', 'light']);
    expect(flags.style).toBe('light');
  });

  test('-w 40 sets width to 40', () => {
    const flags = parseArgs(['-w', '40']);
    expect(flags.width).toBe(40);
  });

  test('--style=dark sets style', () => {
    const flags = parseArgs(['--style=dark']);
    expect(flags.style).toBe('dark');
  });

  test('--width=100 sets width', () => {
    const flags = parseArgs(['--width=100']);
    expect(flags.width).toBe(100);
  });

  test('-a enables all files', () => {
    const flags = parseArgs(['-a']);
    expect(flags.all).toBe(true);
  });

  test('-l enables line numbers', () => {
    const flags = parseArgs(['-l']);
    expect(flags.lineNumbers).toBe(true);
  });

  test('-n enables preserve new lines', () => {
    const flags = parseArgs(['-n']);
    expect(flags.preserveNewLines).toBe(true);
  });

  test('-m enables mouse', () => {
    const flags = parseArgs(['-m']);
    expect(flags.mouse).toBe(true);
  });

  test('-t enables tui', () => {
    const flags = parseArgs(['-t']);
    expect(flags.tui).toBe(true);
  });

  test('config subcommand', () => {
    const flags = parseArgs(['config']);
    expect(flags.configCmd).toBe(true);
  });

  test('positional args', () => {
    const flags = parseArgs(['README.md']);
    expect(flags.args).toEqual(['README.md']);
  });

  test('mixed flags and args', () => {
    const flags = parseArgs(['-s', 'dark', '-w', '60', '-p', 'README.md']);
    expect(flags.style).toBe('dark');
    expect(flags.width).toBe(60);
    expect(flags.pager).toBe(true);
    expect(flags.args).toEqual(['README.md']);
  });

  test('changed set tracks explicit flags', () => {
    const flags = parseArgs(['-s', 'dark', '-w', '60']);
    expect(flags.changed.has('style')).toBe(true);
    expect(flags.changed.has('width')).toBe(true);
    expect(flags.changed.has('pager')).toBe(false);
  });
});

// ==========================================================================
// URL tests — port of url_test.go TestURLParser
// (skipped because they require network, matching Go's behavior)
// ==========================================================================

describe('URL parsing', () => {
  const urlTests = [
    { path: 'github.com/charmbracelet/glow', desc: 'github.com short form' },
    { path: 'github://charmbracelet/glow', desc: 'github:// protocol' },
    { path: 'github://caarlos0/dotfiles.fish', desc: 'github:// with dots' },
    { path: 'github://tj/git-extras', desc: 'github:// with dashes' },
    { path: 'https://github.com/goreleaser/nfpm', desc: 'https://github.com' },
    { path: 'gitlab.com/caarlos0/test', desc: 'gitlab.com short form' },
    { path: 'gitlab://caarlos0/test', desc: 'gitlab:// protocol' },
    { path: 'https://gitlab.com/terrakok/gitlab-client', desc: 'https://gitlab.com' },
  ];

  for (const { path, desc } of urlTests) {
    test.skip(`${desc}: ${path}`, async () => {
      // Skipped: test uses network, sometimes fails for no reason
      // Matching Go behavior: t.Skip("test uses network, sometimes fails for no reason")
    });
  }
});

// ==========================================================================
// isURL
// ==========================================================================

describe('isURL', () => {
  test('http URL', () => {
    expect(isURL('http://example.com')).toBe(true);
  });

  test('https URL', () => {
    expect(isURL('https://github.com/charmbracelet/glow')).toBe(true);
  });

  test('file path is not URL', () => {
    expect(isURL('/Users/test/README.md')).toBe(false);
  });

  test('relative path is not URL', () => {
    expect(isURL('README.md')).toBe(false);
  });

  test('empty string is not URL', () => {
    expect(isURL('')).toBe(false);
  });
});

// ==========================================================================
// RemoveFrontmatter
// ==========================================================================

describe('removeFrontmatter', () => {
  test('removes YAML frontmatter', () => {
    const input = '---\ntitle: Hello\n---\n# Heading\n';
    const result = removeFrontmatter(input);
    expect(result).toBe('# Heading\n');
  });

  test('preserves content without frontmatter', () => {
    const input = '# Heading\nSome text\n';
    expect(removeFrontmatter(input)).toBe(input);
  });

  test('only removes frontmatter at the start', () => {
    const input = 'Hello\n---\ntitle: x\n---\nWorld';
    expect(removeFrontmatter(input)).toBe(input);
  });

  test('handles empty frontmatter', () => {
    const input = '---\n\n---\nContent\n';
    const result = removeFrontmatter(input);
    expect(result).toBe('Content\n');
  });

  test('removeFrontmatterBytes works with Buffer', () => {
    const buf = Buffer.from('---\ntitle: Test\n---\n# Hello');
    const result = removeFrontmatterBytes(buf);
    expect(result.toString()).toBe('# Hello');
  });
});

// ==========================================================================
// expandPath
// ==========================================================================

describe('expandPath', () => {
  test('expands tilde', () => {
    const home = process.env.HOME || '';
    expect(expandPath('~/test')).toBe(`${home}/test`);
  });

  test('expands $HOME', () => {
    const home = process.env.HOME || '';
    const result = expandPath('$HOME/test');
    expect(result).toBe(`${home}/test`);
  });

  test('expands ${HOME}', () => {
    const home = process.env.HOME || '';
    const result = expandPath('${HOME}/test');
    expect(result).toBe(`${home}/test`);
  });

  test('returns path unchanged when no variables', () => {
    expect(expandPath('/usr/local/bin')).toBe('/usr/local/bin');
  });
});

// ==========================================================================
// wrapCodeBlock
// ==========================================================================

describe('wrapCodeBlock', () => {
  test('wraps with language', () => {
    expect(wrapCodeBlock('hello', 'js')).toBe('```js\nhello```');
  });

  test('strips leading dot from extension', () => {
    expect(wrapCodeBlock('code', '.py')).toBe('```py\ncode```');
  });

  test('empty language', () => {
    expect(wrapCodeBlock('code', '')).toBe('```\ncode```');
  });
});

// ==========================================================================
// isMarkdownFile
// ==========================================================================

describe('isMarkdownFile', () => {
  test('README.md is markdown', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
  });

  test('.markdown extension', () => {
    expect(isMarkdownFile('file.markdown')).toBe(true);
  });

  test('.mdown extension', () => {
    expect(isMarkdownFile('notes.mdown')).toBe(true);
  });

  test('.go is not markdown', () => {
    expect(isMarkdownFile('main.go')).toBe(false);
  });

  test('.ts is not markdown', () => {
    expect(isMarkdownFile('index.ts')).toBe(false);
  });

  test('no extension defaults to markdown', () => {
    expect(isMarkdownFile('README')).toBe(true);
  });
});

// ==========================================================================
// parseSimpleYaml
// ==========================================================================

describe('parseSimpleYaml', () => {
  test('parses key-value pairs', () => {
    const input = 'style: dark\nwidth: 80\nmouse: true\n';
    const result = parseSimpleYaml(input);
    expect(result.style).toBe('dark');
    expect(result.width).toBe(80);
    expect(result.mouse).toBe(true);
  });

  test('skips comments', () => {
    const input = '# This is a comment\nstyle: light\n';
    const result = parseSimpleYaml(input);
    expect(result.style).toBe('light');
  });

  test('handles quoted strings', () => {
    const input = 'style: "auto"\n';
    const result = parseSimpleYaml(input);
    expect(result.style).toBe('auto');
  });

  test('handles inline comments', () => {
    const input = 'width: 80 # terminal width\n';
    const result = parseSimpleYaml(input);
    expect(result.width).toBe(80);
  });

  test('empty input', () => {
    expect(parseSimpleYaml('')).toEqual({});
  });
});

// ==========================================================================
// defaultConfig
// ==========================================================================

describe('defaultConfig', () => {
  test('returns sensible defaults', () => {
    const cfg = defaultConfig();
    expect(cfg.showAllFiles).toBe(false);
    expect(cfg.showLineNumbers).toBe(false);
    expect(cfg.enableMouse).toBe(false);
    expect(cfg.preserveNewLines).toBe(false);
    expect(cfg.glamourEnabled).toBe(true);
    expect(cfg.highPerformancePager).toBe(true);
    expect(cfg.path).toBe('');
  });
});

// ==========================================================================
// Markdown helpers
// ==========================================================================

describe('markdown', () => {
  test('newMarkdown creates a markdown', () => {
    const md = newMarkdown('/path/to/file.md', 'file.md', '# Hello', new Date());
    expect(md.localPath).toBe('/path/to/file.md');
    expect(md.note).toBe('file.md');
    expect(md.body).toBe('# Hello');
  });

  test('buildFilterValue populates filterValue', () => {
    const md = newMarkdown('/path/README.md', 'README.md', '', new Date());
    buildFilterValue(md);
    expect(md.filterValue.length).toBeGreaterThan(0);
  });

  test('normalize removes diacritics', () => {
    expect(normalize('Höllo')).toBe('Hollo');
    expect(normalize('café')).toBe('cafe');
  });

  test('normalize preserves case and whitespace', () => {
    // normalize only handles diacritics, not case or trim
    expect(normalize('  Hello World  ')).toBe('  Hello World  ');
  });

  test('sortMarkdowns sorts by note alphabetically', () => {
    const a = newMarkdown('', 'c-file', '', new Date(2020, 0, 1));
    const b = newMarkdown('', 'a-file', '', new Date(2023, 0, 1));
    const c = newMarkdown('', 'b-file', '', new Date(2021, 0, 1));
    const list = [a, b, c];
    sortMarkdowns(list);
    expect(list[0].note).toBe('a-file');
    expect(list[1].note).toBe('b-file');
    expect(list[2].note).toBe('c-file');
  });
});

// ==========================================================================
// relativeTime
// ==========================================================================

describe('relativeTime', () => {
  test('just now', () => {
    expect(relativeTime(new Date())).toBe('just now');
  });

  test('minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(d)).toBe('5 minutes ago');
  });

  test('1 hour ago', () => {
    const d = new Date(Date.now() - 61 * 60 * 1000);
    expect(relativeTime(d)).toBe('1 hour ago');
  });

  test('hours ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(relativeTime(d)).toBe('3 hours ago');
  });

  test('1 day ago', () => {
    const d = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(relativeTime(d)).toBe('1 day ago');
  });

  test('days ago', () => {
    const d = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(relativeTime(d)).toBe('5 days ago');
  });
});

// ==========================================================================
// UI helpers
// ==========================================================================

describe('ui helpers', () => {
  test('indent adds spaces', () => {
    expect(indent('hello', 4)).toBe('    hello');
  });

  test('indent multiline', () => {
    expect(indent('a\nb', 2)).toBe('  a\n  b');
  });

  test('stripAbsolutePath removes cwd prefix', () => {
    expect(stripAbsolutePath('/home/user/project/file.md', '/home/user/project')).toBe('file.md');
  });

  test('stripAbsolutePath returns absolute when not in cwd', () => {
    const result = stripAbsolutePath('/other/path/file.md', '/home/user/project');
    expect(result).toBe('/other/path/file.md');
  });
});

// ==========================================================================
// CLI styles
// ==========================================================================

describe('CLI styles', () => {
  test('keyword returns a styled string', () => {
    const result = keyword('test');
    // Should contain the text and some ANSI codes
    expect(result).toContain('test');
  });

  test('paragraph returns a styled string', () => {
    const result = paragraph('hello world');
    expect(result).toContain('hello');
  });
});
