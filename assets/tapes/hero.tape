# Render: node <vhs>/dist/cli.js assets/tapes/hero.tape (from the repo root,
# with the sibling versions from examples/README.md installed)
Output assets/hero.gif

Set Shell bash
Set FontSize 14
Set Width 1000
Set Height 580
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set Framerate 20

Hide
Type "export PS1='> ' HOME=$(mktemp -d) && alias glow='bun src/cli.ts' && clear"
Enter
Show

Type "glow examples/handbook"
Sleep 300ms
Enter
Sleep 2s
Down@400ms 3
Sleep 600ms
Type "/"
Sleep 400ms
Type@180ms "cach"
Sleep 1.5s
Enter
Sleep 1.2s
Enter
Sleep 2.2s
PageDown
Sleep 2s
Escape
Sleep 1.2s
Type "q"
Sleep 600ms
