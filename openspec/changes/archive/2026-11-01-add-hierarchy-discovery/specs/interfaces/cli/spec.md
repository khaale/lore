## ADDED Requirements

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
