import { describe, expect, it } from 'vitest';
import { normalizeSchema } from '@khaale/lore-schema';
import {
  GraphAnalysisCache,
  ANALYSIS_ERROR,
  ANALYSIS_LIMITS,
  type AnalysisInput,
  type AnalysisRead,
  type Identity,
  type Triple,
} from './index.js';
const schema = normalizeSchema({
  classes: { Base: {}, A: { isA: 'Base' }, B: { isA: 'Base' } },
  slots: { first: { range: 'Base' }, second: { range: 'Base' } },
  types: {},
  enums: {},
});
// Make reference predicates discoverable without business-specific vocabulary.
for (const c of Object.values(schema.classes))
  for (const name of ['first', 'second'])
    c.slots[name] = {
      name,
      range: 'Base',
      mode: 'reference',
      multivalued: true,
    } as (typeof c.slots)[string];
const input = (nodes: Identity[], edges: Triple[], generation = 'g'): AnalysisInput => ({
  generation,
  schema,
  nodes: () => nodes,
  edges: () => edges,
  check: () => {},
});
const edge = (from: string, to: string, relation = 'first'): Triple => ({ from, to, relation });
function reference(nodes: Identity[], edges: Triple[], typeBalance: boolean) {
  const index = new Map(nodes.map((n, i) => [n.id, i])),
    adj = nodes.map(() => [] as number[]),
    counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  for (const e of edges) adj[index.get(String(e.from))!]!.push(index.get(String(e.to))!);
  const sizes = [...counts.values()].sort((a, b) => a - b),
    mid = Math.floor(sizes.length / 2),
    k = sizes.length % 2 ? sizes[mid]! : (sizes[mid - 1]! + sizes[mid]!) / 2;
  const q = nodes.map((n) => (typeBalance ? 1 / (1 + counts.get(n.type)! / k) : 1)),
    sum = q.reduce((a, b) => a + b, 0),
    p = q.map((v) => v / sum);
  let rank = [...p];
  for (let iteration = 0; iteration < 2000; iteration++) {
    const next = p.map((v) => 0.15 * v);
    for (let i = 0; i < nodes.length; i++) {
      const targets = adj[i]!;
      if (targets.length)
        for (const target of targets) next[target]! += (0.85 * rank[i]!) / targets.length;
      else for (let j = 0; j < nodes.length; j++) next[j]! += 0.85 * rank[i]! * p[j]!;
    }
    const delta = rank.reduce((s, v, i) => s + Math.abs(v - next[i]!), 0);
    rank = next;
    if (delta < 1e-14) break;
  }
  return Object.fromEntries(nodes.map((n, i) => [n.id, rank[i]!]));
}
describe('private graph computation', () => {
  it('matches an independent PageRank recurrence with dangling mass, nonuniform priors, self and parallel links', async () => {
    const nodes = [
        { id: 'a', type: 'A' },
        { id: 'b', type: 'B' },
        { id: 'c', type: 'B' },
      ],
      edges = [edge('a', 'a'), edge('a', 'b'), edge('a', 'b', 'second'), edge('b', 'c')];
    const cache = new GraphAnalysisCache();
    try {
      for (const balance of ['none', 'type'] as const)
        for (const direction of ['out', 'in', 'both'] as const) {
          let effective =
            direction === 'in'
              ? edges.map((e) => edge(String(e.to), String(e.from), e.relation))
              : edges;
          if (direction === 'both') {
            const pairs = new Map<string, Triple>();
            for (const e of edges) {
              const pair = [String(e.from), String(e.to)].sort();
              pairs.set(JSON.stringify(pair), edge(pair[0]!, pair[1]!));
            }
            effective = [...pairs.values()].flatMap((e) =>
              e.from === e.to ? [e] : [e, edge(String(e.to), String(e.from))],
            );
          }
          const expected = reference(nodes, effective, balance === 'type');
          await cache.read(input(nodes, edges), { direction }, async (read) => {
            const actual = await read.rank({ balance });
            for (const row of actual.items) expect(row.score).toBeCloseTo(expected[row.id]!, 8);
            expect(actual.items.reduce((s, v) => s + v.score, 0)).toBeCloseTo(1, 12);
            const prefix = await read.rank({ balance, limit: 1 });
            expect(prefix.items).toEqual(actual.items.slice(0, 1));
            expect(prefix.coverage).toMatchObject({
              complete: false,
              remaining: 2,
              reason: 'output-limit',
            });
          });
        }
    } finally {
      await cache.close();
    }
  });
  it('uses an induced descendant scope and separates isolates without hydrating data', async () => {
    const cache = new GraphAnalysisCache();
    const nodes = [
      { id: 'a', type: 'A' },
      { id: 'b', type: 'B' },
      { id: 'c', type: 'A' },
    ];
    try {
      await cache.read(
        input(nodes, [edge('a', 'b'), edge('b', 'c')]),
        { types: ['A'] },
        async (read) => {
          expect(await read.rank()).toMatchObject({
            items: [],
            isolates: 2,
            coverage: { complete: true, reason: 'empty' },
          });
          expect((await read.communities()).items).toEqual([]);
        },
      );
      await cache.read(
        input(nodes, [edge('a', 'b'), edge('b', 'c')]),
        { types: [schema.classes.Base!.typeId] },
        async (read) => expect((await read.rank()).items).toHaveLength(3),
      );
      await expect(cache.read(input(nodes, []), { types: [] }, () => {})).rejects.toMatchObject({
        code: ANALYSIS_ERROR.INVALID,
      });
      await expect(
        cache.read(input(nodes, []), { relations: ['unknown'] }, () => {}),
      ).rejects.toMatchObject({ code: ANALYSIS_ERROR.INVALID });
    } finally {
      await cache.close();
    }
  });
  it('has stable Leiden membership/anchors across balance and permutations, with fresh bounded summaries', async () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ id: String(i), type: i ? 'B' : 'A' }));
    const edges: Triple[] = [];
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++)
        if (Math.floor(i / 4) === Math.floor(j / 4)) edges.push(edge(String(i), String(j)));
    edges.push(edge('3', '4'), edge('0', '0'));
    const cache = new GraphAnalysisCache();
    try {
      let baseline: unknown;
      await cache.read(input(nodes, edges), {}, async (read) => {
        const normal = await read.communities(),
          balanced = await read.communities({ balance: 'type' });
        expect(normal.items).toHaveLength(2);
        expect(normal.items.map((g) => [g.anchorId, g.size]).sort()).toEqual(
          balanced.items.map((g) => [g.anchorId, g.size]).sort(),
        );
        expect(balanced.items.map((g) => g.mass)).not.toEqual(normal.items.map((g) => g.mass));
        expect(normal.items.every((g) => g.representatives.length <= 3)).toBe(true);
        baseline = normal;
        normal.items[0]!.representatives[0]!.score = 999;
        expect((await read.communities()).items[0]!.representatives[0]!.score).not.toBe(999);
        baseline = await read.communities();
      });
      await cache.read(
        input([...nodes].reverse(), [...edges].reverse(), 'permuted'),
        {},
        async (read) => expect(await read.communities()).toEqual(baseline),
      );
      await cache.read(
        input(
          [
            { id: 'é', type: 'A' },
            { id: 'e\u0301', type: 'A' },
          ],
          [edge('é', 'e\u0301')],
          'unicode',
        ),
        {},
        async (read) => expect((await read.communities()).items[0]!.anchorId).toBe('e\u0301'),
      );
    } finally {
      await cache.close();
    }
  });
  it('caps cohorts instead of rewarding bulk duplication and excludes rare isolated records', async () => {
    const nodes = [
      { id: 'a', type: 'A' },
      ...Array.from({ length: 100 }, (_, i) => ({ id: 'b' + i, type: 'B' })),
      { id: 'orphan', type: 'Base' },
    ];
    const cache = new GraphAnalysisCache();
    try {
      await cache.read(
        input(
          nodes,
          nodes.slice(1, -1).map((n) => edge(n.id, 'a')),
        ),
        {},
        async (read) => {
          const report = await read.communities({ balance: 'type' });
          expect(report.isolates).toBe(1);
          expect(report.items[0]!.size).toBe(101);
          expect((await read.rank({ balance: 'type' })).items.some((n) => n.id === 'orphan')).toBe(
            false,
          );
        },
      );
    } finally {
      await cache.close();
    }
  });
  it('bounds a bulk cohort mass when its size grows with a fixed median type size', async () => {
    const cache = new GraphAnalysisCache();
    const masses: number[] = [];
    try {
      for (const bulk of [100, 1000]) {
        const nodes: Identity[] = [],
          edges: Triple[] = [];
        for (const [type, count] of [
          ['A', 2],
          ['B', 3],
          ['Base', bulk],
        ] as const) {
          const ids = Array.from({ length: count }, (_, i) => type + i);
          nodes.push(...ids.map((id) => ({ id, type })));
          edges.push(...ids.slice(1).map((id) => edge(id, ids[0]!)));
        }
        await cache.read(input(nodes, edges, 'bulk' + bulk), {}, async (read) => {
          const groups = await read.communities({ balance: 'type' });
          expect(groups.items).toHaveLength(3);
          const group = groups.items.find((g) => g.size === bulk)!;
          masses.push(group.mass);
          expect(group.mass).toBeLessThan(0.53);
        });
      }
      expect(Math.abs(masses[1]! - masses[0]!)).toBeLessThan(0.01);
    } finally {
      await cache.close();
    }
  });
  it('keeps one reusable slot while old callbacks survive swaps, and closes escaped readers', async () => {
    let scans = 0;
    const original = input(
      [
        { id: 'a', type: 'A' },
        { id: 'b', type: 'B' },
      ],
      [edge('a', 'b')],
    );
    const nodes = original.nodes.bind(original);
    original.nodes = () => {
      scans++;
      return nodes();
    };
    const cache = new GraphAnalysisCache();
    let escaped: AnalysisRead | undefined;
    await cache.read(original, {}, async (first) => {
      escaped = first;
      await cache.read(original, {}, async (second) =>
        expect(await second.rank()).toEqual(await first.rank()),
      );
      expect(scans).toBe(1);
      await cache.read({ ...original, generation: 'new' }, {}, async (next) =>
        expect((await next.rank()).items).toHaveLength(2),
      );
      expect((await first.rank()).items).toHaveLength(2);
      await cache.read(original, {}, () => {});
      expect(scans).toBe(3);
    });
    await expect(escaped!.rank()).rejects.toMatchObject({ code: ANALYSIS_ERROR.CLOSED });
    await cache.read({ ...original, generation: { snapshot: 'same' } }, {}, (read) =>
      expect(read.stats.nodes).toBe(2),
    );
    await cache.read(
      {
        ...original,
        generation: { snapshot: 'same' },
        nodes: () => [
          { id: 'a', type: 'A' },
          { id: 'b', type: 'B' },
          { id: 'c', type: 'B' },
        ],
        edges: () => [edge('a', 'b'), edge('b', 'c')],
      },
      {},
      (read) => expect(read.stats.nodes).toBe(3),
    );
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      ready = new Promise<void>((r) => {
        entered = r;
      });
    const active = cache.read(original, {}, async (read) => {
      entered();
      await gate;
      return read.rank();
    });
    await ready;
    let closed = false;
    const closing = cache.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(cache.read(original, {}, () => {})).rejects.toMatchObject({
      code: ANALYSIS_ERROR.CLOSED,
    });
    release();
    await active;
    await closing;
  });
  it('checks source lifetime on cache hits and rejects over-budget input before reading edges/solving', async () => {
    const cache = new GraphAnalysisCache();
    let alive = true;
    const source = {
      ...input([{ id: 'a', type: 'A' }], []),
      check: () => {
        if (!alive) throw new Error('closed source');
      },
    };
    await cache.read(source, {}, () => {});
    alive = false;
    await expect(cache.read(source, {}, () => {})).rejects.toThrow('closed source');
    const huge = {
      ...source,
      generation: 'huge',
      check: () => {},
      *nodes() {
        for (let i = 0; i <= ANALYSIS_LIMITS.nodes; i++) yield { id: String(i), type: 'A' };
      },
      edges: () => {
        throw new Error('must not scan edges');
      },
    };
    await expect(cache.read(huge, {}, () => {})).rejects.toMatchObject({
      code: ANALYSIS_ERROR.LIMIT,
    });
    const tooManyEdges = {
      ...input(
        [
          { id: 'a', type: 'A' },
          { id: 'b', type: 'B' },
        ],
        [],
      ),
      generation: 'too-many-edges',
      *edges() {
        for (let i = 0; i <= ANALYSIS_LIMITS.edges; i++) yield edge('a', 'b');
      },
    };
    await expect(cache.read(tooManyEdges, {}, () => {})).rejects.toMatchObject({
      code: ANALYSIS_ERROR.LIMIT,
    });
    await cache.close();
  });
});
