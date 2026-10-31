import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { compileSchemaOrThrow, type CompiledSchema } from '@khaale/lore-schema';
import { buildGraph, snapshotFromBuildResult, type Candidate } from './index.js';
let compiled: CompiledSchema;
beforeAll(async () => {
  compiled = await compileSchemaOrThrow(resolve('test/fixtures/record-constraints/model.yaml'));
});
const candidate = (
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
): Candidate => ({
  source: `/source/${id}.yaml`,
  physicalPath: `/source/${id}.yaml`,
  data: { id, type, name: id, ...properties },
  spans: { 'refinements[0].scope': { line: 7, column: 4 } },
  links: [],
  sections: [],
});
const graph = (properties: Record<string, unknown>, others: Candidate[] = []) =>
  buildGraph(
    [
      candidate('owner', 'Owner', properties),
      candidate('runtime', 'Runtime'),
      candidate('group', 'Group'),
      candidate('site', 'Site', { kind: 'root' }),
      ...others,
    ],
    { root: '/source', compiled },
  );
it('checks class exclusivity and conditional presence, including inline instance paths', () => {
  for (const value of [{ workload: 'work' }, { application: 'app' }])
    expect(graph({ choice: value }).index.diagnostics).toEqual([]);
  for (const value of [{}, { workload: 'work', application: 'app' }, { workload: ' ' }])
    expect(graph({ choice: value }).index.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RECORD_CONSTRAINT', slot: 'choice' }),
    );
  const site = (kind: string, parent?: string) =>
    buildGraph(
      [
        candidate('root', 'Site', { kind: 'root' }),
        candidate('s', 'Site', { kind, ...(parent ? { parent } : {}) }),
      ],
      { root: '/source', compiled },
    ).index.diagnostics ?? [];
  expect(site('root', 'root')).toContainEqual(expect.objectContaining({ code: 'CLASS_RULE' }));
  expect(site('child')).toContainEqual(expect.objectContaining({ code: 'CLASS_RULE' }));
  expect(site('child', 'root')).toEqual([]);
  expect(site('other')).toEqual([]);
  expect(
    buildGraph([candidate('s', 'ChildSite', { kind: 'child' })], { root: '/source', compiled })
      .index.diagnostics,
  ).toContainEqual(expect.objectContaining({ code: 'CLASS_RULE' }));
});
it('validates resolved union targets and recursively creates owning-entity reference assertions', () => {
  const valid = graph({
    parent: ['[[runtime]]', 'group'],
    refinements: [
      { scope: '[[group]]', note: 'first' },
      { scope: 'runtime', note: 'second' },
    ],
  });
  expect(valid.index.diagnostics).toEqual([]);
  expect(
    valid.index.edges
      ?.filter((e) => e.relation === 'refinements.scope')
      .map((e) => [e.from, e.to, e.value_path]),
  ).toEqual([
    ['owner', 'group', ['refinements', 0, 'scope']],
    ['owner', 'runtime', ['refinements', 1, 'scope']],
  ]);
  const semantic = snapshotFromBuildResult(valid);
  expect(semantic.entities.owner?.properties.refinements).toEqual([
    { scope: 'group', note: 'first' },
    { scope: 'runtime', note: 'second' },
  ]);
  expect(valid.index.artifacts.owner?.data.refinements).toEqual([
    { scope: '[[group]]', note: 'first' },
    { scope: 'runtime', note: 'second' },
  ]);
  expect(graph({ parent: ['site'] }).index.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_TYPE' }),
  );
  expect(graph({ refinements: [{ scope: '[[missing]]' }] }).index.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'BROKEN_REFERENCE',
      slot: 'refinements[0].scope',
      span: { line: 7, column: 4 },
    }),
  );
  expect(graph({ refinements: [{ scope: 'site' }] }).index.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_TYPE' }),
  );
});
it('enforces reference-aware unique collection values without rewriting input arrays', () => {
  expect(graph({ labels: ['a', 'a'] }).index.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'LIST_ELEMENTS_UNIQUE' }),
  );
  expect(graph({ parent: ['runtime', '[[runtime|Alias]]'] }).index.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'LIST_ELEMENTS_UNIQUE' }),
  );
  expect(
    graph({
      refinements: [
        { scope: 'group', note: 'same' },
        { note: 'same', scope: '[[group]]' },
      ],
    }).index.diagnostics,
  ).toContainEqual(expect.objectContaining({ code: 'LIST_ELEMENTS_UNIQUE' }));
  expect(graph({ authors: ['runtime', '[[runtime]]'] }).index.diagnostics).toEqual([]);
  expect(graph({ authors: ['[[site]]'] }).index.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_TYPE' }),
  );
  expect(
    graph({
      labels: [],
      refinements: [
        { scope: 'group', note: 'one' },
        { scope: 'group', note: 'two' },
      ],
    }).index.diagnostics,
  ).toEqual([]);
});

it('applies unconditional rules with presence treating false and zero as values', () => {
  const copy = structuredClone(compiled);
  const owner = copy.ir.classes.Owner!;
  const stringSlot = owner.slots.name!;
  owner.slots.flag = {
    ...stringSlot,
    name: 'flag',
    range: 'boolean',
    required: false,
    patterns: [],
  };
  owner.slots.count = {
    ...stringSlot,
    name: 'count',
    range: 'integer',
    required: false,
    patterns: [],
  };
  owner.rules = [
    {
      postconditions: {
        slotConditions: { flag: { valuePresence: 'PRESENT' }, count: { valuePresence: 'PRESENT' } },
      },
    },
  ];
  const build = (data: Record<string, unknown>) =>
    buildGraph([candidate('owner', 'Owner', data)], { root: '/source', compiled: copy }).index
      .diagnostics ?? [];
  expect(build({ flag: false, count: 0 })).toEqual([]);
  expect(build({ flag: false })).toContainEqual(expect.objectContaining({ code: 'CLASS_RULE' }));
});
