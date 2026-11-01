import { referencePaths } from '@khaale/lore-schema';
import type { HierarchyReader } from './hierarchy.js';
import type { HierarchyInput } from '@khaale/lore-graph';
import { resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Artifact, IndexV2, SemanticRelation } from '@khaale/lore-core';
import type { RuntimeSchemaIR } from '@khaale/lore-schema';
import { CompactReader, EDGE_SELECT, EDGE_COLUMNS, EDGE_JOINS } from './sqlite-storage.js';
import {
  SDK_LIMITS,
  SdkError,
  ReadSnapshotImpl,
  type ReadSource,
  type SourceEntity,
  type GraphView,
  type GraphArc,
  type NormalizedGraphOptions,
  type SnapshotInfo,
  type ReadSnapshot,
  type QueryOptions,
  type SearchOptions,
  type ExploreOptions,
  type GraphInput,
  type GraphOptions,
  type NeighborhoodOptions,
  type GetOptions,
  type TypeCatalogOptions,
} from './reader.js';
import {
  openSqliteDatabase,
  retrySqliteBusy,
  readSqliteMetadata,
  statusFrom,
  refreshSqliteIndex,
  SqliteIndexError,
  SQLITE_ERROR,
  validateRefreshOptions,
  type SqliteMetadata,
  type SqliteIndexStatus,
} from './sqlite-index.js';

export const SQLITE_FRESHNESS = { INDEXED: 'indexed', REFRESH_ON_READ: 'refresh-on-read' } as const;
export const SOURCE_FRESHNESS = { NOT_CHECKED: 'not-checked', CHECKED: 'checked' } as const;
export type IndexedSnapshotInfo = {
  kind: 'sqlite-generation';
  generationId: string;
  schemaHash: string;
  sourceFreshness: (typeof SOURCE_FRESHNESS)[keyof typeof SOURCE_FRESHNESS];
  checkedAt?: number;
};
export type IndexedResult<T extends { snapshot: SnapshotInfo }> = Omit<T, 'snapshot'> & {
  snapshot: IndexedSnapshotInfo;
};
type IndexedMethod<F> = F extends (
  ...args: infer A
) => Promise<infer R extends { snapshot: SnapshotInfo }>
  ? (...args: A) => Promise<IndexedResult<R>>
  : never;
type IndexedMethods<T> = { [K in keyof T]: IndexedMethod<T[K]> };
export type IndexedReadSnapshot = IndexedMethods<
  Pick<ReadSnapshot, 'describe' | 'query' | 'search' | 'explore'>
> & {
  readonly snapshot: IndexedSnapshotInfo;
  readonly schema: IndexedMethods<ReadSnapshot['schema']>;
  readonly entities: IndexedMethods<ReadSnapshot['entities']>;
  readonly graph: IndexedMethods<ReadSnapshot['graph']>;
  readonly hierarchy: IndexedMethods<HierarchyReader>;
};
export type SqliteWorkspaceOptions = {
  indexPath: string;
  freshness: { mode: 'indexed' } | { mode: 'refresh-on-read'; maxAgeMs?: number };
  busyTimeoutMs?: number;
  maxPageSize?: number;
  maxScanBudget?: number;
  maxNarrativeBytes?: number;
};
export type SqliteWorkspace = Omit<IndexedReadSnapshot, 'snapshot'> & {
  readSnapshot<T>(callback: (read: IndexedReadSnapshot) => T | Promise<T>): Promise<T>;
  status(): Promise<SqliteIndexStatus>;
  close(): Promise<void>;
};

function sqliteSource(
  db: DatabaseSync,
  meta: SqliteMetadata,
  options: SqliteWorkspaceOptions,
  check: () => void,
): ReadSource {
  const schema = JSON.parse(
    String(db.prepare('SELECT value FROM lore_model WHERE id=1').get()!.value),
  ) as RuntimeSchemaIR;
  const cache = new Map<string, SourceEntity>();
  const artifacts = new Map<string, Artifact>();
  const relations = new Map<string, SemanticRelation[]>();
  const compact = new CompactReader(db);
  const readNarrative = db.prepare('SELECT narrative FROM lore_entities WHERE external_id=?');
  const decodeEntity = (row: Record<string, unknown>): SourceEntity => {
    const entity = compact.entity(row);
    artifacts.set(entity.id, compact.artifact(row, entity));
    let loaded = false;
    let narrative: string | undefined;
    Object.defineProperty(entity, 'narrative', {
      get() {
        check();
        if (!loaded) {
          const value = readNarrative.get(entity.id)?.narrative;
          narrative = typeof value === 'string' ? value : undefined;
          loaded = true;
        }
        return narrative;
      },
    });
    cache.set(entity.id, entity);
    return entity;
  };
  const entityStatement = db.prepare('SELECT * FROM lore_entities WHERE external_id=?');
  const get = (id: string): SourceEntity | undefined => {
    check();
    if (cache.has(id)) return cache.get(id);
    const row = entityStatement.get(id);
    return row ? decodeEntity(row) : undefined;
  };
  const index: IndexV2 = {
    version: 2,
    schema_hash: meta.schemaHash,
    artifacts: {},
    edges: [],
    diagnostics: [],
  };
  const source: ReadSource = {
    root: meta.config.root,
    authority: 'filesystem',
    schema,
    schemaIdentity: {
      name: schema.name,
      ...(schema.schemaId === undefined ? {} : { id: schema.schemaId }),
      hash: meta.schemaHash,
    },
    entities: [],
    entitiesById: { get, has: (id) => get(id) !== undefined },
    relations: [],
    relationsByEntity: {
      get(id) {
        check();
        if (!relations.has(id)) {
          const values = db
            .prepare(
              'SELECT * FROM lore_relations WHERE from_id=(SELECT id FROM lore_entities WHERE external_id=?) OR to_id=(SELECT id FROM lore_entities WHERE external_id=?) ORDER BY id',
            )
            .all(id, id)
            .map((row) => compact.relation(row))
            .filter((value) => !value.generic);
          relations.set(id, values);
        }
        return relations.get(id);
      },
    },
    index,
    // This private identity feeds shared continuation code; public envelopes use IndexedSnapshotInfo.
    state: {
      id: `sqlite:${meta.generationId}`,
      authority: 'filesystem',
      schemaHash: meta.schemaHash,
      freshness: 'saved-indexed',
    },
    maxPageSize: options.maxPageSize ?? SDK_LIMITS.maxPageSize,
    maxScanBudget: options.maxScanBudget ?? SDK_LIMITS.maxScanBudget,
    maxNarrativeBytes: options.maxNarrativeBytes ?? SDK_LIMITS.maxNarrativeBytes,
    revalidate: check,
    storage: {
      count: meta.entityCount,
      scan(position, count) {
        check();
        return db
          .prepare('SELECT * FROM lore_entities WHERE id>? ORDER BY id LIMIT ?')
          .all(position, count)
          .map(decodeEntity);
      },
      artifact(id) {
        get(id);
        return artifacts.get(id);
      },
      fullIndex() {
        check();
        const all: IndexV2 = { ...index, artifacts: {}, edges: [] };
        for (const row of db.prepare('SELECT * FROM lore_entities ORDER BY id').iterate()) {
          const artifact = compact.artifact(row, compact.entity(row));
          if (typeof row.narrative === 'string') artifact.body = row.narrative;
          all.artifacts[artifact.id] = artifact;
        }
        all.edges = db
          .prepare('SELECT * FROM lore_relations ORDER BY id')
          .all()
          .map((row) => compact.relation(row));
        return all;
      },
    },
  };
  source.hierarchyInput = (): HierarchyInput => ({
    root: meta.config.root,
    schema,
    *nodes() {
      check();
      for (const row of db
        .prepare(
          'SELECT e.external_id,e.provenance,t.name AS type FROM lore_entities e JOIN lore_types t ON t.id=e.type_id ORDER BY e.id',
        )
        .iterate()) {
        const p = compact.paths.unpack(JSON.parse(String(row.provenance)));
        const file = p.physicalPath;
        yield {
          id: String(row.external_id),
          type: String(row.type),
          file,
          source: p.source.includes('#') ? file + p.source.slice(p.source.indexOf('#')) : file,
        };
      }
    },
    *links() {
      check();
      const sql = `SELECT f.external_id AS source,p.name AS predicate,t.external_id AS target FROM lore_edges e JOIN lore_entities f ON f.id=e.from_id JOIN lore_entities t ON t.id=e.to_id JOIN lore_predicates p ON p.id=e.predicate_id
        UNION SELECT f.external_id,p.name,t.external_id FROM lore_edge_presentations e JOIN lore_entities f ON f.id=e.from_id JOIN lore_entities t ON t.id=e.to_id JOIN lore_predicates p ON p.id=e.predicate_id`;
      for (const row of db.prepare(sql).iterate())
        yield { from: String(row.source), relation: String(row.predicate), to: String(row.target) };
    },
    property: (id, field) => {
      check();
      return get(id)?.properties[field];
    },
  });
  let graph: GraphView | undefined;
  source.graphView = () => {
    check();
    graph ??= sqliteGraph(db, source, meta, compact);
    return graph;
  };
  return source;
}

function sqliteGraph(
  db: DatabaseSync,
  source: ReadSource,
  meta: SqliteMetadata,
  compact: CompactReader,
): GraphView {
  const edges = {
    length: meta.edgeCount,
    *[Symbol.iterator]() {
      for (const row of db.prepare(`${EDGE_SELECT} ORDER BY e.id`).iterate())
        yield compact.edge(row);
    },
  };
  const arcSelect = `SELECT ${EDGE_COLUMNS},a.current_id,a.to_id AS arc_to,a.predicate_id AS arc_predicate,a.mode FROM lore_arcs a JOIN lore_edges e ON e.id=a.edge_id ${EDGE_JOINS}`;
  const arcsForEdge = db.prepare(
    'SELECT current_id,to_id,predicate_id,mode FROM lore_arcs WHERE edge_id=? ORDER BY current_id,ordinal',
  );
  const decodeArc = (row: Record<string, unknown>): GraphArc => {
    const edge = compact.edge(row);
    return {
      from: compact.external(Number(row.current_id)),
      to: compact.external(Number(row.arc_to)),
      relation: compact.predicate(Number(row.arc_predicate)),
      mode: row.mode ? 'out' : 'in',
      edge,
    };
  };
  return {
    edges,
    byId: { get: (id) => source.entitiesById.get(id), size: meta.entityCount },
    relationNames: new Set(
      Object.values(source.schema.classes).flatMap((c) =>
        referencePaths(source.schema, c.name).map((r) => r.path),
      ),
    ),
    arcsByCurrent: {
      get: (id) =>
        db
          .prepare(
            `${arcSelect} WHERE a.current_id=(SELECT id FROM lore_entities WHERE external_id=?) ORDER BY a.ordinal`,
          )
          .all(id)
          .map(decodeArc),
    },
    arcsByEdge: {
      get(key) {
        const id = compact.edgeId(key);
        if (id === undefined) return undefined;
        const edge = compact.edgeById(id);
        return arcsForEdge.all(id).map((row) => ({
          edge,
          from: compact.external(Number(row.current_id)),
          to: compact.external(Number(row.to_id)),
          relation: compact.predicate(Number(row.predicate_id)),
          mode: row.mode ? ('out' as const) : ('in' as const),
        }));
      },
    },
    *arcs(current: string, options: NormalizedGraphOptions) {
      const parameters: SQLInputValue[] = [current];
      const conditions = ['a.current_id=(SELECT id FROM lore_entities WHERE external_id=?)'];
      if (options.relations) {
        conditions.push(
          `a.predicate_id IN (SELECT id FROM lore_predicates WHERE name IN (${[...options.relations].map(() => '?').join(',')}))`,
        );
        parameters.push(...options.relations);
      }
      if (options.direction !== 'both') {
        conditions.push('a.mode=?');
        parameters.push(options.direction === 'out' ? 1 : 0);
      }
      const seen = new Set<string>();
      for (const row of db
        .prepare(`${arcSelect} WHERE ${conditions.join(' AND ')} ORDER BY a.ordinal`)
        .iterate(...parameters)) {
        const arc = decodeArc(row);
        const key = JSON.stringify([arc.edge.key, arc.from, arc.to]);
        if (!seen.has(key)) {
          seen.add(key);
          yield arc;
        }
      }
    },
    *candidates(ids: Set<string>) {
      if (!ids.size) return;
      // Every graph result predicate requires both endpoints in the selected scope.
      // Filter before decoding provenance-heavy candidates at large hubs.
      const parameters = [...ids];
      const slots = parameters.map(() => '?').join(',');
      for (const row of db
        .prepare(
          `${EDGE_SELECT} WHERE e.from_id IN (SELECT id FROM lore_entities WHERE external_id IN (${slots})) AND e.to_id IN (SELECT id FROM lore_entities WHERE external_id IN (${slots})) ORDER BY e.id`,
        )
        .iterate(...parameters, ...parameters))
        yield compact.edge(row);
    },
  };
}

function indexedReader(
  read: ReadSnapshotImpl,
  snapshot: IndexedSnapshotInfo,
  check: () => void,
): IndexedReadSnapshot {
  async function result<T extends { snapshot: SnapshotInfo }>(
    work: () => Promise<T>,
  ): Promise<IndexedResult<T>> {
    check();
    const value = await work();
    check();
    return { ...structuredClone(value), snapshot: structuredClone(snapshot) };
  }
  return {
    get snapshot() {
      check();
      return structuredClone(snapshot);
    },
    hierarchy: {
      propose: (options) => result(() => read.hierarchy.propose(options)),
      read: (options) => result(() => read.hierarchy.read(options)),
    },
    describe: () => result(() => read.describe()),
    query: (options: QueryOptions) => result(() => read.query(options)),
    search: (options: SearchOptions) => result(() => read.search(options)),
    explore: (options: ExploreOptions) => result(() => read.explore(options)),
    schema: {
      listTypes: (options: TypeCatalogOptions = {}) => result(() => read.schema.listTypes(options)),
      describeType: (type: string) => result(() => read.schema.describeType(type)),
    },
    entities: {
      get: (id: string, options: GetOptions = {}) => result(() => read.entities.get(id, options)),
      getMany: (ids: readonly string[], options: GetOptions = {}) =>
        result(() => read.entities.getMany(ids, options)),
    },
    graph: {
      neighbors: (input: GraphInput, options: GraphOptions = {}) =>
        result(() => read.graph.neighbors(input, options)),
      neighborhood: (input: GraphInput, options: NeighborhoodOptions) =>
        result(() => read.graph.neighborhood(input, options)),
      subgraph: (input: GraphInput, options: GraphOptions = {}) =>
        result(() => read.graph.subgraph(input, options)),
      boundary: (input: GraphInput, options: GraphOptions = {}) =>
        result(() => read.graph.boundary(input, options)),
    },
  };
}

class SqliteWorkspaceImpl implements SqliteWorkspace {
  private closed = false;
  private readonly active = new Set<Promise<void>>();
  constructor(private readonly options: SqliteWorkspaceOptions) {}
  private check(): void {
    if (this.closed)
      throw new SqliteIndexError(SQLITE_ERROR.SNAPSHOT_CLOSED, 'SQLite workspace is closed');
  }
  async readSnapshot<T>(callback: (read: IndexedReadSnapshot) => T | Promise<T>): Promise<T> {
    this.check();
    let finish!: () => void;
    const lifetime = new Promise<void>((done) => {
      finish = done;
    });
    this.active.add(lifetime);
    let db: DatabaseSync | undefined;
    let reading = false;
    let alive = true;
    let scopedRead: ReadSnapshotImpl | undefined;
    try {
      const accepted =
        this.options.freshness.mode === SQLITE_FRESHNESS.REFRESH_ON_READ
          ? await refreshSqliteIndex({
              indexPath: this.options.indexPath,
              ...(this.options.freshness.maxAgeMs === undefined
                ? {}
                : { maxAgeMs: this.options.freshness.maxAgeMs }),
              ...(this.options.busyTimeoutMs === undefined
                ? {}
                : { busyTimeoutMs: this.options.busyTimeoutMs }),
            })
          : undefined;
      const scope = await retrySqliteBusy(() => {
        const connection = openSqliteDatabase(this.options.indexPath);
        try {
          connection.exec('BEGIN');
          const meta = readSqliteMetadata(connection);
          return { connection, meta };
        } catch (error) {
          // Closing the failed attempt also discards its transaction before yielding.
          connection.close();
          throw error;
        }
      }, this.options.busyTimeoutMs ?? 5000);
      db = scope.connection;
      reading = true;
      const meta = scope.meta;
      if (
        accepted &&
        (meta.lastAttempt.status !== 'success' || meta.checkedAt < accepted.checkedAt)
      )
        throw new SqliteIndexError(
          SQLITE_ERROR.REFRESH_FAILED,
          'Selected generation has no acceptable successful source check',
        );
      const state: IndexedSnapshotInfo = {
        kind: 'sqlite-generation',
        generationId: meta.generationId,
        schemaHash: meta.schemaHash,
        sourceFreshness: accepted ? SOURCE_FRESHNESS.CHECKED : SOURCE_FRESHNESS.NOT_CHECKED,
        ...(accepted ? { checkedAt: meta.checkedAt } : {}),
      };
      const check = () => {
        if (!alive)
          throw new SqliteIndexError(
            SQLITE_ERROR.SNAPSHOT_CLOSED,
            'SQLite read scope has completed',
          );
      };
      scopedRead = new ReadSnapshotImpl(sqliteSource(db, meta, this.options, check), false, true);
      return await callback(indexedReader(scopedRead, state, check));
    } finally {
      scopedRead?.dispose();
      alive = false;
      try {
        if (reading) db!.exec('ROLLBACK');
      } finally {
        try {
          db?.close();
        } finally {
          this.active.delete(lifetime);
          finish();
        }
      }
    }
  }
  async status(): Promise<SqliteIndexStatus> {
    this.check();
    return retrySqliteBusy(() => {
      const db = openSqliteDatabase(this.options.indexPath);
      try {
        return statusFrom(readSqliteMetadata(db));
      } finally {
        db.close();
      }
    }, this.options.busyTimeoutMs ?? 5000);
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.active);
  }
  describe() {
    return this.readSnapshot((read) => read.describe());
  }
  query(options: QueryOptions) {
    return this.readSnapshot((read) => read.query(options));
  }
  search(options: SearchOptions) {
    return this.readSnapshot((read) => read.search(options));
  }
  explore(options: ExploreOptions) {
    return this.readSnapshot((read) => read.explore(options));
  }
  readonly schema = {
    listTypes: (options: TypeCatalogOptions = {}) =>
      this.readSnapshot((read) => read.schema.listTypes(options)),
    describeType: (type: string) => this.readSnapshot((read) => read.schema.describeType(type)),
  };
  readonly hierarchy = {
    propose: (options?: Parameters<HierarchyReader['propose']>[0]) =>
      this.readSnapshot((read) => read.hierarchy.propose(options)),
    read: (options: Parameters<HierarchyReader['read']>[0]) =>
      this.readSnapshot((read) => read.hierarchy.read(options)),
  };
  readonly entities = {
    get: (id: string, options: GetOptions = {}) =>
      this.readSnapshot((read) => read.entities.get(id, options)),
    getMany: (ids: readonly string[], options: GetOptions = {}) =>
      this.readSnapshot((read) => read.entities.getMany(ids, options)),
  };
  readonly graph = {
    neighbors: (input: GraphInput, options: GraphOptions = {}) =>
      this.readSnapshot((read) => read.graph.neighbors(input, options)),
    neighborhood: (input: GraphInput, options: NeighborhoodOptions) =>
      this.readSnapshot((read) => read.graph.neighborhood(input, options)),
    subgraph: (input: GraphInput, options: GraphOptions = {}) =>
      this.readSnapshot((read) => read.graph.subgraph(input, options)),
    boundary: (input: GraphInput, options: GraphOptions = {}) =>
      this.readSnapshot((read) => read.graph.boundary(input, options)),
  };
}
export async function openSqliteWorkspace(
  options: SqliteWorkspaceOptions,
): Promise<SqliteWorkspace> {
  if (!options.freshness || !Object.values(SQLITE_FRESHNESS).includes(options.freshness.mode))
    throw new SdkError(
      'INVALID_ARGUMENT',
      'Choose an explicit indexed or refresh-on-read SQLite policy',
    );
  validateRefreshOptions({
    indexPath: options.indexPath,
    ...(options.freshness.mode === SQLITE_FRESHNESS.REFRESH_ON_READ &&
    options.freshness.maxAgeMs !== undefined
      ? { maxAgeMs: options.freshness.maxAgeMs }
      : {}),
    ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
  });
  for (const name of ['maxPageSize', 'maxScanBudget', 'maxNarrativeBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new SdkError('INVALID_LIMIT', `${name} must be a positive safe integer`);
  }
  const workspace = new SqliteWorkspaceImpl({
    ...options,
    indexPath: resolve(options.indexPath),
    freshness: { ...options.freshness },
  });
  await workspace.status();
  return workspace;
}
