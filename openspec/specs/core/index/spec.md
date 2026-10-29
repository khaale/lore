# core/index

## Purpose

Publish and watch a derived JSON index atomically without modifying authored files.

## Dependencies

Discovery and observed input stamps are defined in [sources](../../sources/discovery/spec.md);
validated entities and relations in [knowledge-graph](../knowledge-graph/spec.md).
Consumer setup and freshness checks belong to [CLI](../../interfaces/cli/spec.md) and [SDK](../../interfaces/sdk/spec.md).

## Requirements

### Requirement: Read only authority

Lore SHALL read and validate authored inputs without modifying them. Only an explicitly requested index/watch publication SHALL write the derived index; authored files SHALL remain externally owned.

#### Scenario: Index build

- **WHEN** the user requests index publication
- **THEN** only the derived output is published

### Requirement: Persisted projection

Lore SHALL publish index version 2 with schema_hash, artifacts, edges and diagnostics in deterministic order. Empty persisted edge and diagnostic lists SHALL be represented as null by CLI publication. Consumers SHALL accept these empty forms.

#### Scenario: Repeat build

- **WHEN** unchanged authored inputs are indexed repeatedly at the same paths
- **THEN** the serialized index content is deterministic

#### Scenario: No edges

- **WHEN** the valid corpus contains no relations
- **THEN** the CLI persisted edges value is null

### Requirement: Atomic last valid index

Lore SHALL serialize a complete index through a temporary file and atomic replacement. Schema, parse or validation errors SHALL prevent replacement of a last valid index; warnings alone SHALL permit publication.

#### Scenario: Invalid edit

- **WHEN** an indexed workspace acquires a broken typed reference
- **THEN** index publication fails and existing output bytes remain unchanged

#### Scenario: Repair

- **WHEN** the invalid source is repaired
- **THEN** the next successful publication replaces the index

### Requirement: Polling watch

Lore watch SHALL build initially and rebuild after observed source/schema/dependency/ignore changes settle for the debounce interval. Defaults SHALL be 150ms polling and 300ms debounce. Invalid rebuilds SHALL leave the index intact and allow later repairs to publish.

#### Scenario: External edit and repair

- **WHEN** watch observes an invalid edit followed by a valid repair
- **THEN** it preserves the last valid bytes during the failure and publishes the repair

#### Scenario: Dependency edit

- **WHEN** a watched imported schema changes
- **THEN** a debounced rebuild is requested
