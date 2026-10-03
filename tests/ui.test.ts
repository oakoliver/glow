import { describe, test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BatchMsg, SequenceMsg, KeyPressMsg, KeyCode, KeyMod, WindowSizeMsg } from '@oakoliver/bubbletea';
import type { Cmd, Msg } from '@oakoliver/bubbletea';
import { stripAnsi } from '@oakoliver/lipgloss';
import { defaultConfig } from '../src/config.js';
import { newGlowModel, State, type GlowModel } from '../src/ui/ui.js';
import { FilteredMarkdownMsg } from '../src/ui/stash.js';

/**
 * Runs the model like a Program would: each message goes through update()
 * and the returned commands are executed. Timer commands (spinner ticks,
 * status timeouts) are dropped if they don't resolve quickly, so the loop
 * settles.
 */
async function drive(model: GlowModel, ...msgs: Msg[]): Promise<void> {
  const queue: Msg[] = [...msgs];
  const run = async (cmd: Cmd | null | undefined): Promise<void> => {
    if (!cmd) return;
    const result = await Promise.race([
      Promise.resolve(cmd()),
      new Promise((resolve) => setTimeout(() => resolve(undefined), 30)),
    ]);
    if (result instanceof BatchMsg || result instanceof SequenceMsg) {
      for (const c of result.cmds) await run(c);
    } else if (result !== undefined && result !== null) {
      queue.push(result as Msg);
    }
  };
  for (let steps = 0; queue.length > 0 && steps < 200; steps++) {
    const msg = queue.shift()!;
    // A Program runs the commands inside a batch or sequence instead of
    // delivering the batch to the model.
    if (msg instanceof BatchMsg || msg instanceof SequenceMsg) {
      for (const c of msg.cmds) await run(c);
      continue;
    }
    const [, cmd] = model.update(msg);
    await run(cmd);
  }
}

function key(code: KeyCode | string): KeyPressMsg {
  return typeof code === 'string'
    ? new KeyPressMsg({ text: code, mod: KeyMod.None, code: code.charCodeAt(0) })
    : new KeyPressMsg({ text: '', mod: KeyMod.None, code });
}

function stashOn(dir: string): GlowModel {
  const cfg = defaultConfig();
  cfg.path = dir;
  cfg.glamourStyle = 'dark';
  const model = newGlowModel(cfg);
  return model;
}

function tempDocs(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-ui-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe('TUI', () => {
  test('finishing the file search stops the "Scanning" status', async () => {
    const model = stashOn(tempDocs({ 'notes.md': '# Notes\n' }));
    await drive(model, new WindowSizeMsg(80, 24), model.init()!() as Msg);
    const screen = stripAnsi(model.view().content);
    expect(screen).toContain('notes');
    expect(screen).not.toContain('Scanning');
  });

  // Upstream's stash view (glow v3.0.0 ui/stash.go) pads to height - 1
  // lines: a leading newline, then logo, header, list, filler, pagination and
  // help, with the filler sized so the help is the view's last line.
  test('the help bar is the last line of the stash view', async () => {
    const model = stashOn(tempDocs({ 'notes.md': '# Notes\n' }));
    await drive(model, new WindowSizeMsg(80, 24), model.init()!() as Msg);
    const lines = stripAnsi(model.view().content).split('\n');
    expect(lines.length).toBe(23);
    expect(lines[lines.length - 1]).toMatch(/q quit/);
  });

  test('a full page of documents still fits the screen exactly', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`doc-${String(i).padStart(2, '0')}.md`] = `# Doc ${i}\n`;
    for (const height of [24, 30, 17]) {
      const model = stashOn(tempDocs(files));
      await drive(model, new WindowSizeMsg(80, height), model.init()!() as Msg);
      const lines = stripAnsi(model.view().content).split('\n');
      expect(lines.length).toBe(height - 1);
      expect(lines[lines.length - 1]).toMatch(/q quit/);
    }
  });

  test('a blank line separates the documents in the list', async () => {
    const model = stashOn(tempDocs({ 'alpha.md': '# A\n', 'beta.md': '# B\n' }));
    await drive(model, new WindowSizeMsg(80, 24), model.init()!() as Msg);
    const lines = stripAnsi(model.view().content).split('\n').map((l) => l.trim());
    const second = lines.findIndex((l) => l.includes('beta.md'));
    expect(lines[second - 1]).toBe('');
  });

  test('enter opens the selected document in the pager', async () => {
    const model = stashOn(tempDocs({ 'guide.md': '# Guide\n\nUnique body sentence.\n' }));
    await drive(model, new WindowSizeMsg(80, 24), model.init()!() as Msg);
    await drive(model, key(KeyCode.Enter));
    expect(model.state).toBe(State.ShowDocument);
    expect(stripAnsi(model.view().content)).toContain('Unique body sentence.');
  });
});

describe('TUI filtering', () => {
  test('filter results reach the stash and narrow the list', async () => {
    const model = stashOn(tempDocs({ 'alpha.md': '# A\n', 'beta.md': '# B\n', 'gamma.md': '# G\n' }));
    await drive(model, new WindowSizeMsg(80, 24), model.init()!() as Msg);
    await drive(model, key('/'));
    // The stash's filter command produces this message; send it directly so
    // the test doesn't depend on the text input's key handling.
    const beta = model.stash.markdowns.filter((md) => md.note.startsWith('beta'));
    await drive(model, new FilteredMarkdownMsg(beta));
    const screen = stripAnsi(model.view().content);
    expect(screen).toContain('beta');
    expect(screen).not.toContain('alpha');
    expect(screen).not.toContain('gamma');
  });
});
