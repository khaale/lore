# sources/structured-data

## Purpose

Decode YAML, JSON/JSONL and CSV records with format-specific value conversion and provenance.

## Dependencies

[model/linkml-profile](../../model/linkml-profile/spec.md) owns schema constraints;
[core/knowledge-graph](../../core/knowledge-graph/spec.md) owns classification and
reference resolution. This specification owns the input surface behavior below.

## Format comparison

| Format   | Record envelope                               | Conversion                                                                       | Provenance                                                       |
| -------- | --------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| YAML/YML | Mapping, list of mappings, multiple documents | Native parser types; no general string coercion                                  | Record and available nested value spans                          |
| JSON     | Object or array of objects                    | Native JSON values                                                               | Record locator, without precise token spans                      |
| JSONL    | One object per non-empty physical line        | Native JSON values; no multiline object                                          | Physical-line locator; available top-level spans are approximate |
| CSV      | Header plus flat rows                         | Boolean/simple numeric cell coercion independent of schema, even in quoted cells | Logical row locator; field spans identify headers                |

These formats share model validation and relation resolution, but their scalar
conversion differs. CSV is not an inline-object/list serialization format.
YAML companion manifests are specified in [Markdown](../markdown/spec.md).

## Requirements

### Requirement: YAML records

Lore SHALL accept a YAML mapping, a sequence of mappings and multiple YAML documents, skip empty/null documents and reject non-empty non-record shapes. Native YAML types SHALL be preserved without schema-based string coercion.

#### Scenario: Multiple documents

- **WHEN** a YAML file contains two mappings separated by ---
- **THEN** two candidates with distinct source locators are produced

#### Scenario: Quoted boolean

- **WHEN** a YAML boolean field is authored as a quoted string
- **THEN** it remains a string for validation

### Requirement: JSON and JSONL records

Lore SHALL accept a JSON object or array of objects, and one complete JSON object per non-empty JSONL physical line. It SHALL reject scalar records, JSONL arrays and malformed JSON without treating them as partial records.

#### Scenario: Blank JSONL line

- **WHEN** a JSONL stream contains blank lines between objects
- **THEN** only object lines become candidates with physical-line locators

#### Scenario: Multiline JSONL object

- **WHEN** one JSON object spans physical lines in JSONL
- **THEN** parsing fails

### Requirement: Flat CSV records

Lore SHALL parse trimmed CSV headers, quoted and multiline cells, reject malformed quoting/column counts, omit empty cells and coerce boolean and simple numeric text independently of schema. It SHALL NOT decode JSON-looking cells as objects or arrays.

#### Scenario: Quoted numeric cell

- **WHEN** a quoted CSV cell contains 001
- **THEN** it is numerically coerced rather than preserving leading zeroes

#### Scenario: Array cell

- **WHEN** a CSV cell contains JSON array text
- **THEN** it stays text and cannot satisfy a multivalued field

### Requirement: Source location fidelity

Lore SHALL preserve physical file and record locators and available property spans. YAML SHALL provide located values where parsed; JSON SHALL retain record-level provenance and JSONL SHALL additionally expose available approximate top-level spans; CSV field spans SHALL identify headers rather than promise precise value tokens.

#### Scenario: YAML list record

- **WHEN** a YAML sequence contains multiple records
- **THEN** each candidate remains addressable separately

#### Scenario: JSON provenance

- **WHEN** an entity originated in a JSON array
- **THEN** its provenance identifies the file and array record without inventing token spans

### Requirement: Record envelopes and locators

Structured data SHALL expose top-level records only; arbitrary wrapper keys SHALL NOT unpack nested children. JSON/YAML list records SHALL have one-based #N locators; multi-document YAML SHALL include #doc=N; JSONL SHALL use physical #line=N and CSV logical #row=N starting at row 2. Moving files or reordering record lists SHALL NOT promise stable source-derived identity.

#### Scenario: Wrapper mapping

- **WHEN** a YAML mapping contains records: [...] with no matching class of its own
- **THEN** the child list is not automatically expanded into records

#### Scenario: JSONL blank line locator

- **WHEN** the first object occurs after one blank physical line
- **THEN** its source locator is #line=2
