// editor.ts — Launch $EDITOR for editing markdown files
// Port of charmbracelet/glow/ui/editor.go

import { spawn, type ChildProcess } from 'node:child_process';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Message sent when the editor process finishes. */
export class EditorFinishedMsg {
  readonly _tag = 'EditorFinishedMsg';
  constructor(public readonly err: Error | null) {}
}

// --------------------------------------------------------------------------
// Editor resolution
// --------------------------------------------------------------------------

/**
 * Resolve the editor binary. Checks $GLOW_EDITOR, $EDITOR, $VISUAL,
 * then falls back to common editors.
 */
function resolveEditor(): string {
  const editors = [
    process.env.GLOW_EDITOR,
    process.env.EDITOR,
    process.env.VISUAL,
  ];

  for (const e of editors) {
    if (e) return e;
  }

  // Fallback — try common editors
  return 'vi';
}

// --------------------------------------------------------------------------
// Open editor
// --------------------------------------------------------------------------

/**
 * Open a file in the user's preferred editor.
 * Returns a Cmd that spawns the editor and resolves with EditorFinishedMsg.
 *
 * The returned function yields an ExecProcess-like message with the child
 * process reference, so bubbletea can hand off the terminal to it.
 */
export function openEditor(filePath: string, lineNumber?: number): () => Promise<EditorFinishedMsg> {
  return () => {
    return new Promise<EditorFinishedMsg>((resolve) => {
      const editor = resolveEditor();
      const args: string[] = [];

      // Many editors support +line syntax
      if (lineNumber !== undefined && lineNumber > 0) {
        args.push(`+${lineNumber}`);
      }
      args.push(filePath);

      let child: ChildProcess;
      try {
        child = spawn(editor, args, {
          stdio: 'inherit',
          shell: true,
        });
      } catch (err) {
        resolve(new EditorFinishedMsg(err instanceof Error ? err : new Error(String(err))));
        return;
      }

      child.on('error', (err) => {
        resolve(new EditorFinishedMsg(err));
      });

      child.on('close', (code) => {
        if (code !== 0 && code !== null) {
          resolve(new EditorFinishedMsg(new Error(`editor exited with code ${code}`)));
        } else {
          resolve(new EditorFinishedMsg(null));
        }
      });
    });
  };
}
