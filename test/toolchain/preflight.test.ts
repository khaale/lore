import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd());
const script = join(root, 'scripts/preflight.mjs');

const run = (projectRoot: string, ...candidates: string[]) =>
  spawnSync(process.execPath, [script, '--project-root', projectRoot, ...candidates], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_user_agent: '' },
  });

const project = async (
  overrides: { node?: string; selector?: string; packageManager?: string } = {},
) => {
  const directory = await mkdtemp(join(tmpdir(), 'lore-toolchain-'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      packageManager: overrides.packageManager ?? 'pnpm@10.17.0',
      engines: {
        node: overrides.node ?? '>=24.0.0 <25',
        pnpm: (overrides.packageManager ?? 'pnpm@10.17.0').slice('pnpm@'.length),
      },
    }),
  );
  await writeFile(join(directory, '.node-version'), overrides.selector ?? '24');
  return directory;
};

const defaultRootProject = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lore toolchain-'));
  await mkdir(join(directory, 'scripts'));
  await writeFile(join(directory, 'scripts/preflight.mjs'), await readFile(script));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@10.17.0',
      engines: { node: '>=24.0.0 <25', pnpm: '10.17.0' },
    }),
  );
  await writeFile(join(directory, '.node-version'), '24');
  return join(directory, 'scripts/preflight.mjs');
};

const runDefaultRoot = (scriptPath: string, ...candidates: string[]) =>
  spawnSync(process.execPath, [scriptPath, ...candidates], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_user_agent: '' },
  });

describe('toolchain preflight', () => {
  it('resolves the default checkout root from a filesystem URL', async () => {
    const scriptPath = await defaultRootProject();
    try {
      const result = runDefaultRoot(
        scriptPath,
        '--node-version',
        '24.19.0',
        '--pnpm-version',
        '10.17.0',
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('toolchain preflight passed');
    } finally {
      await rm(scriptPath.slice(0, scriptPath.lastIndexOf('/scripts')), {
        recursive: true,
        force: true,
      });
    }
  });

  it('accepts the declared Node and pnpm candidates', async () => {
    const directory = await project();
    try {
      const result = run(directory, '--node-version', '24.19.0', '--pnpm-version', '10.17.0');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('toolchain preflight passed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'Node',
      ['--node-version', '22.22.0', '--pnpm-version', '10.17.0'],
      'Node expected >=24.0.0 <25, actual 22.22.0',
    ],
    [
      'Node prerelease',
      ['--node-version', '24.0.0-rc.1', '--pnpm-version', '10.17.0'],
      'Node expected >=24.0.0 <25, actual 24.0.0-rc.1',
    ],
    [
      'pnpm',
      ['--node-version', '24.19.0', '--pnpm-version', '9.3.0'],
      'pnpm expected pnpm@10.17.0, actual pnpm@9.3.0',
    ],
  ])('rejects an unsupported %s before project work', async (_name, candidates, diagnostic) => {
    const directory = await project();
    const marker = join(directory, 'marker');
    await writeFile(marker, 'untouched');
    try {
      const result = run(directory, ...candidates);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(diagnostic);
      expect(await readFile(marker, 'utf8')).toBe('untouched');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [{ node: '>=24.0.0 <26' }, 'unsupported engines.node declaration'],
    [{ packageManager: 'pnpm@10' }, 'unsupported packageManager declaration'],
    [{ selector: '22' }, '.node-version "22" drifts'],
  ])('rejects malformed or drifting declarations', async (overrides, diagnostic) => {
    const directory = await project(overrides);
    try {
      const result = run(directory, '--node-version', '24.19.0', '--pnpm-version', '10.17.0');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(diagnostic);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
