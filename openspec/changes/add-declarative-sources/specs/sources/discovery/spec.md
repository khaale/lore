## ADDED Requirements

### Requirement: Declarative source file ownership

Lore SHALL match `lore:sources.files` root-relative literal paths and `*`, `**`,
`?` globs against eligible discovered inputs. Absolute selectors, parent traversal
and unsupported selector syntax SHALL fail compilation. Existing ignores,
model/import exclusions and derived-output exclusions SHALL remain authoritative.
A literal selector without an eligible input SHALL be diagnosed; an unmatched
glob SHALL yield no source documents. A file SHALL be claimed by at most one
named source, and claimed files SHALL bypass generic whole-document record
parsing. Unclaimed files SHALL retain their existing parser behavior.

#### Scenario: OpenAPI document claimed once

- **WHEN** an eligible YAML document matches one named source with operation and DTO rules
- **THEN** its rules run without also emitting the generic whole-document record

#### Scenario: Overlapping declarations

- **WHEN** two named sources match the same physical file
- **THEN** ingestion reports ambiguous ownership and does not publish a partial result

#### Scenario: Ignore remains authoritative

- **WHEN** a source glob would match a file excluded by the ignore rules
- **THEN** the file is not ingested by that source

#### Scenario: Empty glob

- **WHEN** a valid glob has no eligible matches
- **THEN** it contributes zero documents without making the model invalid

### Requirement: Declarative source observation

Matched document additions/deletions/stamps and schema-import source declarations
SHALL participate in the existing source-change observation used by index/watch
and SQLite refresh. Declarative rules SHALL NOT introduce hidden filesystem or
network dependencies. The existing unchanged-refresh and published-only SQLite
contracts SHALL continue to apply.

#### Scenario: New matched file

- **WHEN** an eligible matching file is added after publication
- **THEN** the next required check observes the changed input set and rebuilds through declarative ingestion

#### Scenario: Imported declaration changes

- **WHEN** an observed schema dependency changes its source mapping
- **THEN** watch or required refresh recompiles and applies the changed declaration

#### Scenario: Published-only read

- **WHEN** sources are unavailable but a valid SQLite generation contains extracted entities
- **THEN** indexed reads use that generation without executing source declarations
