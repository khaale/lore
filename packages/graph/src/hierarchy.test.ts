import { expect, it } from 'vitest';
import { normalizeSchema } from '@khaale/lore-schema';
import {
  HierarchyComputation,
  HierarchyPlan,
  proposeHierarchy,
  hierarchyTypeScores,
  validateHierarchy,
  type HierarchyInput,
  type HierarchyDefinition,
} from './hierarchy.js';

function input(reverse = false): HierarchyInput {
  const compiled = normalizeSchema({
    slots: {},
    types: {},
    enums: {},
    classes: {
      Entity: {
        abstract: true,
        attributes: { id: { identifier: true }, kind: { designatesType: true } },
      },
      Folder: { isA: 'Entity', attributes: { parent: { range: 'Folder' } } },
      Leaf: { isA: 'Entity', attributes: { folder: { range: 'Folder' }, value: {} } },
    },
  });
  const nodes = [
    { id: 'root', type: 'Folder', file: '/corpus/root.md', source: '/corpus/root.md' },
    { id: 'child', type: 'Folder', file: '/corpus/root/child.md', source: '/corpus/root/child.md' },
    ...[1, 2, 3, 4].map((i) => ({
      id: `l${i}`,
      type: 'Leaf',
      file: '/corpus/root.md',
      source: `/corpus/root.md#${i}`,
    })),
  ];
  const links = [
    { from: 'child', relation: 'parent', to: 'root' },
    ...nodes
      .filter((n) => n.type === 'Leaf')
      .map((n) => ({ from: n.id, relation: 'folder', to: 'child' })),
  ];
  return {
    schema: compiled,
    root: '/corpus',
    nodes: () => (reverse ? [...nodes].reverse() : nodes),
    links: () => (reverse ? [...links].reverse() : links),
    property: (id) => ({ l1: '1', l2: 1, l3: false, l4: null })[id as 'l1'],
  };
}
it('is independent of metadata iteration order and distinguishes navigation from assertions', () => {
  const a = proposeHierarchy(new HierarchyComputation(input()), { detail: 'diagnostic' }),
    b = proposeHierarchy(new HierarchyComputation(input(true)), { detail: 'diagnostic' });
  expect(a.definition).toEqual(b.definition);
  expect(a.diagnostics).toEqual(b.diagnostics);
  const source = structuredClone(a.definition);
  source.branches = [
    {
      key: 'source',
      parent: 'type:Folder',
      child: 'type:Leaf',
      via: { kind: 'source', match: 'document' },
    },
  ];
  source.roots = ['type:Folder'];
  const plan = new HierarchyPlan(
    new HierarchyComputation(input()),
    validateHierarchy(input().schema, source),
  );
  const root = plan.page({ definition: source }).page.items.find((n) => n.entityId === 'root')!;
  const children = plan.page({ definition: source, parent: root.ref }).page.items;
  expect(children.filter((n) => n.type === 'Leaf')).toHaveLength(4);
  expect(children.every((n) => n.basis === 'source-context')).toBe(true);
});
it('keeps typed exact scalar keys and missing groups distinct', () => {
  const i = input(),
    d = validateHierarchy(i.schema, {
      version: 1,
      nodes: [{ key: 'p', kind: 'property', type: 'Leaf', field: 'value' }],
      roots: ['p'],
      branches: [],
    }),
    plan = new HierarchyPlan(new HierarchyComputation(i), d),
    root = plan.page({ definition: d }).page.items[0]!;
  const groups = plan.page({ definition: d, parent: root.ref }).page.items;
  expect(groups).toHaveLength(4);
  expect(new Set(groups.map((g) => g.ref)).size).toBe(4);
  expect(groups.map((g) => g.label).sort()).toEqual(['1', '1', 'Unassigned', 'false']);
});
it('rejects navigation cycles and exposes rootless recursive instances as unassigned', () => {
  const i = input();
  expect(() =>
    validateHierarchy(i.schema, {
      version: 1,
      nodes: [{ key: 'g', kind: 'group', label: 'g', basis: 'schema-navigation', members: ['g'] }],
      roots: ['g'],
      branches: [],
    }),
  ).toThrow(/cycle/);
  const d = validateHierarchy(i.schema, {
    version: 1,
    nodes: [{ key: 'f', kind: 'type', type: 'Folder' }],
    roots: ['f'],
    branches: [
      {
        key: 'loop',
        parent: 'f',
        child: 'f',
        recursive: true,
        via: { kind: 'path', steps: [{ ownerType: 'Folder', field: 'parent', direction: 'out' }] },
      },
    ],
  });
  const cyclic = {
    ...i,
    links: () => [
      { from: 'root', relation: 'parent', to: 'child' },
      { from: 'child', relation: 'parent', to: 'root' },
    ],
  };
  const plan = new HierarchyPlan(new HierarchyComputation(cyclic), d),
    r = plan.page({ definition: d }).page;
  expect(r.placement.unassigned).toBe(2);
  expect(r.items[0]?.flags).toContain('unassigned');
  const entities = plan.page({ definition: d, parent: r.items[0]!.ref }).page.items;
  expect(entities).toHaveLength(2);
  const edited: HierarchyDefinition = { ...d, labels: { Folder: ['id'] } };
  const other = new HierarchyPlan(new HierarchyComputation(cyclic), edited);
  expect(() => other.page({ definition: edited, parent: entities[0]!.ref })).toThrow(
    /different definition/,
  );
});

it('keeps focus hints independent, normalized and invariant to corpus multiplicity', () => {
  const i = input(),
    d = validateHierarchy(i.schema, {
      version: 1,
      nodes: [
        { key: 'f', kind: 'type', type: 'Folder' },
        { key: 'l', kind: 'type', type: 'Leaf' },
      ],
      roots: ['f'],
      branches: [
        {
          key: 'fl',
          parent: 'f',
          child: 'l',
          via: { kind: 'path', steps: [{ ownerType: 'Leaf', field: 'folder', direction: 'out' }] },
        },
      ],
    });
  const scores = hierarchyTypeScores(new HierarchyComputation(i), d);
  expect(scores).toEqual({
    Folder: { structureScore: 1, connectivityScore: 0 },
    Leaf: { structureScore: 0, connectivityScore: 0 },
  });
  const duplicated = {
    ...i,
    nodes: () => [...i.nodes(), ...[...i.nodes()].map((n) => ({ ...n, id: n.id + '-copy' }))],
    links: () => [
      ...i.links(),
      ...i.links(),
      ...[...i.links()].map((e) => ({ ...e, from: e.from + '-copy', to: e.to + '-copy' })),
    ],
  };
  expect(hierarchyTypeScores(new HierarchyComputation(duplicated), d)).toEqual(scores);
  const noBranches = { ...d, branches: [] };
  expect(hierarchyTypeScores(new HierarchyComputation(i), noBranches)).toEqual({
    Folder: { structureScore: 0, connectivityScore: 1 },
    Leaf: { structureScore: 0, connectivityScore: 1 },
  });
});
it('distinguishes repeated navigation occurrences and bounds virtual depth', () => {
  const i = input(),
    d = validateHierarchy(i.schema, {
      version: 1,
      nodes: [
        { key: 'a', kind: 'group', label: 'A', basis: 'schema-navigation', members: ['f'] },
        { key: 'b', kind: 'group', label: 'B', basis: 'schema-navigation', members: ['f'] },
        { key: 'f', kind: 'type', type: 'Folder' },
      ],
      roots: ['a', 'b'],
      branches: [],
    });
  const plan = new HierarchyPlan(new HierarchyComputation(i), d),
    roots = plan.page({ definition: d }).page.items;
  const a = plan.page({ definition: d, parent: roots[0]!.ref }).page.items,
    b = plan.page({ definition: d, parent: roots[1]!.ref }).page.items;
  expect(a.map((n) => n.entityId)).toEqual(b.map((n) => n.entityId));
  expect(a[0]!.ref).not.toBe(b[0]!.ref);
  const deep = validateHierarchy(i.schema, {
      version: 1,
      nodes: Array.from({ length: 40 }, (_, j) => ({
        key: `g${j}`,
        kind: 'group',
        label: `g${j}`,
        basis: 'schema-navigation',
        members: j < 39 ? [`g${j + 1}`] : [],
      })),
      roots: ['g0'],
      branches: [],
    }),
    p = new HierarchyPlan(new HierarchyComputation(i), deep);
  let page = p.page({ definition: deep }).page;
  for (let j = 0; j < 32; j++) page = p.page({ definition: deep, parent: page.items[0]!.ref }).page;
  expect(page.items[0]?.flags).toContain('depth-limit');
  expect(page.items[0]?.directChildren).toEqual({ status: 'unknown' });
});

it('removes only conflicting cycle members while retaining their descendant axes', () => {
  const schema = normalizeSchema({
    slots: {},
    types: {},
    enums: {},
    classes: {
      E: { abstract: true, attributes: { id: { identifier: true } } },
      A: {
        isA: 'E',
        attributes: { up: { range: 'B', annotations: { 'lore:explore_relation': 'context' } } },
      },
      B: {
        isA: 'E',
        attributes: { up: { range: 'A', annotations: { 'lore:explore_relation': 'context' } } },
      },
      C: {
        isA: 'E',
        attributes: { up: { range: 'A', annotations: { 'lore:explore_relation': 'context' } } },
      },
    },
  });
  const c = new HierarchyComputation({
    schema,
    root: '/',
    nodes: () => ['A', 'B', 'C'].map((type) => ({ id: type, type, file: '', source: '' })),
    links: () => [
      { from: 'A', relation: 'up', to: 'B' },
      { from: 'B', relation: 'up', to: 'A' },
      { from: 'C', relation: 'up', to: 'A' },
    ],
    property: () => undefined,
  });
  const p = proposeHierarchy(c);
  expect(
    p.definition.branches.some(
      (b) => !b.alternative && b.parent === 'type:A' && b.child === 'type:C',
    ),
  ).toBe(true);
});

it('keeps domain-name renaming from changing candidate topology', () => {
  const i = input(),
    rename = (v: unknown) =>
      JSON.parse(
        JSON.stringify(v)
          .replaceAll('Folder', 'Branch')
          .replaceAll('Leaf', 'Petal')
          .replaceAll('folder', 'host'),
      );
  const renamed: HierarchyInput = {
    ...i,
    schema: rename(i.schema),
    nodes: () => rename([...i.nodes()]),
    links: () => rename([...i.links()]),
  };
  const original = proposeHierarchy(new HierarchyComputation(i)).definition;
  const expected = JSON.parse(
    JSON.stringify(original)
      .replaceAll('Folder', 'Branch')
      .replaceAll('Leaf', 'Petal')
      .replaceAll('folder', 'host'),
  );
  expect(proposeHierarchy(new HierarchyComputation(renamed)).definition).toEqual(expected);
});

it('uses actual descendant distances and own neighbor types for individual scores', () => {
  const schema = normalizeSchema({
    slots: {},
    types: {},
    enums: {},
    classes: {
      E: { abstract: true, attributes: { id: { identifier: true } } },
      Folder: { isA: 'E', attributes: { parent: { range: 'Folder' } } },
      Leaf: { isA: 'E', attributes: { folder: { range: 'Folder' } } },
      Tag: { isA: 'E' },
    },
  });
  const i: HierarchyInput = {
    schema,
    root: '/',
    nodes: () => [
      { id: 'r', type: 'Folder', file: '', source: '' },
      { id: 'c', type: 'Folder', file: '', source: '' },
      { id: 'l', type: 'Leaf', file: '', source: '' },
      { id: 't', type: 'Tag', file: '', source: '' },
    ],
    links: () => [
      { from: 'c', relation: 'parent', to: 'r' },
      { from: 'l', relation: 'folder', to: 'c' },
      { from: 'r', relation: 'mentions', to: 't' },
    ],
    property: () => undefined,
  };
  const d = validateHierarchy(schema, {
    version: 1,
    nodes: [
      { key: 'f', kind: 'type', type: 'Folder' },
      { key: 'l', kind: 'type', type: 'Leaf' },
      { key: 't', kind: 'type', type: 'Tag' },
    ],
    roots: ['f', 't'],
    branches: [
      {
        key: 'ff',
        parent: 'f',
        child: 'f',
        recursive: true,
        via: { kind: 'path', steps: [{ ownerType: 'Folder', field: 'parent', direction: 'out' }] },
      },
      {
        key: 'fl',
        parent: 'f',
        child: 'l',
        via: { kind: 'path', steps: [{ ownerType: 'Leaf', field: 'folder', direction: 'out' }] },
      },
    ],
  });
  const p = new HierarchyPlan(new HierarchyComputation(i), d),
    r = p.page({ definition: d, includeScores: true }).page.items.find((n) => n.entityId === 'r')!;
  expect(r.kind === 'entity' && r.scores).toEqual({ structureScore: 0.65, connectivityScore: 1 });
  const child = p
    .page({ definition: d, parent: r.ref, includeScores: true })
    .page.items.find((n) => n.entityId === 'c')!;
  expect(child.kind === 'entity' && child.scores).toEqual({
    structureScore: 1,
    connectivityScore: 0,
  });
  const duplicate = {
    ...i,
    nodes: () => [...i.nodes(), ...[...i.nodes()].map((n) => ({ ...n, id: n.id + '-copy' }))],
    links: () => [
      ...i.links(),
      ...i.links(),
      ...[...i.links()].map((e) => ({ ...e, from: e.from + '-copy', to: e.to + '-copy' })),
    ],
  };
  const dp = new HierarchyPlan(new HierarchyComputation(duplicate), d),
    dr = dp
      .page({ definition: d, includeScores: true })
      .page.items.find((n) => n.entityId === 'r')!;
  expect(dr.kind === 'entity' && dr.scores).toEqual(r.kind === 'entity' && r.scores);
  const unused = validateHierarchy(schema, {
    ...d,
    nodes: [...d.nodes, { key: 'hidden', kind: 'type', type: 'Folder' }],
    branches: [
      ...d.branches,
      { key: 'unused', parent: 'hidden', child: 't', via: { kind: 'source', match: 'document' } },
    ],
  });
  const unchanged = new HierarchyPlan(new HierarchyComputation(i), unused)
    .page({ definition: unused, includeScores: true })
    .page.items.find((n) => n.entityId === 'r')!;
  expect(unchanged.kind === 'entity' && unchanged.scores).toEqual(r.kind === 'entity' && r.scores);
  const leafDefinition = { ...d, roots: ['l'], branches: [] };
  const leaf = new HierarchyPlan(new HierarchyComputation(i), leafDefinition)
    .page({ definition: leafDefinition, includeScores: true })
    .page.items.find((n) => n.entityId === 'l')!;
  expect(leaf.kind === 'entity' && leaf.scores).toEqual({
    structureScore: 0,
    connectivityScore: 0,
  });
});
