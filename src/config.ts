// config.ts — Configuration for Glow
// Port of charmbracelet/glow/ui/config.go + config_cmd.go

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

/** TUI-specific configuration. */
export interface Config {
  showAllFiles: boolean;
  showLineNumbers: boolean;
  gopath: string;
  homeDir: string;
  glamourMaxWidth: number;
  glamourStyle: string;
  enableMouse: boolean;
  preserveNewLines: boolean;

  /** Working directory or file path. */
  path: string;

  /** High-performance pager rendering. */
  highPerformancePager: boolean;
  /** Whether glamour rendering is enabled. */
  glamourEnabled: boolean;
}

/** Create a default Config from environment variables. */
export function defaultConfig(): Config {
  return {
    showAllFiles: false,
    showLineNumbers: false,
    gopath: process.env.GOPATH || '',
    homeDir: process.env.HOME || os.homedir(),
    glamourMaxWidth: 0,
    glamourStyle: process.env.GLAMOUR_STYLE || 'auto',
    enableMouse: false,
    preserveNewLines: false,
    path: '',
    highPerformancePager: process.env.GLOW_HIGH_PERFORMANCE_PAGER !== 'false',
    glamourEnabled: process.env.GLOW_ENABLE_GLAMOUR !== 'false',
  };
}

// --------------------------------------------------------------------------
// XDG / Config file paths
// --------------------------------------------------------------------------

/** Get the XDG config directory for glow. */
export function getConfigDir(): string {
  // Check GLOW_CONFIG_HOME first
  const glowHome = process.env.GLOW_CONFIG_HOME;
  if (glowHome) return glowHome;

  // Then XDG_CONFIG_HOME
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) return path.join(xdgConfig, 'glow');

  // Platform defaults
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Preferences', 'glow');
  }
  return path.join(os.homedir(), '.config', 'glow');
}

/** Get the cache directory for glow. */
export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME;
  if (xdgCache) return path.join(xdgCache, 'glow');

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'glow');
  }
  return path.join(os.homedir(), '.cache', 'glow');
}

/** Get the config file path. */
export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'glow.yml');
}

// --------------------------------------------------------------------------
// Default config content
// --------------------------------------------------------------------------

const DEFAULT_CONFIG = `# style name or JSON path (default "auto")
style: "auto"
# mouse support (TUI-mode only)
mouse: false
# use pager to display markdown
pager: false
# word-wrap at width
width: 80
# show all files, including hidden and ignored.
all: false
`;

/** Ensure the config file exists, creating it with defaults if needed. */
export function ensureConfigFile(configFile: string): void {
  const ext = path.extname(configFile);
  if (ext !== '.yaml' && ext !== '.yml') {
    throw new Error(`'${ext}' is not a supported configuration type: use '.yaml' or '.yml'`);
  }
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, DEFAULT_CONFIG, 'utf-8');
  }
}

// --------------------------------------------------------------------------
// Simple YAML config reader (zero-dependency)
// --------------------------------------------------------------------------

/**
 * Parse a simple YAML config file. Only handles top-level key: value pairs
 * with string, number, and boolean values. Not a full YAML parser.
 */
export function parseSimpleYaml(content: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();

    // Remove inline comments
    const commentIdx = val.indexOf(' #');
    if (commentIdx !== -1) {
      val = val.slice(0, commentIdx).trim();
    }

    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Parse booleans
    if (val === 'true') {
      result[key] = true;
    } else if (val === 'false') {
      result[key] = false;
    } else if (/^\d+$/.test(val)) {
      result[key] = parseInt(val, 10);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Load config from the default config file, merging with defaults.
 * Returns an object with all recognized glow config keys.
 */
export function loadConfigFile(): Record<string, string | number | boolean> {
  const configFile = getConfigFilePath();
  const defaults: Record<string, string | number | boolean> = {
    style: 'auto',
    width: 0,
    all: true,
    mouse: false,
    pager: false,
    tui: false,
    preserveNewLines: false,
    showLineNumbers: false,
  };

  try {
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf-8');
      const parsed = parseSimpleYaml(content);
      return { ...defaults, ...parsed };
    }
  } catch {
    // Config not found or unreadable — use defaults
  }

  return defaults;
}
