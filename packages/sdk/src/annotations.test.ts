import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildGraph } from '@khaale/lore-core';
import { publishIndex } from '@khaale/lore-filesystem';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { initializeSqliteIndex } from './sqlite-index.js';
import { openFilesystemWorkspace, openSqliteWorkspace } from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('discovers detached effective annotations on types, fields and nested reference paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-annotations-'));
  roots.push(root);
  const schemaPath = join(root, '.lore.yaml');
  await writeFile(
    schemaPath,
    `name: annotations
classes:
  Base:
    abstract: true
    annotations:
      'bb:group': {name: architecture, order: 1}
      'bb:flags': [searchable, visible]
    attributes:
      id: {identifier: true}
      owner:
        range: Base
        annotations:
          'bb:role': owner
          'bb:display': {label: Owner, color: blue}
  Tagged:
    mixin: true
    annotations:
      'bb:facet': technical
  Child:
    is_a: Base
    mixins: [Tagged]
    annotations:
      'bb:group': {name: interfaces}
      'bb:hidden': false
      'bb:note': null
    slot_usage:
      owner:
        annotations:
          'bb:display': {label: API}
    attributes:
      keys:
        range: ForeignKey
        inlined: true
        multivalued: true
        annotations:
          'bb:role': collection
  ForeignKey:
    attributes:
      target:
        range: Base
        annotations:
          'bb:role': dependency
          'bb:style': {tags: [foreign-key]}
  Plain:
    attributes:
      id: {identifier: true}
`,
  );
  const compiled = await compileSchemaOrThrow(schemaPath);
  const indexPath = join(root, '.artifact-index', 'index.json');
  await publishIndex(indexPath, buildGraph([], { root, compiled, strict: true }).index);
  const json = await openFilesystemWorkspace({ root, schemaPath, indexPath });
  const sqlitePath = join(root, 'index.sqlite');
  await initializeSqliteIndex({ root, schemaPath, indexPath: sqlitePath });
  const sqlite = await openSqliteWorkspace({
    indexPath: sqlitePath,
    freshness: { mode: 'indexed' },
  });
  try {
    const expected = {
      'bb:group': { name: 'interfaces' },
      'bb:flags': ['searchable', 'visible'],
      'bb:facet': 'technical',
      'bb:hidden': false,
      'bb:note': null,
    };
    for (const workspace of [json, sqlite]) {
      const detail = await workspace.schema.describeType('Child');
      expect(detail.annotations).toEqual(expected);
      const owner = detail.fields.find((f) => f.name === 'owner')!;
      expect(owner.annotations).toEqual({
        'bb:role': 'owner',
        'bb:display': { label: 'API' },
      });
      const nested = detail.referencePaths!.find((p) => p.path === 'keys.target')!;
      expect(nested.annotations).toEqual({
        'bb:role': 'dependency',
        'bb:style': { tags: ['foreign-key'] },
      });
      expect(detail.fields.find((f) => f.name === 'keys')!.annotations).toEqual({
        'bb:role': 'collection',
      });
      expect(detail.fields.find((f) => f.name === 'id')!.annotations).toEqual({});
      expect((await workspace.schema.describeType('Plain')).annotations).toEqual({});
      (detail.annotations['bb:flags'] as string[]).push('mutated');
      (owner.annotations['bb:display'] as { label: string }).label = 'mutated';
      (nested.annotations['bb:style'] as { tags: string[] }).tags.push('mutated');
      const again = await workspace.schema.describeType('Child');
      expect(again.annotations).toEqual(expected);
      expect(again.fields.find((f) => f.name === 'owner')!.annotations).toEqual({
        'bb:role': 'owner',
        'bb:display': { label: 'API' },
      });
      expect(again.referencePaths!.find((p) => p.path === 'keys.target')!.annotations).toEqual({
        'bb:role': 'dependency',
        'bb:style': { tags: ['foreign-key'] },
      });
      expect((await workspace.schema.listTypes()).items[0]).not.toHaveProperty('annotations');
    }
    const ptc = await json.call((read) => read.schema.describeType('Child'));
    expect(ptc.status).toBe('completed');
    expect(ptc.result!.annotations).toEqual(expected);
    expect(ptc.result!.referencePaths!.find((p) => p.path === 'keys.target')!.annotations).toEqual({
      'bb:role': 'dependency',
      'bb:style': { tags: ['foreign-key'] },
    });
  } finally {
    await sqlite.close();
  }
});
