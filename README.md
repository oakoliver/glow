# @oakoliver/glow

Terminal markdown reader — TypeScript port of [Charmbracelet's Glow](https://github.com/charmbracelet/glow), built on our `@oakoliver` ports of Lip Gloss, Glamour, Bubble Tea and Bubbles. Its only third-party dependencies come through Glamour (`highlight.js`, `node-emoji`).

Render markdown files beautifully in the terminal, with a full interactive TUI for browsing and filtering markdown files in a directory.

**Parity:** Glow **v3.0.0** (built on the Bubble Tea v2 / Bubbles v2 / Lip Gloss v2 / Glamour v2 ports). See [CHANGELOG.md](./CHANGELOG.md) for what changed from 1.x.

## Install

```bash
npm install -g @oakoliver/glow
```

Or use as a project dependency:

```bash
npm install @oakoliver/glow
```

## CLI Usage

```bash
# Render a markdown file
glow README.md

# Render from stdin
cat README.md | glow -

# Render from a URL
glow https://raw.githubusercontent.com/charmbracelet/glow/master/README.md

# Render from a GitHub repo
glow github://charmbracelet/glow

# Render from a GitLab repo
glow gitlab://caarlos0/test

# Launch the interactive TUI in the current directory
glow

# Launch the TUI in a specific directory
glow ./docs

# Use a specific style
glow -s dark README.md

# Set word-wrap width
glow -w 80 README.md

# Pipe through a pager ($PAGER is parsed with shell syntax, default "less -r")
PAGER='"/opt/my pager/less" -R' glow -p README.md

# Edit the config file
glow config
```

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--style` | `-s` | Style name or JSON path (default "auto") |
| `--width` | `-w` | Word-wrap at width (0 to disable) |
| `--pager` | `-p` | Display with system pager |
| `--tui` | `-t` | Display with TUI |
| `--all` | `-a` | Show system files and directories (TUI only) |
| `--line-numbers` | `-l` | Show line numbers (TUI only) |
| `--preserve-new-lines` | `-n` | Preserve newlines in the output |
| `--mouse` | `-m` | Enable mouse wheel (TUI only, hidden in upstream help) |
| `--config` | | Config file path |
| `--help` | `-h` | Help |
| `--version` | `-v` | Version |

## Available Styles

- `auto` (default) — the `dark` style for markdown (as in Glow v3 / Glamour v2); for source files, picks dark/light from the terminal
- `dark` — dark theme
- `light` — light theme
- `pink` — pink theme
- `dracula` — Dracula color scheme
- `tokyo-night` — Tokyo Night color scheme
- `notty` — plain output for non-TTY contexts

You can also pass a path to a custom JSON style file.

## TUI Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Open document |
| `Esc` / `h` / `Left` / `Delete` | Back to files |
| `/` | Find (filter files) |
| `Tab` / `Shift+Tab` | Switch section (after filtering) |
| `q` | Quit |
| `r` | Refresh files / reload document |
| `c` | Copy contents (OSC 52 + system clipboard) |
| `e` | Edit in `$EDITOR` (only shown when there are documents) |
| `?` | Toggle help |
| `j` / `k` / Arrow keys | Navigate |
| `g` / `G` / `Home` / `End` | Go to top / bottom |
| `d` / `u` | Half page down / up |
| `f` / `b` | Page down / up |

The TUI starts with dark-background colors and switches to the light palette
once the terminal reports a light background color (Bubble Tea v2
`BackgroundColorMsg`).

## Library Usage

```typescript
import { NewProgram, defaultConfig, glamourStyle, parsePagerCommand } from '@oakoliver/glow';

// Create a config
const cfg = defaultConfig();
cfg.path = './docs';

// Launch the TUI programmatically (the stash and pager models are created
// for you; alt screen and mouse mode are declared by the model's View)
const program = NewProgram(cfg);
await program.run();

// Parse a pager command the way glow does
parsePagerCommand('"/opt/my pager/less" -R'); // ['/opt/my pager/less', '-R']
```

## Configuration

Glow reads its configuration from `~/.config/glow/glow.yml` (or `$XDG_CONFIG_HOME/glow/glow.yml`).

```yaml
# style name or JSON path (default "auto")
style: "auto"
# mouse support (TUI-mode only)
mouse: false
# use pager to display markdown
pager: false
# word-wrap at width
width: 80
# show all files, including hidden and ignored
all: false
# show line numbers (TUI-mode only)
showLineNumbers: false
# preserve newlines in the output
preserveNewLines: false
```

Environment variables: `GLOW_CONFIG_HOME` / `XDG_CONFIG_HOME` (config
location), `GLAMOUR_STYLE` (TUI style override), `GLOW_ENABLE_GLAMOUR=false`
(debug: show raw markdown in the TUI), `PAGER`, `EDITOR`.
`GLOW_HIGH_PERFORMANCE_PAGER` was removed in 2.0.0, as in Glow v3.

Run `glow config` to open the config file in your editor.

## Part of the Charm Ecosystem Port

This package is part of a complete TypeScript port of the Charmbracelet terminal UI ecosystem:

| Package | npm | Description |
|---------|-----|-------------|
| [@oakoliver/lipgloss](https://www.npmjs.com/package/@oakoliver/lipgloss) | `@oakoliver/lipgloss` | Terminal styling |
| [@oakoliver/glamour](https://www.npmjs.com/package/@oakoliver/glamour) | `@oakoliver/glamour` | Markdown rendering |
| [@oakoliver/bubbletea](https://www.npmjs.com/package/@oakoliver/bubbletea) | `@oakoliver/bubbletea` | TUI framework (Elm architecture) |
| [@oakoliver/bubbles](https://www.npmjs.com/package/@oakoliver/bubbles) | `@oakoliver/bubbles` | TUI components |
| **@oakoliver/glow** | `@oakoliver/glow` | **Terminal markdown reader** |

All packages are pure TypeScript implementations.

## License

MIT - see [LICENSE](./LICENSE) for details.

Original Go implementation by [Charmbracelet](https://github.com/charmbracelet/glow), licensed under MIT.
