## ADDED Requirements

### Requirement: Effective constraint publication

Published read metadata SHALL retain the effective constraints and nested relations used during validation. Record-constraint violations and invalid nested references SHALL prevent replacement of last-valid data. JSON and SQLite publication SHALL preserve their existing input/freshness policies. This contract SHALL NOT label a previously built projection as revalidated merely because a newer runtime opens it.

#### Scenario: Invalid record during refresh

- **WHEN** changed sources violate a class rule or contain an invalid nested reference
- **THEN** refresh preserves last-valid data and reports failure under the existing lifecycle contract

#### Scenario: Offline stored constraints

- **WHEN** live schema files are unavailable but a compatible SQLite projection exists
- **THEN** indexed schema discovery and reads use the same persisted effective constraints and relations
