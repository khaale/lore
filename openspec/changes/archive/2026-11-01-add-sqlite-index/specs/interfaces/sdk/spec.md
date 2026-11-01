## MODIFIED Requirements

### Requirement: Saved input freshness

For openFilesystemWorkspace, snapshots SHALL identify filesystem authority, schema hash and saved-indexed freshness. Ordinary read methods SHALL revalidate the loaded input stamp set before operating and raise STALE_STATE when it changes, without silently reloading or replaying caller code. Opening an existing index SHALL NOT prove that it was rebuilt after every earlier source edit.

#### Scenario: Edit after opening

- **WHEN** an observed file changes size or mtime after workspace opening
- **THEN** the next ordinary read raises STALE_STATE

#### Scenario: Same loaded source

- **WHEN** readSnapshot groups several unchanged reads
- **THEN** their snapshot identity agrees

### Requirement: Snapshot callback policy

For openFilesystemWorkspace, readSnapshot SHALL group reads over the same loaded source and return the callback value. Its reads SHALL use ordinary per-operation freshness checks. It SHALL NOT promise a completion-time revalidation, a filesystem transaction, callback replay or PTC session lifetime. workspace.call SHALL be used for the stronger call-boundary policy defined in `interfaces/ptc`.

#### Scenario: Edit after the final grouped read

- **WHEN** a callback changes an observed input after its final ordinary read and then returns
- **THEN** readSnapshot itself does not perform a completion check; the next ordinary operation detects stale state

#### Scenario: One loaded source

- **WHEN** two grouped reads observe unchanged inputs
- **THEN** they report the same snapshot identity

## ADDED Requirements

### Requirement: Explicit SQLite workspace API

openSqliteWorkspace SHALL open an initialized indexPath with an explicit indexed or refresh-on-read freshness policy and ordinary SDK read limits. It SHALL provide schema/entity/query/search/graph/explore reads, readSnapshot, status and close. refreshSqliteIndex SHALL expose conditional refresh separately. This addition SHALL preserve openFilesystemWorkspace, its strict freshness behavior and its existing public types.

#### Scenario: Explicit adoption

- **WHEN** a consumer opens a SQLite index using indexed policy
- **THEN** reads use the SQLite projection without silently changing the strict JSON workspace

#### Scenario: Missing index

- **WHEN** the selected SQLite database is absent or uninitialized
- **THEN** opening fails with INDEX_NOT_FOUND and initialization guidance rather than scanning an unspecified root

### Requirement: SQLite read freshness policies

Indexed policy SHALL read the current committed projection without source checks and report sourceFreshness not-checked. Refresh-on-read SHALL complete or reuse the core refresh contract once before an operation or grouped callback, using maxAgeMs default zero. Its results SHALL report checked with checkedAt, meaning the accepted completed check rather than continuous filesystem freshness. A rebuild's input baseline SHALL be observed before source extraction; checked SHALL NOT imply a post-build source check or that all authored files were read from one instant in time.

#### Scenario: Published-only operation

- **WHEN** source files change after publication and an indexed read runs
- **THEN** it returns published data with not-checked metadata

#### Scenario: Refresh-on-read operation

- **WHEN** a source change exists before a required check
- **THEN** refresh-on-read returns the new valid generation after updating

#### Scenario: Refresh failure

- **WHEN** a checking read encounters a failed validation attempt
- **THEN** it fails rather than silently returning old data as checked

### Requirement: Bounded SQLite read semantics

SQLite reads SHALL follow existing SDK schema discovery, projection/facets, predicates, lexical search, graph selectors and coverage semantics. Ordinary page/scan/node/edge limits SHALL remain effective inside grouped reads. SQLite SHALL NOT implicitly select PTC complete-collection behavior or require loading the entire corpus for ordinary bounded entity/query/search/neighborhood reads.

#### Scenario: Bounded query and hydration

- **WHEN** a grouped callback queries with limit 20 then hydrates the supplied IDs
- **THEN** the query remains a bounded page and both results use the same generation

#### Scenario: Existing search meaning

- **WHEN** literal search targets scalar properties in a SQLite index
- **THEN** it preserves SDK match scope/case handling and does not substitute token-based full-text semantics

### Requirement: SQLite snapshot scope and mutation isolation

readSnapshot on a SQLite workspace SHALL pin one committed generation for its callback and apply freshness policy once before entering. Each concurrent scope SHALL have isolated transaction state. Returned object mutation SHALL NOT affect future reads. Callback errors SHALL release the scope without replay, and a callback reader SHALL be invalid after completion.

#### Scenario: Publication during callback

- **WHEN** another consumer publishes between query and getMany in a grouped read
- **THEN** both reads retain the same generation

#### Scenario: Consumer mutates result

- **WHEN** a caller changes returned properties, relations or metadata
- **THEN** a later read is unaffected

#### Scenario: Callback fails

- **WHEN** a grouped callback throws after a read
- **THEN** the callback is not replayed and its read scope is released

### Requirement: Indexed generation metadata and continuation

SQLite result metadata SHALL have a distinct sqlite-generation discriminator, generationId and schemaHash, plus sourceFreshness and checkedAt when applicable. It SHALL NOT masquerade as the strict filesystem snapshot identity. Continuations SHALL bind to generation and relevant read fingerprint; using one after publication changes generation SHALL fail INVALID_CONTINUATION rather than mixing pages.

#### Scenario: Generation changes between pages

- **WHEN** a new publication commits before a continuation is consumed in a new scope
- **THEN** the continuation fails instead of silently continuing in the new generation

#### Scenario: Unchanged refresh between pages

- **WHEN** a no-change refresh occurs before following a continuation
- **THEN** the generation binding remains valid

### Requirement: SQLite status errors and connection cleanup

SQLite lifecycle/refresh failures SHALL use typed INDEX_NOT_FOUND, INDEX_REBUILD_REQUIRED, INDEX_BUSY, REFRESH_BUSY, REFRESH_FAILED and SNAPSHOT_CLOSED codes without changing existing SdkError code types. status SHALL read published/check/attempt metadata without scanning sources. close SHALL reject new operations and release connections after active scopes finish; callbacks SHALL NOT be replayed.

#### Scenario: Inspect failed refresh

- **WHEN** an indexed consumer requests status after another process failed validation
- **THEN** it sees the last usable generation and failed attempt without a source traversal

#### Scenario: Closed workspace

- **WHEN** an operation starts after close
- **THEN** it fails with SNAPSHOT_CLOSED and does not reopen the database

### Requirement: Explicit indexed narrative reads

SQLite entity reads SHALL omit narrative by default and return stored narrative only when requested through include. Existing UTF-8 narrativeMaxBytes and NARRATIVE_LIMIT semantics SHALL apply. Narrative SHALL come from the same indexed generation as the entity properties and graph, without source-file hydration. Narrative storage SHALL NOT expand lexical search scope.

#### Scenario: Default projection

- **WHEN** a SQLite entity containing narrative is queried or fetched without requesting narrative
- **THEN** its stored text is not included in the result

#### Scenario: Explicit narrative limit

- **WHEN** requested stored narrative exceeds the supported narrative byte bound
- **THEN** the read raises NARRATIVE_LIMIT rather than fetching live text or silently truncating it

### Requirement: Bounded SQLite reader startup contention

Opening, status reads and read-scope setup SHALL retry transient SQLite BUSY/LOCKED asynchronously up to busyTimeoutMs (default 5000). Exhaustion SHALL raise INDEX_BUSY, not INDEX_REBUILD_REQUIRED. Zero SHALL fail immediately on contention. An entered caller callback SHALL NOT be retried. Genuine malformed or unsupported storage SHALL retain rebuild guidance. Refresh startup and ownership contention SHALL use REFRESH_BUSY.

#### Scenario: Cold readers during recovery or lock contention

- **WHEN** two processes open a valid index while SQLite transiently blocks reading its metadata
- **THEN** they may wait asynchronously and proceed when access becomes available, or report INDEX_BUSY on timeout without declaring the database corrupt

#### Scenario: Same-process release

- **WHEN** another connection in the same process releases a lock from an asynchronous callback
- **THEN** the reader wait yields so the release can execute

#### Scenario: Caller throws a busy-shaped error

- **WHEN** an entered readSnapshot callback throws an error with a SQLite busy code
- **THEN** it is propagated once without replaying the callback
