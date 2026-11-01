## Context

Class and slot annotations already survive compilation, inheritance and SQLite
model persistence. The shared SDK discovery projection currently discards them.
See proposal.md for the consumer need.

## Goals / Non-Goals

Expose model-owned organization data through existing detailed discovery. Do not
introduce a metamodel registry, grouping language, new endpoints, BB-specific
validation or per-entity metadata copies. Schema/type/enum exports and summary
catalog annotations are outside this change.

## Decisions

- Add `annotations: Record<string, unknown>` to TypeDescription, FieldDescription
  and ReferencePathDescription. Always return a mapping, including `{}`, so
  consumers can inspect custom keys without separate absent-value handling.
- Clone effective runtime class/slot values at the projection boundary. Reuse the
  existing compiler's per-key inheritance and local precedence. Nested mappings
  are opaque winning values, not recursively merged group configurations.
- For inline paths, return annotations of the terminal reference slot. Parent
  container annotations remain on that container's field description; they are
  not silently propagated to each nested relation.
- Leave listTypes/describe summaries unchanged to keep ordinary catalog responses
  small. A consumer can hydrate detailed metadata with existing describeType calls.
- Consumer namespaces such as `bb:group` or `bb:role` are examples, not built-in
  Lore keys. Continue validating reserved `lore:` annotations under the existing
  supported LinkML profile. No annotation execution is added.

## Risks / Trade-offs

- Large payloads increase detailed metadata responses → only explicit detailed
  discovery includes annotations; no new truncation or invented byte guarantee.
- Returned objects could mutate cached schema state → deep-detach every projection
  and cover repeat reads for JSON and SQLite, plus PTC reuse.

No index format change or migration is needed. Existing SQLite generations already
contain annotations; authored edits use the ordinary rebuild/refresh lifecycle.
