## Why

Repeated filesystem discovery and reconstruction of the in-memory graph make small Lore reads expensive when several CLI/SDK consumers use the same corpus. A shared SQLite projection can provide bounded indexed reads and coordinated on-demand refresh without a mandatory daemon, while authored files remain authoritative.

## What Changes

- Add an explicitly selected SQLite derived-index format alongside the JSON format used by current consumers. Store the compiled read model, structured records, extracted narrative, relations, publication identity and source-check baseline together. Narrative remains opt-in in read results and is read from the indexed generation, not live source files.
- Add conditional refresh: check eligible paths/size/mtime, finish without parsing or republishing when unchanged, and rebuild the projection only after a detected change. A changed corpus may still be rebuilt in full in this change.
- Coordinate refresh across processes through SQLite's single-writer transaction. Recheck shared completion metadata after acquiring ownership so overlapping callers reuse the completed check, including when the configured maximum check age is zero.
- Add an ordinary bounded SQLite SDK reader with explicit published-only or refresh-on-read policy, grouped reads in one database snapshot, typed generation/freshness metadata and explicit connection cleanup. Existing strict JSON SDK types and behavior remain unchanged.
- Extend CLI index/watch with explicit SQLite output and add conditional `refresh --index`. Lore owns refresh logic and persistence; the consumer chooses freshness policy rather than implementing index maintenance.
- Avoid whole-corpus loading for ordinary SQLite reads. Make the existing loaded-source graph preparation lazy and shared so non-graph reads do not rebuild adjacency structures.
- Keep existing LinkML, source-format, query/search, graph coverage and validation semantics. Document source-check costs as observations, not latency guarantees.

Out of scope: mandatory background services, per-file incremental rebuild, automatic JSON migration or dual publication, new search/ranking semantics, compact-profile heuristics, hard property byte limits, durable PTC state, and BB/chat orchestration. The new SQLite reader exposes ordinary bounded reads; porting workspace PTC execution to SQLite is a separate change.

## Capabilities

### New Capabilities

None. Extend existing capability owners rather than introducing a storage-provider hierarchy.

### Modified Capabilities

- `core/index`: SQLite persistence, conditional/coalesced refresh, source baseline, transactional publication, failure behavior and optional watch integration.
- `sources/discovery`: complete refresh input observation, including path additions/deletions, model-selection state and selected schema dependencies.
- `interfaces/sdk`: additive SQLite reader, explicit freshness policies, bounded transaction-scoped reads, generation-bound continuation and lifecycle; preserve the strict JSON API.
- `interfaces/cli`: explicit SQLite index/watch selection and conditional refresh with structured outcomes.

## Impact

- Primary implementation areas: filesystem discovery/publication, core persisted projection, SDK reader/query/graph preparation and CLI dispatch. Prefer built-in `node:sqlite` on the existing Node 24 runtime; no database server or new consumer installation package.
- Public additions are proposed as `openSqliteWorkspace`, `refreshSqliteIndex` and separate indexed-generation result metadata. Exact exported type names are specified in the design and verified through packed-consumer declarations.
- JSON output remains the CLI default and `openFilesystemWorkspace` remains source-stamp checking. This is needed by the current public package consumers, including bb-lore; adopting SQLite/freshness is explicit.
- SQLite files are disposable derived state. Unsupported database schemas require rebuilding from sources, not a migration framework. Validation failure retains the previous usable generation.
- README, SDK docs, CLI/model usage skill references and a root-package changeset must accompany implementation. Publication is a separate action.
