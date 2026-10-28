import { describe, expect, it } from 'vitest';
import type { RuntimeClass, RuntimeSchemaIR, RuntimeSlot } from '@khaale/lore-schema';
import {
  createSemanticReadSession,
  SemanticReadError,
  type SemanticEntity,
  type SemanticSnapshot,
} from './index.js';

const slot = (
  name: string,
  range: string,
  mode: RuntimeSlot['mode'],
  options: Partial<RuntimeSlot> = {},
): RuntimeSlot => ({
  name,
  range,
  mode,
  required: false,
  recommended: false,
  multivalued: false,
  identifier: false,
  key: false,
  designatesType: false,
  patterns: [],
  anyOf: [],
  allOf: [],
  noneOf: [],
  exactlyOneOf: [],
  annotations: {},
  ...options,
});
const schema: RuntimeSchemaIR = {
  name: 'test',
  classes: {},
  types: {},
  enums: {},
  designators: {},
};
const thing: RuntimeClass = {
  name: 'Thing',
  typeId: 'example:Thing',
  mixins: [],
  abstract: false,
  mixin: false,
  allowExtra: false,
  depth: 1,
  annotations: {},
  classificationRules: [],
  uniqueKeys: {},
  designatorSlot: 'kind',
  slots: {
    id: slot('id', 'string', 'scalar', { identifier: true }),
    kind: slot('kind', 'string', 'scalar', { designatesType: true }),
    name: slot('name', 'string', 'scalar'),
    tags: slot('tags', 'string', 'scalar', { multivalued: true }),
    score: slot('score', 'integer', 'scalar', { minimumValue: 2, maximumValue: 4 }),
    code: slot('code', 'string', 'scalar', { patterns: ['^[A-Z]+$'] }),
    event_date: slot('event_date', 'date', 'scalar'),
    event_time: slot('event_time', 'datetime', 'scalar'),
    detail: slot('detail', 'Detail', 'inline-object'),
    depends_on: slot('depends_on', 'Thing', 'reference', { inverse: 'depended_on_by' }),
  },
};
schema.classes.Thing = thing;
schema.classes.Other = {
  ...thing,
  name: 'Other',
  typeId: 'example:Other',
  slots: {
    id: thing.slots.id!,
    kind: slot('kind', 'string', 'scalar', { designatesType: true }),
    score: slot('score', 'string', 'scalar', { patterns: ['^ok$'] }),
  },
};
const entity = (id: string, name: string, tags: string[] = ['one']): SemanticEntity => ({
  id,
  kind: 'Thing',
  typeId: 'example:Thing',
  properties: { id, kind: 'Thing', name, tags, ...(id === 'a' ? { score: 3 } : {}) },
  provenance: { source: `${id}.yaml`, physicalPath: `${id}.yaml` },
});
const otherEntity = (): SemanticEntity => ({
  id: 'other',
  kind: 'Other',
  typeId: 'example:Other',
  properties: { id: 'other', kind: 'Other', score: 'ok' },
  provenance: { source: 'other.yaml', physicalPath: 'other.yaml' },
});
const snapshot = (name = 'draft'): SemanticSnapshot => ({
  schemaHash: 'hash-1',
  entities: {
    a: entity('a', name, ['one', 'two']),
    b: entity('b', 'Beta'),
    c: entity('c', 'Gamma'),
    other: otherEntity(),
  },
  relations: [
    { from: 'a', relation: 'depends_on', to: 'b', inferred: false, generic: false },
    { from: 'b', relation: 'depended_on_by', to: 'a', inferred: true, generic: false },
    { from: 'b', relation: 'depends_on', to: 'c', inferred: false, generic: false },
    { from: 'c', relation: 'depends_on', to: 'a', inferred: false, generic: false },
    { from: 'a', relation: 'references', to: 'c', inferred: false, generic: true },
  ],
});

describe('semantic read session', () => {
  it('captures source values immutably and validates schema identity', () => {
    const input = snapshot();
    const session = createSemanticReadSession({ snapshot: input, schema, schemaHash: 'hash-1' });
    input.entities.a!.properties.name = 'changed after capture';
    expect(session.get('a').entity.properties.name).toBe('draft');
    expect(() =>
      createSemanticReadSession({ snapshot: input, schema, schemaHash: 'hash-2' }),
    ).toThrowError(SemanticReadError);
    expect(() => createSemanticReadSession({ snapshot: input, schema } as never)).toThrow(
      /requires a runtime schema hash/,
    );
  });

  it('searches literal scalar leaves and queries scalar/reference values deterministically', () => {
    const session = createSemanticReadSession({
      snapshot: snapshot(),
      schema,
      schemaHash: 'hash-1',
    });
    expect(session.search('DRAFT').matches.map((match) => match.entity.id)).toEqual(['a']);
    expect(session.search('missing').matches).toEqual([]);
    expect(
      session.query('Thing', [{ slot: 'tags', value: 'one' }]).entities.map((item) => item.id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      session
        .query('Thing', [
          { slot: 'tags', value: 'one' },
          { slot: 'tags', value: 'two' },
        ])
        .entities.map((item) => item.id),
    ).toEqual(['a']);
    expect(
      session
        .query(undefined, [{ slot: 'depends_on', value: 'b' }])
        .entities.map((item) => item.id),
    ).toEqual(['a']);
    expect(() => session.query('NoSuchClass')).toThrow(/unknown class/);
    expect(() => session.query('Thing', [{ slot: 'unknown', value: 'x' }])).toThrow(/slot/);
    expect(() => session.query('Other', [{ slot: 'name', value: 'x' }])).toThrow(/slot/);
    expect(() => session.query('Thing', [{ slot: 'name.value', value: 'x' }])).toThrow(/slot/);
    expect(() => session.query('Thing', [{ slot: 'detail', value: 'x' }])).toThrow(/incompatible/);
    expect(() => session.query('Thing', [{ slot: 'name' }] as never)).toThrow(/require a slot/);
    expect(() => session.query('Thing', [{ slot: 'name', value: [] }] as never)).toThrow(
      /require a slot/,
    );
    expect(() => session.query('Thing', [{ slot: 'tags', value: 1 }])).toThrow(/incompatible/);
    expect(() => session.query('Thing', [{ slot: 'depends_on', value: 1 }])).toThrow(
      /incompatible/,
    );
    expect(() => session.query('Thing', [{ slot: 'score', value: 1 }])).toThrow(/incompatible/);
    expect(() => session.query('Thing', [{ slot: 'code', value: 'lower' }])).toThrow(
      /incompatible/,
    );
    expect(() => session.query('Thing', [{ slot: 'event_date', value: '2024-02-31' }])).toThrow(
      /incompatible/,
    );
    expect(() => session.query('Thing', [{ slot: 'event_time', value: 'tomorrow' }])).toThrow(
      /incompatible/,
    );
    expect(
      session.query(undefined, [{ slot: 'score', value: 3 }]).entities.map((item) => item.id),
    ).toEqual(['a']);
    expect(
      session.query(undefined, [{ slot: 'score', value: 'ok' }]).entities.map((item) => item.id),
    ).toEqual(['other']);
    expect(() => session.query(undefined, [{ slot: 'score', value: 1 }])).toThrow(/incompatible/);
  });

  it('uses canonical relations for links, graph, and incoming impact', () => {
    const session = createSemanticReadSession({
      snapshot: snapshot(),
      schema,
      schemaHash: 'hash-1',
    });
    expect(session.links('a').links).toEqual([
      { from: 'a', relation: 'depends_on', to: 'b', inferred: false, generic: false },
      { from: 'c', relation: 'depends_on', to: 'a', inferred: false, generic: false },
    ]);
    expect(session.links('a', 'out').links).toEqual([
      { from: 'a', relation: 'depends_on', to: 'b', inferred: false, generic: false },
    ]);
    expect(session.links('a', 'in', 'depends_on').links).toEqual([
      { from: 'c', relation: 'depends_on', to: 'a', inferred: false, generic: false },
    ]);
    expect(session.graph('a', 1).nodes).toEqual([
      { id: 'a', distance: 0 },
      { id: 'b', distance: 1 },
      { id: 'c', distance: 1 },
    ]);
    expect(session.graph('a', 1).links).toEqual([
      { from: 'a', relation: 'depends_on', to: 'b', inferred: false, generic: false },
      { from: 'b', relation: 'depends_on', to: 'c', inferred: false, generic: false },
      { from: 'c', relation: 'depends_on', to: 'a', inferred: false, generic: false },
    ]);
    expect(session.impact('a', 2).impacts.map((item) => [item.id, item.distance])).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
    expect(() => session.graph('a', 33)).toThrow(/0 and 32/);
    expect(() => session.impact('missing')).toThrow(/not found/);
  });

  it('returns contiguous deterministic shortest impact paths across equal alternatives', () => {
    const base = snapshot();
    const alternative: SemanticSnapshot = {
      ...base,
      entities: {
        ...base.entities,
        d: entity('d', 'Delta'),
      },
      relations: [
        ...base.relations,
        { from: 'd', relation: 'depends_on', to: 'a', inferred: false, generic: false },
        { from: 'b', relation: 'depends_on', to: 'd', inferred: false, generic: false },
      ],
    };
    const session = createSemanticReadSession({
      snapshot: alternative,
      schema,
      schemaHash: 'hash-1',
    });
    expect(session.impact('a', 2).impacts).toMatchObject([
      { id: 'c', distance: 1, path: [{ from: 'c', relation: 'depends_on', to: 'a' }] },
      { id: 'd', distance: 1, path: [{ from: 'd', relation: 'depends_on', to: 'a' }] },
      {
        id: 'b',
        distance: 2,
        path: [
          { from: 'b', relation: 'depends_on', to: 'c' },
          { from: 'c', relation: 'depends_on', to: 'a' },
        ],
      },
    ]);
  });
});
