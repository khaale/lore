import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generateCorpus } from './generate.mjs';
import { captureProfile } from './profile.mjs';
import { verifyCorpus } from './verify.mjs';
import { corpusFingerprint } from './fingerprint.mjs';
import { openSqliteWorkspace } from '../../dist/index.js';

const template = { kind: 'object', fields: { label: { kind: 'string', chars: 20, bytes: 25 } } };
const type = (count, markdown) => ({
  count,
  markdown,
  jsonl: count - markdown,
  propertyBytes: count * 40,
  idLengths: [[12, count]],
  templates: [template],
  narrativeLengths: markdown ? [[{ chars: 80, bytes: 100 }, markdown]] : [],
});
const profile = {
  version: 1,
  reference: { entities: 5, canonicalEdges: 4, classes: ['Entity', 'A', 'B'] },
  types: { A: type(2, 2), B: type(3, 0) },
  directories: [{ parent: -1, length: 6 }],
  files: [
    { kind: 'md', directory: 0, relativeLength: 40, types: { A: 1 } },
    { kind: 'md', directory: 0, relativeLength: 40, types: { A: 1 } },
    { kind: 'jsonl', directory: 0, relativeLength: 40, types: { B: 3 } },
  ],
  unclassified: [{ bytes: 40, directory: 0, relativeLength: 40 }],
  relations: [
    {
      from: 'A',
      relation: 'owner',
      to: 'B',
      count: 4,
      outDegrees: [[2, 2]],
      inDegrees: [
        [1, 2],
        [2, 1],
      ],
    },
  ],
};
async function contents(root) {
  const files = {};
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
      else files[path] = await readFile(join(directory, entry.name), 'utf8');
    }
  }
  await walk(root);
  return files;
}

test('seed reproduces source bytes; a different seed changes records; existing output is protected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-generator-test-'));
  try {
    const first = join(root, 'first'),
      second = join(root, 'second'),
      third = join(root, 'third');
    await generateCorpus({ output: first, seed: 'fixed', profile });
    await generateCorpus({ output: second, seed: 'fixed', profile });
    await generateCorpus({ output: third, seed: 'different', profile });
    assert.deepEqual(await contents(first), await contents(second));
    assert.notDeepEqual(await contents(first), await contents(third));
    await assert.rejects(generateCorpus({ output: first, profile }), /Refusing to overwrite/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI publishes doubled corpus with exact typed in/out degrees; profiling does not retain text/IDs/paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lore-generator-sdk-'));
  try {
    const root = join(directory, 'source'),
      indexPath = join(directory, 'index.sqlite');
    const manifest = await generateCorpus({ output: root, seed: 'fixture', copies: 2, profile });
    execFileSync(
      process.execPath,
      [resolve('dist/cli.js'), 'index', '--format', 'sqlite', '--out', indexPath, root],
      { stdio: 'pipe' },
    );
    const workspace = await openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } });
    try {
      assert.equal((await verifyCorpus(workspace, profile, manifest)).degreeSequencesMatch, true);
      assert.equal(
        (await workspace.entities.get(manifest.samples.narrative, { include: ['narrative'] })).item
          .narrative.length,
        80,
      );
      const captured = JSON.stringify(captureProfile(indexPath));
      assert.ok(!captured.includes(root));
      assert.ok(!captured.includes(manifest.samples.narrative));
      assert.ok(!captured.includes('Synthetic A 0'));
    } finally {
      await workspace.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('comparison fingerprint ignores derived state but detects and verifies restoration of authored bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-fingerprint-test-'));
  try {
    const source = join(root, 'source');
    const manifest = await generateCorpus({ output: source, seed: 'identity', profile });
    const originalHash = await corpusFingerprint(source);
    await mkdir(join(source, '.artifact-index'));
    await writeFile(join(source, '.artifact-index/index.json'), 'derived');
    await writeFile(join(source, '.benchmark.json'), 'changed metadata');
    assert.equal(await corpusFingerprint(source), originalHash);
    const path = join(source, manifest.samples.changedFile),
      original = await readFile(path);
    await writeFile(path, 'changed authored bytes');
    assert.notEqual(await corpusFingerprint(source), originalHash);
    await writeFile(path, original);
    assert.equal(await corpusFingerprint(source), originalHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fractional contraction preserves all types and valid same-type targets without dangling references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lore-generator-fraction-'));
  try {
    const root = join(directory, 'source'),
      indexPath = join(directory, 'index.sqlite');
    const manifest = await generateCorpus({
      output: root,
      seed: 'fraction',
      fraction: 0.5,
      profile,
    });
    assert.deepEqual(manifest.types, { A: 1, B: 2 });
    assert.ok(manifest.edges <= profile.reference.canonicalEdges);
    execFileSync(
      process.execPath,
      [resolve('dist/cli.js'), 'index', '--format', 'sqlite', '--out', indexPath, root],
      { stdio: 'pipe' },
    );
    const workspace = await openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } });
    try {
      const result = await verifyCorpus(workspace, profile, manifest);
      assert.equal(result.degreeReference, 'generated-fraction');
      assert.equal(result.degreeSequencesMatch, true);
    } finally {
      await workspace.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
