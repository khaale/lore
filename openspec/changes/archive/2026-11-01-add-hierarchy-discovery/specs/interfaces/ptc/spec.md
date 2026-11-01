## ADDED Requirements

### Requirement: Bounded hierarchy composition

PTC readers SHALL expose the shared hierarchy operations with their own finite
definition, compute and page limits. PTC's complete query and graph selections
SHALL NOT remove hierarchy bounds. Existing execution tracing and read lifetime
rules SHALL apply without a new session or snapshot protocol.

#### Scenario: Hierarchy within a call

- **WHEN** a PTC program composes a hierarchy child page with entity hydration
- **THEN** the hierarchy retains its requested bounds and the program uses existing getMany for properties
