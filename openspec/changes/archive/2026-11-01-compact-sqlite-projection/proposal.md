## Why

The current SQLite index repeats entity/artifact/provenance data and stores long
string identities throughout the graph. The accepted experiment reduced the same
published SA projection from 249 MiB to about 36 MiB while preserving round trips;
the selected design keeps materialized edges and arcs for bounded graph reading.

## What Changes

- Store entity properties/provenance once, with a lossless raw-data delta for
  source-facing artifact reads. Intern types, paths and predicates; use integer
  entity and edge identities internally while preserving external string IDs.
- Derive lookup tables, canonical edges, inverse presentations and arcs in SQLite
  from loaded normalized entities/relations with `INSERT ... SELECT`.
- Preserve locale order, public entity/query/search/explore/graph results, offline
  reads, transaction publication, last-valid data and pinned readers.
- **BREAKING** private derived storage format: old SQLite indexes require explicit
  removal/rebuild, without migration or dual-format reading. JSON is unchanged.
- Retain the already implemented single-pass source build, bounded ingestion and
  deferred secondary indexing. These completed improvements are not new work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core/index`: compact versioned SQLite representation and lossless reconstruction.

## Impact

Private SDK SQLite writer/reader and regression tests, documentation and a root
changeset. No public API additions, new dependencies or authored-source writes.
Depends on the implemented `add-sqlite-index` and `add-declarative-sources` changes;
their lifecycle/read guarantees remain authoritative. Their deltas must be synced
before this delta when archiving, without reverting the accepted single-pass
freshness contract. The user requested both this plan and its implementation in
the handoff; continue into apply after these artifacts are prepared.
