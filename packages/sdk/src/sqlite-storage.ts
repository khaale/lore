import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { referenceSlot, type RuntimeSchemaIR } from '@khaale/lore-schema';
import type {
  Artifact,
  IndexV2,
  ArtifactProvenance,
  SourceDescriptor,
  SemanticRelation,
} from '@khaale/lore-core';
import {
  projectionSource,
  type SourceEntity,
  type CanonicalGraphEdge,
  type GraphRelationPresentation,
  type ReadSource,
} from './reader.js';

export const COMPACT_SCHEMA = `
CREATE TABLE IF NOT EXISTS lore_types(id INTEGER PRIMARY KEY,name TEXT NOT NULL,uri TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_files(id INTEGER PRIMARY KEY,path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_predicates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,rank INTEGER NOT NULL,inverse_id INTEGER);
CREATE TABLE IF NOT EXISTS lore_entities(id INTEGER PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,type_id INTEGER NOT NULL,
 properties TEXT NOT NULL,raw_delta TEXT,provenance TEXT NOT NULL,narrative TEXT,rank INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lore_relations(id INTEGER PRIMARY KEY,from_id INTEGER NOT NULL,to_id INTEGER NOT NULL,
 predicate_id INTEGER NOT NULL,inferred INTEGER NOT NULL,generic INTEGER NOT NULL,provenance TEXT);
CREATE TABLE IF NOT EXISTS lore_edges(id INTEGER PRIMARY KEY,relation_id INTEGER NOT NULL,from_id INTEGER NOT NULL,
 to_id INTEGER NOT NULL,predicate_id INTEGER NOT NULL,inferred INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lore_edge_presentations(edge_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,relation_id INTEGER,
 from_id INTEGER NOT NULL,to_id INTEGER NOT NULL,predicate_id INTEGER NOT NULL,inferred INTEGER NOT NULL,
 PRIMARY KEY(edge_id,ordinal)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lore_arcs(current_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,edge_id INTEGER NOT NULL,
 to_id INTEGER NOT NULL,predicate_id INTEGER NOT NULL,mode INTEGER NOT NULL,PRIMARY KEY(current_id,ordinal)) WITHOUT ROWID;
`;
export const COMPACT_INDEXES = [
  ['lore_entities_type', 'lore_entities(type_id,id)'],
  ['lore_relations_from', 'lore_relations(from_id)'],
  ['lore_relations_to', 'lore_relations(to_id)'],
  ['lore_edges_from', 'lore_edges(from_id)'],
  ['lore_edges_to', 'lore_edges(to_id)'],
  ['lore_edges_key', 'lore_edges(from_id,predicate_id,to_id)'],
  ['lore_arcs_edge', 'lore_arcs(edge_id)'],
] as const;
type Locator = [number, string];
type PackedDescriptor = Omit<SourceDescriptor, 'source' | 'physicalPath'> & {
  source: Locator;
  physicalPath: number;
};
type PackedProvenance = Omit<
  ArtifactProvenance,
  'source' | 'physicalPath' | 'narrative' | 'properties'
> & {
  source: Locator;
  physicalPath: number;
  narrative?: PackedDescriptor;
  properties?: Record<string, PackedDescriptor>;
};
type ObjectDelta = { remove?: string[]; set?: Record<string, unknown> };
type RawDelta = {
  identifier?: true | string;
  data?: ObjectDelta;
  metadata?: ObjectDelta;
  provenance?: PackedProvenance;
};
const delta = (
  base: Record<string, unknown>,
  raw: Record<string, unknown>,
): ObjectDelta | undefined => {
  const remove = Object.keys(base).filter((key) => !Object.hasOwn(raw, key));
  const set = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => !isDeepStrictEqual(value, base[key]) || !Object.hasOwn(base, key),
    ),
  );
  return remove.length || Object.keys(set).length
    ? { ...(remove.length ? { remove } : {}), ...(Object.keys(set).length ? { set } : {}) }
    : undefined;
};
function applyDelta(base: Record<string, unknown>, change: ObjectDelta | undefined) {
  const value = { ...base, ...change?.set };
  for (const key of change?.remove ?? []) delete value[key];
  return value;
}
function baseArtifact(entity: SourceEntity): Artifact {
  return {
    id: entity.id,
    kind: entity.kind,
    type_id: entity.typeId,
    source: entity.provenance.source,
    physical_path: entity.provenance.physicalPath,
    data: entity.properties,
    provenance: entity.provenance,
  };
}
// Only typed provenance is packed. Raw data/delta fields named source or path
// remain ordinary values, so integers and arrays there cannot collide with IDs.
export class PathCodec {
  private readonly paths = new Map<string, number>();
  private readonly values = new Map<number, string>();
  constructor(private readonly db: DatabaseSync) {}
  private intern(path: string) {
    let id = this.paths.get(path);
    if (id === undefined) {
      id = this.paths.size + 1;
      this.paths.set(path, id);
      this.values.set(id, path);
      this.db.prepare('INSERT INTO lore_files VALUES(?,?)').run(id, path);
    }
    return id;
  }
  private path(id: number): string {
    let value = this.values.get(id);
    if (value === undefined) {
      value = String(this.db.prepare('SELECT path FROM lore_files WHERE id=?').get(id)!.path);
      this.values.set(id, value);
    }
    return value;
  }
  private locator(source: string, physical: string): Locator {
    return source.startsWith(physical)
      ? [this.intern(physical), source.slice(physical.length)]
      : [this.intern(source), ''];
  }
  packDescriptor(value: SourceDescriptor): PackedDescriptor {
    return {
      ...value,
      source: this.locator(value.source, value.physicalPath),
      physicalPath: this.intern(value.physicalPath),
    };
  }
  descriptor(value: PackedDescriptor): SourceDescriptor {
    return {
      ...value,
      source: this.path(value.source[0]) + value.source[1],
      physicalPath: this.path(value.physicalPath),
    };
  }
  pack(value: ArtifactProvenance): PackedProvenance {
    return {
      ...value,
      source: this.locator(value.source, value.physicalPath),
      physicalPath: this.intern(value.physicalPath),
      ...(value.narrative ? { narrative: this.packDescriptor(value.narrative) } : {}),
      ...(value.properties
        ? {
            properties: Object.fromEntries(
              Object.entries(value.properties).map(([k, v]) => [k, this.packDescriptor(v)]),
            ),
          }
        : {}),
    } as PackedProvenance;
  }
  unpack(value: PackedProvenance): ArtifactProvenance {
    return {
      ...value,
      source: this.path(value.source[0]) + value.source[1],
      physicalPath: this.path(value.physicalPath),
      ...(value.narrative ? { narrative: this.descriptor(value.narrative) } : {}),
      ...(value.properties
        ? {
            properties: Object.fromEntries(
              Object.entries(value.properties).map(([k, v]) => [k, this.descriptor(v)]),
            ),
          }
        : {}),
    } as ArtifactProvenance;
  }
}

export function publishCompact(
  db: DatabaseSync,
  index: IndexV2,
  schema: RuntimeSchemaIR,
  source: Pick<ReadSource, 'entities' | 'relations'> = projectionSource(index, schema),
) {
  for (const [name] of COMPACT_INDEXES) db.exec(`DROP INDEX IF EXISTS ${name}`);
  for (const table of [
    'lore_entities',
    'lore_types',
    'lore_files',
    'lore_predicates',
    'lore_relations',
    'lore_edges',
    'lore_edge_presentations',
    'lore_arcs',
  ])
    db.exec(`DELETE FROM ${table}`);
  const codec = new PathCodec(db),
    types = new Map<string, number>();
  const insertType = db.prepare('INSERT INTO lore_types VALUES(?,?,?)');
  const insertEntity = db.prepare('INSERT INTO lore_entities VALUES(?,?,?,?,?,?,?,?)');
  let previous: string | undefined,
    rank = 0;
  source.entities.forEach((entity, ordinal) => {
    if (previous === undefined || previous.localeCompare(entity.id) !== 0) rank++;
    previous = entity.id;
    if (!types.has(entity.kind)) {
      types.set(entity.kind, types.size + 1);
      insertType.run(types.get(entity.kind)!, entity.kind, entity.typeId);
    }
    const { data, ...rawMetadata } = index.artifacts[entity.id]!;
    const { data: _data, ...baseMetadata } = baseArtifact(entity);
    delete rawMetadata.body;
    delete rawMetadata.links;
    // Known descriptor/path metadata uses the same dictionary as the entity.
    const rawProv = rawMetadata.provenance;
    const rawIdentifier = rawMetadata.identifier;
    delete rawMetadata.identifier;
    delete rawMetadata.provenance;
    delete baseMetadata.provenance;
    const rawDelta: RawDelta = {};
    if (rawIdentifier !== undefined)
      rawDelta.identifier = rawIdentifier === entity.id ? true : rawIdentifier;
    const dataDelta = delta(entity.properties, data);
    if (dataDelta) rawDelta.data = dataDelta;
    const metadataDelta = delta(baseMetadata, rawMetadata);
    if (metadataDelta) rawDelta.metadata = metadataDelta;
    if (!rawProv) {
      (rawDelta.metadata ??= {}).remove = [...(rawDelta.metadata?.remove ?? []), 'provenance'];
    } else if (!isDeepStrictEqual(rawProv, entity.provenance))
      rawDelta.provenance = codec.pack(rawProv);
    insertEntity.run(
      ordinal + 1,
      entity.id,
      types.get(entity.kind)!,
      JSON.stringify(entity.properties),
      Object.keys(rawDelta).length ? JSON.stringify(rawDelta) : null,
      JSON.stringify(codec.pack(entity.provenance)),
      entity.narrative ?? null,
      rank,
    );
  });
  const predicates = new Map<string, number>();
  for (const relation of source.relations)
    if (!predicates.has(relation.relation)) predicates.set(relation.relation, predicates.size + 1);
  const inverse = new Map<string, string>();
  for (const name of predicates.keys()) {
    let value: string | undefined;
    for (const cls of Object.values(schema.classes)) {
      const slot = referenceSlot(schema, cls.name, name);
      if (slot) {
        value = slot.inverse;
        break;
      }
    }
    if (value) {
      inverse.set(name, value);
      if (!predicates.has(value)) predicates.set(value, predicates.size + 1);
    }
  }
  const insertPredicate = db.prepare('INSERT INTO lore_predicates VALUES(?,?,?,?)');
  let predicateRank = 0,
    lastPredicate: string | undefined;
  for (const name of [...predicates.keys()].sort((a, b) => a.localeCompare(b))) {
    if (lastPredicate === undefined || lastPredicate.localeCompare(name) !== 0) predicateRank++;
    lastPredicate = name;
    insertPredicate.run(
      predicates.get(name)!,
      name,
      predicateRank,
      inverse.has(name) ? predicates.get(inverse.get(name)!)! : null,
    );
  }
  db.exec(`DROP TABLE IF EXISTS temp.loaded_relations; DROP TABLE IF EXISTS temp.target_ids;
    CREATE TEMP TABLE target_ids(alias TEXT PRIMARY KEY,entity_id INTEGER NOT NULL) WITHOUT ROWID;
    INSERT INTO target_ids SELECT external_id,id FROM lore_entities;
    CREATE TEMP TABLE loaded_relations(id INTEGER PRIMARY KEY,source TEXT,target TEXT,predicate_id INTEGER,inferred INTEGER,generic INTEGER,provenance TEXT);`);
  const insertRelation = db.prepare('INSERT INTO loaded_relations VALUES(?,?,?,?,?,?,?)');
  source.relations.forEach((relation, ordinal) =>
    insertRelation.run(
      ordinal + 1,
      relation.from,
      relation.to,
      predicates.get(relation.relation)!,
      Number(relation.inferred),
      Number(relation.generic),
      relation.provenance ? JSON.stringify(codec.packDescriptor(relation.provenance)) : null,
    ),
  );
  db.exec(`INSERT INTO lore_relations SELECT r.id,f.entity_id,t.entity_id,r.predicate_id,r.inferred,r.generic,r.provenance
    FROM loaded_relations r JOIN target_ids f ON f.alias=r.source JOIN target_ids t ON t.alias=r.target;
    DROP TABLE loaded_relations; DROP TABLE target_ids;`);
  deriveGraph(db);
  for (const [name, target] of COMPACT_INDEXES) db.exec(`CREATE INDEX ${name} ON ${target}`);
  return {
    entityCount: source.entities.length,
    edgeCount: Number(db.prepare('SELECT count(*) n FROM lore_edges').get()!.n),
  };
}

function deriveGraph(db: DatabaseSync) {
  db.exec(`DROP TABLE IF EXISTS temp.graph_relations; DROP TABLE IF EXISTS temp.graph_presentations;
    CREATE TEMP TABLE graph_relations AS SELECT r.*,p.inverse_id,
      row_number() OVER(ORDER BY f.rank,p.rank,t.rank,r.inferred,r.id) AS graph_order,
      CASE WHEN r.inferred=0 THEN 1 ELSE NULL END AS unfolded
    FROM lore_relations r JOIN lore_predicates p ON p.id=r.predicate_id
      JOIN lore_entities f ON f.id=r.from_id JOIN lore_entities t ON t.id=r.to_id WHERE r.generic=0;
    CREATE INDEX graph_relation_key ON graph_relations(from_id,predicate_id,to_id,inferred,graph_order);
    UPDATE graph_relations AS r SET unfolded=0 WHERE r.inferred=1 AND EXISTS(
      SELECT 1 FROM graph_relations a WHERE a.from_id=r.to_id AND a.to_id=r.from_id AND a.predicate_id=r.inverse_id AND a.inferred=0);`);
  // Resolve inferred-only inverse chains in order. Normal builds fold in the
  // first statement; this also preserves orphan/self inferred presentations.
  const resolve = db.prepare(`UPDATE graph_relations AS r SET unfolded=CASE WHEN EXISTS(
    SELECT 1 FROM graph_relations a WHERE a.from_id=r.to_id AND a.to_id=r.from_id AND a.predicate_id=r.inverse_id AND a.inferred=1 AND a.graph_order<r.graph_order AND a.unfolded=1
    ) THEN 0 ELSE 1 END WHERE r.unfolded IS NULL AND NOT EXISTS(
    SELECT 1 FROM graph_relations a WHERE a.from_id=r.to_id AND a.to_id=r.from_id AND a.predicate_id=r.inverse_id AND a.inferred=1 AND a.graph_order<r.graph_order AND a.unfolded IS NULL)`);
  while (resolve.run().changes) {
    /* bounded by the loaded relation dependency order */
  }
  db.exec(`INSERT INTO lore_edges(id,relation_id,from_id,to_id,predicate_id,inferred)
    WITH candidates AS (SELECT r.*,row_number() OVER(PARTITION BY from_id,predicate_id,to_id ORDER BY inferred DESC,graph_order DESC) winner,
      min(graph_order) OVER(PARTITION BY from_id,predicate_id,to_id) creation_order FROM graph_relations r WHERE unfolded=1)
    SELECT row_number() OVER(ORDER BY f.rank,p.rank,t.rank,r.inferred,r.creation_order),r.id,r.from_id,r.to_id,r.predicate_id,r.inferred
    FROM candidates r JOIN lore_entities f ON f.id=r.from_id JOIN lore_entities t ON t.id=r.to_id JOIN lore_predicates p ON p.id=r.predicate_id WHERE winner=1;
    CREATE TEMP TABLE graph_presentations AS
    SELECT e.id edge_id,e.relation_id,e.from_id,e.to_id,e.predicate_id,e.inferred,1 base,0 presentation_order FROM lore_edges e
    UNION ALL
    SELECT e.id,r.id,r.from_id,r.to_id,r.predicate_id,r.inferred,0,r.graph_order FROM graph_relations r JOIN lore_edges e
      ON e.from_id=r.to_id AND e.to_id=r.from_id AND e.predicate_id=r.inverse_id WHERE r.unfolded=0
    UNION ALL
    SELECT e.id,NULL,e.to_id,e.from_id,p.inverse_id,1,0,2147483647 FROM lore_edges e JOIN lore_predicates p ON p.id=e.predicate_id
      WHERE e.inferred=0 AND p.inverse_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM graph_relations r WHERE r.from_id=e.to_id AND r.to_id=e.from_id AND r.predicate_id=p.inverse_id AND r.inferred=1);
    INSERT INTO lore_edge_presentations
    SELECT g.edge_id,row_number() OVER(PARTITION BY g.edge_id ORDER BY f.rank,p.rank,t.rank,g.inferred,g.presentation_order)-1,
      g.relation_id,g.from_id,g.to_id,g.predicate_id,g.inferred
    FROM graph_presentations g JOIN lore_entities f ON f.id=g.from_id JOIN lore_entities t ON t.id=g.to_id JOIN lore_predicates p ON p.id=g.predicate_id WHERE g.base=0;
    INSERT INTO lore_arcs
    WITH directions AS(SELECT from_id current_id,edge_id,to_id,predicate_id,1 mode FROM graph_presentations
      UNION SELECT to_id,edge_id,from_id,predicate_id,0 FROM graph_presentations)
    SELECT a.current_id,row_number() OVER(PARTITION BY a.current_id ORDER BY t.rank,ep.rank,ef.rank,et.rank,ap.rank,a.mode)-1,
      a.edge_id,a.to_id,a.predicate_id,a.mode
    FROM directions a JOIN lore_edges e ON e.id=a.edge_id JOIN lore_entities t ON t.id=a.to_id
      JOIN lore_predicates ep ON ep.id=e.predicate_id JOIN lore_entities ef ON ef.id=e.from_id JOIN lore_entities et ON et.id=e.to_id JOIN lore_predicates ap ON ap.id=a.predicate_id;
    DROP TABLE graph_presentations; DROP TABLE graph_relations;`);
}

export class CompactReader {
  readonly paths: PathCodec;
  private readonly identities = new Map<number, string>();
  private readonly predicates = new Map<number, string>();
  private readonly types = new Map<number, { name: string; uri: string }>();
  private readonly edgeCache = new Map<number, CanonicalGraphEdge>();
  private readonly edgeIds = new Map<string, number>();
  constructor(readonly db: DatabaseSync) {
    this.paths = new PathCodec(db);
    for (const r of db.prepare('SELECT * FROM lore_predicates').all())
      this.predicates.set(Number(r.id), String(r.name));
    for (const r of db.prepare('SELECT * FROM lore_types').all())
      this.types.set(Number(r.id), { name: String(r.name), uri: String(r.uri) });
  }
  predicate(id: number): string {
    return this.predicates.get(id)!;
  }
  edgeId(key: string): number | undefined {
    const cached = this.edgeIds.get(key);
    if (cached !== undefined) return cached;
    const [from, relation, to] = JSON.parse(key) as [string, string, string];
    const row = this.db
      .prepare(
        `SELECT e.id FROM lore_edges e WHERE from_id=(SELECT id FROM lore_entities WHERE external_id=?) AND to_id=(SELECT id FROM lore_entities WHERE external_id=?) AND predicate_id=(SELECT id FROM lore_predicates WHERE name=?)`,
      )
      .get(from, to, relation);
    return row ? Number(row.id) : undefined;
  }
  edgeById(id: number): CanonicalGraphEdge {
    return (
      this.edgeCache.get(id) ?? this.edge(this.db.prepare(`${EDGE_SELECT} WHERE e.id=?`).get(id)!)
    );
  }
  external(id: number): string {
    let value = this.identities.get(id);
    if (value === undefined) {
      value = String(
        this.db.prepare('SELECT external_id FROM lore_entities WHERE id=?').get(id)!.external_id,
      );
      this.identities.set(id, value);
    }
    return value;
  }
  entity(row: Record<string, unknown>): SourceEntity {
    const type = this.types.get(Number(row.type_id))!;
    this.identities.set(Number(row.id), String(row.external_id));
    return {
      id: String(row.external_id),
      kind: type.name,
      typeId: type.uri,
      properties: JSON.parse(String(row.properties)),
      provenance: this.paths.unpack(JSON.parse(String(row.provenance))),
    };
  }
  artifact(row: Record<string, unknown>, entity: SourceEntity): Artifact {
    const raw: RawDelta = row.raw_delta === null ? {} : JSON.parse(row.raw_delta as string);
    const base = baseArtifact(entity);
    const result = applyDelta(base, raw.metadata) as unknown as Artifact;
    result.data = applyDelta(entity.properties, raw.data);
    if (raw.identifier !== undefined)
      result.identifier = raw.identifier === true ? entity.id : raw.identifier;
    if (raw.provenance) result.provenance = this.paths.unpack(raw.provenance);
    return result;
  }
  relation(row: Record<string, unknown>): SemanticRelation {
    if (typeof row.external_from === 'string')
      this.identities.set(Number(row.from_id), row.external_from);
    if (typeof row.external_to === 'string')
      this.identities.set(Number(row.to_id), row.external_to);
    return {
      from: this.external(Number(row.from_id)),
      relation: this.predicates.get(Number(row.predicate_id))!,
      to: this.external(Number(row.to_id)),
      inferred: Boolean(row.inferred),
      generic: Boolean(row.generic),
      ...(row.provenance === null
        ? {}
        : { provenance: this.paths.descriptor(JSON.parse(row.provenance as string)) }),
    };
  }
  presentation(row: Record<string, unknown>): GraphRelationPresentation {
    const semantic = this.relation(row);
    const descriptor = semantic.provenance,
      span = descriptor?.span;
    return {
      from: semantic.from,
      relation: semantic.relation,
      to: semantic.to,
      inferred: semantic.inferred,
      ...(descriptor
        ? {
            provenance: {
              authority: 'filesystem',
              source: descriptor.source,
              location: descriptor.physicalPath,
              representation: descriptor.representation,
              ...(span
                ? {
                    span: {
                      line: span.line,
                      column: span.column,
                      ...(span.end_line === undefined ? {} : { endLine: span.end_line }),
                      ...(span.end_column === undefined ? {} : { endColumn: span.end_column }),
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  }
  edge(row: Record<string, unknown>): CanonicalGraphEdge {
    const cached = this.edgeCache.get(Number(row.id));
    if (cached) return cached;
    const base = this.presentation(row);
    const extras =
      row.has_presentations === 0
        ? []
        : this.db
            .prepare(
              `SELECT p.*,r.provenance FROM lore_edge_presentations p LEFT JOIN lore_relations r ON r.id=p.relation_id WHERE p.edge_id=? ORDER BY p.ordinal`,
            )
            .all(Number(row.id))
            .map((r) => this.presentation(r));
    const presentations = [base, ...extras].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.relation.localeCompare(b.relation) ||
        a.to.localeCompare(b.to) ||
        Number(a.inferred) - Number(b.inferred),
    );
    const edge = {
      key: JSON.stringify([base.from, base.relation, base.to]),
      ...base,
      presentations,
    };
    this.edgeCache.set(Number(row.id), edge);
    this.edgeIds.set(edge.key, Number(row.id));
    return edge;
  }
}
export const EDGE_COLUMNS = `e.*,r.provenance,f.external_id AS external_from,t.external_id AS external_to,
  EXISTS(SELECT 1 FROM lore_edge_presentations x WHERE x.edge_id=e.id) AS has_presentations`;
export const EDGE_JOINS = `JOIN lore_relations r ON r.id=e.relation_id
  JOIN lore_entities f ON f.id=e.from_id JOIN lore_entities t ON t.id=e.to_id`;
export const EDGE_SELECT = `SELECT ${EDGE_COLUMNS} FROM lore_edges e ${EDGE_JOINS}`;
