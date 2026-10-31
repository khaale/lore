import { mkdtemp, cp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import * as filesystem from '@khaale/lore-filesystem';
import { buildGraph } from '@khaale/lore-core';
import { openFilesystemWorkspace, openSqliteWorkspace, refreshSqliteIndex } from './index.js';
import { initializeSqliteIndex } from './sqlite-index.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lore-source-sdk-'));
  directories.push(directory);
  const root = join(directory, 'source');
  await cp(resolve('examples/source-documents'), root, {
    recursive: true,
    filter: (path) => !path.includes('.artifact-index'),
  });
  const schemaPath = join(root, '.lore.yaml'),
    indexPath = join(directory, 'index.sqlite'),
    jsonPath = join(root, '.artifact-index/index.json');
  await writeFile(join(root, 'ordinary.yaml'), 'id: handwritten\ntype: Api\nname: Handwritten\n');
  const compiled = await compileSchemaOrThrow(schemaPath);
  const read = await filesystem.readSources({ root, schemaPath }, compiled);
  expect(read.diagnostics).toEqual([]);
  const built = buildGraph(read.candidates, { root, compiled });
  expect(built.index.diagnostics).toEqual([]);
  await filesystem.publishIndex(jsonPath, built.index);
  await initializeSqliteIndex({ root, indexPath });
  return { root, directory, schemaPath, indexPath, jsonPath, compiled, built };
}

it('uses ordinary public reads for mixed projected entities in JSON and SQLite, with nested FK graph parity', async () => {
  const f = await fixture();
  const json = await openFilesystemWorkspace({ root: f.root, indexPath: f.jsonPath });
  const sql = await openSqliteWorkspace({ indexPath: f.indexPath, freshness: { mode: 'indexed' } });
  try {
    const ids = Object.keys(f.built.index.artifacts);
    expect(ids).toHaveLength(9);
    const strip = (value: any) => {
      const { snapshot: _, ...rest } = value;
      return rest;
    };
    expect(strip(await sql.entities.getMany(ids))).toEqual(strip(await json.entities.getMany(ids)));
    for (const workspace of [json, sql]) {
      const operation = (
        await workspace.query({ type: 'ApiOperation', where: { method: { eq: 'get' } } })
      ).items[0]!;
      expect(operation.properties.operation_id).toBe('getOrder');
      expect(operation.properties.definition).toHaveProperty('responses.200');
      expect(
        (await workspace.graph.neighbors([operation.id], { relations: ['response_schemas'] }))
          .edges,
      ).toHaveLength(1);
      expect((await workspace.entities.get(operation.id)).item.provenance?.source).toContain(
        '#/paths/~1orders~1{id}/get',
      );
      const table = (
        await workspace.query({ type: 'DatabaseObject', where: { name: { eq: 'public.заказ' } } })
      ).items[0]!;
      expect(table.properties.definition).toHaveProperty('columns.0.data_type', 'uuid');
      expect(
        (await workspace.graph.neighbors([table.id], { relations: ['foreign_keys.target'] })).edges,
      ).toHaveLength(1);
    }
  } finally {
    await sql.close();
  }
});

it('refreshes matched additions/deletions and imported declaration edits, preserving last valid data on extraction errors', async () => {
  const f = await fixture();
  const sql = await openSqliteWorkspace({ indexPath: f.indexPath, freshness: { mode: 'indexed' } });
  try {
    const initial = await sql.query({ type: 'ApiOperation' });
    const extraction = vi.spyOn(filesystem, 'readSources');
    const unchanged = await refreshSqliteIndex({ indexPath: f.indexPath });
    expect(unchanged.outcome).toBe('unchanged');
    expect(unchanged.generationId).toBe(initial.snapshot.generationId);
    expect(extraction).not.toHaveBeenCalled();
    const apiText = await readFile(join(f.root, 'api/orders.yaml'), 'utf8');
    await writeFile(join(f.root, 'api/second.yaml'), apiText);
    expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
    expect((await sql.query({ type: 'ApiOperation' })).items).toHaveLength(4);
    await rm(join(f.root, 'api/second.yaml'));
    await refreshSqliteIndex({ indexPath: f.indexPath });
    expect((await sql.query({ type: 'ApiOperation' })).items).toHaveLength(2);
    const stable = await sql.query({ type: 'ApiOperation' });
    await writeFile(
      join(f.root, 'api/orders.yaml'),
      apiText.replaceAll('#/components/schemas/Order', '#/components/schemas/Missing'),
    );
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
    expect(await sql.query({ type: 'ApiOperation' })).toEqual(stable);
    await writeFile(join(f.root, 'api/orders.yaml'), apiText);
    expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
    const oldModel = await readFile(f.schemaPath, 'utf8');
    await writeFile(join(f.root, 'definitions.yaml'), oldModel);
    await writeFile(f.schemaPath, 'imports: [definitions]\n');
    await refreshSqliteIndex({ indexPath: f.indexPath });
    await writeFile(
      join(f.root, 'definitions.yaml'),
      oldModel.replace('    openapi:', '    rest:'),
    );
    const changed = await refreshSqliteIndex({ indexPath: f.indexPath });
    expect(changed.outcome).toBe('updated');
    expect((await sql.query({ type: 'ApiOperation' })).items[0]!.id).toMatch(/^rest\//);
    await rename(f.root, join(f.directory, 'offline'));
    expect((await sql.query({ type: 'ApiOperation' })).items).toHaveLength(2);
  } finally {
    await sql.close();
  }
});
