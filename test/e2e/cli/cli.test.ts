import { execFileSync, spawn } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
const root = join(process.cwd(), 'test/fixtures/workspaces/basic');
const bin = join(process.cwd(), 'apps/cli/dist/index.js');
const run = (...args: string[]) =>
  execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
describe('built CLI', () => {
  it('checks, indexes, lists and explores', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'lore-cli-basic-'));
    await cp(root, workspace, { recursive: true });
    try {
      expect(run('check', workspace)).toContain('checked:');
      expect(run('index', workspace)).toContain('indexed:');
      expect(run('list', '--index', join(workspace, '.artifact-index/index.json'))).toContain(
        'thing-1',
      );
      expect(
        run('refs', '--index', join(workspace, '.artifact-index/index.json'), 'thing-1'),
      ).toContain('related');
      expect(run('explore', '--json', workspace)).toContain('overview');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
  it('keeps last-known-good bytes across invalid watch edits and publishes repair', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'lore-cli-watch-'));
    await cp(root, workspace, { recursive: true });
    const child = spawn(
      process.execPath,
      [bin, 'watch', '--poll', '15ms', '--debounce', '15ms', workspace],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const index = join(workspace, '.artifact-index/index.json');
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(predicate()).toBe(true);
    };
    try {
      await waitFor(() => output.includes('indexed'));
      const initial = await readFile(index, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 150));
      await writeFile(join(workspace, 'thing.yaml'), 'id: thing-1\nkind: Thing\ntitle: Changed\n');
      await waitFor(() => (output.match(/indexed:?/g) ?? []).length >= 2);
      const changed = await readFile(index, 'utf8');
      expect(changed).not.toBe(initial);
      await writeFile(join(workspace, 'thing.yaml'), 'id: [\n');
      await waitFor(() => output.includes('validation failed'));
      expect(await readFile(index, 'utf8')).toBe(changed);
      await writeFile(join(workspace, 'thing.yaml'), 'id: thing-1\nkind: Thing\ntitle: Repaired\n');
      await waitFor(() => (output.match(/indexed:?/g) ?? []).length >= 3);
      expect(await readFile(index, 'utf8')).not.toBe(changed);
    } finally {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await access(index);
    }
  });
});
