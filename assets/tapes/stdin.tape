# Render: node <vhs>/dist/cli.js assets/tapes/stdin.tape (from the repo root,
# with the sibling versions from examples/README.md installed)
Output "/tmp/glow-stdin-discard.gif"

Set Shell bash
Set FontSize 14
Set Width 860
Set Height 560
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type `export PS1='> ' HOME=$(mktemp -d) && alias glow="bun $PWD/src/cli.ts" && cd examples/handbook && doc=caching-api-responses-at-the-edge.md && clear`
Enter
Show

Type "sed -n '/^## II /,/^---/p' $doc | glow -"
Enter
Sleep 2.5s
Screenshot assets/stdin.png
