## MODIFIED Requirements

### Requirement: Typed reference resolution

Lore SHALL resolve typed references from exact IDs and supported complete WikiLinks/local Markdown-link surfaces, check target existence and compatible class including inheritance, and preserve available reference provenance. This SHALL apply recursively inside inline objects/arrays. Resolved target checks SHALL evaluate the effective range and reference boolean expression together; a broad inherited range SHALL NOT erase a narrower union condition. Invalid nested references SHALL identify the owning entity and concrete value path.

#### Scenario: Wrong target kind

- **WHEN** a reference resolves to a record of an incompatible class
- **THEN** REFERENCE_TYPE is reported

#### Scenario: Missing target

- **WHEN** an ordinary typed reference has no resolvable target
- **THEN** BROKEN_REFERENCE is reported

#### Scenario: Narrowed reference union

- **WHEN** parent has inherited range Entity and any_of RuntimeEntity or Subsystem but targets a DeploymentSite
- **THEN** reference type validation fails despite DeploymentSite being an Entity

#### Scenario: Nested missing target

- **WHEN** position_refinements[0].scope targets a nonexistent record
- **THEN** a broken-reference diagnostic identifies the containing entity and nested value location

## ADDED Requirements

### Requirement: Owning-entity nested reference assertions

A valid reference contained in inline values SHALL create an assertion from its owning entity to the target, using its schema field path as the relation selector. Inline values SHALL NOT acquire standalone graph IDs. Array positions SHALL belong to diagnostic/source locations and SHALL NOT create separate relation predicates. Nested paths SHALL be discoverable and selectable by existing graph operations. Ambiguous path spellings SHALL fail schema normalization rather than bind arbitrarily.

#### Scenario: Repeated inline scope

- **WHEN** two position_refinements elements contain scope references
- **THEN** their assertions use position_refinements.scope and retain available per-occurrence source locations

#### Scenario: Graph context

- **WHEN** a consumer selects neighbors through position_refinements.scope
- **THEN** the owning entity and referenced entities participate using existing direction, canonicalization and graph bounds
