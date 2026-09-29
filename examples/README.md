# Examples

Glow is a CLI, so the examples are commands plus a few sample documents to
point them at. `handbook/` holds 15 short markdown files from an imaginary
team handbook. One of them, `caching-api-responses-at-the-edge.md`, has
headings, a TypeScript code block, tables, a link and horizontal rules, so
it exercises most of the renderer.

Run the commands from the repository root after building:

```sh
npm install
npm run build
```

`glow` below means `node dist/cli.js`. Once this version is published,
`npx @oakoliver/glow` works the same way.

## File list with a filter

```sh
glow -t examples/handbook
```

The TUI opens on the file list (15 documents). Press `/`, type `cach` and
press `enter`: the list narrows to the matching files, with the matched
characters underlined. Arrow keys move, `enter` opens a file, `esc` clears
the filter, `q` quits.

## Pager with line numbers

```sh
glow -t -l -w 100 examples/handbook/caching-api-responses-at-the-edge.md
```

Opens the document in the pager with line numbers (`-l`), word-wrapped at
100 columns (`-w 100`). Scroll with the arrow keys or `j`/`k` to reach the
code block and the tables; the status bar at the bottom shows the file name
and how far you are. `?` shows the help, `esc` goes back to the file list.
The pager needs a terminal at least 104 columns wide for the line numbers
and the 100-column text to fit.

## CLI rendering with a style

```sh
glow -s dracula -w 100 examples/handbook/caching-api-responses-at-the-edge.md
glow -s dracula -w 100 - < examples/handbook/caching-api-responses-at-the-edge.md
```

Renders straight to stdout in the Dracula style; `-` reads the document from
stdin. Try `-s tokyo-night`, `-s pink`, `-s light` or `-s notty` too.

## Requirements

These commands need the sibling versions this glow requires:
`@oakoliver/lipgloss` 1.1.2 or later, `@oakoliver/glamour` 2.0.0 or later,
`@oakoliver/bubbletea` 1.2.0 or later and `@oakoliver/bubbles` 1.2.2 or
later.

Until those versions are on npm, run glow against local builds of the
sibling repositories (checked out next to this one), without touching
`package.json` or the lockfile:

```sh
for pkg in lipgloss glamour bubbletea bubbles; do
  (cd ../$pkg && npm install && npm run build)
  rm -rf node_modules/@oakoliver/$pkg
  mkdir -p node_modules/@oakoliver/$pkg
  cp -R ../$pkg/package.json ../$pkg/dist node_modules/@oakoliver/$pkg/
done
# glamour's own runtime dependencies (syntax highlighting and emoji)
mkdir -p node_modules/@oakoliver/glamour/node_modules
for dep in highlight.js node-emoji @sindresorhus char-regex emojilib skin-tone unicode-emoji-modifier-base; do
  cp -R ../glamour/node_modules/$dep node_modules/@oakoliver/glamour/node_modules/
done
```

Run `npm install` again to go back to the versions from npm.
