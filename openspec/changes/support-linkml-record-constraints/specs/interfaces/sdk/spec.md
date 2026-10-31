## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Nested reference projections

Entity projections SHALL preserve inline object/array shape and replace resolved nested reference values with target IDs, retaining scalar literals in supported unions. Entity relations and graph reads SHALL expose the nested relation selectors defined by knowledge-graph. Existing get/query/search pagination, narrative/provenance opt-in, coverage and freshness policies SHALL remain applicable. Public constraint DTOs SHALL NOT require private workspace-package imports.

#### Scenario: Inline refinement result

- **WHEN** an entity has an inline position refinement with a resolved scope link
- **THEN** its projected properties retain the inline refinement structure with scope as a target ID and expose the corresponding owning-entity relation
