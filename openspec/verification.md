# Completeness review snapshot — 2026-10-29

This is one-time review evidence for the current specification cleanup. It is not
a maintained traceability index, a normative capability or a requirement to update
implementation links whenever code moves. Main specs intentionally have no
Evidence sections.

## Reviewed surface and resulting coverage

| Reviewed implementation/public surface                              | Owning specification    | Coverage added or checked                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema decoder, profile checks, normalization and profile fixtures  | model/linkml-profile    | Import closure, allowedRoot exposure, inheritance/induction, identity, every supported primitive and field constraint family, accepted metadata, operational exclusions and annotation scope |
| Filesystem model/path resolution, discovery and stamps              | sources/discovery       | Default ambiguity, explicit path base, extensions, schema/ignore/output exclusions, ignore rules and stamp limitations                                                                       |
| YAML/JSON/JSONL/CSV adapters                                        | sources/structured-data | Record envelopes, wrapper limitation, native versus coerced values, row/line/document locators and available provenance                                                                      |
| Markdown parsing, enrichment, table expansion and manifest bindings | sources/markdown        | Frontmatter, conventional title/description fallback, exact selectors, section ownership/regions, heading identities, table extraction/conversion and manifest target modes                  |
| Graph building and semantic state                                   | core/knowledge-graph    | Classification precedence/name ordering, IDs, references/unions, file/stem/fragment limitations, inverse/generic relations, error reports and invalid-state rejection                        |
| Index publisher and polling watcher                                 | core/index              | Persisted shape, deterministic output, atomic replacement, last-valid recovery, schema/dependency/ignore observation and watch timing                                                        |
| Shared exploration implementation                                   | core/exploration        | All five views, annotated logical edges, hierarchy/dependency direction, neighborhood branch grouping, cycles, presentation and report shape                                                 |
| CLI command parser/dispatch and semantic reader                     | interfaces/cli          | All exposed commands/options, current-source versus saved-index reads, equality parsing, search/traversal differences, strictness, JSON/human output and flag placement                      |
| Public Workspace/ReadSnapshot/reader interfaces and implementation  | interfaces/sdk          | Every reader method, defaults/facets, metadata export limits, configured-view gating, query/search, graph input/result/coverage, continuation, freshness and readSnapshot policy             |
| Workspace calls, runtime/session/result/trace interfaces            | interfaces/ptc          | Inherited SDK semantics, execution-boundary policy, complete selections, output helpers, callback lifetime, response feedback, quotas, retained serialization/views and low-level scopes     |
| Root manifest, public declaration consumers and build/preflight     | distribution            | Single public package, runtime/toolchain, CLI/SDK declarations, packaged skills and release boundary                                                                                         |

This review inspected implementation and public types alongside existing tests and
packaged usage/modeling references. It did not infer coverage from requirement or
test counts. In particular, the SDK operation map was compared against Workspace,
ReadSnapshot, SchemaReader, EntityReader and GraphReader, with PTC-specific types
and low-level result/trace APIs reviewed separately.

## Corrections made during completeness review

- Ordinary Markdown does fill declared missing title/description fields from H1
  and prose after classification; this is different from classifying a heading.
- Ownership conflicts differ between ordinary documents and enriched records;
  equivalent ordinary declarations need not be rejected.
- Manifest heading_id targeting excludes anchor/id and enriches an existing
  entity rather than classifying a new one.
- readSnapshot shares the loaded source and checks each operation, but does not
  add workspace.call's completion-time freshness check or PTC lifetime.
- FieldDescription exports a constrained metadata projection, not every authored
  LinkML pattern/bound/expression.
- SDK configured-view gating differs from the shared core view algorithms.
- Result get(limit) bounds only top-level arrays/items and requires a positive
  integer; it is not a recursive graph preview and does not accept zero.
- SDK-shaped retained collections/graphs can omit undefined object fields, unlike
  custom retained data. Retention preserves data, not object prototypes/capabilities.
- Direct enum validation stringifies input; scalar-expression and SDK predicate
  checks are stricter. Classification syntax acceptance does not prove evaluation.
- A local Markdown fragment is not a general section-entity selection mechanism.
  Ordinary reference IDs, WikiLink filename fallback and local file links differ.

## Scope limits

The specifications describe the exposed local product and the behavior needed to
understand its current capabilities and plan changes. This is not a formal proof
of every internal branch, a measured test-coverage claim, an exhaustive diagnostic
message catalog or performance/concurrency certification. No unsupported capacity,
latency, security-sandbox or transaction guarantee has been invented.

Possible development directions and their existing constraints are indexed in the
[capability map](README.md). They are not represented as implemented requirements.

## Validation of this revision

- 11 capabilities, grouped under model, sources, core and interfaces, plus distribution.
- `openspec validate --specs --strict --json`: 11/11 passed, no issues.
- `openspec doctor --json`: healthy root, no relationship issues.
- Relative Markdown links: every target exists; legacy capability paths removed.
- Prettier: all current OpenSpec Markdown/YAML passes.
- Product code is unchanged. OpenSpec is tracked planning documentation; .agents/ remains local and ignored.

The original reconstruction ran pnpm check (118 tests in 20 files, including
isolated tarball installation) and pnpm test:cli (6 tests in 3 files). Those are
previous baseline results. Tests were not rerun for this specification-only
revision; current validation targets the changed artifacts.

## Validation environment

- Node v24.20.0 and pnpm 10.17.0 with CI=true.
- Repository preflight passed with the declared toolchain.
- Host-specific executable paths are session-local execution metadata.

## Independent review

A separate reviewer read README, config and all 11 specs without treating this
verification report as proof of quality. Its verdict was PASS WITH WARNINGS:
the corpus is usable for understanding and evolving the system, with no blocking
structural or comprehension issues found. This was an independent reader review,
not a second exhaustive source audit.

The two recommendations were applied: the LinkML profile now lists reserved
annotation input forms/values and their effective consumer placement, and spells
out actual cardinality precedence with a conflicting local/inherited scenario.
