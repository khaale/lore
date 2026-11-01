# sources/discovery

## Purpose

Select the model and authored inputs, apply exclusions and observe saved input changes.

## Dependencies

[model/linkml-profile](../../model/linkml-profile/spec.md) owns schema constraints;
[core/knowledge-graph](../../core/knowledge-graph/spec.md) owns classification and
reference resolution. This specification owns the input surface behavior below.

## Requirements

### Requirement: Model selection

Lore SHALL discover .lore.yaml or model.yaml under the knowledge root. When both exist, it SHALL require explicit CLI --schema or SDK schemaPath selection; when neither exists, it SHALL report a setup failure.

#### Scenario: Ambiguous defaults

- **WHEN** both model filenames exist without explicit selection
- **THEN** the operation fails with a model selection diagnostic

#### Scenario: Explicit model

- **WHEN** the caller selects one existing schema
- **THEN** that schema is used

### Requirement: Deterministic input discovery

Lore SHALL recursively discover supported Markdown, YAML/YML, JSON, JSONL and CSV files in deterministic order. It SHALL exclude root model filenames, the selected schema and dependencies, ignore file, selected index output and .git/.artifact-index directories.

#### Scenario: Imported schema

- **WHEN** a schema dependency is located among source documents
- **THEN** it is not parsed as a knowledge record

#### Scenario: Derived output

- **WHEN** the index output exists under the knowledge root
- **THEN** it is excluded from source discovery

### Requirement: Git style ignores

Lore SHALL apply ordered Git-style ignore rules from .artifactignore or an explicit ignore path, including negation, anchored rules and globstars. A missing ignore file SHALL be tolerated; invalid supported-pattern syntax SHALL fail discovery.

#### Scenario: Negated exclusion

- **WHEN** a valid later rule re-includes an eligible path
- **THEN** discovery respects the ordered rules

#### Scenario: Malformed bracket rule

- **WHEN** an ignore pattern contains unmatched brackets
- **THEN** discovery reports an invalid ignore pattern

### Requirement: Observed input stamps

Lore SHALL observe discovered inputs, schema dependencies and ignore-file presence through sorted path/size/mtime stamps. Missing watched inputs SHALL have an observable missing stamp. This mechanism SHALL NOT imply content-hash change detection.

#### Scenario: Ignore file created

- **WHEN** a previously missing ignore file appears
- **THEN** the input stamp set changes

#### Scenario: External schema edit

- **WHEN** an observed schema dependency changes size or mtime
- **THEN** the input stamps change

### Requirement: Explicit source configuration

An explicit schema path SHALL override default-name ambiguity and resolve from the process working directory, including when root differs. SDK indexPath/ignorePath and CLI explicit paths SHALL similarly be caller paths rather than implicit root-relative paths. Automatic discovery SHALL recognize .md, .markdown, .yaml, .yml, .json, .jsonl and .csv case-insensitively.

#### Scenario: Custom schema filename

- **WHEN** a caller supplies an explicit existing custom schema path
- **THEN** default-name discovery does not select a different model

#### Scenario: Uppercase extension

- **WHEN** a discovered record filename ends in .JSON
- **THEN** the JSON parser handles it

### Requirement: SQLite refresh input baseline

SQLite refresh SHALL observe eligible file additions/deletions as well as size/mtime, selected schema/import dependencies and ignore-file presence. Automatic model selection SHALL observe both default model names; explicit selection SHALL remain explicit. SQLite database/journal files SHALL not become authored inputs. Published-only reading SHALL not perform this observation.

#### Scenario: New record file

- **WHEN** an eligible file is added after publication
- **THEN** the next required source check detects the changed path set

#### Scenario: Ambiguous automatic model

- **WHEN** a second default model filename appears after an automatically selected model was published
- **THEN** refresh reports model ambiguity and retains the last valid generation

#### Scenario: Dependency repair

- **WHEN** a changed model imports an invalid dependency and is later repaired
- **THEN** the subsequent source-check/build path can validate and publish the repair

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
