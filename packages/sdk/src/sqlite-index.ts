import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGraph, checkReport, type Diagnostic, type IndexV2 } from '@khaale/lore-core';
import { compileSchema, type RuntimeSchemaIR } from '@khaale/lore-schema';
import {
  discover,
  MODEL_FILENAMES,
  parseFile,
  resolveSchemaPath,
  snapshot,
  type FileStamp,
} from '@khaale/lore-filesystem';
import { canonicalGraphView, projectionSource } from './reader.js';

export const SQLITE_ERROR = {
  INDEX_NOT_FOUND: 'INDEX_NOT_FOUND',
  INDEX_BUSY: 'INDEX_BUSY',
  INDEX_REBUILD_REQUIRED: 'INDEX_REBUILD_REQUIRED',
  REFRESH_BUSY: 'REFRESH_BUSY',
  REFRESH_FAILED: 'REFRESH_FAILED',
  SNAPSHOT_CLOSED: 'SNAPSHOT_CLOSED',
} as const;
export type SqliteIndexErrorCode = (typeof SQLITE_ERROR)[keyof typeof SQLITE_ERROR];
export class SqliteIndexError extends Error {
  constructor(
    readonly code: SqliteIndexErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SqliteIndexError';
  }
}
export const REFRESH_OUTCOME = {
  UNCHANGED: 'unchanged',
  UPDATED: 'updated',
  REUSED: 'reused',
} as const;
export type SqliteSourceConfig = {
  root: string;
  schemaPath?: string;
  ignorePath: string;
  strict: boolean;
};
type Attempt = {
  sequence: number;
  completedAt: number;
  status: 'success' | 'failed';
  message?: string;
  diagnostics?: unknown;
};
export type SqliteIndexStatus = {
  generationId: string;
  schemaHash: string;
  checkedAt: number;
  lastAttempt: Attempt;
};
export type SqliteMetadata = SqliteIndexStatus & {
  version: 1;
  config: SqliteSourceConfig;
  dependencies: string[];
  entityCount: number;
  edgeCount: number;
};
export type RefreshSqliteOptions = { indexPath: string; maxAgeMs?: number; busyTimeoutMs?: number };
export type SqliteRefreshResult = SqliteIndexStatus & {
  outcome: (typeof REFRESH_OUTCOME)[keyof typeof REFRESH_OUTCOME];
};
export type InitializeSqliteOptions = {
  indexPath: string;
  root: string;
  schemaPath?: string;
  ignorePath?: string;
  strict?: boolean;
  busyTimeoutMs?: number;
};

const VERSION = 1;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS lore_meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_model (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lore_inputs (path TEXT PRIMARY KEY, size REAL NOT NULL, mtime REAL NOT NULL);
CREATE TABLE IF NOT EXISTS lore_entities (
  id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, type TEXT NOT NULL,
  entity TEXT NOT NULL, artifact TEXT NOT NULL, narrative TEXT
);
CREATE INDEX IF NOT EXISTS lore_entities_type ON lore_entities(type, ordinal);
CREATE TABLE IF NOT EXISTS lore_relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lore_relations_from ON lore_relations(from_id);
CREATE INDEX IF NOT EXISTS lore_relations_to ON lore_relations(to_id);
CREATE TABLE IF NOT EXISTS lore_edges (
  edge_key TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, from_id TEXT NOT NULL, to_id TEXT NOT NULL, value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lore_edges_from ON lore_edges(from_id);
CREATE INDEX IF NOT EXISTS lore_edges_to ON lore_edges(to_id);
CREATE TABLE IF NOT EXISTS lore_arcs (
  current_id TEXT NOT NULL, ordinal INTEGER NOT NULL, edge_key TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL, mode TEXT NOT NULL,
  PRIMARY KEY(current_id, ordinal)
);
CREATE INDEX IF NOT EXISTS lore_arcs_edge ON lore_arcs(edge_key);
`;

export function validateRefreshOptions(options: RefreshSqliteOptions): {
  maxAgeMs: number;
  busyTimeoutMs: number;
} {
  const maxAgeMs = options.maxAgeMs ?? 0;
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  for (const [name, value] of Object.entries({ maxAgeMs, busyTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new SqliteIndexError(
        SQLITE_ERROR.REFRESH_FAILED,
        `${name} must be a non-negative safe integer`,
      );
  }
  return { maxAgeMs, busyTimeoutMs };
}
export function readSqliteMetadata(db: DatabaseSync): SqliteMetadata {
  let row: Record<string, unknown> | undefined;
  try {
    row = db.prepare('SELECT value FROM lore_meta WHERE id=1').get();
  } catch (cause) {
    if (isSqliteBusy(cause)) throw cause;
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
      'Not a supported Lore SQLite index; rebuild with lore index --format sqlite',
      {},
      { cause },
    );
  }
  if (!row)
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_NOT_FOUND,
      'No published SQLite generation; initialize with lore index --format sqlite',
    );
  let value: SqliteMetadata;
  try {
    value = JSON.parse(String(row.value)) as SqliteMetadata;
  } catch (cause) {
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
      'Invalid SQLite metadata; rebuild the index',
      {},
      { cause },
    );
  }
  if (value.version !== VERSION || !value.generationId || !value.config || !value.lastAttempt)
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
      'Unsupported SQLite projection version; rebuild the index',
    );
  try {
    // Validate storage shape without loading entity, narrative or graph contents.
    db.prepare(
      `SELECT m.value,e.entity,e.artifact,e.narrative,g.value,a.edge_key,r.value,i.path
      FROM lore_model m,lore_entities e,lore_edges g,lore_arcs a,lore_relations r,lore_inputs i LIMIT 0`,
    ).all();
    if (!db.prepare('SELECT 1 FROM lore_model WHERE id=1').get())
      throw new Error('Missing read model');
  } catch (cause) {
    if (isSqliteBusy(cause)) throw cause;
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
      'Incomplete SQLite projection; rebuild the index',
      {},
      { cause },
    );
  }
  return value;
}
export function openSqliteDatabase(path: string, readOnly = true): DatabaseSync {
  if (!existsSync(path))
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_NOT_FOUND,
      'SQLite index not found; initialize with lore index --format sqlite',
      { indexPath: path },
    );
  try {
    return new DatabaseSync(path, { readOnly });
  } catch (cause) {
    if (isSqliteBusy(cause)) throw cause;
    throw new SqliteIndexError(
      SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
      'Cannot open SQLite index; check the path or rebuild it',
      {},
      { cause },
    );
  }
}
export function statusFrom(metadata: SqliteMetadata): SqliteIndexStatus {
  return {
    generationId: metadata.generationId,
    schemaHash: metadata.schemaHash,
    checkedAt: metadata.checkedAt,
    lastAttempt: structuredClone(metadata.lastAttempt),
  };
}
function saveMetadata(db: DatabaseSync, value: SqliteMetadata): void {
  db.prepare('INSERT OR REPLACE INTO lore_meta(id,value) VALUES(1,?)').run(JSON.stringify(value));
}
function isSqliteBusy(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object'
      ? (error as { errcode?: number }).errcode
      : undefined;
  return typeof code === 'number' && ((code & 255) === 5 || (code & 255) === 6);
}
/** Retry only synchronous SQLite entry/ownership work, never an entered caller callback. */
export async function retrySqliteBusy<T>(
  work: () => T,
  timeout: number,
  code: 'INDEX_BUSY' | 'REFRESH_BUSY' = SQLITE_ERROR.INDEX_BUSY,
): Promise<T> {
  const deadline = performance.now() + timeout;
  for (;;) {
    try {
      return work();
    } catch (cause) {
      if (!isSqliteBusy(cause)) throw cause;
      if (performance.now() >= deadline) {
        throw new SqliteIndexError(
          code,
          code === SQLITE_ERROR.REFRESH_BUSY
            ? 'SQLite refresh ownership timed out'
            : 'SQLite index access timed out',
          { busyTimeoutMs: timeout },
          { cause },
        );
      }
      await new Promise<void>((done) =>
        setTimeout(done, Math.min(10, Math.max(1, deadline - performance.now()))),
      );
    }
  }
}

async function inputs(
  config: SqliteSourceConfig,
  indexPath: string,
  dependencies: string[],
): Promise<FileStamp[]> {
  const schemaPath = await resolveSchemaPath(config.root, config.schemaPath);
  return snapshot({
    root: config.root,
    schemaPath,
    ignorePath: config.ignorePath,
    outputPath: indexPath,
    dependencies: [
      ...dependencies,
      ...(config.schemaPath === undefined
        ? MODEL_FILENAMES.map((name) => join(config.root, name))
        : []),
    ],
  });
}
function baseline(db: DatabaseSync): FileStamp[] {
  return db
    .prepare('SELECT path,size,mtime FROM lore_inputs ORDER BY path')
    .all()
    .map((row) => ({ path: String(row.path), size: Number(row.size), mtimeMs: Number(row.mtime) }));
}
function sameInputs(left: FileStamp[], right: FileStamp[]): boolean {
  const sort = (values: FileStamp[]) => [...values].sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}
async function compile(path: string) {
  const result = await compileSchema(path);
  if (!result.ok)
    throw new SqliteIndexError(SQLITE_ERROR.REFRESH_FAILED, 'Schema compilation failed', {
      diagnostics: result.diagnostics,
    });
  return result.value;
}
async function build(config: SqliteSourceConfig, indexPath: string) {
  const schemaPath = await resolveSchemaPath(config.root, config.schemaPath);
  // Discover the candidate closure, then observe it before the authoritative compile/build.
  const preliminary = await compile(schemaPath);
  const before = await inputs(config, indexPath, preliminary.dependencies);
  const compiled = await compile(schemaPath);
  const files = await discover({
    root: config.root,
    schemaPath,
    ignorePath: config.ignorePath,
    outputPath: indexPath,
    dependencies: compiled.dependencies,
  });
  const candidates = [];
  const failures: Diagnostic[] = [];
  for (const path of files) {
    try {
      candidates.push(...(await parseFile(path)));
    } catch (error) {
      failures.push({ severity: 'error', code: 'PARSE', source: path, message: String(error) });
    }
  }
  const result = buildGraph(candidates, { root: config.root, compiled, strict: config.strict });
  result.index.diagnostics = [...(result.index.diagnostics ?? []), ...failures];
  const report = checkReport(result.index);
  if (report.summary.errors)
    throw new SqliteIndexError(
      SQLITE_ERROR.REFRESH_FAILED,
      'Source validation failed; last valid generation retained',
      { diagnostics: report.diagnostics },
    );
  const after = await inputs(config, indexPath, compiled.dependencies);
  if (!sameInputs(before, after))
    throw new SqliteIndexError(
      SQLITE_ERROR.REFRESH_FAILED,
      'Sources changed during refresh; last valid generation retained',
    );
  return { ...result, dependencies: compiled.dependencies, stamps: after };
}
function publish(
  db: DatabaseSync,
  index: IndexV2,
  schema: RuntimeSchemaIR,
  stamps: FileStamp[],
): { entityCount: number; edgeCount: number } {
  const source = projectionSource(index, schema);
  const graph = canonicalGraphView(source);
  db.exec(
    'DELETE FROM lore_entities; DELETE FROM lore_relations; DELETE FROM lore_edges; DELETE FROM lore_arcs; DELETE FROM lore_inputs;',
  );
  db.prepare('INSERT OR REPLACE INTO lore_model(id,value) VALUES(1,?)').run(JSON.stringify(schema));
  const entityInsert = db.prepare('INSERT INTO lore_entities VALUES(?,?,?,?,?,?)');
  source.entities.forEach((entity, ordinal) => {
    const { narrative, ...data } = entity;
    const { body: _body, links: _links, ...artifact } = index.artifacts[entity.id]!;
    entityInsert.run(
      entity.id,
      ordinal,
      entity.kind,
      JSON.stringify(data),
      JSON.stringify(artifact),
      narrative ?? null,
    );
  });
  const relationInsert = db.prepare('INSERT INTO lore_relations VALUES(?,?,?)');
  for (const relation of source.relations)
    relationInsert.run(relation.from, relation.to, JSON.stringify(relation));
  const edgeInsert = db.prepare('INSERT INTO lore_edges VALUES(?,?,?,?,?)');
  let ordinal = 0;
  for (const edge of graph.edges)
    edgeInsert.run(edge.key, ordinal++, edge.from, edge.to, JSON.stringify(edge));
  const arcInsert = db.prepare('INSERT INTO lore_arcs VALUES(?,?,?,?,?,?,?)');
  for (const entity of source.entities) {
    const arcs = [...(graph.arcsByCurrent.get(entity.id) ?? [])].sort(
      (a, b) =>
        a.to.localeCompare(b.to) ||
        a.edge.relation.localeCompare(b.edge.relation) ||
        a.edge.from.localeCompare(b.edge.from) ||
        a.edge.to.localeCompare(b.edge.to),
    );
    arcs.forEach((arc, order) =>
      arcInsert.run(entity.id, order, arc.edge.key, arc.from, arc.to, arc.relation, arc.mode),
    );
  }
  const inputInsert = db.prepare('INSERT INTO lore_inputs VALUES(?,?,?)');
  for (const stamp of stamps) inputInsert.run(stamp.path, stamp.size, stamp.mtimeMs);
  return { entityCount: source.entities.length, edgeCount: graph.edges.length };
}

const refreshing = new Map<string, Promise<SqliteRefreshResult>>();
async function update(
  indexPath: string,
  options: RefreshSqliteOptions,
  config?: SqliteSourceConfig,
): Promise<SqliteRefreshResult> {
  const { maxAgeMs, busyTimeoutMs } = validateRefreshOptions(options);
  if (config) await mkdir(dirname(indexPath), { recursive: true });
  let connection: DatabaseSync | undefined;
  let transaction = false;
  try {
    // Read the sequence outside the write transaction so waiters can recognize a completed peer check.
    let observed: SqliteMetadata | undefined;
    const db = await retrySqliteBusy(
      () => {
        const db = (connection ??= config
          ? new DatabaseSync(indexPath)
          : openSqliteDatabase(indexPath, false));
        if (
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lore_meta'").get()
        ) {
          const row = db.prepare('SELECT value FROM lore_meta WHERE id=1').get();
          if (row && !observed) observed = readSqliteMetadata(db);
        } else if (!config) {
          throw new SqliteIndexError(
            SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
            'Not a Lore SQLite projection',
          );
        } else if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) {
          throw new SqliteIndexError(
            SQLITE_ERROR.INDEX_REBUILD_REQUIRED,
            'Refusing to overwrite a non-Lore database',
          );
        }
        if (!observed && !config)
          throw new SqliteIndexError(
            SQLITE_ERROR.INDEX_NOT_FOUND,
            'No published generation; initialize the index',
          );
        db.exec('PRAGMA journal_mode=WAL');
        db.exec('BEGIN IMMEDIATE');
        return db;
      },
      busyTimeoutMs,
      SQLITE_ERROR.REFRESH_BUSY,
    );
    transaction = true;
    db.exec(SCHEMA);
    const currentRow = db.prepare('SELECT value FROM lore_meta WHERE id=1').get();
    const current = currentRow ? readSqliteMetadata(db) : undefined;
    const now = Date.now();
    if (
      !config &&
      current &&
      (current.lastAttempt.sequence !== observed?.lastAttempt.sequence ||
        (maxAgeMs > 0 && now - current.lastAttempt.completedAt <= maxAgeMs))
    ) {
      if (current.lastAttempt.status === 'failed')
        throw new SqliteIndexError(
          SQLITE_ERROR.REFRESH_FAILED,
          current.lastAttempt.message ?? 'Latest refresh failed',
          { diagnostics: current.lastAttempt.diagnostics },
        );
      db.exec('COMMIT');
      transaction = false;
      return { ...statusFrom(current), outcome: REFRESH_OUTCOME.REUSED };
    }
    const sourceConfig = config ?? current!.config;
    let next: SqliteMetadata;
    let outcome: SqliteRefreshResult['outcome'];
    let mutating = false;
    try {
      if (
        !config &&
        current &&
        sameInputs(await inputs(sourceConfig, indexPath, current.dependencies), baseline(db))
      ) {
        next = {
          ...current,
          checkedAt: Date.now(),
          lastAttempt: {
            sequence: current.lastAttempt.sequence + 1,
            completedAt: Date.now(),
            status: 'success',
          },
        };
        outcome = REFRESH_OUTCOME.UNCHANGED;
      } else {
        const candidate = await build(sourceConfig, indexPath);
        mutating = true;
        const counts = publish(db, candidate.index, candidate.schema, candidate.stamps);
        next = {
          version: VERSION,
          config: sourceConfig,
          generationId: randomUUID(),
          schemaHash: candidate.index.schema_hash,
          dependencies: candidate.dependencies,
          ...counts,
          checkedAt: Date.now(),
          lastAttempt: {
            sequence: (current?.lastAttempt.sequence ?? 0) + 1,
            completedAt: Date.now(),
            status: 'success',
          },
        };
        outcome = REFRESH_OUTCOME.UPDATED;
      }
    } catch (cause) {
      const error =
        cause instanceof SqliteIndexError
          ? cause
          : new SqliteIndexError(SQLITE_ERROR.REFRESH_FAILED, String(cause), {}, { cause });
      // Build/validation failures precede mutation; storage failures must roll back instead.
      if (current && !mutating && error.code === SQLITE_ERROR.REFRESH_FAILED) {
        saveMetadata(db, {
          ...current,
          lastAttempt: {
            sequence: current.lastAttempt.sequence + 1,
            completedAt: Date.now(),
            status: 'failed',
            message: error.message,
            diagnostics: error.details.diagnostics,
          },
        });
        db.exec('COMMIT');
        transaction = false;
      }
      throw error;
    }
    saveMetadata(db, next);
    db.exec('COMMIT');
    transaction = false;
    return { ...statusFrom(next), outcome };
  } finally {
    try {
      if (transaction) connection!.exec('ROLLBACK');
    } finally {
      connection?.close();
    }
  }
}
export async function refreshSqliteIndex(
  options: RefreshSqliteOptions,
): Promise<SqliteRefreshResult> {
  validateRefreshOptions(options);
  const path = resolve(options.indexPath);
  const previous = refreshing.get(path);
  if (previous) return { ...(await previous), outcome: REFRESH_OUTCOME.REUSED };
  const work = update(path, options);
  refreshing.set(path, work);
  try {
    return await work;
  } finally {
    if (refreshing.get(path) === work) refreshing.delete(path);
  }
}
/** Private CLI initialization boundary; not exported from the public package. */
export async function initializeSqliteIndex(
  options: InitializeSqliteOptions,
): Promise<SqliteRefreshResult> {
  const path = resolve(options.indexPath);
  const config: SqliteSourceConfig = {
    root: resolve(options.root),
    ignorePath: resolve(options.ignorePath ?? join(options.root, '.artifactignore')),
    strict: options.strict ?? true,
    ...(options.schemaPath === undefined ? {} : { schemaPath: resolve(options.schemaPath) }),
  };
  return update(
    path,
    {
      indexPath: path,
      ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    },
    config,
  );
}
