import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { buildGraph } from '@khaale/lore-core';
import { parseFile, publishIndex } from '@khaale/lore-filesystem';
import { CompactReader } from './sqlite-storage.js';
import { initializeSqliteIndex } from './sqlite-index.js';
import { openFilesystemWorkspace, openSqliteWorkspace, type HierarchyDefinition } from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(sharedByOwner = true) {
  const root = await mkdtemp(join(tmpdir(), 'lore-hierarchy-'));
  roots.push(root);
  const schemaPath = join(root, '.lore.yaml');
  await writeFile(
    schemaPath,
    `name: hierarchy
classes:
  E:
    abstract: true
    attributes:
      id: {identifier: true}
      type: {designates_type: true}
      label:
        annotations: {'lore:explore_roles': [title]}
      group: {}
  Root: {is_a: E}
  Unit:
    is_a: E
    attributes:
      parent: {range: Root, annotations: {'lore:explore_relation': context}}
      assets: {range: Resource, multivalued: true}
  Resource:
    is_a: E
    attributes:
      owner: {range: Unit}
  Item:
    is_a: E
    attributes:
      owner: {range: Resource}
`,
  );
  const file = join(root, 'records.yaml');
  await writeFile(
    file,
    `- {id: r, type: Root, label: Root}
- {id: u1, type: Unit, label: One, parent: r, assets: ${sharedByOwner ? '[s]' : '[]'}}
- {id: u2, type: Unit, label: Two, parent: r, assets: [s]}
- {id: s, type: Resource, label: Shared, owner: u1, group: a}
- {id: orphan, type: Resource, label: Unassigned}
- {id: i, type: Item, label: Item, owner: s}
`,
  );
  const compiled = await compileSchemaOrThrow(schemaPath),
    built = buildGraph(await parseFile(file), { root, compiled, strict: true });
  const indexPath = join(root, '.artifact-index', 'index.json');
  await publishIndex(indexPath, built.index);
  const sqlitePath = join(root, '.artifact-index', 'index.sqlite');
  await initializeSqliteIndex({ root, schemaPath, indexPath: sqlitePath });
  return { root, schemaPath, indexPath, sqlitePath };
}
const definition = (): HierarchyDefinition => ({
  version: 1,
  nodes: [
    { key: 'r', kind: 'type', type: 'Root' },
    { key: 'u', kind: 'type', type: 'Unit' },
    { key: 's', kind: 'type', type: 'Resource' },
    { key: 'i', kind: 'type', type: 'Item' },
  ],
  roots: ['r'],
  labels: { Unit: ['label'], Resource: ['label'] },
  branches: [
    {
      key: 'ru',
      parent: 'r',
      child: 'u',
      via: { kind: 'path', steps: [{ ownerType: 'Unit', field: 'parent', direction: 'out' }] },
    },
    {
      key: 'us',
      parent: 'u',
      child: 's',
      via: { kind: 'path', steps: [{ ownerType: 'Resource', field: 'owner', direction: 'out' }] },
    },
    {
      key: 'si',
      parent: 's',
      child: 'i',
      via: { kind: 'path', steps: [{ ownerType: 'Item', field: 'owner', direction: 'out' }] },
    },
  ],
  unassigned: 'group',
});

it('composes JSON/SQLite lazy pages, labels, hydration and caller-edited definitions', async () => {
  const f = await fixture(),
    json = await openFilesystemWorkspace(f),
    sqlite = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  try {
    for (const w of [json, sqlite]) {
      const proposal = await w.hierarchy.propose({ detail: 'diagnostic' });
      expect(proposal.typeTotals.Resource).toBe(2);
      expect(proposal.definition.nodes.some((n) => n.kind === 'type' && n.type === 'Unit')).toBe(
        true,
      );
      expect(proposal.diagnostics?.length).toBeGreaterThan(0);
      const d = definition(),
        roots = await w.hierarchy.read({ definition: d });
      expect(roots.items.find((n) => n.entityId === 'r')?.directChildren).toEqual({
        status: 'exact',
        value: 2,
      });
      expect(roots.placement.unassigned).toBe(1);
      const parent = roots.items.find((n) => n.entityId === 'r')!.ref;
      const first = await w.hierarchy.read({ definition: d, parent, limit: 1 });
      expect(first.items[0]?.label).toBe('One');
      expect(first.continuation).toBeDefined();
      const second = await w.hierarchy.read({
        definition: d,
        parent,
        limit: 1,
        continuation: first.continuation!,
      });
      expect(second.items[0]?.label).toBe('Two');
      expect(second.coverage.complete).toBe(true);
      expect(
        (await w.entities.getMany([first.items[0]!.entityId!], { select: ['label'] })).items[0]
          ?.properties.label,
      ).toBe('One');
      const edited = structuredClone(d);
      edited.labels = { Unit: ['id'] };
      await expect(
        w.hierarchy.read({ definition: edited, parent, continuation: first.continuation! }),
      ).rejects.toMatchObject({ code: 'INVALID_CONTINUATION' });
      const shared = await w.hierarchy.read({ definition: d, parent: first.items[0]!.ref });
      expect(shared.items[0]?.entityId).toBe('s');
      expect(shared.items[0]?.directChildren).toEqual({ status: 'exact', value: 1 });
      const a = await w.hierarchy.propose(),
        b = await w.hierarchy.propose({ detail: 'diagnostic' });
      expect(a.definition).toEqual(b.definition);
    }
    const ptc = await json.call((read) =>
      read.hierarchy.read({ definition: definition(), limit: 1 }),
    );
    expect(ptc.status).toBe('completed');
    expect(ptc.result?.items).toHaveLength(1);
    expect(ptc.events[0]?.method).toBe('hierarchy.read');
  } finally {
    await sqlite.close();
  }
});

it('groups exact scalar values, preserves missing values and truncates only labels', async () => {
  const f = await fixture(),
    w = await openFilesystemWorkspace(f);
  const d: HierarchyDefinition = {
    version: 1,
    nodes: [{ key: 'g', kind: 'property', type: 'Resource', field: 'group' }],
    roots: ['g'],
    branches: [],
    labels: { Resource: ['label'] },
  };
  const root = await w.hierarchy.read({ definition: d });
  expect(root.items[0]?.basis).toBe('property');
  const groups = await w.hierarchy.read({ definition: d, parent: root.items[0]!.ref });
  expect(groups.items.map((n) => n.label).sort()).toEqual(['Unassigned', 'a']);
  expect(groups.items.find((n) => n.label === 'Unassigned')?.flags).toContain('unassigned');
  const children = await w.hierarchy.read({
    definition: d,
    parent: groups.items.find((n) => n.label === 'a')!.ref,
  });
  expect(children.items[0]?.entityId).toBe('s');
  const invalid = structuredClone(d);
  invalid.nodes = [{ key: 'g', kind: 'property', type: 'Unit', field: 'assets' }];
  await expect(w.hierarchy.read({ definition: invalid })).rejects.toMatchObject({
    code: 'INVALID_HIERARCHY',
    path: 'nodes[0].field',
  });
  const long = structuredClone(d);
  long.nodes[0]!.label = 'я'.repeat(1000);
  const truncated = await w.hierarchy.read({ definition: long });
  expect(truncated.items[0]?.flags).toContain('label-truncated');
  expect(Buffer.byteLength(truncated.items[0]!.label)).toBeLessThanOrEqual(256);
});

it('places shared resources at a selected common ancestor without changing assertions', async () => {
  const f = await fixture(),
    w = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  try {
    const d = definition();
    d.placements = [
      {
        branch: 'us',
        backbone: ['ru'],
        consumers: [{ ownerType: 'Unit', field: 'assets', direction: 'in' }],
        includeDirectParent: true,
      },
    ];
    const roots = await w.hierarchy.read({ definition: d }),
      root = roots.items.find((n) => n.entityId === 'r')!;
    const children = await w.hierarchy.read({ definition: d, parent: root.ref });
    const resource = children.items.find((n) => n.entityId === 's');
    expect(resource?.basis).toBe('derived-placement');
    expect(resource?.flags).toContain('lca-placement');
    expect((await w.entities.get('s', { select: ['owner'] })).item.properties.owner).toBe('u1');
    await expect(
      w.hierarchy.read({ definition: { ...d, version: 2 } as unknown as HierarchyDefinition }),
    ).rejects.toMatchObject({ code: 'INVALID_HIERARCHY', path: 'version' });
    await expect(w.hierarchy.propose({ workBudget: 1 })).rejects.toMatchObject({
      code: 'HIERARCHY_LIMIT',
    });
  } finally {
    await w.close();
  }
});

it('profiles SQLite metadata without hydrating entity properties or narrative', async () => {
  const f = await fixture(),
    w = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  const spy = vi.spyOn(CompactReader.prototype, 'entity');
  try {
    await w.hierarchy.propose();
    const d = definition();
    d.labels = {};
    await w.hierarchy.read({ definition: d, includeScores: true });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    await w.close();
  }
});

it('reports disconnected LCA consumers as deferred with unknown expansion rather than selecting a parent', async () => {
  const f = await fixture(),
    w = await openFilesystemWorkspace(f),
    d = definition();
  d.placements = [
    {
      branch: 'us',
      backbone: ['us'],
      consumers: [{ ownerType: 'Unit', field: 'assets', direction: 'in' }],
      includeDirectParent: true,
    },
  ];
  const r = await w.hierarchy.read({ definition: d });
  expect(r.placement.deferred).toBe(1);
  expect(r.placement.unassigned).toBe(2);
  expect(r.items.find((n) => n.entityId === 'r')?.directChildren?.status).toBe('lower-bound');
  const unassigned = r.items.find((n) => n.kind === 'group')!;
  const rows = await w.hierarchy.read({ definition: d, parent: unassigned.ref });
  const s = rows.items.find((n) => n.entityId === 's')!;
  expect(s.flags).toContain('unassigned');
  expect((await w.entities.get('s', { select: ['owner'] })).item.properties.owner).toBe('u1');
});

it('opts in whole-scope individual scores with JSON/SQLite/PTC parity and stable pages', async () => {
  const f = await fixture(),
    json = await openFilesystemWorkspace(f),
    sql = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  try {
    const results = [];
    for (const w of [json, sql]) {
      const d = definition(),
        roots = await w.hierarchy.read({ definition: d }),
        parent = roots.items.find((n) => n.entityId === 'r')!.ref;
      const plain = await w.hierarchy.read({ definition: d, parent });
      expect(plain.items.every((n) => !('scores' in n))).toBe(true);
      const scored = await w.hierarchy.read({ definition: d, parent, includeScores: true });
      expect(scored.items.map((n) => n.ref)).toEqual(plain.items.map((n) => n.ref));
      expect(scored.items.map((n) => (n.kind === 'entity' ? n.scores : undefined))).toEqual([
        { structureScore: 1, connectivityScore: 0 },
        { structureScore: 0, connectivityScore: 0 },
      ]);
      const first = await w.hierarchy.read({
          definition: d,
          parent,
          includeScores: true,
          limit: 1,
        }),
        second = await w.hierarchy.read({
          definition: d,
          parent,
          includeScores: true,
          limit: 1,
          continuation: first.continuation!,
        });
      expect([...first.items, ...second.items]).toEqual(scored.items);
      results.push(scored.items);
      const lifted = structuredClone(d);
      lifted.placements = [
        {
          branch: 'us',
          backbone: ['ru'],
          consumers: [{ ownerType: 'Unit', field: 'assets', direction: 'in' }],
          includeDirectParent: true,
        },
      ];
      const lr = await w.hierarchy.read({ definition: lifted });
      const lc = await w.hierarchy.read({
        definition: lifted,
        parent: lr.items.find((n) => n.entityId === 'r')!.ref,
        includeScores: true,
      });
      expect(
        lc.items
          .filter((n) => n.type === 'Unit')
          .every((n) => n.kind === 'entity' && n.scores?.structureScore === 0),
      ).toBe(true);
      const atBudget = plain.compute.examined;
      await expect(
        w.hierarchy.read({ definition: d, parent, includeScores: true, workBudget: atBudget }),
      ).rejects.toMatchObject({ code: 'HIERARCHY_LIMIT' });
    }
    expect(results[0]).toEqual(results[1]);
    const ptc = await json.call((r) =>
      r.hierarchy.read({ definition: definition(), includeScores: true, limit: 20 }),
    );
    expect(ptc.status).toBe('completed');
    const root = ptc.result?.items.find((n) => n.kind === 'entity' && n.entityId === 'r');
    expect(root?.kind === 'entity' && root.scores?.structureScore).toBe(1);
  } finally {
    await sql.close();
  }
});

it('reuses one scoped plan with lazy scores, eviction, budgets and detached results', async () => {
  const f = await fixture(),
    json = await openFilesystemWorkspace(f),
    sql = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  const { HierarchyComputation } = await import('@khaale/lore-graph');
  const spy = vi.spyOn(HierarchyComputation.prototype, 'assignments');
  try {
    for (const w of [json, sql]) {
      spy.mockClear();
      const d = definition();
      await w.readSnapshot(async (read) => {
        const root = await read.hierarchy.read({ definition: d });
        const parent = root.items.find((n) => n.entityId === 'r')!.ref;
        const baseline = spy.mock.calls.length;
        expect(baseline).toBeGreaterThan(0);
        const first = await read.hierarchy.read({
          definition: structuredClone(d),
          parent,
          limit: 1,
        });
        const scored = await read.hierarchy.read({
          definition: d,
          parent,
          limit: 1,
          includeScores: true,
        });
        expect(scored.items[0]?.kind === 'entity' && scored.items[0].scores?.structureScore).toBe(
          1,
        );
        scored.items[0]!.label = 'mutated';
        if (scored.items[0]?.kind === 'entity') scored.items[0].scores!.structureScore = -1;
        const again = await read.hierarchy.read({
          definition: d,
          parent,
          limit: 1,
          includeScores: true,
        });
        expect(again.compute).toEqual(scored.compute);
        expect(again.items[0]?.label).toBe('One');
        expect(again.items[0]?.kind === 'entity' && again.items[0].scores?.structureScore).toBe(1);
        const second = await read.hierarchy.read({
          definition: d,
          parent,
          limit: 1,
          continuation: first.continuation!,
          includeScores: true,
        });
        expect(second.items[0]?.entityId).toBe('u2');
        expect(spy.mock.calls.length).toBe(baseline);
        expect(
          (await read.hierarchy.read({ definition: d, parent })).items.every(
            (n) => n.kind !== 'entity' || !n.scores,
          ),
        ).toBe(true);
        const edited = structuredClone(d);
        edited.labels = { Unit: ['id'] };
        await read.hierarchy.read({ definition: edited });
        expect(spy.mock.calls.length).toBe(2 * baseline);
        await read.hierarchy.read({ definition: d });
        expect(spy.mock.calls.length).toBe(3 * baseline);
        await expect(read.hierarchy.read({ definition: d, workBudget: 1 })).rejects.toMatchObject({
          code: 'HIERARCHY_LIMIT',
        });
        await read.hierarchy.read({ definition: d });
        expect(spy.mock.calls.length).toBe(4 * baseline);
        await expect(
          read.hierarchy.read({
            definition: { ...d, version: 9 } as unknown as HierarchyDefinition,
          }),
        ).rejects.toMatchObject({ code: 'INVALID_HIERARCHY' });
        await read.hierarchy.read({ definition: d });
        expect(spy.mock.calls.length).toBe(5 * baseline);
        const property: HierarchyDefinition = {
          version: 1,
          nodes: [{ key: 'g', kind: 'property', type: 'Resource', field: 'group' }],
          roots: ['g'],
          branches: [],
        };
        const pr = await read.hierarchy.read({ definition: property });
        const a = await read.hierarchy.read({ definition: property, parent: pr.items[0]!.ref });
        const b = await read.hierarchy.read({ definition: property, parent: pr.items[0]!.ref });
        expect(b).toEqual(a);
        const c = await read.hierarchy.read({ definition: property });
        expect(c).toEqual(pr);
      });
      const before = spy.mock.calls.length;
      await expect(
        w.readSnapshot(async (read) => {
          await read.hierarchy.read({ definition: d, includeScores: true });
          throw new Error('callback failure');
        }),
      ).rejects.toThrow('callback failure');
      await w.readSnapshot(async (read) => {
        await read.hierarchy.read({ definition: d });
      });
      expect(spy.mock.calls.length).toBe(before + 6);
    }
    // JSON readers historically remain callable when retained by a consumer;
    // completion must still release and permanently disable this scope's cache.
    let retained: (() => Promise<void>) | undefined;
    await json.readSnapshot(async (read) => {
      retained = async () => {
        await read.hierarchy.read({ definition: definition(), includeScores: true });
      };
      await retained();
    });
    spy.mockClear();
    await retained!();
    await retained!();
    expect(spy.mock.calls.length).toBe(6);
  } finally {
    spy.mockRestore();
    await sql.close();
  }
});

it('includes the direct owner before deciding whether a sole consumer requires LCA placement', async () => {
  const f = await fixture(false),
    json = await openFilesystemWorkspace(f),
    sql = await openSqliteWorkspace({ indexPath: f.sqlitePath, freshness: { mode: 'indexed' } });
  try {
    for (const w of [json, sql]) {
      const d = definition();
      d.placements = [
        {
          branch: 'us',
          backbone: ['ru'],
          consumers: [{ ownerType: 'Unit', field: 'assets', direction: 'in' }],
          includeDirectParent: true,
        },
      ];
      const root = await w.hierarchy.read({ definition: d });
      const children = await w.hierarchy.read({
        definition: d,
        parent: root.items.find((n) => n.entityId === 'r')!.ref,
      });
      const resource = children.items.find((n) => n.entityId === 's');
      expect(resource?.basis).toBe('derived-placement');
      expect(resource?.flags).toContain('lca-placement');
      expect(children.placement.deferred).toBe(0);
      const ownerChildren = await w.hierarchy.read({
        definition: d,
        parent: children.items.find((n) => n.entityId === 'u1')!.ref,
      });
      expect(ownerChildren.items.some((n) => n.entityId === 's')).toBe(false);
      expect((await w.entities.get('s', { select: ['owner'] })).item.properties.owner).toBe('u1');
    }
  } finally {
    await sql.close();
  }
});
