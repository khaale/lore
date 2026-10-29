# Lore capability map

These main specifications describe implemented behavior for understanding the
product and planning changes. They are grouped by responsibility, with one
owner per rule. CLI, SDK and PTC remain separate interfaces, sharing explicit
contracts rather than copied query or graph definitions.

## Product flow

A local LinkML model defines record types and constraints. Discovery selects
saved authored files; format adapters extract candidates. The core classifies
records, validates values and resolves relations. Invalid input produces located
diagnostics; valid data can be published as a disposable JSON index.

CLI semantic reads build from current files without an index. Saved-index
commands and SDK read the persisted projection. PTC executes caller programs
against SDK read semantics, with complete computational selections and bounded
output previews. All authored inputs remain externally owned.

## Specifications

| Area         | Capability                                               | Owns                                                                                                              |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Model        | [LinkML profile](specs/model/linkml-profile/spec.md)     | Complete supported model subset, imports, induction, constraints, annotations, metadata and unsupported semantics |
| Sources      | [Discovery](specs/sources/discovery/spec.md)             | Model selection, paths, supported extensions, exclusions, ignore rules and input stamps                           |
| Sources      | [Structured data](specs/sources/structured-data/spec.md) | YAML, JSON/JSONL and CSV shapes, coercion and provenance                                                          |
| Sources      | [Markdown](specs/sources/markdown/spec.md)               | File/section/table entities, selectors, heading identities, manifests and ownership                               |
| Core         | [Knowledge graph](specs/core/knowledge-graph/spec.md)    | Classification, corpus identity, references, inverse/generic edges and valid semantic state                       |
| Core         | [Index](specs/core/index/spec.md)                        | Persisted shape, atomic publishing, last-valid behavior and polling watch                                         |
| Core         | [Exploration](specs/core/exploration/spec.md)            | Configured overview/card/tree/neighborhood/impact reports                                                         |
| Interfaces   | [CLI](specs/interfaces/cli/spec.md)                      | Commands, flags, source-read semantics, saved-index navigation and output/exit behavior                           |
| Interfaces   | [SDK](specs/interfaces/sdk/spec.md)                      | Public read APIs, projections, query/search, graph selection, ordinary freshness and coverage                     |
| Interfaces   | [PTC](specs/interfaces/ptc/spec.md)                      | SDK execution mode, policy exceptions, previews, feedback, traces and retained results                            |
| Distribution | [Package](specs/distribution/spec.md)                    | Single public package, toolchain, consumer/build boundary and release discipline                                  |

## Where is the supported LinkML profile?

**[model/linkml-profile](specs/model/linkml-profile/spec.md)** is the normative
entry point. Its support matrix distinguishes executable semantics, accepted
metadata and unsupported constructs; its requirements specify actual checks.
Classification behavior links to core/knowledge-graph, and format coercion links
to the relevant source specification. The packaged
[LinkML authoring reference](../skills/lore-modeling/references/linkml-support.md)
is a user guide, not a second local specification.

## Boundaries relevant to development planning

| Intended change                           | Start here                                                    | Existing boundary to consider                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| New LinkML construct or constraint        | model/linkml-profile                                          | Acceptance, normalization, value validation and exposed SDK metadata are different responsibilities                  |
| New source format or richer table values  | sources/structured-data or sources/markdown                   | Format coercion differs; inline values do not automatically become graph entities                                    |
| Richer classification or identity         | core/knowledge-graph                                          | Flat rule conditions and name-order selection; no general classifier or automatic stable IDs after file moves        |
| More relation inference or traversal      | core/knowledge-graph, then interfaces/sdk or core/exploration | Assertions, inferred inverse presentations and generic narrative links differ                                        |
| Search improvements                       | interfaces/cli and interfaces/sdk                             | CLI visits recursive scalar leaves; SDK/PTC only identity and top-level scalars; no narrative full-text/fuzzy search |
| Live refresh or stronger read consistency | core/index, sources/discovery and interfaces/sdk              | Saved index; size/mtime observation; no automatic reindex/replay or filesystem transaction                           |
| New view                                  | core/exploration, interfaces/sdk                              | Core report semantics and SDK advertised-view gating are separate                                                    |
| New query operator or aggregation         | interfaces/sdk, with interfaces/cli mapping if exposed        | eq/in/present only; larger computation is caller code                                                                |
| PTC streaming/execution/storage changes   | interfaces/ptc                                                | Caller-owned process, no callback sandbox/timeout, no side-effect rollback or durable result storage                 |
| Public API or package change              | distribution and affected interface                           | Root @khaale/lore import/declarations and isolated packed-consumer boundary                                          |

## Reading and maintaining the corpus

Main specs contain behavioral requirements and observable scenarios, with links
only to other owning specifications where needed. They do not maintain lists of
implementation/test files or claim a dedicated automated test for every case. Read the
contract and its limits before using a successful parse, an empty result or a
coverage flag as evidence of broader support. Requirements describe current
behavior, not desired future changes.

[Coverage and verification](verification.md) records the source/API review and
remaining evidence limits. openspec/ is tracked planning documentation; .agents/ remains local and ignored.
Neither is a package or runtime dependency.
