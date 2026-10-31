import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { parseFile, publishIndex } from '@khaale/lore-filesystem';
import { buildGraph } from '@khaale/lore-core';
import { openFilesystemWorkspace, openSqliteWorkspace, refreshSqliteIndex } from './index.js';
import { initializeSqliteIndex } from './sqlite-index.js';

it('publishes detached effective constraints and bounded nested references identically in JSON and offline SQLite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-constraints-sdk-'));
  const root = join(dir, 'source');
  await mkdir(root);
  const jsonPath = join(root, '.artifact-index/index.json'),
    sqlPath = join(dir, 'index.sqlite');
  try {
    await writeFile(
      join(root, '.lore.yaml'),
      await readFile(resolve('test/fixtures/record-constraints/model.yaml'), 'utf8'),
    );
    await writeFile(
      join(root, 'records.yaml'),
      `- {id: runtime, type: Runtime, name: Runtime}\n- {id: group, type: Group, name: Group}\n- id: owner\n  type: Owner\n  name: Owner\n  parent: [runtime]\n  authors: [Literal Author, '[[runtime]]']\n  refinements:\n    - {scope: '[[group]]', note: test}\n  choice: {workload: work}\n  chain: {scope: group, next: {scope: group}}\n`,
    );
    const compiled = await compileSchemaOrThrow(join(root, '.lore.yaml'));
    const built = buildGraph(await parseFile(join(root, 'records.yaml')), { root, compiled });
    expect(built.index.diagnostics).toEqual([]);
    await publishIndex(jsonPath, built.index);
    await initializeSqliteIndex({ root, indexPath: sqlPath });
    const json = await openFilesystemWorkspace({ root, indexPath: jsonPath });
    const sql = await openSqliteWorkspace({ indexPath: sqlPath, freshness: { mode: 'indexed' } });
    try {
      for (const workspace of [json, sql]) {
        const type = await workspace.schema.describeType('Owner');
        expect(type.fields.find((f) => f.name === 'parent')?.relationTargets).toEqual([
          'Group',
          'Owner',
          'Runtime',
        ]);
        expect(type.fields.find((f) => f.name === 'labels')?.constraints?.listElementsUnique).toBe(
          true,
        );
        expect(
          type.referencePaths?.find((r) => r.path === 'refinements.scope')?.relationTargets,
        ).toEqual(['Group', 'Owner', 'Runtime']);
        expect(
          (await workspace.schema.describeType('Choice')).recordConstraints?.[0]?.exactlyOneOf,
        ).toHaveLength(2);
        expect((await workspace.schema.describeType('Site')).rules).toHaveLength(2);
        type.fields.find((f) => f.name === 'parent')!.constraints!.anyOf.splice(0);
        expect(
          (await workspace.schema.describeType('Owner')).fields.find((f) => f.name === 'parent')
            ?.constraints?.anyOf,
        ).toHaveLength(2);
        const record = await workspace.entities.get('owner');
        expect(record.item.properties.authors).toEqual(['Literal Author', 'runtime']);
        expect(
          (
            await workspace.query({ type: 'Owner', where: { authors: { eq: 'Literal Author' } } })
          ).items.map((e) => e.id),
        ).toEqual(['owner']);
        expect(record.item.properties.refinements).toEqual([{ scope: 'group', note: 'test' }]);
        expect(record.item.relations).toContainEqual(
          expect.objectContaining({ from: 'owner', relation: 'refinements.scope', to: 'group' }),
        );
        const graph = await workspace.graph.neighborhood(['owner'], {
          depth: 1,
          relations: ['refinements.scope'],
          maxNodes: 2,
          maxEdges: 1,
        });
        expect((await workspace.entities.get('owner')).item.relations).toContainEqual(
          expect.objectContaining({ relation: 'chain.next.scope', to: 'group' }),
        );
        expect(
          (await workspace.graph.neighbors(['owner'], { relations: ['chain.next.scope'] })).edges,
        ).toHaveLength(1);
        expect((await workspace.schema.describeType('Chain')).referencePaths).toHaveLength(1);
        expect(graph.edges).toHaveLength(1);
        expect(graph.nodes.map((n) => n.id)).toEqual(['owner', 'group']);
      }
      const strip = (v: any) => {
        const { snapshot: _snapshot, ...rest } = v;
        return rest;
      };
      expect(strip(await sql.entities.getMany(['owner', 'runtime']))).toEqual(
        strip(await json.entities.getMany(['owner', 'runtime'])),
      );
      expect(strip(await sql.graph.neighbors(['owner']))).toEqual(
        strip(await json.graph.neighbors(['owner'])),
      );
      expect((await refreshSqliteIndex({ indexPath: sqlPath })).outcome).toBe('unchanged');
      await rm(root, { recursive: true });
      expect(
        (await sql.schema.describeType('Choice')).recordConstraints?.[0]?.exactlyOneOf,
      ).toHaveLength(2);
      expect((await sql.entities.get('owner')).item.properties.refinements).toEqual([
        { scope: 'group', note: 'test' },
      ]);
    } finally {
      await sql.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
