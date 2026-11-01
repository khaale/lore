## Why

An authoritative model such as SA's `_meta/metamodel.yaml` cannot be consumed faithfully today: list uniqueness, class-level boolean constraints and conditional rules are rejected, while some union and nested references escape target validation. Existing adapted schemas remove constraints and alter cardinality, so successful indexing does not establish compatibility with the original contract.

## What Changes

- Execute inherited `list_elements_unique`, record-level boolean expressions and a bounded `rules` subset with `preconditions`/`postconditions`, `slot_conditions` and `value_presence`.
- Validate resolved targets against the full reference expression, including inherited refinements, and recursively validate/project references inside inline values without turning those values into independent entities.
- Expose the effective new constraints and nested reference selectors through public schema discovery, consistently for JSON and SQLite readers.
- Retain source ownership, current scalar/inline/reference union behavior and last-valid publication. **Behavior correction:** values previously accepted because target-type checks were incomplete will now fail validation; existing projections must be rebuilt to establish the stronger contract.

## Capabilities

### New Capabilities

None; extend the existing owning capabilities.

### Modified Capabilities

- `model/linkml-profile`: unique collections, record expressions, conditional rules, presence and effective constraint induction; retain an explicit unsupported boundary.
- `core/knowledge-graph`: resolved reference expression checks and recursive inline references.
- `core/index`: effective constraint persistence and complete validated publication.
- `interfaces/sdk`: effective constraint discovery and nested reference projection/selection.

Classification continues to use existing designators and classification_rules. SA-specific serialized type mappings remain outside this change; the authoritative model or its external adapter can provide existing classification_rules.

## Impact

Primary modules are schema parsing/normalization, core validation/reference resolution, SDK descriptions/projections, publication and existing CLI read paths. The SQLite part builds on the implemented `add-sqlite-index` change, which is not yet synced into main specifications; reconcile that delta before sync/archive rather than reintroducing its requirements here.

Only `@khaale/lore` remains public. Update README, the supported LinkML profile/reference, SDK docs, reusable skills and a root-package changeset. No new runtime dependency, mandatory daemon, general schema-patching engine, data migration, code execution, full LinkML reasoner, SA-specific generator/waiver/severity policy or BB UI work is included. SA files remain read-only; project-independent fixtures are required and the local SA corpus is optional acceptance input.
