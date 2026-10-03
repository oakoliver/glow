# Render: node <vhs>/dist/cli.js assets/tapes/pager.tape (from the repo root,
# with the sibling versions from examples/README.md installed)
Output assets/pager.gif

Set Shell bash
Set FontSize 14
Set Width 1000
Set Height 620
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 20

Hide
Type "export PS1='> ' HOME=$(mktemp -d) && alias glow='bun src/cli.ts' && clear"
Enter
Show

Type "glow -t -l -w 100 examples/handbook/caching-api-responses-at-the-edge.md"
Sleep 300ms
Enter
Sleep 2s
PageDown
Sleep 1.8s
PageDown
Sleep 1.8s
Type "?"
Sleep 2s
Type "?"
Sleep 600ms
Type "q"
Sleep 600ms
