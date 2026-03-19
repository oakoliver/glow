# @oakoliver/glow

Terminal markdown reader — zero-dependency TypeScript port of [Charmbracelet's Glow](https://github.com/charmbracelet/glow).

Render markdown files beautifully in the terminal, with a full interactive TUI for browsing and filtering markdown files in a directory.

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

# Pipe through a pager
glow -p README.md

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
| `--mouse` | `-m` | Enable mouse wheel (TUI only) |
| `--config` | | Config file path |
| `--help` | `-h` | Help |
| `--version` | `-v` | Version |

## Available Styles

- `auto` (default) — automatically detects dark/light terminal
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
| `Esc` / `h` / `Backspace` | Go back |
| `/` | Filter files |
| `q` | Quit |
| `r` | Refresh files |
| `c` | Copy to clipboard |
| `e` | Open in editor |
| `?` | Toggle help |
| `j` / `k` / Arrow keys | Navigate |
| `g` / `G` | Go to top / bottom |
| `Ctrl+D` / `Ctrl+U` | Half page down / up |

## Library Usage

```typescript
import {
  NewProgram,
  StashModel,
  PagerModel,
  defaultConfig,
  removeFrontmatter,
  isMarkdownFile,
  glamourStyle,
} from '@oakoliver/glow';

// Create a config
const cfg = defaultConfig();
cfg.path = './docs';

// Launch the TUI programmatically
const program = NewProgram(
  cfg,
  () => new StashModel(cfg),
  () => new PagerModel(cfg),
);
await program.run();
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
```

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

All packages are zero-dependency, pure TypeScript implementations.

## License

MIT - see [LICENSE](./LICENSE) for details.

Original Go implementation by [Charmbracelet](https://github.com/charmbracelet/glow), licensed under MIT.
