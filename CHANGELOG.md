# Changelog

## 2.0.1

### Fixed

- The file listing only shows markdown files. It is now a 1:1 port of
  upstream's finder (glow v3.0.0 `findLocalFiles` on
  [muesli/gitcha](https://github.com/muesli/gitcha) v0.3.0 and
  sabhiram/go-gitignore): files match the glob patterns `*.md`, `*.mdown`,
  `*.mkdn`, `*.mkd` and `*.markdown` (case-insensitive), so extensionless
  files such as `.DS_Store`, `README` or `Dockerfile` are no longer listed.
  Without `--all`, dotfiles and dot-directories, `node_modules`, `$GOPATH`,
  `~/Library` (macOS) and paths excluded by the enclosing git repository's
  root `.gitignore` are skipped (nested `.gitignore` files are not read, as
  upstream); with `--all`, nothing is skipped. Entries are listed in the same
  order as upstream, with symlinks resolved as upstream does.
- `isMarkdownFile` uses Go's `filepath.Ext` semantics: a leading dot counts as
  an extension, so `.DS_Store` is treated as source code, not markdown.
- An unreadable or missing directory reports an error instead of an empty list.
- The type build (`build:types` / `tsc --noEmit`) works against the current
  sibling ports: `NewView`, `BackgroundColorMsg`, `RequestBackgroundColor`
  (`@oakoliver/bubbletea` 1.2.0) and `withStylesFromJSONFile`
  (`@oakoliver/glamour` 1.1.0) are exported by those versions; the failures came
  from stale 1.0.0 copies installed from npm.

### Added

- `markdownExtensions` and `localFileToMarkdown` are exported.

## 2.0.0

Parity with [charmbracelet/glow v3.0.0](https://github.com/charmbracelet/glow/releases/tag/v3.0.0)
(synced from the v2.1.1 baseline, including v2.1.2). Requires
`@oakoliver/bubbletea` ^1.2.0 (Bubble Tea v2), `@oakoliver/bubbles` ^1.2.0
(Bubbles v2), `@oakoliver/glamour` ^1.1.0 (Glamour v2) and
`@oakoliver/lipgloss` ^1.1.0 (Lip Gloss v2).

### Breaking

- The TUI runs on the Bubble Tea v2 port: `GlowModel.view()` returns a `View`
  that declares the alt screen and mouse mode; `NewProgram` no longer passes
  program options, and its stash/pager factories are optional.
- Styles are no longer module-level values picked via `$COLORFGBG`. `newStyles(isDark)`
  builds a `Styles` object; the TUI starts dark and rebuilds styles when the
  terminal reports its background (`BackgroundColorMsg`, requested at startup).
  The old exports (`adaptiveColor`, `greenFg`, `subtleStyle`, …) are removed.
- The `auto` style renders markdown with the standard `dark` style (Glamour v2
  has no auto-detection); source files still pick dark/light.
- `GLOW_HIGH_PERFORMANCE_PAGER` / `Config.highPerformancePager` were removed.
- `StashModel` / `PagerModel` take `(cfg, common?)` and share the top-level
  `CommonModel` (which now carries `styles`). `errorView(styles, err, fatal)`
  matches upstream's layout. UI messages are now single classes re-exported
  from `ui.ts` (`FetchedMarkdownMsg`, `ContentRenderedMsg`, `FilteredMarkdownMsg`).

### Changed / fixed (upstream v2.1.2 and v3.0.0)

- `$PAGER` is parsed with shell syntax (quotes, escapes, `$VAR`, `${VAR:-x}`,
  `~`, braces), like `shell.Fields`, and an unparsable command reports
  `unable to parse PAGER command: …` (glow v2.1.2).
- `showLineNumbers` from the config file is honored in the TUI (glow v2.1.2).
- The file listing header says “1 document” instead of “1 documents” (glow v3).
- Filter input uses a virtual cursor and a styled `Find:` prompt. Paginator
  dots use the gray palette and are restyled with the background (glow v3).
- Pager status bar, help and line numbers follow upstream's layout and colors.
  The pager re-renders when the window is resized.

### Fixed (port gaps against the v2.1.1 baseline)

- Opening a document from the file listing, and the loading spinner stopping
  after the file search, now work.
- "e edit" only shows (and `e` only acts) when documents are available.
- The CLI always preserves newlines, like upstream.
- Stdin is only read when it's a pipe or has content, not whenever it isn't a TTY.
- Custom JSON style files load again with Glamour v2 (`withStylesFromJSONFile`).
- `glow config --config path` edits the given file.

### Not ported

- Kitty text-sizing protocol for headers (glow `main`, unreleased after v3.0.0).
- Go/packaging-only changes: module path `charm.land/glow/v3`, `go install`
  instructions, `glow man`/completion commands, goreleaser, CI and
  dependency bumps.
