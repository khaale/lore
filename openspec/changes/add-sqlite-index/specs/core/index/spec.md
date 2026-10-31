## MODIFIED Requirements

### Requirement: Read only authority

Lore SHALL read and validate authored inputs without modifying them. Explicit index/watch/refresh publication or an explicitly selected refresh-on-read policy SHALL write only derived index state; authored files SHALL remain externally owned.

#### Scenario: Index build

- **WHEN** the user requests index publication
- **THEN** only the derived output is published

### Requirement: Persisted projection

JSON publication SHALL retain index version 2 with schema_hash, artifacts, edges and diagnostics in deterministic order. Empty persisted edge and diagnostic lists SHALL be represented as null by CLI publication. JSON consumers SHALL accept these empty forms. SQLite SHALL be a separately selected derived format, not a JSON payload under a different extension.

#### Scenario: Repeat build

- **WHEN** unchanged authored inputs are indexed repeatedly as JSON at the same paths
- **THEN** the serialized index content is deterministic

#### Scenario: No edges

- **WHEN** the valid corpus is published as JSON and contains no relations
- **THEN** the CLI persisted edges value is null

### Requirement: Atomic last valid index

JSON publication SHALL use complete temporary-file serialization and atomic replacement. SQLite publication SHALL commit a complete validated projection, compiled read model and source baseline together. Schema, parse or validation errors SHALL retain the previous usable projection; warnings alone SHALL permit publication.

#### Scenario: Invalid edit

- **WHEN** an indexed workspace acquires a broken typed reference
- **THEN** publication fails and valid entity/model/relation data remain unchanged; JSON bytes are unchanged, while SQLite failure metadata can be updated

#### Scenario: Repair

- **WHEN** the invalid source is repaired
- **THEN** the next successful publication replaces the index

### Requirement: Polling watch

Lore watch SHALL support the selected JSON or SQLite format, build initially and rebuild after observed source/schema/dependency/ignore changes settle for the debounce interval. Defaults SHALL be 150ms polling and 300ms debounce. Invalid rebuilds SHALL leave the index intact and allow later repairs to publish.

#### Scenario: External edit and repair

- **WHEN** watch observes an invalid edit followed by a valid repair
- **THEN** it preserves last-valid data during the failure and publishes the repair; JSON output bytes remain unchanged until repair

#### Scenario: Dependency edit

- **WHEN** a watched imported schema changes
- **THEN** a debounced rebuild is requested

## ADDED Requirements

### Requirement: Self contained SQLite projection

A SQLite index SHALL contain the read model, entities, relations, provenance, generation identity and source configuration/baseline needed for reading and refreshing it. Published-only reads SHALL require neither a source traversal nor recompilation of live schema files. Unsupported database formats SHALL require an explicit rebuild from sources rather than automatic migration.

#### Scenario: Offline published read

- **WHEN** a valid SQLite index exists but source files are unavailable
- **THEN** published-only entity/schema reads succeed from the database

#### Scenario: Unsupported format

- **WHEN** a database uses an unsupported projection format
- **THEN** opening fails with rebuild guidance without modifying that database

### Requirement: Conditional refresh without changes

Refresh SHALL compare the eligible input path set and source baseline under the discovery contract. If unchanged, it SHALL record a successful completed check, return unchanged and preserve generation identity, without parsing record contents, rebuilding graph data or rewriting entity/relation tables. A changed input SHALL trigger model compilation and complete-corpus validation before publication.

#### Scenario: No-change refresh

- **WHEN** source paths and observed input stamps match the published baseline
- **THEN** the operation returns unchanged, updates check metadata and retains generation/data

#### Scenario: Changed source

- **WHEN** an eligible record changes size or mtime
- **THEN** refresh validates and publishes a new generation when valid

### Requirement: Single pass rebuild inputs

A rebuild SHALL compile the model once and discover eligible source paths once using that compiled dependency closure. It SHALL reuse the discovered list for input size/mtime collection before source extraction and for reading candidates. It SHALL NOT perform a post-build source-stability scan. A validated candidate SHALL publish even if authored files change during the build. A later source check SHALL compare against the retained pre-read baseline. Source verification SHALL describe a completed size/mtime check, not a transactional snapshot of the authored filesystem or content-hash verification.

#### Scenario: Source changes during build

- **WHEN** an input is edited after its recorded baseline while a valid candidate is being read or built
- **THEN** the candidate read by that build publishes and a later source check detects the changed path set or size/mtime

#### Scenario: Shared discovered file list

- **WHEN** a full rebuild reads eligible authored sources
- **THEN** stamp collection and source extraction reuse one discovered list rather than walking the source tree again

#### Scenario: Preserved metadata

- **WHEN** a file changes while retaining the same observed size/mtime
- **THEN** the stamp contract does not promise detection

### Requirement: Cross process refresh coalescing

Refresh ownership SHALL be serialized per SQLite database with bounded waiting. After acquiring ownership, a caller SHALL reuse a compatible successful check completed by an overlapping request, including with maxAgeMs zero. Otherwise it SHALL evaluate freshness age and check sources. A shared failed attempt SHALL propagate failure instead of being treated as a successful check.

#### Scenario: Overlapping strict checks

- **WHEN** two consumers request refresh with maxAgeMs zero before either check completes
- **THEN** one checks/builds and the waiter reuses its completed result

#### Scenario: Independent later check

- **WHEN** a new maxAgeMs zero request starts after the previous check completed
- **THEN** it performs a new source check

#### Scenario: Writer timeout

- **WHEN** refresh ownership cannot be acquired within the configured timeout
- **THEN** the operation reports REFRESH_BUSY without changing the published generation

### Requirement: Published generation and refresh status

Each successful publication SHALL have a database generation identity; no-change checks SHALL preserve it. Shared metadata SHALL distinguish the published generation, last successful source check and latest completed attempt/failure. A failed refresh SHALL NOT erase the last valid data or label it freshly verified. Reader-visible generation data SHALL change atomically.

#### Scenario: Invalid corpus

- **WHEN** refresh finds validation errors after a valid publication
- **THEN** published-only readers retain valid data while checking readers receive REFRESH_FAILED and diagnostics

#### Scenario: Successful repair

- **WHEN** the invalid input is repaired and refresh succeeds
- **THEN** a new generation and successful check replace the failure status atomically

### Requirement: Concurrent readers and updater lifetime

Independent consumers on the same local host SHALL read committed database snapshots while refresh runs. An in-flight read SHALL keep its generation across publication. Lore SHALL NOT require a daemon or consumer-owned persistent process. A terminated updater SHALL NOT expose partial publication or leave a permanent application refresh lock.

#### Scenario: Read overlaps publication

- **WHEN** a reader has begun its database snapshot before another process publishes
- **THEN** all reads in that snapshot use the old generation and a later snapshot can use the new one

#### Scenario: Updater termination

- **WHEN** an updater terminates before committing publication
- **THEN** other processes can subsequently read the last committed generation and obtain refresh ownership

### Requirement: Narrative belongs to the indexed generation

SQLite publication SHALL retain narrative produced by existing entity extraction together with properties, relations and model data. Published-only narrative reads SHALL use stored text rather than current source files. A valid refresh SHALL publish text and structure atomically; unchanged refresh SHALL not reread or rewrite narrative. This SHALL preserve existing extraction semantics rather than duplicate every raw source format.

#### Scenario: Source document unavailable

- **WHEN** a SQLite generation contains narrative and its original document is unavailable
- **THEN** published-only reads can return the stored narrative

#### Scenario: Document changes across publication

- **WHEN** narrative changes and a valid refresh publishes a new generation while an earlier read scope remains active
- **THEN** the earlier scope retains its old text and structure, and a later scope sees the new text and structure
