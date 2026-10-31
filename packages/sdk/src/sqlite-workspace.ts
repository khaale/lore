import { referencePaths } from '@khaale/lore-schema';
import { resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Artifact, IndexV2, SemanticRelation } from '@khaale/lore-core';
import type { RuntimeSchemaIR } from '@khaale/lore-schema';
import {
  SDK_LIMITS,
  SdkError,
  ReadSnapshotImpl,
  type ReadSource,
  type SourceEntity,
  type GraphView,
  type GraphArc,
  type CanonicalGraphEdge,
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
  const readNarrative = db.prepare('SELECT narrative FROM lore_entities WHERE id=?');
  const decodeEntity = (row: Record<string, unknown>): SourceEntity => {
    const entity = JSON.parse(String(row.entity)) as SourceEntity;
    artifacts.set(entity.id, JSON.parse(String(row.artifact)) as Artifact);
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
  const entityStatement = db.prepare('SELECT entity,artifact FROM lore_entities WHERE id=?');
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
            .prepare('SELECT value FROM lore_relations WHERE from_id=? OR to_id=? ORDER BY rowid')
            .all(id, id)
            .map((row) => JSON.parse(String(row.value)) as SemanticRelation)
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
          .prepare(
            'SELECT entity,artifact FROM lore_entities WHERE ordinal>=? ORDER BY ordinal LIMIT ?',
          )
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
        for (const row of db
          .prepare('SELECT id,artifact,narrative FROM lore_entities ORDER BY ordinal')
          .iterate()) {
          const artifact = JSON.parse(String(row.artifact)) as Artifact;
          if (typeof row.narrative === 'string') artifact.body = row.narrative;
          all.artifacts[String(row.id)] = artifact;
        }
        all.edges = db
          .prepare('SELECT value FROM lore_relations ORDER BY rowid')
          .all()
          .map((row) => JSON.parse(String(row.value)) as SemanticRelation);
        return all;
      },
    },
  };
  let graph: GraphView | undefined;
  source.graphView = () => {
    check();
    graph ??= sqliteGraph(db, source, meta);
    return graph;
  };
  return source;
}

function sqliteGraph(db: DatabaseSync, source: ReadSource, meta: SqliteMetadata): GraphView {
  const edges = {
    length: meta.edgeCount,
    *[Symbol.iterator]() {
      for (const row of db.prepare('SELECT value FROM lore_edges ORDER BY ordinal').iterate())
        yield JSON.parse(String(row.value)) as CanonicalGraphEdge;
    },
  };
  const arcSelect = `SELECT a.from_id,a.to_id,a.relation,a.mode,e.value FROM lore_arcs a JOIN lore_edges e ON e.edge_key=a.edge_key`;
  const decodeArc = (row: Record<string, unknown>): GraphArc => ({
    from: String(row.from_id),
    to: String(row.to_id),
    relation: String(row.relation),
    mode: row.mode as 'in' | 'out',
    edge: JSON.parse(String(row.value)) as CanonicalGraphEdge,
  });
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
        db.prepare(`${arcSelect} WHERE a.current_id=? ORDER BY a.ordinal`).all(id).map(decodeArc),
    },
    arcsByEdge: {
      get: (id) =>
        db
          .prepare(`${arcSelect} WHERE a.edge_key=? ORDER BY a.current_id,a.ordinal`)
          .all(id)
          .map(decodeArc),
    },
    *arcs(current: string, options: NormalizedGraphOptions) {
      const parameters: SQLInputValue[] = [current];
      const conditions = ['a.current_id=?'];
      if (options.relations) {
        conditions.push(`a.relation IN (${[...options.relations].map(() => '?').join(',')})`);
        parameters.push(...options.relations);
      }
      if (options.direction !== 'both') {
        conditions.push('a.mode=?');
        parameters.push(options.direction);
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
      const parameters = [...ids];
      const slots = parameters.map(() => '?').join(',');
      for (const row of db
        .prepare(
          `SELECT value FROM lore_edges WHERE from_id IN (${slots}) OR to_id IN (${slots}) ORDER BY ordinal`,
        )
        .iterate(...parameters, ...parameters))
        yield JSON.parse(String(row.value)) as CanonicalGraphEdge;
    },
  };
}

function indexedReader(
  source: ReadSource,
  snapshot: IndexedSnapshotInfo,
  check: () => void,
): IndexedReadSnapshot {
  const read = new ReadSnapshotImpl(source);
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
      return await callback(
        indexedReader(sqliteSource(db, meta, this.options, check), state, check),
      );
    } finally {
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
