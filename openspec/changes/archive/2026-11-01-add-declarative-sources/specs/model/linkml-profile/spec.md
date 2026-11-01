## ADDED Requirements

### Requirement: Declarative source annotation

Lore SHALL support `lore:sources` only in schema annotations. Its value SHALL be
a mapping of named sources with nonempty file selectors and nonempty entity lists,
with optional nonblank static namespace. Lore SHALL compile the vocabulary
defined in [sources/declarative](../../sources/declarative/spec.md), rejecting
unknown declaration keys/operators, invalid shapes, unknown bindings/rules/classes,
undeclared target fields and statically incompatible assignments. Projected
classes SHALL have one effective string-compatible identifier. Extraction SHALL
fill the identifier and any type-designator field from the generated ID and
declared class respectively, including when those fields are required. Mapped fields
SHALL NOT overwrite it or type designators. Data-dependent validation SHALL
follow the ordinary record validation contract. `poc:projections` SHALL NOT be
an executable alias, and the annotation SHALL NOT enable output generation.

#### Scenario: Valid input mapping

- **WHEN** a model declares valid `lore:sources` rules for a user-defined class
- **THEN** compilation provides their executable input semantics without adding a built-in domain class

#### Scenario: Invalid placement or reference

- **WHEN** `lore:sources` appears on a class/slot or refers to an unknown bound value or target rule
- **THEN** compilation fails before source extraction

#### Scenario: Unselectable field

- **WHEN** a rule assigns an undeclared field even though its class allows extra slots
- **THEN** compilation rejects the assignment rather than producing data hidden from ordinary SDK field selection

### Requirement: Source declaration composition

Lore SHALL compose named source definitions from its local schema import closure
by unique name, visiting a shared dependency once. Distinct duplicate
declarations SHALL fail rather than override or deep-merge. Effective source
declarations SHALL participate in schema identity. File selectors SHALL resolve
against the knowledge root, not the declaring schema's directory.

#### Scenario: Shared imported declaration

- **WHEN** two imports depend on one physical schema declaring a named source
- **THEN** that declaration participates once

#### Scenario: Conflicting source names

- **WHEN** a root and an imported schema each declare the same source name
- **THEN** compilation reports a conflict instead of selecting one

#### Scenario: Extraction edit

- **WHEN** an effective source field mapping changes
- **THEN** the compiled schema identity changes under the existing schema-identity contract
