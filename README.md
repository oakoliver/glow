# @oakoliver/glow

Terminal markdown reader — TypeScript port of [Charmbracelet's Glow](https://github.com/charmbracelet/glow), built on our `@oakoliver` ports of Lip Gloss, Glamour, Bubble Tea and Bubbles. Its only third-party dependencies come through Glamour (`highlight.js`, `node-emoji`).

Render markdown files beautifully in the terminal, with a full interactive TUI for browsing and filtering markdown files in a directory.

![glow examples/handbook: the file list, filtered by typing /cach with the matched characters underlined, then the caching guide opened in the pager and scrolled to its tables](https://raw.githubusercontent.com/oakoliver/glow/main/assets/hero.gif)

**Parity:** Glow **v3.0.0** (built on the Bubble Tea v2 / Bubbles v2 / Lip Gloss v2 / Glamour v2 ports). See [CHANGELOG.md](./CHANGELOG.md) for what changed from 1.x.

**Read the article:** [Getting Started with Glow](https://engineering.oakoliver.com/articles/getting-started-glow-markdown-terminal-reader) · [Porting Glow from Go to TypeScript](https://engineering.oakoliver.com/articles/porting-go-glow-to-typescript-terminal-markdown-reader-zero-dependencies)

## Install

```bash
npm install -g @oakoliver/glow
```

Or use as a project dependency:

```bash
npm install @oakoliver/glow
```

## CLI Usage

![A section of a markdown file piped into glow -: a heading, two tables with column dividers, and a paragraph](https://raw.githubusercontent.com/oakoliver/glow/main/assets/stdin.png)

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

![The same section, with a TypeScript code block, rendered by glow -s dracula and then glow -s tokyo-night](https://raw.githubusercontent.com/oakoliver/glow/main/assets/styles.gif)

## TUI Keybindings

![glow -t -l -w 100 on the caching guide: the pager with line numbers, paging down through the code block and both tables, then the ? help](https://raw.githubusercontent.com/oakoliver/glow/main/assets/pager.gif)

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

Glow reads its configuration from `glow.yml` in `$GLOW_CONFIG_HOME`, else `$XDG_CONFIG_HOME/glow`, else the platform default: `~/Library/Preferences/glow` on macOS and `~/.config/glow` elsewhere (as upstream). `glow config` creates the file if it's missing and opens it.

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

## Recording the pictures

The pictures in this README are real output of this package, recorded with
[@oakoliver/vhs](https://github.com/oakoliver/vhs) from the tapes in
[`assets/tapes`](assets/tapes) against the sample documents in
[`examples/handbook`](examples/handbook). Each tape runs glow with a fresh
`HOME`, so a local `glow.yml` doesn't change the output.

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
