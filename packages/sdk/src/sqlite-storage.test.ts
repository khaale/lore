import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { normalizeSchema } from '@khaale/lore-schema';
import type { IndexV2, Edge } from '@khaale/lore-core';
import { COMPACT_SCHEMA, CompactReader, EDGE_SELECT, publishCompact } from './sqlite-storage.js';
import { canonicalGraphView, projectionSource } from './reader.js';

const schema = normalizeSchema({
  classes: {
    Thing: {
      attributes: {
        id: { identifier: true },
        name: {},
        depends: { range: 'Thing', inverse: 'incoming', multivalued: true },
        incoming: { range: 'Thing', inverse: 'depends', multivalued: true },
        peer: { range: 'Thing', inverse: 'peer', multivalued: true },
        plain: { range: 'Thing', multivalued: true },
        detail: { range: 'Detail', inlined: true },
      },
      extraSlots: { allowed: true },
    },
    Detail: {
      attributes: { scope: { range: 'Thing' }, source: { range: 'integer' } },
      extraSlots: { allowed: true },
    },
  },
  slots: {},
  types: {},
  enums: {},
});
const descriptor = {
  source: '/fixture/a#literal.md#line=1',
  physicalPath: '/fixture/a#literal.md',
  representation: 'frontmatter' as const,
  span: { line: 2, column: 3, end_line: 2, end_column: 9 },
};
const ids = ['z', 'ä', 'A', 'a', 'é', 'e\u0301'];
function index(edges: Edge[]): IndexV2 {
  return {
    version: 2,
    schema_hash: 'test',
    diagnostics: [],
    edges,
    artifacts: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          id,
          kind: 'Thing',
          type_id: schema.classes.Thing!.typeId,
          source: descriptor.source,
          physical_path: descriptor.physicalPath,
          data: {
            id,
            name: id,
            plain: [],
            nullable: null,
            source: 3,
            raw: { source: 7, physicalPath: [1, 'not encoded'] },
            detail: { scope: '[[a|alias]]', source: 42 },
          },
          identifier: id,
          body: 'body',
          provenance: {
            source: descriptor.source,
            physicalPath: descriptor.physicalPath,
            span: descriptor.span,
            properties: { name: descriptor },
          },
        },
      ]),
    ),
  };
}
function check(built: IndexV2) {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPACT_SCHEMA);
  const source = projectionSource(built, schema),
    expected = canonicalGraphView(source);
  const counts = publishCompact(db, built, schema),
    reader = new CompactReader(db);
  expect(counts.entityCount).toBe(ids.length);
  expect(counts.edgeCount).toBe(expected.edges.length);
  for (const row of db.prepare('SELECT * FROM lore_entities ORDER BY id').all()) {
    const entity = reader.entity(row),
      original = source.entitiesById.get(entity.id)!;
    const { narrative: _narrative, ...data } = original;
    expect(entity).toEqual(JSON.parse(JSON.stringify(data)));
    const raw = { ...built.artifacts[entity.id] };
    delete raw.body;
    delete raw.links;
    expect(reader.artifact(row, entity)).toEqual(JSON.parse(JSON.stringify(raw)));
    expect(row.narrative).toBe(original.narrative);
  }
  const actual = db
    .prepare(`${EDGE_SELECT} ORDER BY e.id`)
    .all()
    .map((row) => reader.edge(row));
  expect(actual).toEqual([...expected.edges]);
  const actualRelations = db
    .prepare('SELECT * FROM lore_relations ORDER BY id')
    .all()
    .map((row) => reader.relation(row));
  expect(actualRelations).toEqual(source.relations);
  // Compare the exact persisted per-entity ordering used by the previous SQLite writer.
  for (const row of db.prepare('SELECT id,external_id FROM lore_entities').all()) {
    const arcs = db
      .prepare('SELECT * FROM lore_arcs WHERE current_id=? ORDER BY ordinal')
      .all(Number(row.id));
    const target = [...(expected.arcsByCurrent.get(String(row.external_id)) ?? [])].sort(
      (a, b) =>
        a.to.localeCompare(b.to) ||
        a.edge.relation.localeCompare(b.edge.relation) ||
        a.edge.from.localeCompare(b.edge.from) ||
        a.edge.to.localeCompare(b.edge.to),
    );
    expect(
      arcs.map((a) => ({
        edge: actual[Number(a.edge_id) - 1]!.key,
        to: reader.external(Number(a.to_id)),
        relation: reader.predicate(Number(a.predicate_id)),
        mode: a.mode ? 'out' : 'in',
      })),
    ).toEqual(
      target.map((a) => ({ edge: a.edge.key, to: a.to, relation: a.relation, mode: a.mode })),
    );
  }
  db.close();
}
it('round-trips semantic/raw values and typed provenance without interpreting authored path-like fields', () => {
  const value = index([
    {
      from: 'a',
      relation: 'detail.scope',
      to: 'a',
      surface: '[[a|alias]]',
      value_path: ['detail', 'scope'],
      provenance: descriptor,
    },
  ]);
  delete value.artifacts.z!.provenance;
  value.artifacts.z!.data.plain = ['[[A|other label]]'];
  check(value);
});
it('matches JSON canonical edges, presentations and locale order across inverse/orphan/self/generic cases', () => {
  const fixtures: Edge[][] = [
    [
      { from: 'a', relation: 'depends', to: 'A' },
      { from: 'z', relation: 'plain', to: 'a', generic: true },
    ],
    [
      { from: 'a', relation: 'depends', to: 'A' },
      { from: 'A', relation: 'incoming', to: 'a', inferred: true, provenance: descriptor },
    ],
    [{ from: 'A', relation: 'incoming', to: 'a', inferred: true }],
    [
      { from: 'a', relation: 'depends', to: 'A' },
      { from: 'A', relation: 'incoming', to: 'a' },
    ],
    [
      { from: 'a', relation: 'peer', to: 'A' },
      { from: 'A', relation: 'peer', to: 'a', inferred: true },
      { from: 'a', relation: 'peer', to: 'a' },
    ],
    [
      { from: 'a', relation: 'plain', to: 'A' },
      { from: 'a', relation: 'plain', to: 'A', inferred: true },
    ],
    [
      { from: 'a', relation: 'depends', to: 'A', inferred: true },
      { from: 'A', relation: 'incoming', to: 'a', inferred: true },
    ],
    [{ from: 'a', relation: 'peer', to: 'a', inferred: true }],
    ids.flatMap((from) => ids.map((to) => ({ from, relation: 'plain', to }))),
  ];
  for (const edges of fixtures) check(index(edges));
});
