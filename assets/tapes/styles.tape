# Render: node <vhs>/dist/cli.js assets/tapes/styles.tape (from the repo root,
# with the sibling versions from examples/README.md installed)
Output assets/styles.gif

Set Shell bash
Set FontSize 14
Set Width 860
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Hide
Type `export PS1='> ' HOME=$(mktemp -d) && alias glow="bun $PWD/src/cli.ts" && cd examples/handbook && doc=caching-api-responses-at-the-edge.md && clear`
Enter
Show

Type "sed -n '/^## I /,/^---/p' $doc | glow -s dracula -"
Enter
Sleep 3s
Hide
Type "clear"
Enter
Show
Type "sed -n '/^## I /,/^---/p' $doc | glow -s tokyo-night -"
Enter
Sleep 3s
