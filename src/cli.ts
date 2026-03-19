// cli.ts — CLI entry point for Glow
// Port of charmbracelet/glow/main.go (Cobra root command)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { type Config, defaultConfig, loadConfigFile, getConfigFilePath, ensureConfigFile } from './config.js';
import { readmeURL, isURL } from './url.js';
import type { Source } from './source.js';
import { removeFrontmatter, isMarkdownFile, wrapCodeBlock, glamourStyle, expandPath as utilExpandPath } from './utils.js';
import { keyword, paragraph } from './style.js';
import {
  TermRenderer,
  withWordWrap,
  withBaseURL,
  withPreservedNewLines,
  withAutoStyle,
  withStylePath,
  AutoStyleName,
  NoTTYStyleName,
  defaultStyles,
} from '@oakoliver/glamour';
import { NewProgram } from './ui/ui.js';
import { StashModel } from './ui/stash.js';
import { PagerModel } from './ui/pager.js';

// --------------------------------------------------------------------------
// Version
// --------------------------------------------------------------------------

const VERSION = '1.0.0';

// --------------------------------------------------------------------------
// README detection names
// --------------------------------------------------------------------------

const readmeNames = ['README.md', 'README', 'Readme.md', 'Readme', 'readme.md', 'readme'];

// --------------------------------------------------------------------------
// Arg parsing (replaces Cobra)
// --------------------------------------------------------------------------

interface CLIFlags {
  style: string;
  width: number;
  pager: boolean;
  tui: boolean;
  all: boolean;
  lineNumbers: boolean;
  preserveNewLines: boolean;
  mouse: boolean;
  configPath: string;
  help: boolean;
  version: boolean;
  configCmd: boolean;
  args: string[];
  /** Track which flags were explicitly set by the user. */
  changed: Set<string>;
}

function parseArgs(argv: string[]): CLIFlags {
  const flags: CLIFlags = {
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
    args: [],
    changed: new Set(),
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // Subcommands
    if (arg === 'config') {
      flags.configCmd = true;
      i++;
      continue;
    }

    // Flags
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      i++;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      flags.version = true;
      i++;
      continue;
    }
    if (arg === '-s' || arg === '--style') {
      flags.style = argv[++i] || 'auto';
      flags.changed.add('style');
      i++;
      continue;
    }
    if (arg.startsWith('--style=')) {
      flags.style = arg.slice('--style='.length);
      flags.changed.add('style');
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--width') {
      flags.width = parseInt(argv[++i] || '0', 10);
      flags.changed.add('width');
      i++;
      continue;
    }
    if (arg.startsWith('--width=')) {
      flags.width = parseInt(arg.slice('--width='.length), 10);
      flags.changed.add('width');
      i++;
      continue;
    }
    if (arg === '-p' || arg === '--pager') {
      flags.pager = true;
      flags.changed.add('pager');
      i++;
      continue;
    }
    if (arg === '-t' || arg === '--tui') {
      flags.tui = true;
      flags.changed.add('tui');
      i++;
      continue;
    }
    if (arg === '-a' || arg === '--all') {
      flags.all = true;
      flags.changed.add('all');
      i++;
      continue;
    }
    if (arg === '-l' || arg === '--line-numbers') {
      flags.lineNumbers = true;
      flags.changed.add('lineNumbers');
      i++;
      continue;
    }
    if (arg === '-n' || arg === '--preserve-new-lines') {
      flags.preserveNewLines = true;
      flags.changed.add('preserveNewLines');
      i++;
      continue;
    }
    if (arg === '-m' || arg === '--mouse') {
      flags.mouse = true;
      flags.changed.add('mouse');
      i++;
      continue;
    }
    if (arg === '--config') {
      flags.configPath = argv[++i] || '';
      flags.changed.add('config');
      i++;
      continue;
    }
    if (arg.startsWith('--config=')) {
      flags.configPath = arg.slice('--config='.length);
      flags.changed.add('config');
      i++;
      continue;
    }

    // Unknown flags (but not bare "-" which means stdin)
    if (arg.startsWith('-') && arg !== '-') {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }

    // Positional arg
    flags.args.push(arg);
    i++;
  }

  return flags;
}

// --------------------------------------------------------------------------
// Help text
// --------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    paragraph(
      `\nRender markdown on the CLI, ${keyword('with pizzazz')}!`,
    ),
  );
  console.log(`
Usage:
  glow [SOURCE|DIR] [flags]
  glow [command]

Available Commands:
  config      Edit the glow config file

Flags:
  -s, --style string              style name or JSON path (default "auto")
  -w, --width uint                word-wrap at width (set to 0 to disable)
  -p, --pager                     display with pager
  -t, --tui                       display with tui
  -a, --all                       show system files and directories (TUI-mode only)
  -l, --line-numbers              show line numbers (TUI-mode only)
  -n, --preserve-new-lines        preserve newlines in the output
      --config string             config file path
  -h, --help                      help for glow
  -v, --version                   version for glow
`);
}

// --------------------------------------------------------------------------
// sourceFromArg
// --------------------------------------------------------------------------

async function sourceFromArg(arg: string): Promise<Source> {
  // stdin
  if (arg === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks).toString('utf-8'), url: '' };
  }

  // GitHub/GitLab URL
  const src = await readmeURL(arg);
  if (src !== null) {
    return src;
  }

  // HTTP(S) URL
  if (arg.includes('://')) {
    let u: URL;
    try {
      u = new URL(arg);
    } catch {
      throw new Error(`invalid URL: ${arg}`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`${u.protocol} is not a supported protocol`);
    }
    const resp = await fetch(u.toString());
    if (!resp.ok) {
      throw new Error(`HTTP status ${resp.status}`);
    }
    const body = await resp.text();
    return { body, url: u.toString() };
  }

  // Directory — find README
  if (arg === '' || arg === '.') {
    arg = '.';
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(arg);
  } catch {
    // Not a directory — try as file below
    stat = null as unknown as fs.Stats;
  }

  if (stat && stat.isDirectory()) {
    for (const name of readmeNames) {
      const candidate = path.join(arg, name);
      if (fs.existsSync(candidate)) {
        const body = fs.readFileSync(candidate, 'utf-8');
        const abs = path.resolve(candidate);
        return { body, url: abs };
      }
    }
    throw new Error('missing markdown source');
  }

  // File
  try {
    const body = fs.readFileSync(arg, 'utf-8');
    const abs = path.resolve(arg);
    return { body, url: abs };
  } catch (e) {
    throw new Error(`unable to open file: ${(e as Error).message}`);
  }
}

// --------------------------------------------------------------------------
// Validate style
// --------------------------------------------------------------------------

function validateStyle(style: string): string | null {
  if (style === 'auto' || style === AutoStyleName) return null;
  if (defaultStyles[style]) return null;

  const expanded = utilExpandPath(style);
  try {
    fs.statSync(expanded);
    return null;
  } catch {
    return `specified style does not exist: ${style}`;
  }
}

// --------------------------------------------------------------------------
// stdinIsPipe
// --------------------------------------------------------------------------

function stdinIsPipe(): boolean {
  try {
    return !process.stdin.isTTY;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// executeCLI — render markdown to stdout
// --------------------------------------------------------------------------

async function executeCLI(
  src: Source,
  flags: CLIFlags,
  viperCfg: Record<string, string | number | boolean>,
): Promise<void> {
  let content = removeFrontmatter(src.body);

  const isCode = !isMarkdownFile(src.url);

  // Determine base URL for relative links
  let baseURL = '';
  if (src.url) {
    try {
      const u = new URL(src.url);
      u.pathname = path.posix.dirname(u.pathname);
      baseURL = u.toString() + '/';
    } catch {
      // Not a URL (local path) — no base URL needed
    }
  }

  // Build the file extension for code wrapping
  const ext = path.extname(src.url);
  if (isCode) {
    content = wrapCodeBlock(content, ext);
  }

  // Style
  const styleName = String(viperCfg.style || 'auto');
  const wordWrapWidth = Number(viperCfg.width) || 80;

  // Create glamour renderer
  const renderer = new TermRenderer(
    glamourStyle(styleName, isCode),
    withWordWrap(wordWrapWidth),
    ...(baseURL ? [withBaseURL(baseURL)] : []),
    ...(viperCfg.preserveNewLines ? [withPreservedNewLines()] : []),
  );

  const out = renderer.render(content);

  // Output
  const usePager = viperCfg.pager || flags.changed.has('pager');
  const useTUI = viperCfg.tui || flags.changed.has('tui');

  if (usePager) {
    let pagerCmd = process.env.PAGER || 'less -r';
    const parts = pagerCmd.split(' ');
    const result = spawnSync(parts[0], parts.slice(1), {
      input: out,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (result.error) {
      throw new Error(`unable to run pager: ${result.error.message}`);
    }
    return;
  }

  if (useTUI) {
    const filePath = !isURL(src.url) ? src.url : '';
    await runTUI(flags, viperCfg, filePath, content);
    return;
  }

  process.stdout.write(out);
}

// --------------------------------------------------------------------------
// runTUI — launch the interactive Bubble Tea TUI
// --------------------------------------------------------------------------

async function runTUI(
  flags: CLIFlags,
  viperCfg: Record<string, string | number | boolean>,
  filePath: string,
  content?: string,
): Promise<void> {
  const cfg: Config = defaultConfig();

  // Apply viper config values
  const glamourStyle = String(viperCfg.style || 'auto');
  const styleErr = validateStyle(glamourStyle);
  if (styleErr) {
    cfg.glamourStyle = flags.style;
  } else {
    cfg.glamourStyle = glamourStyle;
  }

  cfg.path = filePath;
  cfg.showAllFiles = Boolean(viperCfg.all);
  cfg.showLineNumbers = Boolean(viperCfg.showLineNumbers);
  cfg.glamourMaxWidth = Number(viperCfg.width) || 0;
  cfg.enableMouse = Boolean(viperCfg.mouse);
  cfg.preserveNewLines = Boolean(viperCfg.preserveNewLines);

  const program = NewProgram(
    cfg,
    (_common) => new StashModel(cfg),
    (_common) => new PagerModel(cfg),
    content,
  );

  await program.run();
}

// --------------------------------------------------------------------------
// Config subcommand
// --------------------------------------------------------------------------

function executeConfig(): void {
  const configPath = getConfigFilePath();
  ensureConfigFile(configPath);

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  spawnSync(editor, [configPath], {
    stdio: 'inherit',
  });
}

// --------------------------------------------------------------------------
// Detect terminal width
// --------------------------------------------------------------------------

function detectWidth(): number {
  try {
    const cols = process.stdout.columns;
    if (cols && cols > 0) {
      return Math.min(cols, 120);
    }
  } catch {
    // ignore
  }
  return 80;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  // --help
  if (flags.help) {
    printHelp();
    return;
  }

  // --version
  if (flags.version) {
    console.log(`glow version ${VERSION}`);
    return;
  }

  // config subcommand
  if (flags.configCmd) {
    executeConfig();
    return;
  }

  // Load config file (viper equivalent)
  const viperCfg = loadConfigFile();

  // Merge CLI flags into viper config (CLI flags override config file)
  if (flags.changed.has('style')) viperCfg.style = flags.style;
  if (flags.changed.has('width')) viperCfg.width = flags.width;
  if (flags.changed.has('pager')) viperCfg.pager = flags.pager;
  if (flags.changed.has('tui')) viperCfg.tui = flags.tui;
  if (flags.changed.has('all')) viperCfg.all = flags.all;
  if (flags.changed.has('lineNumbers')) viperCfg.showLineNumbers = flags.lineNumbers;
  if (flags.changed.has('preserveNewLines')) viperCfg.preserveNewLines = flags.preserveNewLines;
  if (flags.changed.has('mouse')) viperCfg.mouse = flags.mouse;

  // Validate pager + tui conflict
  if (viperCfg.pager && viperCfg.tui) {
    console.error('Error: cannot use both pager and tui');
    process.exit(1);
  }

  // Validate style
  const style = String(viperCfg.style || 'auto');
  const styleErr = validateStyle(style);
  if (styleErr) {
    console.error(`Error: ${styleErr}`);
    process.exit(1);
  }

  // Detect terminal
  const isTerminal = process.stdout.isTTY ?? false;

  // Use notty style when stdout is not a terminal and no style was explicitly set
  if (!isTerminal && !flags.changed.has('style')) {
    viperCfg.style = NoTTYStyleName;
  }

  // Detect width
  if (!flags.changed.has('width')) {
    if (isTerminal && Number(viperCfg.width) === 0) {
      viperCfg.width = detectWidth();
    }
    if (Number(viperCfg.width) === 0) {
      viperCfg.width = 80;
    }
  }

  // If stdin is a pipe, read from it
  if (stdinIsPipe()) {
    const src = await sourceFromArg('-');
    await executeCLI(src, flags, viperCfg);
    return;
  }

  // No args → TUI on cwd
  if (flags.args.length === 0) {
    await runTUI(flags, viperCfg, '');
    return;
  }

  // One arg — check if it's a directory for TUI, otherwise CLI
  if (flags.args.length === 1) {
    const arg = flags.args[0];
    try {
      const stat = fs.statSync(arg);
      if (stat.isDirectory()) {
        const abs = path.resolve(arg);
        await runTUI(flags, viperCfg, abs);
        return;
      }
    } catch {
      // Not a directory — fall through to CLI
    }
  }

  // CLI mode — render each arg
  for (const arg of flags.args) {
    const src = await sourceFromArg(arg);
    await executeCLI(src, flags, viperCfg);
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
