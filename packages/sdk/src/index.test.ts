import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGraph } from '@khaale/lore-core';
import { parseFile, publishIndex } from '@khaale/lore-filesystem';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import {
  openFilesystemWorkspace,
  PTC_ERROR_CODE,
  PTC_OUTCOME,
  PTC_STATUS,
  type PtcRead,
} from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const schemaText = `id: https://example.org/sdk
name: sdk-fixture
classes:
  Base:
    description: Common workspace record
    abstract: true
    slots: [id, kind, status]
  Child:
    description: Decision record
    is_a: Base
    slots: [title, related, detail, depends_on, depended_on_by, connects_to, connected_from]
  Leaf:
    description: A concrete leaf record
    is_a: Child
    slots: [title]
  Other:
    description: Unrelated record
    slots: [id, kind, status, title, owner]
slots:
  id: {range: string, identifier: true}
  kind: {range: string, designates_type: true}
  status: {range: State}
  title: {range: string}
  related: {range: Child, multivalued: true}
  owner: {range: Child}
  detail: {range: string}
  depends_on: {range: Child, multivalued: true, inverse: depended_on_by}
  depended_on_by: {range: Child, multivalued: true, inverse: depends_on}
  connects_to: {range: Child, multivalued: true, inverse: connected_from}
  connected_from: {range: Child, multivalued: true, inverse: connects_to}
enums:
  State:
    permissible_values: {accepted: Accepted, draft: Draft}
`;

async function makeFilesystemWorkspace(extraDocuments: readonly string[] = []): Promise<{
  root: string;
  schemaPath: string;
  indexPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'lore-sdk-fs-'));
  roots.push(root);
  const schemaPath = join(root, '.lore.yaml');
  const indexPath = join(root, '.artifact-index', 'index.json');
  await writeFile(schemaPath, schemaText);
  await writeFile(
    join(root, 'a.yaml'),
    'id: child-1\nkind: Child\nstatus: accepted\ntitle: Decision one\nrelated: [leaf-1]\ndepends_on: [leaf-1]\nconnects_to: [child-1]\n',
  );
  await writeFile(
    join(root, 'b.yaml'),
    'id: leaf-1\nkind: Leaf\nstatus: accepted\ntitle: Decision leaf\ndepends_on: [child-1]\n',
  );
  await writeFile(join(root, 'c.yaml'), 'id: other-1\nkind: Other\nstatus: draft\ntitle: Other\n');
  await Promise.all(
    extraDocuments.map((document, index) => writeFile(join(root, `extra-${index}.yaml`), document)),
  );
  const compiled = await compileSchemaOrThrow(schemaPath);
  const candidates = (
    await Promise.all(
      [
        join(root, 'a.yaml'),
        join(root, 'b.yaml'),
        join(root, 'c.yaml'),
        ...extraDocuments.map((_, index) => join(root, `extra-${index}.yaml`)),
      ].map(parseFile),
    )
  ).flat();
  const built = buildGraph(candidates, {
    root,
    compiled,
    strict: true,
  });
  const child = built.index.artifacts['child-1'];
  if (!child) throw new Error('fixture child artifact was not built');
  child.provenance = {
    source: child.provenance?.source ?? child.source,
    physicalPath: child.provenance?.physicalPath ?? child.physical_path,
    ...(child.provenance?.span === undefined ? {} : { span: child.provenance.span }),
    narrative: {
      source: 'a.yaml#narrative',
      physicalPath: join(root, 'a.yaml'),
      representation: 'narrative',
    },
    properties: {
      ...(child.provenance?.properties ?? {}),
      title: {
        source: 'a.yaml#title',
        physicalPath: join(root, 'a.yaml'),
        representation: 'frontmatter',
      },
    },
  };
  await publishIndex(indexPath, built.index);
  return { root, schemaPath, indexPath };
}

describe('@khaale/lore-sdk', () => {
  it('discovers model.yaml and supports explicit selection for ambiguous model names', async () => {
    const fixture = await makeFilesystemWorkspace();
    const model = join(fixture.root, 'model.yaml');
    await rename(fixture.schemaPath, model);
    const workspace = await openFilesystemWorkspace({ root: fixture.root });
    expect((await workspace.query({ limit: 10 })).items).toHaveLength(3);
    await writeFile(fixture.schemaPath, schemaText);
    await expect(openFilesystemWorkspace({ root: fixture.root })).rejects.toMatchObject({
      code: 'SETUP_FAILED',
      message: expect.stringContaining('multiple Lore models'),
    });
    const explicit = await openFilesystemWorkspace({ root: fixture.root, schemaPath: model });
    expect((await explicit.query({ limit: 10 })).items).toHaveLength(3);
    await rm(model);
    await rm(fixture.schemaPath);
    await expect(openFilesystemWorkspace({ root: fixture.root })).rejects.toMatchObject({
      code: 'SETUP_FAILED',
      message: expect.stringContaining('expected .lore.yaml or model.yaml'),
    });
  });

  it('retains typed results across workspace calls with automatic lifetime and isolation', async () => {
    const fixture = await makeFilesystemWorkspace();
    let now = 100;
    const workspace = await openFilesystemWorkspace({
      ...fixture,
      ptc: { ttlMs: 10, now: () => now },
    });
    const saved = await workspace.call(async (read) => read.retain(await read.query()));
    expect(saved.status).toBe(PTC_STATUS.COMPLETED);
    const reference = saved.result!;
    const loaded = await workspace.call(async (read) => {
      const { value } = await read.results.get(reference);
      return value.items.map(({ id }) => id);
    });
    expect(loaded.result).toEqual(['child-1', 'leaf-1', 'other-1']);
    expect(loaded.events[0]?.method).toBe('results.get');
    expect((await workspace.results.get(reference)).value.items).toHaveLength(3);
    expect((await workspace.trace.get(saved.executionId)).events).toHaveLength(1);
    const other = await openFilesystemWorkspace(fixture);
    await expect(other.results.get(reference)).rejects.toMatchObject({
      code: PTC_ERROR_CODE.RESULT_NOT_FOUND,
    });
    now = 110;
    const expired = await workspace.call((read) => read.results.get(reference));
    expect(expired.status).toBe(PTC_STATUS.FAILED);
    expect(expired.error?.code).toBe(PTC_ERROR_CODE.RESULT_EXPIRED);
  });

  it('reads full PTC collections and limits only their output previews', async () => {
    const workspace = await openFilesystemWorkspace({
      ...(await makeFilesystemWorkspace()),
      maxPageSize: 1,
      maxScanBudget: 1,
    });
    const page = await workspace.query({ type: 'Other', limit: 1, scanBudget: 1 });
    expect(page.items).toHaveLength(0);
    expect(page.continuation).toBeDefined();
    const response = await workspace.call(async (read) => {
      const all = await read.query();
      return {
        all,
        selected: await read.query({ type: 'Other' }),
        searched: await read.search({ text: 'Other' }),
        types: await read.schema.listTypes(),
        preview: read.limitItems(all, 1),
        empty: read.limitItems(all, 0),
        emptyGraph: await read.graph.boundary([]),
      };
    });
    expect(response.status).toBe(PTC_STATUS.COMPLETED);
    const result = response.result!;
    expect(result.all.items).toHaveLength(3);
    expect(result.selected.items.map(({ id }) => id)).toEqual(['other-1']);
    expect(result.searched.items.map(({ item }) => item.id)).toEqual(['other-1']);
    expect(result.types.items).toHaveLength(4);
    for (const collection of [result.all, result.selected, result.searched, result.types]) {
      expect(collection).not.toHaveProperty('continuation');
      expect(collection.coverage.complete).toBe(true);
      expect(collection.coverage.remaining).toBe(0);
    }
    expect(result.preview.coverage).toMatchObject({
      complete: false,
      returned: 1,
      remaining: 2,
      reason: 'output-limit',
    });
    expect(result.empty.items).toHaveLength(0);
    expect(result.empty.coverage.remaining).toBe(3);
    expect(result.emptyGraph.nodes).toEqual([]);
    expect(result.emptyGraph.edges).toEqual([]);
    expect(result.emptyGraph.coverage.nodes.complete).toBe(true);
    expect(result.emptyGraph.coverage.edges.complete).toBe(true);
    const invalid = await workspace.call((read) => read.limitItems(result.all, -1));
    expect(invalid.error?.code).toBe('INVALID_LIMIT');
  });

  it('reads complete PTC graphs beyond SDK defaults and makes consistent graph previews', async () => {
    const fixture = await makeFilesystemWorkspace(
      Array.from(
        { length: 1_000 },
        (_, index) => `id: bulk-${index}\nkind: Child\ntitle: Bulk\ndepends_on: [child-1]\n`,
      ),
    );
    const workspace = await openFilesystemWorkspace(fixture);
    const response = await workspace.call(async (read) => {
      const graph = await read.graph.boundary(['child-1']);
      const preview = read.limitGraph(graph, { nodes: 2, edges: 1 });
      return {
        count: graph.nodes.length,
        coverage: graph.coverage,
        preview,
        empty: read.limitGraph(graph, { nodes: 0, edges: 0 }),
      };
    });
    expect(response.status).toBe(PTC_STATUS.COMPLETED);
    expect(response.result!.count).toBe(1_001);
    expect(response.result!.coverage.nodes.complete).toBe(true);
    expect(response.result!.coverage.edges.complete).toBe(true);
    const { preview } = response.result!;
    expect(preview.nodes).toHaveLength(2);
    expect(preview.edges).toHaveLength(1);
    expect(preview).not.toHaveProperty('seedIds');
    expect(preview.nodes[0]).not.toHaveProperty('provenance');
    expect(preview.nodes[0]).not.toHaveProperty('trace');
    expect(preview.nodes[0]).not.toHaveProperty('typeId');
    expect(preview.edges[0]).not.toHaveProperty('presentations');
    expect(preview.edges[0]).not.toHaveProperty('provenance');
    expect(response.result!.empty.nodes).toHaveLength(0);
    expect(response.result!.empty.edges).toHaveLength(0);
    expect(preview.coverage.nodes).toMatchObject({
      complete: false,
      remaining: 999,
      reason: 'output-limit',
    });
    expect(preview.coverage.edges.reason).toBe('output-limit');
    const ids = new Set(preview.nodes.map(({ id }) => id));
    for (const edge of preview.edges) {
      if (edge.fromVisible) expect(ids.has(edge.from)).toBe(true);
      if (edge.toVisible) expect(ids.has(edge.to)).toBe(true);
    }
  });

  it('composes an empty search with batch entity reads', async () => {
    const workspace = await openFilesystemWorkspace(await makeFilesystemWorkspace());
    const response = await workspace.call(async (read) => {
      const matches = await read.search({ text: 'no such record' });
      return read.entities.getMany(matches.items.map(({ item }) => item.id));
    });
    expect(response.status).toBe(PTC_STATUS.COMPLETED);
    expect(response.result).toMatchObject({
      items: [],
      missingIds: [],
      coverage: { complete: true, examined: 0, returned: 0, remaining: 0, reason: 'empty' },
    });
    await expect(workspace.entities.getMany([''])).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('accepts entity collections and arrays as graph selections', async () => {
    const workspace = await openFilesystemWorkspace(await makeFilesystemWorkspace());
    const response = await workspace.call(async (read) => {
      const records = await read.query({ type: 'Child' });
      const ids = records.items.map(({ id }) => id);
      const options = { depth: 1 };
      const expected = await read.graph.neighborhood(ids, options);
      expect(await read.graph.neighborhood(records, options)).toEqual(expected);
      expect(await read.graph.neighborhood(records.items, options)).toEqual(expected);
      expect(await read.graph.neighborhood([ids[0]!, records.items[1]!], options)).toEqual(
        expected,
      );
      for (const method of ['neighbors', 'boundary', 'subgraph'] as const) {
        expect(await read.graph[method](records)).toEqual(await read.graph[method](ids));
      }
      const empty = await read.query({ type: 'Child', where: { status: { eq: 'draft' } } });
      expect((await read.graph.subgraph(empty)).nodes).toEqual([]);
      return records;
    });
    expect(response.status).toBe(PTC_STATUS.COMPLETED);
    const ordinary = await workspace.query({ type: 'Child', limit: 10 });
    expect((await workspace.graph.subgraph(ordinary)).seedIds).toEqual(['child-1', 'leaf-1']);
  });

  it('projects resolved reference values and keeps filters and detailed relations consistent', async () => {
    const fixture = await makeFilesystemWorkspace([
      `id: owned
kind: Other
title: Owned
owner: '[[child-1]]'
`,
      `id: empty-related
kind: Child
related: []
`,
    ]);
    const workspace = await openFilesystemWorkspace(fixture);
    const response = await workspace.call(async (read) => {
      const selected = await read.query({
        type: 'Other',
        where: { owner: { eq: 'child-1' } },
        select: ['owner'],
      });
      expect(selected.items.map(({ id, properties }) => ({ id, ...properties }))).toEqual([
        { id: 'owned', owner: 'child-1' },
      ]);
      const members = await read.query({
        type: 'Other',
        where: { owner: { in: ['leaf-1', 'child-1'] } },
      });
      expect(members.items.map(({ id }) => id)).toEqual(['owned']);
      const absent = await read.query({ type: 'Other', where: { owner: { present: false } } });
      expect(absent.items.map(({ id }) => id)).toEqual(['other-1']);
      expect(absent.items[0]!.properties).not.toHaveProperty('owner');
      const child = await read.entities.get('child-1', {
        select: ['related', 'depends_on', 'depended_on_by', 'connects_to'],
      });
      expect(child.item.properties).toEqual({
        related: ['leaf-1'],
        depends_on: ['leaf-1'],
        connects_to: ['child-1'],
      });
      expect(child.item.relations).toContainEqual(
        expect.objectContaining({ relation: 'depended_on_by', inferred: true }),
      );
      expect(
        child.item.relations.filter((edge) => edge.from === 'child-1' && edge.to === 'child-1'),
      ).toHaveLength(1);
      const batch = await read.entities.getMany(['owned', 'missing', 'owned'], {
        select: ['owner'],
      });
      expect(batch.items.map(({ properties }) => properties)).toEqual([{ owner: 'child-1' }]);
      expect(batch.missingIds).toEqual(['missing']);
      const empty = await read.entities.get('empty-related', { select: ['related'] });
      expect(empty.item.properties).toEqual({ related: [] });
      // Projection must not expose mutable references to the indexed source.
      const targets = child.item.properties.related as string[];
      targets.push('changed');
      expect((await read.entities.get('child-1', { select: ['related'] })).item.properties).toEqual(
        { related: ['leaf-1'] },
      );
      return 'checked';
    });
    expect(response.status, response.error?.message).toBe(PTC_STATUS.COMPLETED);
    expect(response.result).toBe('checked');
  });

  it('calls a read program with automatic feedback and releases its execution', async () => {
    const workspace = await openFilesystemWorkspace({
      ...(await makeFilesystemWorkspace()),
      maxPageSize: 1,
      maxScanBudget: 1,
    });
    const readers: PtcRead[] = [];
    const response = await workspace.call(async (read) => {
      readers.push(read);
      await read.schema.listTypes();
      const page = await read.query({ type: 'Child' });
      const entities = await read.entities.getMany(page.items.map(({ id }) => id));
      const graph = await read.graph.boundary(page.items.map(({ id }) => id));
      return { ids: entities.items.map(({ id }) => id), context: graph.nodes.length };
    });
    expect(response.status).toBe(PTC_STATUS.COMPLETED);
    expect(response.result).toEqual({ ids: ['child-1', 'leaf-1'], context: 0 });
    expect(response.events.map(({ method }) => method)).toEqual([
      'schema.listTypes',
      'query',
      'entities.getMany',
      'graph.boundary',
    ]);
    expect(response.events[1]?.outcome).toBe(PTC_OUTCOME.SUCCESS);
    expect(response.trace).toContain('graph.boundary');
    await expect(readers[0]!.query()).rejects.toMatchObject({
      code: PTC_ERROR_CODE.SCOPE_CLOSED,
    });
    // A later call gets an independent execution without reopening the workspace.
    const next = await workspace.call(() => 42);
    expect(next.result).toBe(42);
  });

  it('reports SDK and callback failures without replaying the calling program', async () => {
    const fixture = await makeFilesystemWorkspace();
    const workspace = await openFilesystemWorkspace(fixture);
    let calls = 0;
    const failed = await workspace.call(async (read) => {
      calls++;
      return read.schema.describeType('Missing');
    });
    expect(calls).toBe(1);
    expect(failed.status).toBe(PTC_STATUS.FAILED);
    expect(failed.error?.code).toBe('UNKNOWN_TYPE');
    expect(failed.events).toHaveLength(1);
    expect(failed.events[0]).toMatchObject({
      method: 'schema.describeType',
      outcome: PTC_OUTCOME.ERROR,
    });
    const thrown = await workspace.call(() => {
      throw new Error('calling program failed');
    });
    expect(thrown.error?.message).toBe('calling program failed');

    const stale = await workspace.call(async (read) => {
      calls++;
      await read.query();
      await writeFile(join(fixture.root, 'a.yaml'), 'id: child-1\nkind: Child\ntitle: Changed\n');
      return 'calculated before the files changed';
    });
    expect(calls).toBe(2);
    expect(stale.error?.code).toBe('STALE_STATE');
    expect(stale.status).toBe(PTC_STATUS.FAILED);
    const alreadyStale = await workspace.call(() => {
      calls++;
      return 'must not execute';
    });
    expect(alreadyStale.error?.code).toBe('STALE_STATE');
    expect(calls).toBe(2);
  });

  it('discovers dynamic schema metadata and applies named/omitted type rules', async () => {
    const fixture = await makeFilesystemWorkspace();
    const workspace = await openFilesystemWorkspace(fixture);

    const description = await workspace.describe();
    expect(description.authority).toBe('filesystem');
    expect(description.schema.name).toBe('sdk-fixture');
    expect((await workspace.schema.listTypes({ text: 'Decision', limit: 1 })).items[0]?.name).toBe(
      'Child',
    );
    await expect(workspace.schema.listTypes({ text: 'решение', limit: 5 })).resolves.toMatchObject({
      items: [],
      coverage: { reason: 'empty' },
    });
    await expect(
      workspace.schema.listTypes({ text: 'example.org/sdk#Child', limit: 5 }),
    ).resolves.toMatchObject({ items: [], coverage: { reason: 'empty' } });
    const detail = await workspace.schema.describeType('Child');
    expect(detail.fields.map((field) => field.name)).toEqual([
      'connected_from',
      'connects_to',
      'depended_on_by',
      'depends_on',
      'detail',
      'id',
      'kind',
      'related',
      'status',
      'title',
    ]);
    const named = await workspace.query({
      type: 'Base',
      where: { status: { eq: 'accepted' } },
      select: ['title'],
      limit: 10,
    });
    expect(named.items.map((item) => item.id)).toEqual(['child-1', 'leaf-1']);
    const omitted = await workspace.query({
      where: { status: { present: true } },
      select: ['title'],
      limit: 10,
    });
    expect(omitted.items.map((item) => item.id)).toEqual(['child-1', 'leaf-1', 'other-1']);
    expect(omitted.items[0]?.properties).toEqual({ title: 'Decision one' });
  });

  it('keeps lexical search, pagination, provenance, and errors branchable', async () => {
    const fixture = await makeFilesystemWorkspace();
    const workspace = await openFilesystemWorkspace(fixture);

    const first = await workspace.search({ text: 'Decision', limit: 1 });
    expect(first.items[0]?.matches[0]?.field).toBe('title');
    expect(first.continuation).toBeTypeOf('string');
    const searchContinuation = first.continuation;
    if (!searchContinuation) throw new Error('expected search continuation');
    const second = await workspace.search({
      text: 'Decision',
      limit: 1,
      continuation: searchContinuation,
    });
    expect(second.items.map((match) => match.item.id)).toEqual(['leaf-1']);
    const entity = await workspace.entities.get('child-1', {
      select: ['title'],
      include: ['provenance'],
    });
    expect(entity.item.properties).toEqual({ title: 'Decision one' });
    expect(entity.item.provenance?.authority).toBe('filesystem');
    expect(entity.item.provenance?.properties?.title?.location).toContain('a.yaml');
    expect(entity.item).not.toHaveProperty('capabilities');
    const scalarQuery = await workspace.query({ type: 'Child', select: ['title'], limit: 10 });
    expect(scalarQuery.items.find((item) => item.id === 'child-1')?.relations).toEqual([]);
    expect(scalarQuery.items[0]).not.toHaveProperty('capabilities');
    expect(first.items[0]?.item).not.toHaveProperty('capabilities');
    const relationQuery = await workspace.query({
      type: 'Child',
      select: ['related'],
      limit: 10,
    });
    expect(relationQuery.items.find((item) => item.id === 'child-1')?.relations).toMatchObject([
      { relation: 'related', to: 'leaf-1' },
    ]);
    await expect(workspace.entities.get('missing')).rejects.toMatchObject({
      code: 'MISSING_ENTITY',
    });
    await expect(workspace.schema.describeType('Missing')).rejects.toMatchObject({
      code: 'UNKNOWN_TYPE',
    });
    await expect(workspace.query({ type: 'Missing', limit: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_TYPE',
    });
    await expect(
      workspace.query({ type: 'Child', where: { missing: { eq: 'x' } }, limit: 1 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' });
    await expect(
      workspace.query({
        type: 'Child',
        where: { status: { pattern: 'accepted' } as never },
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILTER' });
    await expect(
      workspace.query({
        type: 'Child',
        where: { status: { in: ['accepted'] } },
        select: ['title'],
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [{ id: 'child-1' }, { id: 'leaf-1' }] });
    await expect(workspace.query({ limit: 0 })).rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    await expect(workspace.explore({ view: 'missing' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_VIEW',
    });
    await expect(workspace.search({ text: 'not-present', limit: 5 })).resolves.toMatchObject({
      items: [],
      coverage: { reason: 'empty' },
    });
  });

  it('expires a callback-scoped filesystem read without replaying the callback', async () => {
    const fixture = await makeFilesystemWorkspace();
    const workspace = await openFilesystemWorkspace(fixture);
    let callbacks = 0;

    await expect(
      workspace.readSnapshot(async (read) => {
        callbacks++;
        const page = await read.query({ type: 'Child', limit: 1 });
        expect(page.items).toHaveLength(1);
        await writeFile(
          join(fixture.root, 'a.yaml'),
          'id: child-1\nkind: Child\nstatus: draft\ntitle: Changed\n',
        );
        const queryContinuation = page.continuation;
        if (!queryContinuation) throw new Error('expected query continuation');
        await read.query({ type: 'Child', continuation: queryContinuation, limit: 1 });
      }),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(callbacks).toBe(1);
  });

  it('uses opaque query continuations tied to the originating state', async () => {
    const fixture = await makeFilesystemWorkspace();
    const workspace = await openFilesystemWorkspace(fixture);

    const page = await workspace.query({ type: 'Base', limit: 1 });
    const queryContinuation = page.continuation;
    if (!queryContinuation) throw new Error('expected query continuation');
    await expect(
      workspace.query({ type: 'Other', limit: 1, continuation: queryContinuation }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTINUATION' });
    await expect(
      workspace.query({ type: 'Base', limit: 1, continuation: 'not-a-token' }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTINUATION' });
  });

  it('bounds mostly nonmatching query scans and resumes at the scan position', async () => {
    const fixture = await makeFilesystemWorkspace(
      Array.from(
        { length: 250 },
        (_, index) =>
          `id: zz-other-${index}\nkind: Other\nstatus: draft\ntitle: Unrelated ${index}\n`,
      ),
    );
    const workspace = await openFilesystemWorkspace(fixture);

    const first = await workspace.query({
      where: { status: { eq: 'accepted' } },
      select: ['title'],
      limit: 3,
      scanBudget: 10,
    });
    expect(first.items.map((item) => item.id)).toEqual(['child-1', 'leaf-1']);
    expect(first.coverage).toMatchObject({
      complete: false,
      examined: 10,
      returned: 2,
      reason: 'scan-budget',
    });
    expect(first.coverage.remaining).toBeUndefined();
    expect(first.continuation).toBeTypeOf('string');
    const second = await workspace.query({
      where: { status: { eq: 'accepted' } },
      select: ['title'],
      limit: 3,
      scanBudget: 10,
      ...(first.continuation === undefined ? {} : { continuation: first.continuation }),
    });
    expect(second.items).toEqual([]);
    expect(second.coverage.complete).toBe(false);
    expect(second.continuation).toBeTypeOf('string');
  });

  it('reads deterministic graph context with filters, inverse aliases, and independent coverage', async () => {
    const fixture = await makeFilesystemWorkspace([
      'id: child-2\nkind: Child\nstatus: accepted\ntitle: Middle\ndepends_on: [child-1, child-3]\nconnects_to: [child-3]\n',
      'id: child-3\nkind: Child\nstatus: accepted\ntitle: Shared\ndepends_on: [child-4]\n',
      'id: child-4\nkind: Child\nstatus: accepted\ntitle: External\n',
      'id: child-5\nkind: Child\nstatus: accepted\ntitle: Isolated\n',
    ]);
    const filesystem = await openFilesystemWorkspace(fixture);

    const results = await Promise.all(
      [filesystem].map((workspace) =>
        workspace.readSnapshot(async (read) => {
          const neighbors = await read.graph.neighbors(['child-1'], {
            direction: 'in',
            relations: ['depends_on', 'connects_to'],
            maxNodes: 10,
            maxEdges: 10,
          });
          const neighborhood = await read.graph.neighborhood(['child-1', 'child-2', 'child-2'], {
            direction: 'out',
            relations: ['depends_on', 'connects_to'],
            nodeTypes: ['Leaf'],
            depth: 2,
            maxNodes: 10,
            maxEdges: 20,
          });
          const subgraph = await read.graph.subgraph(['child-1', 'leaf-1'], {
            maxNodes: 2,
            maxEdges: 10,
          });
          const boundary = await read.graph.boundary(['child-1', 'child-2'], {
            direction: 'both',
            maxNodes: 10,
            maxEdges: 10,
          });
          const truncated = await read.graph.neighborhood(['child-1'], {
            direction: 'both',
            depth: 2,
            maxNodes: 10,
            maxEdges: 1,
          });
          const empty = await read.graph.neighbors(['child-5'], {
            direction: 'both',
            relations: ['depends_on'],
            maxNodes: 10,
            maxEdges: 10,
          });
          return { neighbors, neighborhood, subgraph, boundary, truncated, empty };
        }),
      ),
    );
    const filesystemResults = results[0]!;
    expect(filesystemResults.neighbors.nodes.map((node) => node.id)).toEqual(['child-2', 'leaf-1']);
    expect(filesystemResults.neighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'leaf-1',
          relation: 'depends_on',
          to: 'child-1',
        }),
      ]),
    );
    expect(filesystemResults.neighbors.edges.find((edge) => edge.from === 'leaf-1')).toMatchObject({
      from: 'leaf-1',
      relation: 'depends_on',
      to: 'child-1',
    });
    expect(filesystemResults.neighbors.nodes).not.toContainEqual(
      expect.objectContaining({ id: 'child-1' }),
    );
    expect(filesystemResults.neighborhood.seedIds).toEqual(['child-1', 'child-2']);
    expect(filesystemResults.neighborhood.nodes.map((node) => node.id)).toEqual(['leaf-1']);
    expect(filesystemResults.neighborhood.nodes[0]?.trace).toEqual([
      expect.objectContaining({ from: 'child-1', relation: 'depends_on', to: 'leaf-1' }),
    ]);
    expect(filesystemResults.subgraph.edges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(['depends_on', 'depends_on', 'related']),
    );
    expect(filesystemResults.subgraph.edges).toHaveLength(4);
    expect(
      filesystemResults.neighbors.edges.some(
        (edge) =>
          edge.from === 'child-1' && edge.relation === 'connects_to' && edge.to === 'child-1',
      ),
      JSON.stringify(filesystemResults.neighbors.edges),
    ).toBe(true);
    expect(filesystemResults.neighbors.nodes).not.toContainEqual(
      expect.objectContaining({ id: 'child-1' }),
    );
    expect(
      filesystemResults.boundary.edges.every(
        (edge) =>
          ['child-1', 'child-2'].includes(edge.from) !== ['child-1', 'child-2'].includes(edge.to),
      ),
    ).toBe(true);
    expect(filesystemResults.boundary.nodes).not.toContainEqual(
      expect.objectContaining({ id: 'child-1' }),
    );
    expect(filesystemResults.boundary.nodes).not.toContainEqual(
      expect.objectContaining({ id: 'child-2' }),
    );
    expect(filesystemResults.truncated.coverage.nodes.complete).toBe(true);
    expect(filesystemResults.truncated.coverage.edges).toMatchObject({
      complete: false,
      reason: 'edge-limit',
      examined: 1,
    });
    expect(filesystemResults.empty.coverage).toMatchObject({
      nodes: { complete: true, reason: 'empty' },
      edges: { complete: true, reason: 'empty' },
      next: 'none',
    });
    expect(filesystemResults.neighborhood.snapshot).toEqual(
      expect.objectContaining({ authority: 'filesystem' }),
    );
    expect(
      filesystemResults.neighborhood.edges.filter((edge) => edge.relation === 'depends_on'),
    ).toHaveLength(5);
    expect(
      filesystemResults.neighborhood.edges.flatMap((edge) =>
        edge.presentations.filter((presentation) => presentation.inferred),
      ),
    ).not.toHaveLength(0);
    await expect(
      filesystem.graph.neighborhood(['child-1'], { depth: 1, relations: ['missing'] }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      filesystem.graph.neighborhood(['child-1'], { depth: 1, maxNodes: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    await expect(filesystem.graph.neighborhood(['missing'], { depth: 1 })).rejects.toMatchObject({
      code: 'MISSING_ENTITY',
    });
  });

  it('does not replay graph callbacks after filesystem state changes', async () => {
    const fixture = await makeFilesystemWorkspace();
    const filesystem = await openFilesystemWorkspace(fixture);

    for (const workspace of [filesystem]) {
      let callbacks = 0;
      await expect(
        workspace.readSnapshot(async (read) => {
          callbacks += 1;
          await read.graph.neighborhood(['child-1'], { depth: 1 });
          await writeFile(
            join(fixture.root, 'a.yaml'),
            'id: child-1\nkind: Child\nstatus: draft\ntitle: Changed\n',
          );
          await read.graph.neighbors(['child-1']);
        }),
      ).rejects.toMatchObject({ code: 'STALE_STATE' });
      expect(callbacks).toBe(1);
    }
  });

  it('stops canonical edge enumeration at maxEdges with a large bounded scope', async () => {
    const fixture = await makeFilesystemWorkspace(
      Array.from(
        { length: 250 },
        (_, index) =>
          `id: bulk-${index}\nkind: Child\nstatus: accepted\ntitle: Bulk ${index}\ndepends_on: [child-1]\n`,
      ),
    );
    const workspace = await openFilesystemWorkspace(fixture);

    const result = await workspace.graph.neighborhood(['child-1'], {
      direction: 'in',
      depth: 1,
      maxNodes: 300,
      maxEdges: 1,
    });
    expect(result.coverage.nodes.complete).toBe(true);
    expect(result.coverage.edges).toMatchObject({
      complete: false,
      examined: 1,
      returned: 1,
      reason: 'edge-limit',
    });
  });
});
