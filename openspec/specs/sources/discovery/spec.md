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
