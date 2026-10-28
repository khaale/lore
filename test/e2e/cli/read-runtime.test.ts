import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const binary = join(process.cwd(), 'apps/cli/dist/index.js');
const invoke = (...args: string[]) =>
  spawnSync(process.execPath, [binary, ...args], { encoding: 'utf8' });

describe('read-only filesystem CLI', () => {
  it('finds model.yaml and requires explicit selection when both model names exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-model-'));
    try {
      await cp('test/fixtures/workspaces/basic', root, { recursive: true });
      const schema = join(root, 'model.yaml');
      await rename(join(root, '.lore.yaml'), schema);
      const checked = invoke('check', '--strict', root);
      expect(checked.status, checked.stderr).toBe(0);
      const indexed = invoke('index', root);
      expect(indexed.status, indexed.stderr).toBe(0);
      expect(invoke('query', '--root', root).status).toBe(0);
      await cp(schema, join(root, '.lore.yaml'));
      const ambiguous = invoke('check', root);
      expect(ambiguous.status).not.toBe(0);
      expect(ambiguous.stderr).toContain('multiple Lore models');
      const explicit = invoke('check', '--schema', schema, '--strict', root);
      expect(explicit.status, explicit.stderr).toBe(0);
      // Saved index reads do not require automatic schema selection.
      expect(invoke('list', '--index', join(root, '.artifact-index/index.json')).status).toBe(0);
      await rm(schema);
      await rm(join(root, '.lore.yaml'));
      expect(invoke('check', root).stderr).toContain('expected .lore.yaml or model.yaml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads current sources without initialization or state and validates external edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-read-'));
    try {
      await cp('test/fixtures/workspaces/basic', root, { recursive: true });
      const source = join(root, 'thing.yaml');
      const original = await readFile(source, 'utf8');
      const filesBefore = await readdir(root);
      for (const args of [
        ['get', 'thing-1'],
        ['query'],
        ['search', 'thing'],
        ['links', 'thing-1'],
        ['graph', 'thing-1'],
        ['impact', 'thing-1'],
        ['validate'],
      ]) {
        const result = invoke(...args, '--root', root, '--json');
        expect(result.status, result.stderr).toBe(0);
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      }
      expect(await readFile(source, 'utf8')).toBe(original);
      expect(await readdir(root)).toEqual(filesBefore);
      await writeFile(source, 'id: thing-1\nkind: Thing\ntitle: Updated externally\n');
      const result = invoke('get', 'thing-1', '--root', root, '--json');
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).entity.properties.title).toBe('Updated externally');
      await writeFile(source, 'id: [\n');
      const invalid = invoke('validate', '--root', root, '--json');
      expect(invalid.status).not.toBe(0);
      expect(JSON.parse(invalid.stdout).summary.errors).toBeGreaterThan(0);
      expect(invoke('get', 'thing-1', '--root', root).status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unknown commands', () => {
    expect(invoke('--help').status).toBe(0);
    expect(invoke('unknown-command').status).not.toBe(0);
  });
});
