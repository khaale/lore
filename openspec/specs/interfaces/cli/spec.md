# interfaces/cli

## Purpose

Expose current-source reads, validation and saved-index navigation through the lore console.

## Dependencies

Commands use [sources](../../sources/discovery/spec.md), [linkml-profile](../../model/linkml-profile/spec.md)
and [knowledge-graph](../../core/knowledge-graph/spec.md) for discovery, validation and
record construction. index/watch follow [index](../../core/index/spec.md); explore
follows [exploration](../../core/exploration/spec.md). This specification owns command
syntax, read selection, CLI query/search/traversal semantics and output/exit behavior.

## Command map

| Commands                      | Data source                      | Selection/options                                        | Output and side effects                                                     |
| ----------------------------- | -------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| check [root], validate --root | Current files                    | schema; check also ignore/strict                         | CheckReport JSON or human diagnostics/counts; no writes                     |
| get, query, search            | Current files                    | ID/text or kind/repeated where; root/schema/json         | Semantic version-1 reports; no writes                                       |
| links, graph, impact          | Current files                    | ID; direction/relation for links; depth for graph/impact | Canonical assertion reports; no writes                                      |
| index [root]                  | Current files                    | schema/ignore/strict/out/json                            | Validated JSON index publication, default <root>/.artifact-index/index.json |
| watch [root]                  | Current files                    | schema/ignore/strict/out/poll/debounce                   | Repeated valid index publication; diagnostics on invalid edits              |
| list, refs                    | Saved index                      | index path; exact kind for list, ID for refs             | Human records/incident stored edges; no writes                              |
| explore [root] [id]           | Saved index plus compiled schema | view/depth/index/schema/json/raw                         | Core configured report; no writes                                           |

Read --where values support booleans, finite numeric literals, ordinary strings
and JSON-quoted strings, but not arrays/objects/null. watch durations accept unit
suffixes, for example 150ms or 1s. Graph and exploration depth default to 1.

## Requirements

### Requirement: Command families

The CLI SHALL expose check, validate, index, watch, get, query, search, links, graph, impact, list, refs and explore. Unknown commands/flags and invalid argument counts SHALL exit unsuccessfully. Help SHALL describe supported syntax.

#### Scenario: Unknown command

- **WHEN** the executable is invoked with an unknown verb
- **THEN** it exits nonzero with usage information

#### Scenario: Unsupported read flag

- **WHEN** a semantic source read receives an index/state option it does not support
- **THEN** the CLI rejects the flag

### Requirement: Current source reads

get/query/search/links/graph/impact SHALL compile and strictly validate current source files on every invocation, use --root with default current directory and require no saved index. Invalid inputs SHALL prevent a successful semantic read.

#### Scenario: External source change

- **WHEN** a source property changes after an earlier query
- **THEN** a new CLI query sees the saved edit without indexing

#### Scenario: Invalid current corpus

- **WHEN** a saved source acquires a validation error
- **THEN** the next semantic read exits nonzero

### Requirement: Validation interface

check SHALL accept a positional root and validate SHALL accept --root. Both SHALL provide the same strict validation report by default and fail on errors while allowing warnings. JSON mode SHALL return the structured report.

#### Scenario: Report parity

- **WHEN** check --json and validate --json read the same root with defaults
- **THEN** they produce equivalent validation content

#### Scenario: Warnings only

- **WHEN** validation reports warnings without errors
- **THEN** the exit status is successful

### Requirement: Get query and lexical search

get SHALL return one known entity or fail for a missing ID. query SHALL accept optional class name/type ID including subclasses and repeated top-level equality filters joined by AND. Filter values SHALL be typed scalars; multivalued fields SHALL match membership and reference fields SHALL match resolved target IDs. CLI search SHALL perform case-insensitive literal matching over IDs, type identities and recursive scalar property leaves, excluding narrative-only prose.

#### Scenario: Repeated filters

- **WHEN** query supplies two --where filters
- **THEN** only entities satisfying both are returned

#### Scenario: Typed string literal

- **WHEN** a numeric-looking string filter is explicitly JSON-quoted
- **THEN** it is compared as a string

#### Scenario: Nested search

- **WHEN** a literal appears only in a nested scalar property
- **THEN** CLI search returns its matching property path

### Requirement: Canonical link and traversal reads

links SHALL support in/out/both and an optional exact relation filter over asserted non-generic relations. graph SHALL traverse both directions to depth 0..32 and return distances and links within the reached node set. impact SHALL traverse incoming assertions and return deterministic shortest contiguous paths from affected entities to the root.

#### Scenario: Zero graph depth

- **WHEN** graph is requested with depth 0
- **THEN** only the root node is reached

#### Scenario: Equal impact alternatives

- **WHEN** two paths of equal length reach the same affected entity
- **THEN** one deterministic shortest path is returned

#### Scenario: Negative depth

- **WHEN** graph or impact receives a negative depth
- **THEN** the CLI rejects it

#### Scenario: Canonical semantic read

- **WHEN** a relation and its inferred inverse are present
- **THEN** CLI links/graph do not double-count the inferred mirror

### Requirement: Read report formats

Semantic reads SHALL provide human-readable output or JSON version-1 reports containing operation, schemaHash, normalized query and operation-specific data with deterministic ordering.

#### Scenario: Empty query

- **WHEN** a valid query matches no entities
- **THEN** a successful structured empty result is returned

### Requirement: Saved index commands

list and refs SHALL read the selected saved index. explore SHALL additionally compile the selected schema and reject a missing index or schema-hash mismatch with rebuild guidance. Explore SHALL default to card with an ID and overview without one.

#### Scenario: Changed model

- **WHEN** explore opens an index built against a different model hash
- **THEN** it fails with rebuild guidance

#### Scenario: List filter

- **WHEN** list receives --kind
- **THEN** it prints only artifacts with that exact stored kind

### Requirement: CLI flag and output boundaries

Source semantic commands SHALL accept interspersed flags and use --root; positional-root commands SHALL parse flags before their positional root. check/index/watch SHALL default strict to true and accept --strict=false; validate SHALL remain strict. index --json SHALL print diagnostics JSON followed on success by a publication status line, rather than promise one JSON document. list/refs SHALL remain human-readable saved-index commands.

#### Scenario: Non-strict check

- **WHEN** check receives --strict=false before its root
- **THEN** undeclared slots alone are not rejected by strict validation

#### Scenario: Index JSON output

- **WHEN** index --json publishes a valid index
- **THEN** stdout may contain diagnostics JSON and the textual publication confirmation

### Requirement: Explicit SQLite publication format

index and watch SHALL accept --format json|sqlite with JSON remaining the default. SQLite SHALL default to <root>/.artifact-index/index.sqlite and store the resolved source configuration needed for later refresh. Existing --out/schema/ignore/strict options SHALL retain their meanings. JSON list/refs/explore commands SHALL not silently reinterpret SQLite files.

#### Scenario: SQLite initialization

- **WHEN** index --format sqlite is run for a valid source root
- **THEN** it publishes a SQLite index and source configuration without editing authored files

#### Scenario: Existing JSON caller

- **WHEN** index is invoked without --format
- **THEN** its existing JSON output path and format remain unchanged

#### Scenario: SQLite watch

- **WHEN** watch selects sqlite and observes a valid edit
- **THEN** it publishes through the same coordinated refresh lifecycle as SDK/CLI refresh

### Requirement: Stateless conditional refresh command

refresh --index PATH SHALL check and conditionally update an initialized SQLite projection without a daemon. --max-age SHALL default to zero and --busy-timeout to 5000ms. Human output SHALL distinguish unchanged/updated/reused; --json SHALL return one structured result including generation/check information. Failure SHALL exit nonzero with a structured code/diagnostics in JSON mode and preserve the last valid generation.

#### Scenario: No-change invocation

- **WHEN** a separate CLI process refreshes unchanged sources
- **THEN** it reports unchanged without rebuilding entities/relations

#### Scenario: Overlapping invocation

- **WHEN** two refresh processes overlap
- **THEN** the waiter can report reused instead of performing a second check

#### Scenario: Invalid input invocation

- **WHEN** refresh --json finds invalid authored input
- **THEN** it exits nonzero with REFRESH_FAILED and retains the last valid projection

### Requirement: Saved hierarchy commands

The CLI SHALL expose hierarchy propose and hierarchy read over explicit saved
JSON/SQLite workspace selection, without implicit indexing. Text output SHALL be
compact and --json SHALL return structured results. Read SHALL require a definition
file and accept either a bare definition or exactly a proposal envelope's
definition member, not an arbitrary read result. Read SHALL support bounded root
and parent expansion. Invalid input SHALL exit unsuccessfully with useful errors.
The saved-workspace behavior SHALL be documented separately from existing CLI
current-source graph reads.

#### Scenario: Proposal roundtrip

- **WHEN** a caller saves hierarchy propose --json output and passes it to hierarchy read --definition
- **THEN** the CLI reads the contained definition without a conversion command or extra format

### Requirement: Optional instance scores
Hierarchy read SHALL accept --scores to request individual focus hints. Default
output SHALL omit them. Text and JSON output SHALL preserve the two separate
components without changing page order.

#### Scenario: Score opt-in
- **WHEN** a caller reads a saved definition with --scores
- **THEN** real entity nodes include their independent structure/connectivity scores
