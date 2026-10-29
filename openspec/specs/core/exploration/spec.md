# core/exploration

## Purpose

Present schema-configured overview, card, tree, neighborhood and impact views over logical relations.

## Dependencies

This capability owns shared view semantics for CLI and SDK exploration.
[linkml-profile](../../model/linkml-profile/spec.md) owns annotation syntax and validation;
[knowledge-graph](../knowledge-graph/spec.md) owns stored assertions.
CLI/SDK own setup, freshness, options and report transport.

## Requirements

### Requirement: Views and metadata

Lore SHALL provide overview, card, tree, neighborhood and impact exploration reports with schema identity, query and graph metadata. A non-overview view SHALL require an existing root entity; unknown views SHALL fail. View depth SHALL be bounded to 0..32.

#### Scenario: Unknown view

- **WHEN** a caller selects an unsupported view
- **THEN** exploration fails

#### Scenario: Rootless tree

- **WHEN** tree is requested without an entity
- **THEN** exploration fails

### Requirement: Presentation model

Lore SHALL use configured field roles, title labels, ordering, visibility and view selection. Exploration graph views SHALL use annotated non-generic logical edges and suppress redundant inferred inverse representations.

#### Scenario: Hidden card property

- **WHEN** a populated field is configured hidden
- **THEN** it is absent from the card field list

#### Scenario: Generic prose link

- **WHEN** the index has generic narrative reference edges
- **THEN** they are excluded from the exploration logical graph

### Requirement: Overview and cards

Overview SHALL report class counts, connected components, entry points, orphans, highly connected records and cycles, scoped to a root component when selected. Cards SHALL expose configured fields and incident logical relations; raw mode SHALL include raw data, and human/raw output MAY include a bounded body summary.

#### Scenario: Fully cyclic component

- **WHEN** every record in the selected component has an incoming logical relation
- **THEN** overview reports cycles and explains the absence of entry points

#### Scenario: Raw card

- **WHEN** a populated record is explored with raw mode
- **THEN** its report includes raw_data

### Requirement: Bounded graph views

Tree SHALL follow hierarchy-role edges and mark cycles/revisits. Neighborhood SHALL expose reachable incident logical relations. Impact SHALL present dependency-oriented effects through configured relations. Empty views SHALL explain the lack of eligible relations where the report supports a reason.

#### Scenario: No hierarchy

- **WHEN** tree is requested for a model with only dependency relations
- **THEN** it returns no hierarchy children and explains the missing hierarchy

#### Scenario: Cycle revisit

- **WHEN** tree traversal encounters an entity on its current path
- **THEN** it marks the cycle and stops that branch

### Requirement: Exploration traversal semantics

Tree SHALL follow outgoing hierarchy relations. Neighborhood SHALL traverse both directions and group results by their first incoming/outgoing branch from the root, with distances. Impact SHALL follow incoming dependency-role relations only and report direct/indirect affected nodes with paths and count. Generic source links SHALL NOT substitute for configured relations.

#### Scenario: Reference versus dependency impact

- **WHEN** a root has incoming annotated reference-role edges but no incoming dependency-role edges
- **THEN** impact is empty with an explanatory reason

#### Scenario: Two-hop neighborhood branch

- **WHEN** a path starts with an incoming relation and traverses another relation at the next node
- **THEN** the reached context remains grouped under the initial incoming branch

### Requirement: Exploration report presentation

Explore reports SHALL contain version, view, normalized query, optional root, metadata and view data. Metadata SHALL identify annotated-non-generic-logical edge filtering, schema hashes, logical/inferred/excluded counts and cycles. Cards SHALL order fields by explore_order then name, derive labels from title-role fields with ID fallback, and include at most a 200-character body prefix plus ellipsis in human/raw summary mode.

#### Scenario: Unconfigured title

- **WHEN** a record has no populated title-role field
- **THEN** its exploration node label falls back to the ID

#### Scenario: Long human card narrative

- **WHEN** a human card is rendered for a body longer than 200 characters
- **THEN** the summary uses a bounded prefix and ellipsis
