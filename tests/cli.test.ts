import { describe, test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.join(import.meta.dir, '..');

function glow(args: string[], stdin: 'ignore' | 'devnull' | string): string {
  const input = stdin === 'devnull' ? Bun.file('/dev/null') : stdin === 'ignore' ? 'ignore' : new Blob([stdin]);
  const proc = Bun.spawnSync(['bun', 'src/cli.ts', '-s', 'notty', ...args], { cwd: root, stdin: input });
  return proc.stdout.toString();
}

describe('CLI input selection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-cli-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, '# From the file\n');

  test('a file argument is rendered when stdin is /dev/null', () => {
    expect(glow([file], 'devnull')).toContain('From the file');
  });

  // As upstream glow v3.0.0 (main.go execute): piped stdin takes precedence
  // over arguments.
  test('piped stdin takes precedence over a file argument', () => {
    expect(glow([file], '# From stdin\n')).toContain('From stdin');
  });

  test('piped stdin is rendered when there is no argument', () => {
    expect(glow([], '# From stdin\n')).toContain('From stdin');
  });

  test('"-" reads stdin', () => {
    expect(glow(['-'], '# From stdin\n')).toContain('From stdin');
  });
});
