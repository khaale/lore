# interfaces/ptc

## Purpose

Run caller-owned compound SDK read programs with complete selections, feedback, bounded output previews and temporary retained results.

## SDK relationship

PTC is the execution mode of the [SDK](../sdk/spec.md), not an independent query
or graph language. SDK vocabulary discovery, entity projections, predicates,
search scope, graph selectors, orientation and depth semantics SHALL apply inside
workspace.call. Only the following read-policy differences apply:

- Freshness is checked at call boundaries as specified below, rather than before
  every operation within the call.
- Query, search and type discovery return complete collections without ordinary
  page/scan controls or continuations; graph reads use complete selections without
  ordinary node/edge output caps.
- Empty graph seeds are accepted as specified below.

SDK entity narrative bounds and validation errors still apply. Output previews,
operation feedback, traces and retained results are additional PTC contracts in
this specification; they do not redefine query or graph semantics.

## Execution and state API

| Surface                                                        | Contract                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| workspace.call(callback)                                       | PtcResponse with executionId, status/result or error, operation events, bounded trace, outcome summaries and errorReport |
| read.query/search/schema/graph/entities/explore                | SDK semantics with the explicit complete-selection and freshness exceptions above                                        |
| read.limitItems / limitGraph                                   | Output previews of already computed selections; no automatic pagination or fetching                                      |
| read.retain(value, options)                                    | Typed historical result reference; optional label/kind/snapshot/coverage/sensitive policy                                |
| read.results / workspace.results                               | describe, get and release scoped handles across calls                                                                    |
| workspace.trace.get(executionId, options)                      | Trace details; optional operationId and positive event-view limit                                                        |
| createPtcRuntime / createScope / execute / session.run / close | Optional caller-owned execution and instrumentation, independent of workspace convenience calling                        |

Caller code owns process execution, output export and external effects. Lore does
not sandbox the callback, impose a callback timeout or roll back its side effects.

## Requirements

### Requirement: Workspace call lifecycle

workspace.call SHALL execute a caller callback once, automatically own and finish its execution session and return completed/result or failed/error responses. The callback reader SHALL be valid only for its call. Lore SHALL NOT host an arbitrary-code execution endpoint or replay programs.

#### Scenario: Callback exception

- **WHEN** a program throws after one read
- **THEN** the response is failed and the callback is not replayed

#### Scenario: Escaped reader

- **WHEN** a caller uses a PTC reader after its call finishes
- **THEN** the operation fails because its session has closed

### Requirement: Freshness boundaries

A workspace call SHALL revalidate saved inputs before program entry and after successful callback completion, and use the same loaded in-memory source within the program. Detected changes SHALL fail with STALE_STATE. Failure SHALL NOT roll back caller side effects or already retained values.

#### Scenario: Change during program

- **WHEN** an observed source changes during a callback
- **THEN** completion fails with STALE_STATE without rerunning the callback

#### Scenario: Caller side effect

- **WHEN** a callback performs an external effect then fails
- **THEN** Lore does not promise to undo that effect

### Requirement: Complete computational selections

Within PTC, query/search/type discovery SHALL return complete collections without pagination options or continuations, and graph reads SHALL return the complete graph selected by semantic selectors and depth without ordinary SDK output caps. Empty graph seeds SHALL return an empty graph.

#### Scenario: Beyond ordinary page size

- **WHEN** a PTC query matches more than the ordinary SDK page cap
- **THEN** all matching items are available for computation

#### Scenario: Empty derived seed set

- **WHEN** a PTC query returns no records and feeds a graph method
- **THEN** the program receives an empty graph rather than a seed validation failure

### Requirement: Collection and graph previews

limitItems and limitGraph SHALL produce output previews without modifying original results. Defaults SHALL be 20 collection items or 20 nodes/40 edges. Zero SHALL be a valid preview limit; invalid limits SHALL raise INVALID_LIMIT. Truncation SHALL preserve snapshot and mark affected coverage output-limit with remaining counts where known.

#### Scenario: Compute then preview

- **WHEN** a program counts a complete collection and returns a limited preview
- **THEN** the count uses all matches while only the preview is truncated

#### Scenario: Graph preview endpoints

- **WHEN** the node preview removes a previously visible node
- **THEN** edges with newly omitted endpoints are excluded, while endpoints already invisible in the input retain their visibility flags; seed lists, per-node provenance, traversal traces and relation presentations are not copied into the compact preview

### Requirement: Operation feedback

PTC SHALL record structured operation identities, methods, outcomes, counts, coverage, snapshot context and errors, with success/empty/partial/error outcomes. A completed call SHALL be distinguishable from completeness of its returned preview.

#### Scenario: Partial output preview

- **WHEN** a successful callback returns a truncated collection preview
- **THEN** the call is completed while result coverage remains partial

#### Scenario: Caught SDK error

- **WHEN** a callback catches an SDK operation error and returns a fallback
- **THEN** the call can complete while operation feedback still records the error

### Requirement: Bounded traces

PTC SHALL bound trace details, outcome summaries and stored bytes, expose omitted-event counts and retained/omitted error summaries, and support trace lookup by execution and operation ID. Lookup SHALL distinguish available, omitted and unavailable details, with expired/evicted/not-found/access-denied reasons where available. Truncation SHALL NOT misrepresent omitted errors as absent errors.

#### Scenario: Trace quota exceeded

- **WHEN** more operations fail than trace summaries can retain
- **THEN** errorReport counts total and omitted errors

### Requirement: Low level execution API

createPtcRuntime SHALL support caller-owned scopes, wrapped operations and explicit runtime/scope close. Workspace calling SHALL use its own automatic scope without requiring low-level setup.

#### Scenario: Closed scope

- **WHEN** a caller executes through a closed low-level scope
- **THEN** SCOPE_CLOSED is reported

### Requirement: Session and trace storage limits

Each workspace SHALL isolate retained values and traces in memory, with shared session ttlMs defaulting to 300000ms. Trace defaults SHALL be 100 events, 65536 immediate bytes and 524288 stored bytes; limits SHALL be safe integers with immediate minimum 128 and stored minimum 256 bytes. Trace storage SHALL be independent of retained-result storage and ordinary SDK page limits.

#### Scenario: Trace eviction

- **WHEN** a stored execution trace exceeds its lifetime or is evicted
- **THEN** lookup reports unavailability without replaying its execution

#### Scenario: Minimum trace quota

- **WHEN** maxTraceBytes is below 128 or maxStoredTraceBytes below 256
- **THEN** runtime configuration is rejected

### Requirement: Typed retained handles

read.retain SHALL return a typed reference usable through read.results or workspace.results describe/get/release within the owning workspace scope. Retained values SHALL be historical copies rather than live views or index refreshes.

#### Scenario: Cross-call reuse

- **WHEN** one call retains a collection and a later call retrieves it on the same workspace
- **THEN** the retrieved value is available with its type and stored metadata

#### Scenario: Mutation isolation

- **WHEN** the caller mutates a retrieved value or metadata
- **THEN** a later retrieval is unchanged

### Requirement: Retention serialization

Retention SHALL copy supported finite JSON-like data and reject function values, cycles, non-finite numbers and explicitly sensitive values. Undefined custom data SHALL fail serialization; undefined object fields in SDK-shaped collection/graph results SHALL be omitted. Object prototypes and live capabilities SHALL NOT be preserved. Conflicting supplied snapshot identity SHALL be diagnosed.

#### Scenario: Sensitive value

- **WHEN** retain is called with sensitive: true
- **THEN** SENSITIVE_VALUE is returned without a handle

#### Scenario: Cyclic value

- **WHEN** a retained object contains a cycle
- **THEN** SERIALIZATION_FAILED is reported

### Requirement: Isolated lifetime

Retained results SHALL expire according to the session ttlMs and SHALL NOT persist across processes. Expiry, explicit release, quota eviction and unknown/foreign handles SHALL produce distinct structured unavailability while bounded tombstone evidence remains.

#### Scenario: Expired handle

- **WHEN** a retained result exceeds its TTL
- **THEN** retrieval reports RESULT_EXPIRED while that tombstone is retained

#### Scenario: Foreign handle

- **WHEN** a second workspace tries to read another workspace result
- **THEN** it cannot access that value

#### Scenario: Released handle

- **WHEN** a result is released and then retrieved
- **THEN** RESULT_RELEASED is reported while its tombstone remains

### Requirement: Retained result limits

Result retention SHALL default to 16777216 bytes and 128 tombstones. Configured retention and lifetime limits SHALL be positive safe integers. Retained storage SHALL NOT impose ordinary SDK pagination on the stored value.

#### Scenario: Result fills budget

- **WHEN** one serialized value fits exactly within the retained-result budget
- **THEN** it can use the budget without an unrelated per-value fraction cap

#### Scenario: Invalid TTL

- **WHEN** ttlMs is zero or fractional
- **THEN** runtime construction fails

### Requirement: Quota eviction safety

Retention SHALL expire entries and evict older entries as necessary for a fitting write. An oversized single write SHALL be rejected before evicting valid retained results.

#### Scenario: Oversized new value

- **WHEN** a new value exceeds the entire retained-result budget
- **THEN** RETENTION_QUOTA_EXCEEDED is reported and existing handles remain valid

#### Scenario: Fitting replacement

- **WHEN** a fitting value needs space occupied by an older result
- **THEN** the older entry can be evicted with a diagnosable tombstone

### Requirement: Retained result views

Result get SHALL support bounded views with separate viewCoverage without mutating the stored value. Closing a low-level scope or runtime SHALL invalidate its owned session state.

#### Scenario: Limited retained array

- **WHEN** get requests a limited view of a retained collection
- **THEN** viewCoverage reports the omission and a subsequent unrestricted get remains complete

### Requirement: Retained result descriptions and views

results.describe SHALL report reference/kind, optional label, serialized size, creation/expiry times and available snapshot/coverage. results.get SHALL return a cloned value and separate viewCoverage; a positive integer limit SHALL truncate only top-level arrays or items arrays. It SHALL NOT recursively bound graph nodes/edges or arbitrary nested content. Zero/invalid limits SHALL raise INVALID_VIEW_LIMIT.

#### Scenario: Graph retained view

- **WHEN** get reads a retained graph with a result-view limit
- **THEN** the option does not truncate graph nodes/edges; limitGraph is needed for that preview

#### Scenario: Zero retained-view limit

- **WHEN** results.get uses limit: 0
- **THEN** INVALID_VIEW_LIMIT is raised even though output preview helpers allow zero

### Requirement: Low level scopes and operations

A PtcRuntime SHALL create isolated-access scopes sharing that runtime storage budget; each scope SHALL execute callbacks through PtcSession. session.run SHALL wrap a named operation for feedback and rethrow its failure inside the callback. Scope/runtime close SHALL prevent further use. Workspace calls SHALL use their own automatically managed runtime scope. A supplied now function SHALL control TTL and quota-order timing.

#### Scenario: Instrumented caught error

- **WHEN** a low-level session.run operation throws and the callback catches it
- **THEN** the operation remains an error event while the callback may complete

#### Scenario: Shared runtime budget

- **WHEN** two low-level scopes retain values in the same runtime
- **THEN** scope access is isolated while storage quotas are runtime-wide

### Requirement: Bounded hierarchy composition

PTC readers SHALL expose the shared hierarchy operations with their own finite
definition, compute and page limits. PTC's complete query and graph selections
SHALL NOT remove hierarchy bounds. Existing execution tracing and read lifetime
rules SHALL apply without a new session or snapshot protocol.

#### Scenario: Hierarchy within a call

- **WHEN** a PTC program composes a hierarchy child page with entity hydration
- **THEN** the hierarchy retains its requested bounds and the program uses existing getMany for properties
