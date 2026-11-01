# interfaces/sdk

## Purpose

Expose typed saved-workspace discovery, entity projections, queries, search and graph reads with bounded coverage.

## Scope and dependencies

This specification defines the shared SDK read semantics. Ordinary workspace
reads use the freshness checks and bounds specified below. [PTC](../ptc/spec.md)
uses the same schema/entity/query/search/graph semantics with explicit exceptions
for freshness boundaries, complete computational selections and empty graph seeds.
PTC lifecycle, previews and retention are owned only by ptc.

Schemas follow [linkml-profile](../../model/linkml-profile/spec.md); source observation
follows [sources](../../sources/discovery/spec.md); persisted data follows [index](../../core/index/spec.md)
and [knowledge-graph](../../core/knowledge-graph/spec.md). SDK explore SHALL use the
shared [exploration](../../core/exploration/spec.md) view semantics, subject to SDK error
mapping and saved-input freshness.

## Public operation map

| Operation                                            | Input and result                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| openFilesystemWorkspace                              | root plus schemaPath/indexPath/ignorePath, workspace read limits and PTC options; a saved filesystem Workspace |
| describe / schema.listTypes / schema.describeType    | Workspace metadata, pageable type catalog and effective type/field descriptions                                |
| entities.get / getMany                               | ID or ID selection plus select/include/narrativeMaxBytes; projected entity or batch with missingIds            |
| query                                                | Optional type, eq/in/present where, select, limit, scanBudget and continuation; Page of entities               |
| search                                               | Literal text, optional types, limit, scanBudget and continuation; Page of identity matches with explanations   |
| graph.neighbors / neighborhood / subgraph / boundary | Supplied seeds and semantic selectors; graph with separate node/edge coverage                                  |
| explore                                              | view, optional root/depth; configured core report with snapshot and coverage                                   |
| readSnapshot                                         | Callback over an ordinary reader; shared source with per-operation freshness checks                            |
| call / results / trace                               | PTC execution and temporary session state, specified in interfaces/ptc                                         |

No query ordering, aggregation, arbitrary predicate language or server-side code
execution is exposed. Computations beyond supported predicates are caller code.

## Requirements

### Requirement: Saved workspace setup

openFilesystemWorkspace SHALL read the selected schema and version-2 saved index, defaulting to .artifact-index/index.json, and SHALL NOT build or publish it. Invalid setup SHALL raise SdkError SETUP_FAILED; differing schema hashes SHALL raise SCHEMA_MISMATCH.

#### Scenario: Missing index

- **WHEN** a workspace opens without a readable saved index
- **THEN** setup fails instead of indexing sources

#### Scenario: Mismatched schema

- **WHEN** the saved schema_hash differs from the selected compiled model
- **THEN** SCHEMA_MISMATCH is raised

### Requirement: Saved input freshness

For openFilesystemWorkspace, snapshots SHALL identify filesystem authority, schema hash and saved-indexed freshness. Ordinary read methods SHALL revalidate the loaded input stamp set before operating and raise STALE_STATE when it changes, without silently reloading or replaying caller code. Opening an existing index SHALL NOT prove that it was rebuilt after every earlier source edit.

#### Scenario: Edit after opening

- **WHEN** an observed file changes size or mtime after workspace opening
- **THEN** the next ordinary read raises STALE_STATE

#### Scenario: Same loaded source

- **WHEN** readSnapshot groups several unchanged reads
- **THEN** their snapshot identity agrees

### Requirement: Vocabulary discovery

describe, schema.listTypes and schema.describeType SHALL expose schema identity, read-only capabilities, runtime types, field ranges/value kinds, required/recommended flags, cardinalities, enum choices, relation targets/inverses and configured views independently of concrete domain vocabulary. Type lookup SHALL accept names and logical IDs; unknown types SHALL raise UNKNOWN_TYPE.

#### Scenario: Custom domain

- **WHEN** the schema declares classes absent from Lore examples
- **THEN** SDK metadata describes those classes

#### Scenario: Type catalog text

- **WHEN** listTypes supplies text
- **THEN** types are filtered by literal case-insensitive name/title/description matching

### Requirement: Branchable failures

SDK failures SHALL expose structured SdkError codes and details for setup, schema mismatch, stale state, unknown types/fields, unsupported filters/views, missing entities, limits, arguments, narrative bounds and continuation errors.

#### Scenario: Unsupported view

- **WHEN** explore receives an unknown view
- **THEN** the caller can branch on UNSUPPORTED_VIEW rather than parsing prose

### Requirement: Entity projections

entities.get/getMany SHALL return ID, type/typeId, selected properties, requested facets, snapshot and coverage. Narrative SHALL be opt-in and bounded in UTF-8 bytes, defaulting to 65536; excess SHALL raise NARRATIVE_LIMIT. Unknown selected fields SHALL raise UNKNOWN_FIELD.

#### Scenario: Identity selection

- **WHEN** an entity is read with select containing only id
- **THEN** identity remains available without unselected property values

#### Scenario: Oversized narrative

- **WHEN** requested narrative exceeds the supported byte bound
- **THEN** NARRATIVE_LIMIT is raised

### Requirement: Batch selection coverage

getMany SHALL deduplicate and sort supplied IDs, report missingIds and distinguish incomplete missing selections from complete empty input. get for a missing entity SHALL raise MISSING_ENTITY.

#### Scenario: Empty batch

- **WHEN** getMany receives []
- **THEN** it returns a complete empty collection

#### Scenario: Partly missing batch

- **WHEN** some requested IDs do not exist
- **THEN** existing entities and missingIds are returned with incomplete coverage

### Requirement: Reference projection

Selected outgoing reference properties SHALL contain resolved target IDs, with arrays for multivalued fields. Absent references SHALL be omitted, authored empty reference arrays SHALL remain empty, and inverse presentations/provenance SHALL remain available through detailed relations.

#### Scenario: Authored WikiLink

- **WHEN** a selected field is authored as a resolved WikiLink
- **THEN** its property value contains the target ID

#### Scenario: Empty references

- **WHEN** a multivalued reference is explicitly []
- **THEN** the selected property stays []

### Requirement: Typed query predicates

query SHALL support optional type name/type ID including subclasses, select and top-level eq/in/present predicates joined by AND. Multivalued scalar predicates SHALL test membership; reference predicates SHALL use resolved targets. Unknown/inapplicable fields, incompatible values and unsupported predicates SHALL fail explicitly.

#### Scenario: Unknown query type

- **WHEN** query supplies an unknown type
- **THEN** UNKNOWN_TYPE is raised

#### Scenario: Invalid membership

- **WHEN** in contains no values or non-scalar values
- **THEN** UNSUPPORTED_FILTER is raised

### Requirement: Field presence semantics

The present predicate SHALL test non-null/non-undefined scalar or inline data, and at least one resolved outgoing target for reference fields. An empty reference list SHALL count as absent; an authored empty scalar list SHALL count as present.

#### Scenario: Empty reference selection

- **WHEN** a reference field is authored as [] and filtered with present: false
- **THEN** it satisfies the presence predicate

#### Scenario: Empty scalar list

- **WHEN** a scalar list is authored as [] and filtered with present: true
- **THEN** it satisfies the presence predicate

### Requirement: SDK lexical search scope

search SHALL perform case-insensitive literal matching over IDs, type names/type IDs and top-level scalar properties, with optional type filters and bounded match snippets. It SHALL NOT search narrative, nested objects or array property members, infer terms or perform fuzzy matching.

#### Scenario: Narrative-only word

- **WHEN** a word occurs only in retained Markdown prose
- **THEN** SDK search does not match it

#### Scenario: Scalar match

- **WHEN** a literal occurs in a top-level scalar property
- **THEN** search returns the entity identity and field match explanation

### Requirement: Pages and scan coverage

query, search and schema.listTypes SHALL return items, snapshot, coverage and optional opaque continuation. Query/search defaults SHALL be 20 items and 100 examined entities; workspace defaults SHALL cap requests at 100 items and 10000 examined entities. Coverage SHALL distinguish page-limit, scan-budget, empty and complete outcomes.

#### Scenario: Sparse match scan

- **WHEN** a finite scan budget is exhausted before enough matches are found
- **THEN** the result reports incomplete scan coverage and a continuation even if the page is short

#### Scenario: Invalid page limit

- **WHEN** an ordinary page request has zero, fractional or excessive limit
- **THEN** INVALID_LIMIT is raised

### Requirement: Bound continuations

Continuation tokens SHALL be validated against operation, originating snapshot and relevant query fingerprint. Query/search continuations SHALL include their limit and scan-budget fingerprint and resume the scan position rather than rescan omitted nonmatches.

#### Scenario: Changed query

- **WHEN** a continuation is reused with a different query predicate
- **THEN** INVALID_CONTINUATION is raised

#### Scenario: Resume sparse scan

- **WHEN** the caller follows a valid sparse-scan continuation
- **THEN** the next read starts after the previously examined candidates

### Requirement: Graph seed inputs

Graph methods SHALL accept ID arrays, entity arrays using their id, or collections using only their supplied items. Seeds SHALL be deduplicated and validated. Ordinary SDK graph reads SHALL require non-empty seeds. The PTC exception is defined only in [ptc](../ptc/spec.md).

#### Scenario: Paged collection seeds

- **WHEN** a page with an unconsumed continuation is supplied as graph input
- **THEN** only supplied items become seeds; no page is fetched implicitly

#### Scenario: Missing seed

- **WHEN** a supplied seed ID is unknown
- **THEN** MISSING_ENTITY is raised

### Requirement: Graph operations

neighbors SHALL read one-hop graph context; neighborhood SHALL traverse to an integer depth in 0..32; subgraph SHALL select edges internal to the seed set; boundary SHALL select crossing relations to outside neighbors. neighbors and boundary SHALL return non-seed node summaries while keeping seedIds and edge endpoint visibility; neighborhood and subgraph SHALL include eligible seed summaries. Traversal SHALL be deterministic and cycle-safe.

#### Scenario: Seed subgraph

- **WHEN** subgraph receives two connected seeds and a third external neighbor exists
- **THEN** only edges internal to the supplied seeds are selected

#### Scenario: Boundary

- **WHEN** a relation crosses from the seed set to an outside entity
- **THEN** boundary can expose that crossing relation

### Requirement: Direction and selectors

Graph reads SHALL support in/out/both, relation selectors and nodeTypes by class name/type ID including subclasses. Node type filters SHALL affect returned summaries while eligible intermediate nodes remain traversable. Unknown selectors and empty selector lists SHALL fail.

#### Scenario: Filtered intermediate

- **WHEN** an eligible path passes through a node of an unselected type
- **THEN** traversal can reach a selected downstream type

#### Scenario: Unknown relation

- **WHEN** a graph selector names no declared reference slot
- **THEN** INVALID_ARGUMENT is raised

### Requirement: Canonical graph relations

SDK graph results SHALL preserve stored assertion orientation, expose inverse relation presentations without duplicate assertions, and provide available provenance and traversal context. Generic narrative links SHALL NOT become typed graph assertions.

#### Scenario: Inverse alias traversal

- **WHEN** a caller selects a declared inverse relation presentation
- **THEN** it can traverse the corresponding assertion without creating a duplicate logical edge

### Requirement: Independent graph bounds

Ordinary graph reads SHALL default to 1000 nodes and 2000 edges, accept positive integer caps up to 10000 nodes and 20000 edges, and reject a node cap smaller than the logical seed set. Node and edge coverage SHALL be independent and SHALL NOT imply continuation.

#### Scenario: Edge cap

- **WHEN** selected graph edges exceed maxEdges while nodes fit
- **THEN** edge coverage reports incompleteness independently of node coverage

#### Scenario: Zero cap

- **WHEN** maxNodes or maxEdges is zero
- **THEN** INVALID_LIMIT is raised

#### Scenario: No incident edges

- **WHEN** valid seeds have no selected relations
- **THEN** the result distinguishes a complete empty edge set from incomplete traversal

### Requirement: Snapshot callback policy

For openFilesystemWorkspace, readSnapshot SHALL group reads over the same loaded source and return the callback value. Its reads SHALL use ordinary per-operation freshness checks. It SHALL NOT promise a completion-time revalidation, a filesystem transaction, callback replay or PTC session lifetime. workspace.call SHALL be used for the stronger call-boundary policy defined in `interfaces/ptc`.

#### Scenario: Edit after the final grouped read

- **WHEN** a callback changes an observed input after its final ordinary read and then returns
- **THEN** readSnapshot itself does not perform a completion check; the next ordinary operation detects stale state

#### Scenario: One loaded source

- **WHEN** two grouped reads observe unchanged inputs
- **THEN** they report the same snapshot identity

### Requirement: Default entity facets and projection

get/getMany SHALL default to declared properties, relations and provenance without narrative. query SHALL return selected properties/relations without narrative/provenance. search SHALL return identity summaries and match explanations. select SHALL control properties/references while identity remains available; include SHALL control optional narrative/provenance/relations. Entity results SHALL NOT include per-field capability metadata.

#### Scenario: Default get

- **WHEN** get is called without options
- **THEN** declared available properties, selected relations and provenance are returned, with no narrative

#### Scenario: Query projection

- **WHEN** query selects one scalar field
- **THEN** the result contains that field and identity without unselected values or narrative

#### Scenario: Search identity summary

- **WHEN** a search matches a scalar property
- **THEN** its item provides identity and the match explains the property; full entity data requires a projected read

### Requirement: Configured exploration access

SDK explore SHALL use core view semantics with required view, optional root and depth defaulting to 1. Advertised views SHALL default to all five when no views are configured; otherwise the workspace union SHALL include overview plus configured class/slot views. A non-advertised view SHALL raise UNSUPPORTED_VIEW, a missing required root INVALID_ARGUMENT, and an unknown root MISSING_ENTITY.

#### Scenario: Restricted configured views

- **WHEN** only card is configured in class/slot annotations
- **THEN** overview and card are advertised while an unadvertised tree request fails

#### Scenario: Rootless overview

- **WHEN** overview is requested without root
- **THEN** the workspace overview is returned

### Requirement: Coverage and ordering semantics

Collections SHALL expose complete, examined, returned, remaining and reason with snapshot identity. Unknown remaining SHALL NOT imply zero. Query/search examined SHALL count scanned candidates; type-catalog examined SHALL count its filtered catalog. Entity pages SHALL be deterministic in loaded ID order; catalog pages by type name. Graph completeness SHALL use its independent node/edge coverage, and explore coverage SHALL describe report delivery, not unconstrained graph reachability.

#### Scenario: Short incomplete page

- **WHEN** a scan ends before exhausting the corpus and has zero matches
- **THEN** coverage is incomplete with a continuation and unknown remaining

#### Scenario: Explore report coverage

- **WHEN** a depth-limited exploration report is delivered
- **THEN** complete report coverage does not claim that every reachable entity was traversed

### Requirement: Metadata discovery boundary

describe SHALL return the schema identity, full type summaries, advertised views, read-only capability map and snapshot. describeType SHALL add effective parent/mixins and field descriptions. Additive constraint descriptions SHALL expose supported effective scalar patterns/bounds, boolean expression trees, unique-list flags, record constraints and conditional rules. Reference metadata SHALL preserve union alternatives and nested reference selectors rather than flattening them to a broader range. This SHALL describe Lore's executable contract, not a complete export of every authored LinkML metadata field or functionality of other LinkML tools.

#### Scenario: Constrained numeric field

- **WHEN** a type has numeric bounds and cardinality constraints
- **THEN** discovery reports those supported effective constraints alongside the existing field description

#### Scenario: Conditional inline selector

- **WHEN** a consumer describes DeploymentSelector
- **THEN** it can discover the workload/application exclusive record constraint without reading source YAML

#### Scenario: Reference alternatives

- **WHEN** a consumer describes a field narrowed to RuntimeEntity or Subsystem
- **THEN** the effective reference metadata does not claim that all Entity descendants are allowed

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

### Requirement: Nested reference projections

Entity projections SHALL preserve inline object/array shape and replace resolved nested reference values with target IDs, retaining scalar literals in supported unions. Entity relations and graph reads SHALL expose the nested relation selectors defined by knowledge-graph. Existing get/query/search pagination, narrative/provenance opt-in, coverage and freshness policies SHALL remain applicable. Public constraint DTOs SHALL NOT require private workspace-package imports.

#### Scenario: Inline refinement result

- **WHEN** an entity has an inline position refinement with a resolved scope link
- **THEN** its projected properties retain the inline refinement structure with scope as a target ID and expose the corresponding owning-entity relation

### Requirement: Metamodel annotation discovery

schema.describeType SHALL expose effective class annotations in TypeDescription.annotations,
effective slot annotations in FieldDescription.annotations, and terminal reference-slot
annotations in ReferencePathDescription.annotations, including nested inline reference
paths. Each annotations value SHALL be a detached mapping, empty when no annotations
apply. JSON, SQLite and PTC discovery SHALL share this projection. Existing model
inheritance and annotation-key precedence SHALL apply; a winning value SHALL replace
the whole annotation value rather than deep merge it.

Annotation payloads SHALL remain descriptive data. Consumers MAY use custom keys
to group types, categorize relations or choose presentation. Lore SHALL NOT execute
consumer annotations or infer new inheritance, ownership or graph edges from them.
TypeSummary catalogs and instance/edge results SHALL remain unchanged. Existing
UNKNOWN_TYPE behavior and snapshot/freshness contracts SHALL remain applicable.

#### Scenario: Consumer-defined groups and roles

- **WHEN** a class defines a custom group annotation and a reference slot defines a custom role annotation
- **THEN** describeType returns both effective payloads without interpreting their values

#### Scenario: Inherited values

- **WHEN** a child overrides one annotation key and inherits another from a parent or mixin
- **THEN** discovery returns the effective winning values and preserves unrelated inherited keys

#### Scenario: Nested relationship metadata

- **WHEN** an inline foreign-key record has an annotated target reference
- **THEN** its reference-path description exposes the target slot's annotations independently of the containing field

#### Scenario: Detached values and empty metadata

- **WHEN** a consumer mutates a returned nested annotation value and repeats discovery
- **THEN** subsequent results remain unchanged and unannotated descriptions return an empty mapping

### Requirement: Hierarchy convenience reads

Workspace and grouped readers SHALL expose hierarchy.propose and hierarchy.read
for the shared core/hierarchy semantics. JSON, SQLite and PTC SHALL use the same
definition format. Existing query, getMany, schema discovery and graph operations
SHALL remain independent composable operations rather than being duplicated by
hierarchy methods. Existing read envelopes, freshness and ordinary continuation
validation SHALL apply; no new snapshot or expected-generation API is required.

#### Scenario: Edited candidate

- **WHEN** a caller changes the candidate definition and requests instances
- **THEN** the SDK validates that definition and uses the chosen branches without rerunning semantic selection

#### Scenario: Composition

- **WHEN** a consumer needs properties and crosslinks for returned real IDs
- **THEN** existing getMany and bounded graph.subgraph can hydrate them independently

### Requirement: Callback-scoped hierarchy reuse

A grouped reader SHALL reuse at most one hierarchy analysis and placement plan
for the same source identity, validated definition serialization and work budget
within one readSnapshot callback. Individual scores SHALL remain lazy, unchanged
and absent from unscored responses. Definition/budget changes and failed reads
SHALL evict the entry. Charging reused work SHALL preserve logical workBudget and
compute.examined semantics. Callback completion or failure SHALL release the entry
without retaining a cross-callback analysis cache. Independent workspace calls
SHALL NOT share it. Existing source checks, validation, continuation rules and
work bounds SHALL remain in effect.

#### Scenario: Repeated child pages
- **WHEN** a consumer pages through one definition inside one readSnapshot callback
- **THEN** topology/placement and requested individual scores are reused while page
  results remain detached and retain their existing order, refs and coverage

#### Scenario: Definition edit or budget reduction
- **WHEN** a caller edits the definition or lowers workBudget after a successful read
- **THEN** the new read evaluates under that definition/budget without reusing an
  incompatible successful analysis or silently bypassing budget failure
