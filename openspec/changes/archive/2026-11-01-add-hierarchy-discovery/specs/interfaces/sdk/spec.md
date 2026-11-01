## ADDED Requirements

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
for the same validated definition and work budget. Individual scores SHALL remain
lazy, unchanged and absent from unscored responses. Definition/budget changes
and failed reads SHALL evict the entry. Callback completion or failure SHALL
release it without retaining a cross-callback analysis cache. Existing source
checks, validation, continuation rules and work bounds SHALL remain in effect.

#### Scenario: Repeated child pages
- **WHEN** a consumer pages through one definition inside one readSnapshot callback
- **THEN** topology/placement and requested individual scores are reused while page
  results remain detached and retain their existing order, refs and coverage

#### Scenario: Definition edit or budget reduction
- **WHEN** a caller edits the definition or lowers workBudget after a successful read
- **THEN** the new read evaluates under that definition/budget without reusing an
  incompatible successful analysis or silently bypassing budget failure
