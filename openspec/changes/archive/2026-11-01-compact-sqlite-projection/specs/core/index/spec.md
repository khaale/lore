## ADDED Requirements

### Requirement: Compact lossless SQLite projection

SQLite SHALL retain entity properties/provenance once and use shared dictionaries
and internal integer graph identities while preserving external string IDs. It
SHALL reconstruct source-facing artifact values from necessary raw differences,
without a second complete artifact JSON copy. Missing, null, empty lists/objects,
inline structures, authored reference values and provenance SHALL retain their
existing read semantics. Narrative and compiled model SHALL remain offline-readable.

#### Scenario: Raw reference differs from semantic value

- **WHEN** an inline or top-level reference is normalized or omitted in semantic properties
- **THEN** source-facing explore and empty-reference checks retain the original authored value

#### Scenario: Ordinary property named source

- **WHEN** authored data contains source/path-shaped field names or numeric values
- **THEN** dictionary decoding does not reinterpret these values as stored provenance

### Requirement: Materialized compact graph parity

Canonical edges, inverse presentations and bidirectional arcs SHALL be materialized
from loaded relations. Their exposed ordering SHALL match existing locale ordering,
including canonical keys, inferred orientation, generic exclusion, self-links and
multiple presentations. Ordinary bounded reads SHALL remain lazy and preserve
existing limits, coverage and continuation behavior; global explore can materialize
the corpus. Publication SHALL remain atomic with last-valid and pinned-reader
guarantees under the existing SQLite lifecycle contract.

#### Scenario: Explicit inverse and self-loop

- **WHEN** a graph contains explicit/inferred inverse presentations and self-links
- **THEN** compact and JSON reads expose the same edges, arcs, order and coverage

#### Scenario: Invalid refresh overlaps an active reader

- **WHEN** validation fails while an earlier read snapshot is active
- **THEN** no partial compact tables are published and the earlier reader retains its generation

### Requirement: Explicit derived-format rebuild

The compact format SHALL have a distinct version. Readers and refresh SHALL reject
unsupported previous formats with INDEX_REBUILD_REQUIRED and actionable explicit
rebuild guidance, without modifying the old database or automatically migrating it.

#### Scenario: Previous-format database

- **WHEN** a consumer opens a valid previous-format SQLite index
- **THEN** it receives rebuild guidance instead of a mixed-format read or automatic conversion
