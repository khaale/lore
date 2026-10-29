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

SDK snapshots SHALL identify filesystem authority, schema hash and saved-indexed freshness. Ordinary read methods SHALL revalidate the loaded input stamp set before operating and raise STALE_STATE when it changes, without silently reloading or replaying caller code. Opening an existing index SHALL NOT prove that it was rebuilt after every earlier source edit.

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

readSnapshot SHALL group reads over the same loaded source and return the callback value. Its reads SHALL use ordinary per-operation freshness checks. It SHALL NOT promise a completion-time revalidation, a filesystem transaction, callback replay or PTC session lifetime. workspace.call SHALL be used for the stronger call-boundary policy defined in [PTC](../ptc/spec.md).

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

describe SHALL return the schema identity, full type summaries, advertised views, read-only capability map and snapshot. describeType SHALL add effective parent/mixins and field descriptions. Field metadata SHALL NOT be interpreted as a complete exported LinkML schema: patterns, numeric bounds and boolean expression trees are not exposed by FieldDescription. The authored schema and [LinkML profile](../../model/linkml-profile/spec.md) remain necessary for those constraints.

#### Scenario: Constrained numeric field

- **WHEN** a type has numeric bounds and cardinality constraints
- **THEN** discovery reports its public field description without promising all authored bound/expression details
