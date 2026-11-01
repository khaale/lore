## ADDED Requirements

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
