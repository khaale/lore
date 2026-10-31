import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

it('watch applies imported lore:sources mappings and retains JSON bytes after a bad extracted reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-declared-watch-'));
  await cp(resolve('examples/source-documents'), root, {
    recursive: true,
    filter: (path) => !path.includes('.artifact-index'),
  });
  const model = await readFile(join(root, '.lore.yaml'), 'utf8');
  await writeFile(join(root, 'definitions.yaml'), model);
  await writeFile(join(root, '.lore.yaml'), 'imports: [definitions]\n');
  const child = spawn(
    process.execPath,
    [resolve('dist/cli.js'), 'watch', '--poll', '15ms', '--debounce', '15ms', root],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += String(chunk);
  });
  async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(predicate(), output).toBe(true);
  }
  const count = () => (output.match(/indexed:?/g) ?? []).length;
  const index = join(root, '.artifact-index/index.json'),
    api = join(root, 'api/orders.yaml');
  try {
    await waitFor(() => count() >= 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const original = await readFile(api, 'utf8'),
      stable = await readFile(index, 'utf8');
    await writeFile(
      api,
      original.replace(/#\/components\/schemas\/Order/g, '#/components/schemas/Missing'),
    );
    await waitFor(() => output.includes('validation failed'));
    expect(await readFile(index, 'utf8')).toBe(stable);
    await writeFile(api, original);
    await waitFor(() => count() >= 2);
    await writeFile(join(root, 'definitions.yaml'), model.replace('    openapi:', '    rest:'));
    await waitFor(() => count() >= 3);
    expect(
      Object.keys(JSON.parse(await readFile(index, 'utf8')).artifacts).some((id) =>
        id.startsWith('rest/'),
      ),
    ).toBe(true);
    await writeFile(join(root, 'api/second.yaml'), original);
    await waitFor(() => count() >= 4);
    expect(Object.keys(JSON.parse(await readFile(index, 'utf8')).artifacts)).toHaveLength(13);
  } finally {
    const exit = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGTERM');
    await exit;
    await rm(root, { recursive: true, force: true });
  }
});
