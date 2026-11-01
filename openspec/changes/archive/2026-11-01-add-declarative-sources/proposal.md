## Why

Nested source documents currently remain whole-file records: consumers cannot
address OpenAPI operations/DTOs or database tables independently. The PoC showed
that both real formats can be extracted by one small declarative interpreter,
without embedding their vocabulary in Lore.

## What Changes

- Introduce schema-level `annotations.lore:sources` with named local YAML/JSON
  sources, file selectors and entity extraction rules.
- Support nested collection selection, explicit identities, field construction,
  typed entity references and bounded, declared traversal of local pointers.
- Compile declarations with the LinkML model and feed extracted candidates into
  existing validation, graph construction and both derived index formats.
- Give a matched file exactly one parser owner; preserve existing generic parsing
  for unclaimed files and existing ignore/exclusion authority.
- Ship documented OpenAPI and SA database examples expressed through the same
  vocabulary. Keep the source file and record pointer available for navigation.
- Keep this a directed input mapping. Export, reversible editing, remote fetching
  and complete OpenAPI/JSON Schema semantics are outside this change.

## Capabilities

### New Capabilities

- `sources/declarative`: source-independent extraction language, identity/link
  resolution, bounded execution and candidate integration.

### Modified Capabilities

- `model/linkml-profile`: supported schema-only `lore:sources` annotation,
  declaration validation and local import composition.
- `sources/discovery`: root-relative source selection, exclusive file claiming
  and participation in existing source-change observation.

## Impact

The schema compiler gains a normalized extraction plan; filesystem ingestion
executes it before the existing `buildGraph` boundary. CLI check/index/watch and
SQLite refresh use the same ingestion path. Existing SDK/PTC entity and graph
APIs remain unchanged; no plugin-specific API, adapter registry, external runtime
dependency or daemon is introduced. Only the root package receives a changeset.

This change builds on the implemented SQLite and record-constraint changes in
`a8a269b`. Their pending main-spec synchronization must be reconciled before
archiving this change; their requirements are not restated here.
