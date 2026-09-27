// Local file finder parity with glow v3.0.0 (muesli/gitcha v0.3.0 +
// sabhiram/go-gitignore). Expected listings were produced by running the Go
// finder (gitcha.FindFilesExcept / FindAllFilesExcept with glow's
// markdownExtensions and ignore patterns) over the same fixture tree, and the
// GitIgnore expectations by go-gitignore's MatchesPath on the same inputs.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { goExt, isMarkdownFile } from '../src/utils.js';
import { match, ErrBadPattern, gitRepoForPath } from '../src/ui/gitcha.js';
import { GitIgnore } from '../src/ui/gitignore.js';
import { findMarkdowns, markdownExtensions } from '../src/ui/filewalk.js';
import { findLocalFiles, ErrMsg } from '../src/ui/stash.js';
import { FoundMarkdownsMsg } from '../src/ui/filewalk.js';
import { defaultConfig, type Config } from '../src/config.js';
import { newStyles } from '../src/ui/styles.js';

describe('goExt / isMarkdownFile (Go filepath.Ext semantics)', () => {
  test('a leading dot is an extension, unlike Node path.extname', () => {
    expect(goExt('.DS_Store')).toBe('.DS_Store');
    expect(goExt('dir/.gitignore')).toBe('.gitignore');
    expect(goExt('a.tar.gz')).toBe('.gz');
    expect(goExt('foo.')).toBe('.');
    expect(goExt('dir.d/README')).toBe('');
    expect(goExt('README')).toBe('');
  });

  test('dotfiles are not markdown', () => {
    expect(isMarkdownFile('.DS_Store')).toBe(false);
    expect(isMarkdownFile('/x/.gitignore')).toBe(false);
    expect(isMarkdownFile('foo.')).toBe(false);
  });

  test('extensionless files still default to markdown (upstream IsMarkdownFile)', () => {
    expect(isMarkdownFile('README')).toBe(true);
    expect(isMarkdownFile('dir.d/README')).toBe(true);
    expect(isMarkdownFile('NOTES.MD')).toBe(true);
    expect(isMarkdownFile('.hidden.md')).toBe(true);
  });
});

describe('match (Go filepath.Match)', () => {
  test('stars and question marks do not cross separators', () => {
    expect(match('*.md', 'a.md')).toBe(true);
    expect(match('*.md', '.md')).toBe(true);
    expect(match('*.md', 'a/b.md')).toBe(false);
    expect(match('/x/.*', '/x/.DS_Store')).toBe(true);
    expect(match('/x/.*', '/x/y/.DS_Store')).toBe(false);
    expect(match('a?c', 'abc')).toBe(true);
    expect(match('a?c', 'a/c')).toBe(false);
    expect(match('*', 'abc')).toBe(true);
    expect(match('*', 'a/c')).toBe(false);
    expect(match('a*b*c', 'axxbyyc')).toBe(true);
    expect(match('a*b', 'axxbyy')).toBe(false);
  });

  test('character classes and escapes', () => {
    expect(match('[a-c]x', 'bx')).toBe(true);
    expect(match('[^a-c]x', 'bx')).toBe(false);
    expect(match('[^a-c]x', 'dx')).toBe(true);
    expect(match('\\*x', '*x')).toBe(true);
    expect(match('\\*x', 'ax')).toBe(false);
    expect(match('/a/[x]/.*', '/a/[x]/.b')).toBe(false);
    expect(match('[ü]', 'ü')).toBe(true);
  });

  test('malformed patterns throw ErrBadPattern', () => {
    expect(() => match('[', 'a')).toThrow(ErrBadPattern);
    expect(() => match('a\\', 'a')).toThrow(ErrBadPattern);
    expect(() => match('[]', 'a')).toThrow(ErrBadPattern);
    expect(() => match('x[', 'y')).toThrow(ErrBadPattern);
  });
});

describe('GitIgnore (go-gitignore d3107576)', () => {
  const gi = GitIgnore.compileLines(
    'build/', '*.log', 'docs/*.md', '!docs/keep.md', '**/gen', '?x.md',
    '# comment', '\\#hash.md', '/rooted.md', 'logs/**', '',
  );

  test('matches paths relative to the repository root', () => {
    // "dir/" only matches below the directory, not the directory itself.
    expect(gi.matchesPath('/build')).toBe(false);
    expect(gi.matchesPath('/build/b.md')).toBe(true);
    expect(gi.matchesPath('/x.log')).toBe(true);
    expect(gi.matchesPath('/deep/x.log')).toBe(true);
    expect(gi.matchesPath('/docs/a.md')).toBe(true);
    expect(gi.matchesPath('/docs/sub/deep.md')).toBe(false);
    expect(gi.matchesPath('/gen/x/g.md')).toBe(true);
    expect(gi.matchesPath('/a/gen/h.md')).toBe(true);
    expect(gi.matchesPath('/#hash.md')).toBe(true);
    expect(gi.matchesPath('/rooted.md')).toBe(true);
    expect(gi.matchesPath('/nested/rooted.md')).toBe(false);
    expect(gi.matchesPath('/logs/l.md')).toBe(true);
    expect(gi.matchesPath('/logs')).toBe(true);
    expect(gi.matchesPath('/gen')).toBe(true);
    expect(gi.matchesPath('/README.md')).toBe(false);
  });

  test('negation only un-ignores an earlier match', () => {
    expect(gi.matchesPath('/docs/keep.md')).toBe(false);
  });

  test('"?" is matched literally in this go-gitignore version', () => {
    expect(gi.matchesPath('/ax.md')).toBe(false);
    expect(gi.matchesPath('/?x.md')).toBe(true);
  });
});

describe('findMarkdowns (gitcha parity)', () => {
  let root: string;
  let cfg: Config;

  const touch = (...parts: string[]) => {
    const p = path.join(root, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  };
  const notes = (dir: string, showAllFiles: boolean) =>
    findMarkdowns(path.join(root, dir), { ...cfg, showAllFiles }).map((md) => md.note);

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glow-filewalk-')));
    cfg = { ...defaultConfig(), gopath: '', homeDir: path.join(root, 'home') };

    for (const f of ['.DS_Store', 'README', 'a.md', 'B.MD', 'c.markdown', 'd.mkd', 'e.mkdn', 'f.mdown',
      'g.txt', 'h.md.bak', '.hidden.md', 'Makefile', 'space name.md', 'a[1].md', 'foo.']) {
      touch('plain', f);
    }

    fs.mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'repo', 'nested', '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo', '.gitignore'),
      'build/\n*.log\ndocs/*.md\n!docs/keep.md\n**/gen\n?x.md\n# comment\n\\#hash.md\nsub2\n/rooted.md\nlogs/**\n*.MD\n');
    fs.writeFileSync(path.join(root, 'repo', 'nested', '.gitignore'), 'ignored/\n');
    // Only the repository root's .gitignore is honoured upstream.
    fs.mkdirSync(path.join(root, 'repo', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo', 'docs', '.gitignore'), 'deep.md\n');
    for (const f of ['README.md', 'x.log', 'build/b.md', 'docs/a.md', 'docs/keep.md', 'docs/sub/deep.md',
      'gen/x/g.md', 'a/gen/h.md', 'ax.md', 'abx.md', '#hash.md', 'sub2/s.md', 'rooted.md', 'nested/rooted.md',
      'UP.MD', 'logs/l.md', 'nested/n.md', 'nested/ignored/i.md', 'nested/x.log', 'br[ack]/.hid.md',
      'br[ack]/q/v.md', 'd.md/inside.md', 'node_modules/pkg/r.md', '.hiddendir/h.md', 'Ünï/ü.md', '.env.md']) {
      touch('repo', ...f.split('/'));
    }
    touch('.hiddenroot', 'inner', 'z.md');
    fs.symlinkSync(path.join('..', 'plain', 'a.md'), path.join(root, 'repo', 'link.md'));
    fs.symlinkSync(path.join('..', 'plain'), path.join(root, 'repo', 'linkdir.md'));
    fs.symlinkSync(path.join('..', 'plain'), path.join(root, 'repo', 'linkdir'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('uses glob patterns, not isMarkdownFile', () => {
    expect(markdownExtensions).toEqual(['*.md', '*.mdown', '*.mkdn', '*.mkd', '*.markdown']);
  });

  test('lists only markdown files, skipping hidden files by default', () => {
    expect(notes('plain', false)).toEqual([
      'B.MD', 'a.md', 'a[1].md', 'c.markdown', 'd.mkd', 'e.mkdn', 'f.mdown', 'space name.md',
    ]);
  });

  test('showAllFiles includes hidden markdown files, never non-markdown ones', () => {
    expect(notes('plain', true)).toEqual([
      '.hidden.md', 'B.MD', 'a.md', 'a[1].md', 'c.markdown', 'd.mkd', 'e.mkdn', 'f.mdown', 'space name.md',
    ]);
  });

  test('respects the repository .gitignore, hidden dirs and node_modules', () => {
    const plain = path.join(root, 'plain');
    expect(notes('repo', false)).toEqual([
      'README.md', 'abx.md', 'ax.md', 'br[ack]/.hid.md', 'br[ack]/q/v.md', 'd.md', 'd.md/inside.md',
      'docs/keep.md', 'docs/sub/deep.md', path.join(plain, 'a.md'), plain, 'nested/n.md', 'nested/rooted.md',
      'Ünï/ü.md',
    ]);
  });

  test('showAllFiles bypasses .gitignore and ignore patterns', () => {
    const plain = path.join(root, 'plain');
    expect(notes('repo', true)).toEqual([
      '#hash.md', '.env.md', '.hiddendir/h.md', 'README.md', 'UP.MD', 'a/gen/h.md', 'abx.md', 'ax.md',
      'br[ack]/.hid.md', 'br[ack]/q/v.md', 'build/b.md', 'd.md', 'd.md/inside.md', 'docs/a.md', 'docs/keep.md',
      'docs/sub/deep.md', 'gen/x/g.md', path.join(plain, 'a.md'), plain, 'logs/l.md', 'nested/ignored/i.md',
      'nested/n.md', 'nested/rooted.md', 'node_modules/pkg/r.md', 'rooted.md', 'sub2/s.md', 'Ünï/ü.md',
    ]);
  });

  test('a nested repository uses its own root .gitignore', () => {
    expect(gitRepoForPath(path.join(root, 'repo', 'nested', 'n.md'))).toBe(path.join(root, 'repo', 'nested'));
    expect(notes('repo/nested', false)).toEqual(['n.md', 'rooted.md']);
    expect(notes('repo/nested', true)).toEqual(['ignored/i.md', 'n.md', 'rooted.md']);
  });

  test('a hidden root directory is itself ignored unless showing all files', () => {
    expect(notes('.hiddenroot', false)).toEqual([]);
    expect(notes('.hiddenroot', true)).toEqual(['inner/z.md']);
    expect(notes('.hiddenroot/inner', false)).toEqual(['z.md']);
  });

  test('findLocalFiles reports an error for a missing directory', () => {
    const common = { cfg, cwd: path.join(root, 'missing'), width: 0, height: 0, styles: newStyles(true) };
    expect(findLocalFiles(common)()).toBeInstanceOf(ErrMsg);
    common.cwd = path.join(root, 'plain');
    const msg = findLocalFiles(common)();
    expect(msg).toBeInstanceOf(FoundMarkdownsMsg);
    expect((msg as FoundMarkdownsMsg).markdowns.map((m) => m.note)).not.toContain('.DS_Store');
  });
});
