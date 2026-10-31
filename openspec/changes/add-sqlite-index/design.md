## Context

The implemented compact storage representation is specified by the successor
[compact-sqlite-projection](../compact-sqlite-projection/design.md). This document
continues to own source freshness, coordination and publication lifecycle; older
storage measurements below describe their measured historical builds.

See [proposal.md](proposal.md) for motivation and scope. The existing source pipeline compiles a local model, discovers inputs, parses records, builds/validates a graph and atomically publishes JSON v2. JSON SDK readers load that projection, observe source stamps and reject changed inputs. These behaviors have active public consumers, including bb-lore.

Read-only SA measurements on the existing Node 24 runtime provide a useful baseline, not an SLA:

| Operation                                                                      | Repeated local median |
| ------------------------------------------------------------------------------ | --------------------: |
| stat on a known list of roughly 1085 input/index paths                         |                 3.4ms |
| discovery of 1078 Markdown and 3 JSONL inputs                                  |                 160ms |
| discovery plus source stamps                                                   |                 175ms |
| current SDK freshness check with empty getMany                                 |                 164ms |
| current metadata-only readSnapshot callback, including eager graph preparation |                 863ms |

The SQLite projection will still need full discovery when a source check is required; it avoids repeating that work for every internal read and avoids rebuilding/republishing unchanged data. A changed-input rebuild can still use the current whole-corpus validation pipeline and temporary memory. Persistence does not itself provide source freshness or change detection.

## Goals / Non-Goals

**Goals:**

- Give independent processes a shared derived database with one coordinated refresher, bounded reads and explicit freshness policy.
- Define a cheap no-change refresh and a true published-only mode with no source traversal.
- Preserve current consumer-facing semantics while avoiding eager whole-graph preparation for small reads.

**Non-Goals:**

- Replacing the JSON API/default during this change, transparent dual writes, a storage-provider framework, or migration of disposable database contents.
- Per-record incremental rebuild, persistent historical generations, background refresh from a short-lived caller, automatic retries of callbacks, or a mandatory service.
- Adding SQLite workspace.call/results/trace: this first reader is the ordinary bounded API. Existing JSON PTC remains available with its existing complete-selection semantics.

## Decisions

### 1. SQLite is an explicit derived format, owned by Lore

Use built-in `node:sqlite` under Node 24. The available project runtime exposes DatabaseSync and SQLite 3.53.4; implementation must use APIs available throughout the declared Node 24 range or explicitly adjust/test that range. Use ordinary statements and WAL on a local filesystem, not a database server or external native installation.

Keep the database implementation private within the existing workspace modules; public imports remain `@khaale/lore`. Add a focused module if needed, not a generic adapter registry. Reuse schema compilation, source extraction, validation and relation canonicalization instead of implementing a second model language.

JSON stays the current default because bb-lore and packed consumers use it. SQLite adoption is explicit. This is a compatibility requirement for named consumers, not a general promise to retain every future storage format.

### 2. Store queryable data, not a single serialized index blob

Use a minimal schema with:

- One metadata row: projection-format version, generationId, schema identity, serialized runtime read model, resolved source configuration, successful check metadata and latest completed attempt outcome/diagnostics.
- Entity rows keyed by ID: effective type/type ID, stable scan ordinal, scalar/inline data, authored reference data, extracted narrative when present, and provenance. JSON-valued columns are appropriate for dynamic domain properties.
- Relation rows and canonical/inverse presentations sufficient to preserve current SDK graph behavior; indexes for both source/relation/target and target/relation/source lookup.
- An input-baseline table: observed eligible paths plus schema/import/ignore/model-selection inputs and their size/mtime or missing sentinel.

Store narrative produced by the existing document/section extraction pipeline in the same publication as its entity and relations. It is not a second raw copy of every YAML/JSON/CSV source file, and this change does not introduce new narrative extraction or summarization rules. Keep narrative separately retrievable from ordinary property projections so identity/query/schema reads do not load or return it unnecessarily.

An explicit include:['narrative'] read returns stored text under the existing UTF-8 narrative bound and NARRATIVE_LIMIT behavior. Published-only reads work even if the original document is unavailable. A read scope pinned before refresh keeps its previous text, properties and graph; a later scope sees the new generation together. This deliberately favors snapshot consistency over source-on-demand hydration. No-change refresh does not reread/rewrite narrative. Measure database size and explicit narrative reads alongside refresh costs before considering a later content-storage policy.

Persist the compiled model with the data so published-only reading needs no live schema file. The source configuration records root, automatic versus explicit schema selection, selected path, ignore path and strictness; later refresh obtains these from the initialized database. A relocated root/config requires explicit reinitialization rather than guessing paths.

Use a new opaque generationId on each successful publication. It identifies the committed publication for page binding and BB's snapshot/cache comparison, not content equivalence. No-change checks preserve it; an explicit rebuild can produce a new ID for equivalent contents. A single publication identity avoids unnecessary full-index hashes or an additional lineage system.

### 3. Initialization and refresh are distinct

Initialize/rebuild with:

```sh
lore index --format sqlite ./knowledge
lore index --format sqlite --out ./cache/knowledge.sqlite ./knowledge
```

This explicitly selects the source root and validates before publishing. No new opener creates an empty database or infers a root from indexPath. A first invalid initialization leaves no readable generation; existing valid data survives failed reinitialization.

Conditional maintenance is:

```sh
lore refresh --index ./knowledge/.artifact-index/index.sqlite
lore refresh --index ./knowledge/.artifact-index/index.sqlite --max-age 1s --json
lore watch --format sqlite ./knowledge
```

Export `refreshSqliteIndex({indexPath,maxAgeMs?,busyTimeoutMs?})` for callers using the same lifecycle without a CLI child process. Defaults: maxAgeMs 0, busyTimeoutMs 5000; both non-negative finite integers. A zero wait timeout means an immediate contention result. CLI durations follow the existing duration syntax. Refresh returns unchanged, updated or reused with generation/check information; failures are typed errors. A normal refresh does not promise a force/content-hash verification mode.

### 4. Coalesce checks, including when maxAgeMs is zero

Capture the current completed-attempt sequence before waiting for refresh ownership. Use one writer transaction per refresh and repeat the metadata decision after acquiring it:

1. If a compatible attempt completed after the request observed metadata, reuse that result. Propagate its failure if it failed. This is what prevents two overlapping zero-age requests from scanning twice.
2. Otherwise, a successful check within maxAgeMs can be reused. A more recent failed attempt must not be hidden by an older success; within a nonzero age window, reuse the failure, then allow a new attempt after that window. Zero age allows the next non-overlapping request to attempt repair immediately.
3. Otherwise discover inputs and compare the baseline. If unchanged, commit only completed-check/attempt metadata. Do not parse source contents or rewrite entity/relation rows.
4. On change, compile the model once, discover eligible files once using its dependency closure, and collect size/mtime before reading. Reuse that file list for source extraction and build/validate the candidate. Do not scan again after the build or reject publication solely because sources changed while building.
5. For a valid candidate, replace the data/model/pre-read baseline and generation in the transaction and commit. For a validation failure detected before mutation, commit only failed-attempt metadata and keep valid data. I/O/transaction failure rolls back; recording a failure is best-effort when storage itself is unavailable. A later source check discovers edits made after the recorded baseline, subject to maxAgeMs reuse.

A waiter that starts after a completed zero-age check performs a new check: overlap reuse is not an implicit TTL. The sequence is shared coordination state, not an audit log; retain only the latest attempt, not historical attempts.

Refresh takes write ownership before filesystem work in this first version. This intentionally prioritizes a simple, crash-safe single-updater invariant over concurrent writers. Read transactions remain possible in WAL. Initializing/watch/SDK refresh use the same coordination path.

### 5. Bound contention without blocking a live JavaScript refresher

`DatabaseSync` and a long SQLite busy wait can block the JavaScript event loop while a same-process updater awaits filesystem work. Therefore:

- Coalesce same-process overlapping refreshes for a database through one in-flight operation.
- Acquire SQLite write ownership non-blockingly, with bounded asynchronous waits for contention from another process, up to busyTimeoutMs; do not hold a read transaction while trying to upgrade it.
- Retry only lock acquisition, never caller callbacks or a partially failed build. Release statements/connections/timers in finally paths.

Do not implement leases, heartbeat tables or custom persistent lockfiles. SQLite transaction ownership is released by connection/process termination. Only one process refreshes a given database at a time; different databases can update independently.

### 6. Add an explicitly configured ordinary SQL reader

Proposed public surface:

```ts
const workspace = await openSqliteWorkspace({
  indexPath: './knowledge/.artifact-index/index.sqlite',
  freshness: { mode: 'refresh-on-read', maxAgeMs: 0 },
  busyTimeoutMs: 5000,
  // maxPageSize, maxScanBudget, maxNarrativeBytes follow ordinary SDK options.
});

try {
  const value = await workspace.readSnapshot(async (read) => {
    const page = await read.query({ type: actualType, limit: 20 });
    const details = await read.entities.getMany(
      page.items.map(({ id }) => id),
      {
        select: actualFields,
        include: ['properties'],
      },
    );
    return { page, details };
  });
} finally {
  await workspace.close();
}
```

The other policy is `{mode:'indexed'}`. Require the discriminated freshness option so adoption cannot silently retain a consumer's source-verified status. maxAgeMs applies only to refresh-on-read. The opener checks database format/schema presence, not sources; freshness policy is applied on data operations. `status()` reads only persisted generation/check/attempt metadata. A missing/unsupported database gives initialization/rebuild guidance.

Provide the ordinary read family: describe, schema discovery, get/getMany, query/search, graph operations and configured explore. Each top-level read is one scope. readSnapshot applies refresh policy once before starting its read transaction, then gives a reader bound to that transaction. The callback runs once. No additional filesystem scans happen inside. Concurrent scopes use dedicated connections; sharing one connection's transaction across overlapping callbacks would break isolation.

Release the transaction and its connection on completion/error; an escaped reader fails SNAPSHOT_CLOSED. close prevents new operations, waits for active scopes to finish and releases owned resources. No hidden watcher/timer is started. Read scopes should last for a bounded operation, not an entire conversation or agent session.

### 7. Keep freshness and generation separate from the old public types

Add `IndexedSnapshotInfo` with `kind:'sqlite-generation'`, generationId, schemaHash, sourceFreshness and optional checkedAt. Do not widen/cast existing `SnapshotInfo.freshness:'saved-indexed'` in a way that changes existing consumers' accepted types. Use separate indexed result envelopes reusing existing item, coverage and option contracts; public type helpers may share implementation if their defaults preserve existing declarations.

- indexed reads report sourceFreshness `not-checked`, even if a prior check exists in status.
- refresh-on-read reports `checked` and the accepted check time. A reused check can be older than this operation and does not assert that the filesystem stayed unchanged afterward.
- A read transaction selects generation metadata with its data. If a publication races between refresh completion and transaction start, use the actual transaction's generation; do not attach a successful check for a different generation. Refresh-on-read must obtain an acceptable check for its selected generation or fail REFRESH_FAILED; it must not replay an entered callback.
- Bind continuations to generation and the existing relevant query fingerprint. New publication causes INVALID_CONTINUATION in a new scope, rather than retaining historical data solely for page tokens.

Keep source-check/attempt status distinct from generation data so a failed check cannot overwrite the last usable snapshot identity. Use `SqliteIndexError` for INDEX_NOT_FOUND, INDEX_REBUILD_REQUIRED, INDEX_BUSY, REFRESH_BUSY, REFRESH_FAILED and SNAPSHOT_CLOSED. Existing query/type/filter/etc errors retain current SdkError meanings; do not widen the old code union simply to add lifecycle errors.

### 8. Preserve bounded semantics without loading the corpus on opening

Entity and adjacency reads use indexed lookups. Query/search use a bounded candidate window in persisted scan order and reuse current matching/projection logic. Preserve locale-sensitive lexical matching, missing/null/reference semantics, snippets and coverage. A SQL LIMIT over already-filtered rows is not equivalent to the existing scanBudget: nonmatches still consume the budget. Store scan ordinals matching the current canonical entity order so SQL collation does not silently reorder pages.

Read graph neighborhoods through indexed adjacency, preserving canonical assertion orientation, inverse presentations, hidden-but-traversable intermediate nodes and independent node/edge limits. Compute/persist reusable canonical representations during publication instead of rebuilding the full graph for a small read. Global exploration can materialize the data required by that explicitly global operation; opening, describe, get and bounded reads must not eagerly load the whole corpus.

For the existing JSON reader, make canonicalGraphView lazy and shared by the loaded source, including callback readers over that same source. This directly removes the measured non-graph cost without changing freshness or page semantics. Do not add PageRank, full-text tokenization, generic caches or property-index families without a later measured need.

### 9. Publication and verification limits

The input baseline must include discovery/model-selection state and additions/deletions, not just stat calls on known record files. Use the exact compiled dependency closure for a valid publication; do not make the regex-based broken-schema watch helper the authoritative dependency manifest. Exclude the SQLite file and its WAL/SHM companions from authored discovery.

Collect size/mtime once before source extraction and retain that baseline for subsequent refresh checks. Rebuilds do not promise an atomic authored-filesystem snapshot or verify source stability after reading. Edits during a build do not themselves reject a validated candidate; later checks discover changed paths or stamps. Deliberately preserved timestamps/size remain outside the detection contract. Successful shared check metadata names the completed source observation rather than promising a post-build check.

Do not rename/replace a live SQLite database file under open WAL connections. Publish within the database transaction. Checkpoint policy begins with SQLite defaults; keep read scopes short and surface contention within the configured timeout. WAL assumes processes on one local host, not a shared network database service.

During full publication, drop secondary indexes and build them in bulk after
loading rows, inside the same transaction. Primary/unique indexes remain active.
No-change refresh does not rebuild indexes. Source extraction reads at most 16
files concurrently and consumes each batch in discovery order, preserving
candidate and diagnostic ordering.

### 10. Verification and delivery

Use focused tests at the persistence/reader boundary plus real independent-process integration where OS locking and crash cleanup matter. Verify semantic parity against existing small fixtures rather than duplicating all schema-parser tests. Use deterministic barriers/instrumentation for coalescing/no-reparse assertions, not timing-only sleeps or a hard 250ms CI threshold.

Record real-corpus measurements separately: cold opening, no-change refresh, indexed get/schema, bounded query/search, neighborhood, concurrent writer/readers and memory use. Optional SA measurement must use a disposable output index and leave source files and bb-lore's published index unchanged.

Update README, docs/sdk.md and reusable usage skill references. Add a root-package changeset; test the packed tarball with both an existing JSON consumer and the new SQLite API. When the completed delta is synced/archived, update the core/index purpose and OpenSpec context from JSON-only wording to derived JSON/SQLite; main specs remain current-state during planning.

## Risks / Trade-offs

- **A no-change refresh still walks directories** → apply freshness once per scope, use explicit shared maxAgeMs when acceptable, retain indexed mode. The observed 170–250ms is a baseline, not a promised future runtime.
- **Changed inputs can require a full rebuild** → keep that cost explicit; per-file invalidation has graph/classification dependencies and is deferred until measured.
- **A writer holds ownership during filesystem work** → other refreshers wait/fail boundedly; published-only readers continue. Optimize preparation later only if it is a demonstrated bottleneck.
- **Database read scopes can hold WAL history** → close scopes promptly; document that waiting for user/model interaction inside a scope is inappropriate.
- **SQL optimizations can alter query/order/coverage or search semantics** → use bounded windows/current matchers first and test observable parity.
- **Node SQLite is synchronous** → bounded statements, asynchronous ownership waits and transaction-isolated connections; this change does not promise arbitrary CPU-intensive work is nonblocking.
- **Two supported persisted formats require maintenance** → preserve JSON only for its active consumer contract, share model/read semantics, and avoid migration/dual-write machinery.

## Migration Plan

No authored-data or database-schema migration. Existing CLI/JSON integrations keep their current defaults. Consumers opt into a separately initialized SQLite index and explicitly select a freshness policy. Rollback is reopening/rebuilding the existing JSON projection; no source edits are involved. Unsupported SQLite projection versions require an explicit rebuild, with existing usable data left intact on failed attempts.

A documentation example must show CLI index/watch plus SDK reads and separate connection cleanup, without implying a mandatory daemon. BB registration, UI status policy, FIFO scheduling and orchestration remain outside this repository.

### Reader contention correction after BB acceptance

BB observed a transient cold-open failure with rebuild guidance, followed by a successful read of the same unchanged database. A controlled exclusive lock in another process reproduced the same misclassification: the metadata SELECT catch wrapped SQLite BUSY as INDEX_REBUILD_REQUIRED. The exact live WAL/recovery event was not captured.

Preserve BUSY/LOCKED causes internally and reuse one bounded asynchronous SQLite retry helper for connection/metadata/read-transaction entry and writer startup/ownership. Reader exhaustion is INDEX_BUSY; refresh exhaustion remains REFRESH_BUSY. busyTimeoutMs applies to these entry waits, defaults to 5000, and zero means immediate failure. Failed reader entry closes its attempt connection before yielding. Never retry an entered caller callback, parsing/validation, or partially completed publication, and never install a synchronous busy_timeout that would block a same-process lock owner's event loop. Unsupported version, absent tables and malformed metadata retain their real rebuild errors. No corpus rebuild or storage migration is needed for this fix.
