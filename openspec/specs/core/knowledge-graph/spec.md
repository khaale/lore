# core/knowledge-graph

## Purpose

Classify extracted records, assign corpus identity, resolve typed and narrative relations, and expose valid semantic state.

## Dependencies

Record constraints, value modes and uniqueness are defined only in
[linkml-profile](../../model/linkml-profile/spec.md); extraction in [sources](../../sources/discovery/spec.md).
This capability owns classification, corpus identity, reference resolution and
semantic assertions. Consumers select and present those assertions under their
own CLI, SDK or exploration contracts.

## Requirements

### Requirement: Record classification

Lore SHALL select recognized type-designator values by class name or logical type ID before flat classification_rules slot_conditions, and accept explicitly declared Markdown classes. Flat rules SHALL act as alternative matches; accepted class-level boolean trees and is_a predicates SHALL NOT imply general classifier evaluation. Explicit abstract-class selection SHALL NOT alone guarantee rejection. Unclassified candidates SHALL be omitted.

#### Scenario: Explicit designator

- **WHEN** a record supplies a recognized type-designator value
- **THEN** the corresponding class is selected before classification rules

#### Scenario: Flat conditions

- **WHEN** a candidate matches one class rule slot_conditions
- **THEN** that rule can classify the candidate

### Requirement: Corpus identity

Identifiers SHALL be unique across the knowledge root. Classified records without an identifier field SHALL receive a source-derived identity.

#### Scenario: Duplicate IDs across files

- **WHEN** two classified records in different files declare the same ID
- **THEN** Lore reports DUPLICATE_ID

#### Scenario: No identifier field

- **WHEN** a classified class has no identifier field
- **THEN** the record receives an identity derived from its source locator

### Requirement: Typed reference resolution

Lore SHALL resolve typed references from exact IDs and supported complete WikiLinks/local Markdown-link surfaces, check target existence and compatible class including inheritance, and preserve available reference provenance.

#### Scenario: Wrong target kind

- **WHEN** a reference resolves to a record of an incompatible class
- **THEN** REFERENCE_TYPE is reported

#### Scenario: Missing target

- **WHEN** an ordinary typed reference has no resolvable target
- **THEN** BROKEN_REFERENCE is reported

### Requirement: Reference unions

For supported scalar/reference unions, Lore SHALL preserve valid bare scalar literals and resolve explicit link surfaces as references. Ordinary reference fields SHALL still require valid reference targets.

#### Scenario: Literal union value

- **WHEN** a bare string is valid in the scalar branch and has no reference target
- **THEN** it remains a scalar without an edge

#### Scenario: Explicit union reference

- **WHEN** a supported explicit link resolves to the reference branch
- **THEN** Lore records the typed edge

### Requirement: Inverse presentations

Lore SHALL derive inverse edges for declared inverse relations and mark them inferred. Independent authored assertions SHALL retain their own surfaces. Selection of assertions and inverse presentations for reads SHALL follow the owning [CLI](../../interfaces/cli/spec.md), [SDK](../../interfaces/sdk/spec.md) or [exploration](../exploration/spec.md) contract.

#### Scenario: Declared inverse

- **WHEN** a record asserts a relation with an inverse slot
- **THEN** the index includes the inferred reverse presentation

### Requirement: Narrative links

Lore SHALL distinguish unclaimed narrative references from typed relations using generic references edges. Unresolved narrative WikiLinks SHALL be warnings. HTTP/HTTPS/mail and fragment-only Markdown links SHALL NOT be traversed as local graph references.

#### Scenario: Unresolved prose WikiLink

- **WHEN** a narrative WikiLink has no target
- **THEN** a warning is emitted rather than a typed-reference error

#### Scenario: Remote URL

- **WHEN** Markdown prose links to an HTTPS resource
- **THEN** Lore does not fetch it or create a local typed relation

### Requirement: Unambiguous local targets

Lore SHALL resolve local file links only when a suitable target can be identified unambiguously, using supported surface parsing rather than treating URL fragments as an entity-selection API. A document with multiple entities SHALL NOT be treated as one arbitrary target.

#### Scenario: Ambiguous file link

- **WHEN** a local file link cannot uniquely select a record
- **THEN** it is not silently bound to an arbitrary entity

### Requirement: Diagnostic and check reports

Lore SHALL expose error/warning severity, stable diagnostic codes, messages and available source, artifact, slot and span details. Check reports SHALL summarize artifacts, edges, classes, errors and warnings. Parse failures SHALL be reported rather than yielding a publishable partial corpus.

#### Scenario: Nested field error

- **WHEN** a parser can locate a failing nested value
- **THEN** its diagnostic uses that span or the nearest available enclosing span

#### Scenario: Malformed source file

- **WHEN** one discovered input cannot be parsed
- **THEN** the report includes a PARSE error and publishing is prevented

### Requirement: Validated semantic state

Lore SHALL refuse to expose a semantic snapshot from a build containing error diagnostics, and SHALL preserve entity identity, source properties and canonical relation data when creating a valid snapshot.

#### Scenario: Error build snapshot

- **WHEN** a consumer attempts snapshot conversion on an invalid build
- **THEN** conversion rejects the build

### Requirement: Reference surface and classification selection boundaries

Bare typed references SHALL be exact logical IDs. WikiLinks MAY resolve an exact ID or unambiguous filename stem; local Markdown links MAY resolve an unambiguous file record. Parsed fragments SHALL NOT independently select a section entity in a multi-record file. When multiple classes match, designator and rule passes SHALL each use class-name order; Lore SHALL NOT infer the most specific class or diagnose all classifier overlaps.

#### Scenario: Bare filename stem

- **WHEN** a typed reference contains a file stem that differs from every record ID
- **THEN** it fails rather than using WikiLink stem fallback

#### Scenario: Ambiguous section document

- **WHEN** a Markdown file contains several records and is referenced through a file link plus fragment
- **THEN** the fragment does not provide general section-entity selection; an exact record ID is needed

#### Scenario: Several matching classifiers

- **WHEN** flat rules for more than one class match without an explicit designator
- **THEN** the first matching class in name order is selected
