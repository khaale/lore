# Changelog

## 0.2.0

### Minor Changes

- 67cf87b: Simplify PTC reads and retained results: remove per-entity capability metadata, return compact graph previews, use one 16 MiB retention budget, accept empty batch reads, and check source freshness at call boundaries instead of rescanning before every operation. The `maxValueBytes` option is removed; `maxRetainedBytes` bounds both individual values and the complete result store.

  Skip ignored directory trees during file discovery, avoiding filesystem work in dependency and generated-site folders.

- a952d08: Replace the private SQLite index with compact format 2: shared types/paths/predicates,
  single entity content with lossless raw differences, and integer graph tables
  derived in SQL. Public reads retain their results, ordering and lifecycle semantics.
  Older SQLite databases require explicit removal/rebuild, without automatic migration.
- a952d08: Add model-owned `lore:sources` declarations to extract entities and typed links
  from nested local YAML/JSON, with OpenAPI/database examples, bounded execution,
  record-pointer provenance and shared JSON/SQLite index integration.
- 2e2980f: Add editable hierarchy candidates and bounded instance navigation to SDK and CLI,
  including source-context hypotheses, alternative axes, exact scalar groups,
  explicit labels and optional checked forest-LCA placement. Keep ordinary flat
  queries and canonical graph reads available for composition. Include independent
  relative structure/connectivity type hints without filtering or changing placement.

  Support optional individual entity scores with includeScores / CLI --scores,
  normalized per actual type across the selected hierarchy without changing pages.

  Reuse one bounded hierarchy analysis and lazy instance-score calculation within
  each readSnapshot callback; evict on definition/budget changes and errors, and
  release on callback exit without changing formulas or the public API.

- 67cf87b: Index entity identities and incident relations once per workspace to accelerate batch reads and reference filters. Graph methods accept query/read collections and arrays of entity identities directly. Selected reference fields now appear in entity properties as resolved target IDs (arrays for multivalued fields), alongside detailed relations; inferred inverse relations remain separate from authored property values.
- a8a269b: Support inherited unique lists, record-level boolean constraints and conditional class rules with presence checks. Validate union targets and references recursively in inline values, expose nested relations and resolved properties, and describe effective constraints through the public SDK. Rebuild derived indexes to establish the stronger validation contract.
- 2e2980f: Read an explicitly named Markdown-table reference column into a containing
  record's multivalued reference field, preserving cell provenance and narrative.
  Distinguish absent/status-only sections from malformed or ambiguous tables.
- 2e2980f: Expose effective annotations on type, field and nested reference-path descriptions
  through schema.describeType in JSON, SQLite and PTC readers. Consumers can group
  types and classify relations with custom metadata; values are detached from model
  state, and existing summary catalogs and graph semantics stay unchanged.
- a8a269b: Add a shared SQLite index including stored narrative, explicit indexed/refresh-on-read SDK policies, transactional grouped reads and conditional CLI refresh. Preserve JSON defaults and make JSON graph preparation lazy.

  Handle transient SQLite reader startup contention with bounded asynchronous waiting and an explicit INDEX_BUSY error instead of incorrect rebuild guidance.

### Patch Changes

- a952d08: Speed up graph builds with per-build reference-target indexes. Read source files
  in bounded concurrent batches, preserve candidate/diagnostic order and avoid
  repeated source-position scans and unnecessary Markdown tokenization.

  Compile/discover once per SQLite rebuild and build secondary indexes after row
  loading in the publication transaction. Publish the validated data read without
  a post-build source-stability rescan; later refresh checks detect concurrent edits.
  Filter bounded graph candidates before hydrating rejected edges/provenance,
  preserving graph results and coverage.

- daedd4e: Bound intermediate hierarchy placements before allocating child arrays, including
  repeated type occurrences and child-count lookahead. Include direct owners before
  checking whether LCA placement has multiple distinct participants. Claim matching
  Markdown-table links when frontmatter already supplies the same reference value,
  preventing an extra generic edge while preserving frontmatter provenance.
- 67cf87b: Provide a compact, model-independent usage entrypoint and a self-contained PTC API contract with exact result shapes and independent operations. Distinguish technical entity metadata from model property selection, and cover metadata-only reads, nested values, graph reads and output previews without prescribing domain vocabulary or a fixed workflow.
- 1264f14: Share effective class ancestry checks, stable SDK serialization and JSON source
  projection. Reuse the existing canonical graph across JSON graph/hierarchy reads.
  Separate hierarchy definitions, computation, proposal, scoring and placement;
  retain the existing public SDK/CLI contracts, formulas and finite work bounds.
  Use one portable JSON formatter for both CLI index and watch publication.

## 0.1.0

Initial unified package with the Lore CLI, TypeScript SDK, programmatic tool
calling, reusable agent skills and an example knowledge model.
