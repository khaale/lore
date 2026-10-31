// Internal adapters only. Root SDK exports and freshness contracts are unchanged.
import type { DatabaseSync } from 'node:sqlite';
import { AnalysisError, ANALYSIS_ERROR, type AnalysisInput } from '@khaale/lore-graph';
import type { RuntimeSchemaIR } from '@khaale/lore-schema';
import { canonicalGraphView, type ReadSource, type GraphView } from './reader.js';
import { readSqliteMetadata } from './sqlite-index.js';

/** Caller owns the loaded JSON source and its existing freshness/lifetime boundaries. */
export function jsonAnalysisInput(source: ReadSource, check: () => void): AnalysisInput {
  if (source.storage)
    throw new AnalysisError(ANALYSIS_ERROR.INVALID, 'Use the pinned SQLite metadata adapter');
  let graph: GraphView | undefined;
  return {
    // Loaded JSON identity, including test/prepared sources without a content-specific snapshot ID.
    generation: source.index,
    schema: source.schema,
    check,
    *nodes() {
      check();
      for (const entity of source.entities) yield { id: entity.id, type: entity.kind };
    },
    *edges() {
      check();
      for (const edge of (graph ??= canonicalGraphView(source)).edges)
        yield { from: edge.from, relation: edge.relation, to: edge.to };
    },
  };
}

/** Requires a caller-owned read transaction; never refreshes or opens/closes a connection. */
export function sqliteAnalysisInput(db: DatabaseSync, check: () => void): AnalysisInput {
  const alive = () => {
    check();
    if (!db.isTransaction)
      throw new AnalysisError(
        ANALYSIS_ERROR.CLOSED,
        'Analysis requires a pinned SQLite transaction',
      );
  };
  alive();
  const meta = readSqliteMetadata(db);
  const schema = JSON.parse(
    String(db.prepare('SELECT value FROM lore_model WHERE id=1').get()!.value),
  ) as RuntimeSchemaIR;
  const types = new Map(
    db
      .prepare('SELECT id,name FROM lore_types')
      .all()
      .map((row) => [Number(row.id), String(row.name)]),
  );
  const predicates = new Map(
    db
      .prepare('SELECT id,name FROM lore_predicates')
      .all()
      .map((row) => [Number(row.id), String(row.name)]),
  );
  return {
    generation: JSON.stringify([meta.generationId, meta.schemaHash]),
    schema,
    check: alive,
    *nodes() {
      alive();
      for (const row of db
        .prepare('SELECT id,external_id,type_id FROM lore_entities ORDER BY id')
        .iterate())
        yield {
          key: Number(row.id),
          id: String(row.external_id),
          type: types.get(Number(row.type_id))!,
        };
    },
    *edges() {
      alive();
      for (const row of db
        .prepare('SELECT from_id,predicate_id,to_id FROM lore_edges ORDER BY id')
        .iterate())
        yield {
          from: Number(row.from_id),
          relation: predicates.get(Number(row.predicate_id))!,
          to: Number(row.to_id),
        };
    },
  };
}
