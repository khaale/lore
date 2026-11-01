## ADDED Requirements

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
