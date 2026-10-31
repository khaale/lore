## 1. Establish the derived storage boundary

- [x] 1.1 Make canonical graph preparation lazy and shared for an existing loaded JSON source, including callback readers; verify a metadata/entity/query-only scope does not prepare the graph, a first graph read prepares it once, and current SDK graph fixtures retain their results.
- [x] 1.2 Add the private SQLite schema and Node 24 statement/connection lifecycle for model, entities, separately retrievable narrative, canonical relations/presentations, input baseline and metadata; verify an initialized small fixture can be reopened without source access and unsupported formats fail without modification.
- [x] 1.3 Add transactional SQLite initialization/publication using existing compilation/extraction/validation; verify reopening sees matching model/data/narrative/generation and invalid initialization/republication never exposes a partial or replacement generation.

## 2. Implement conditional and shared refresh

- [x] 2.1 Persist and collect the authoritative source-check baseline, including eligible path additions/deletions, auto/explicit model selection, compiler dependency closure and ignore presence; verify focused fixtures detect new/deleted records, a second default model, changed imports and ignore changes, while excluding SQLite/WAL/SHM outputs.
- [x] 2.2 Implement the unchanged fast path and changed-input validation/rebuild with one model compilation and one shared discovery list for stamps and extraction; verify unchanged refresh preserves generation without parsing or rewriting rows, a valid candidate publishes without a post-build stability scan, and the next check detects edits made after the pre-read baseline.
- [x] 2.3 Implement shared successful-check/latest-attempt metadata and maxAgeMs behavior; verify recent success reuse, recent failure propagation, repair after the allowed age, and zero-age later requests performing a new check without treating previous failure as success.
- [x] 2.4 Coordinate same-process and cross-process refresh ownership with a completed-attempt sequence and bounded asynchronous lock acquisition; verify deterministic overlapping zero-age requests perform one source check, later requests do not incorrectly coalesce, and ownership timeout returns REFRESH_BUSY.
- [x] 2.5 Verify updater failure recovery using independent processes and a precommit barrier: terminate an updater while it holds ownership, then confirm the last generation remains readable and another process can refresh without clearing an application lockfile or lease.

## 3. Add bounded SQLite SDK reading

- [x] 3.1 Export openSqliteWorkspace, refreshSqliteIndex, distinct IndexedSnapshotInfo/result types and SqliteIndexError through the root SDK; verify existing JSON consumer declarations remain unchanged and new consumer declarations require explicit freshness policy and reject JSON PTC methods on the ordinary SQLite workspace.
- [x] 3.2 Implement indexed and refresh-on-read operation scopes, metadata-only status, isolated connections, close and callback-reader lifetime; verify indexed reads touch no authored files, grouped checking reads perform one accepted check, concurrent callbacks retain independent transactions, escaped readers fail and no callback is replayed.
- [x] 3.3 Implement schema discovery and ID/batch entity projection from SQLite; verify ordinary SDK facets/defaults, resolved reference properties, missingIds, empty input, provenance/narrative bounds and consumer-mutation isolation against existing fixture results; also verify stored narrative is readable with sources unavailable and omitted unless explicitly requested.
- [x] 3.4 Implement bounded query/search and generation-bound continuations using persisted scan order and shared matching logic; verify predicate/value errors, literal search scope/case, sparse scanBudget behavior, projection/coverage parity, continuation success after unchanged checks and rejection after publication.
- [x] 3.5 Implement graph selection with indexed adjacency and canonical/inverse representations, plus configured exploration through existing core semantics; verify direction/type/hidden-intermediate behavior, seed handling, independent limits and view gating on representative existing graph fixtures, without eagerly loading a corpus for opening or bounded reads.
- [x] 3.6 Verify multi-process read/publication integration: hold a grouped reader across another process's successful refresh, confirm properties, graph and explicitly requested narrative keep the old generation, new scopes see the new text and structure together, and checked metadata is never attached to a different transaction generation.

## 4. Wire CLI and documentation

- [x] 4.1 Add explicit json/sqlite format selection to index/watch, format-specific default output paths and shared SQLite source configuration; verify built CLI SQLite initialization/watch/repair while existing JSON command output and current-file reads remain compatible.
- [x] 4.2 Add refresh --index with max-age/busy-timeout and human/JSON result/error output; verify standalone unchanged/updated/reused outcomes, one JSON document, failed-validation exit status/diagnostics and recovery in short-lived CLI processes.
- [x] 4.3 Update README, docs/sdk.md and lore-usage skill references with explicit policy selection, grouped reads, failure/age semantics, optional watch and connection cleanup; verify examples use only @khaale/lore and do not imply an automatic daemon, SQLite PTC, source transactions or millisecond latency guarantees.
- [x] 4.4 Add a root @khaale/lore changeset and extend the packed-consumer boundary to the SQLite SDK/CLI; verify installation needs no private workspace package, external SQLite server or separately compiled native consumer dependency.

## 5. Complete behavioral and planning gates

- [x] 5.1 Measure the disposable SA SQLite path where the corpus is available: database size, cold open/memory, no-change refresh, indexed entity/schema/narrative, bounded query/search, graph context and concurrent refresh; report phase measurements against the design baseline without editing SA sources or bb-lore's existing index, or explicitly record that the optional corpus was unavailable.
- [x] 5.2 Run pnpm check and pnpm test:cli with the repository execution capsule, plus strict validation of this change; verify meaningful persistence, concurrency, callback and consumer tests pass without redundant new parser/profile matrices.
- [x] 5.3 Review public API/docs/delta consistency and the implemented storage boundary before declaring completion; verify scope exclusions remain intact and identify the core/index purpose/OpenSpec context wording to update when the completed delta is synced or archived, while leaving unimplemented main-spec behavior unchanged.

## 6. Correct transient reader contention found during BB acceptance

- [x] 6.1 Reproduce BUSY being mislabeled as INDEX_REBUILD_REQUIRED with a separate lock-owning process; add bounded asynchronous connection/status/read-entry waiting and INDEX_BUSY while preserving invalid-storage errors and callback non-replay.
- [x] 6.2 Verify zero-wait reader/refresh classification, successful two-process cold-open/refresh-on-read after lock release, repeated concurrent cold reopen/close, and same-process asynchronous lock release.
- [x] 6.3 Run final checks, package the corrected public artifact and send its identity and API change to BB for vendor update and live acceptance.
