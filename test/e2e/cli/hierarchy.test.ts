import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
const bin = resolve('dist/cli.js');
const cli = (...args: string[]) =>
  execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
it('roundtrips saved JSON/SQLite hierarchy proposals and rejects edited invalid definitions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-hierarchy-cli-'));
  try {
    await cp(resolve('test/fixtures/workspaces/basic'), root, { recursive: true });
    for (const format of ['json', 'sqlite']) {
      cli('index', '--format', format, root);
      const index = join(root, `.artifact-index/index.${format === 'json' ? 'json' : 'sqlite'}`),
        before = await readFile(index);
      const options = ['--format', format, '--index', index, '--root', root];
      const proposed = cli('hierarchy', 'propose', ...options, '--json'),
        proposal = JSON.parse(proposed);
      const file = join(root, 'saved-definition.json');
      await writeFile(file, proposed);
      const page = JSON.parse(
        cli('hierarchy', 'read', ...options, '--definition', file, '--limit', '1', '--json'),
      );
      expect(page.items).toHaveLength(1);
      expect(page.coverage.returned).toBe(1);
      await writeFile(file, JSON.stringify(proposal.definition));
      expect(
        JSON.parse(cli('hierarchy', 'read', ...options, '--definition', file, '--json')).items
          .length,
      ).toBeGreaterThan(0);
      const scored = JSON.parse(
        cli('hierarchy', 'read', ...options, '--definition', file, '--scores', '--json'),
      ) as import('../../../dist/index.js').HierarchyReadResult;
      expect(
        scored.items
          .filter((n) => n.kind === 'entity')
          .every((n) => typeof n.scores?.structureScore === 'number'),
      ).toBe(true);
      await writeFile(file, JSON.stringify({ ...proposal.definition, version: 99 }));
      const failed = spawnSync(
        process.execPath,
        [bin, 'hierarchy', 'read', ...options, '--definition', file, '--json'],
        { encoding: 'utf8' },
      );
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout).error).toMatchObject({
        code: 'INVALID_HIERARCHY',
        path: 'version',
      });
      expect(await readFile(index)).toEqual(before);
    }
    expect(cli('hierarchy', '--help')).toContain('propose|read');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
