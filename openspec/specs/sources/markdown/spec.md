# sources/markdown

## Purpose

Extract modeled file records, sections and table rows from Markdown and companion manifests.

## Dependencies

[model/linkml-profile](../../model/linkml-profile/spec.md) owns schema constraints;
[core/knowledge-graph](../../core/knowledge-graph/spec.md) owns classification and
reference resolution. This specification owns the input surface behavior below.

## Authored surfaces

| Surface                  | Shape and role                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| File record              | YAML frontmatter at the beginning of .md/.markdown; classified properties plus body narrative                               |
| Selected property        | Slot annotation lore:markdown_selectors selects exact heading level/text; extracts one paragraph, one list or WikiLinks     |
| Anchored section         | lore.sections maps an explicit {#anchor} to metadata including type/identity                                                |
| Heading identity section | Schema lore:heading_identity rules derive ID/title for a lore.sections entry keyed by the derived ID                        |
| Declared table           | lore.tables maps a table name to scope, class, id_column and columns; each row is a record                                  |
| YAML companion           | lore_manifest: 1 with bindings and/or tables lists; enriches existing document/section records or declares table extraction |

Anchors and table names use `[A-Za-z][A-Za-z0-9_-]*`. Heading-derived logical IDs
can contain punctuation and use encoded heading-id source locators. Plain headings
and undeclared tables remain prose. Examples and authoring syntax are illustrated
in the packaged [format reference](../../../../skills/lore-modeling/references/file-formats.md).

## Requirements

### Requirement: Frontmatter and narrative

Lore SHALL read YAML frontmatter and preserve Markdown body narrative. An ordinary heading alone SHALL NOT classify a record. Conventional title/description fallback for an already classified record is specified below. Narrative code spans/fences SHALL NOT supply local graph links.

#### Scenario: Unclassified prose

- **WHEN** a Markdown document has headings but no recognized record declaration or classification
- **THEN** the prose does not automatically become a typed entity

#### Scenario: Narrative read

- **WHEN** a typed Markdown record is read with narrative enabled
- **THEN** its retained prose can be returned

### Requirement: Selected property sections

Lore SHALL extract properties from exact level-and-text heading selectors. Scalar selections SHALL use one paragraph, scalar lists one Markdown list, and reference selections WikiLinks with cardinality appropriate to the field. Selected scalar prose SHALL remain text rather than being coerced to numeric or boolean values.

#### Scenario: Wrong heading level

- **WHEN** a selector names ## Summary but the document contains ### Summary
- **THEN** that heading does not satisfy the selector

#### Scenario: Ambiguous selected content

- **WHEN** selected regions overlap or a scalar section contains competing paragraphs
- **THEN** Lore produces located ownership or shape diagnostics

### Requirement: Declared section entities

Lore SHALL create independently addressable Markdown sections only through explicit lore.sections declarations. It SHALL bind explicit anchors or configured heading identities and preserve section and heading provenance.

#### Scenario: Heading derived identity

- **WHEN** a declared section matches one configured heading rule
- **THEN** its ID and title are derived from the heading groups

#### Scenario: Overlapping identity rules

- **WHEN** a targeted heading matches competing identity rules
- **THEN** Lore reports ambiguity with the heading location

### Requirement: Single property ownership

Enriched records SHALL have one owner per property across declarations, selected sections, heading-owned values and manifests; explicit empty/null declarations SHALL count as ownership. Ordinary non-enriched frontmatter/selector values MAY agree without conflict after supported normalization; conflicting populated values SHALL produce MARKDOWN_FRONTMATTER_CONFLICT.

#### Scenario: Empty field conflict

- **WHEN** frontmatter explicitly declares an empty field and a manifest also supplies it
- **THEN** an ownership conflict is reported

#### Scenario: Heading title conflict

- **WHEN** another source conflicts with a heading-owned title
- **THEN** the competing sources are diagnosed

### Requirement: Companion manifests

Lore SHALL support lore_manifest: 1 bindings to document records, anchors or heading_id targets and companion table declarations. Bindings SHALL target resolvable documents within the knowledge root and SHALL NOT own identifier or type-designator fields.

#### Scenario: Enriched section

- **WHEN** a valid binding supplies an unowned declared relation to an anchored section
- **THEN** the same section entity is enriched without creating a duplicate

#### Scenario: Invalid target combination

- **WHEN** a binding combines incompatible heading_id and anchor targeting
- **THEN** it is rejected before target resolution

### Requirement: Declared table selection

Lore SHALL leave undeclared tables as prose. A lore.tables or companion declaration SHALL select one pipe table under an exact heading scope, fix its class and map named headers to slots. The class SHALL have exactly one identifier supplied by id_column; selected headers SHALL be unambiguous.

#### Scenario: Two tables in scope

- **WHEN** one declaration selects a scope containing two tables
- **THEN** selection fails with a diagnostic

#### Scenario: Fenced example

- **WHEN** a code fence contains a pipe table
- **THEN** it is ignored by table discovery

### Requirement: Table row values and provenance

Lore SHALL create one entity per valid declared row with cell provenance; decode escaped pipes and alignment delimiters; coerce declared scalar types; accept flat JSON arrays for multivalued cells and exact IDs or complete WikiLinks for reference cells. Empty scalar cells SHALL be absent and empty multivalued cells SHALL be empty arrays. Inline objects and nested array/object cells SHALL be rejected.

#### Scenario: Numeric row value

- **WHEN** a declared integer column contains valid numeric text
- **THEN** the row property is an integer with a cell location

#### Scenario: Invalid declaration

- **WHEN** a table declaration has shape errors or a duplicate declaration name
- **THEN** partial rows are not expanded

#### Scenario: Duplicate row identity

- **WHEN** two rows declare the same ID
- **THEN** validation reports duplicate identity

### Requirement: Conventional Markdown property fallback

After classification and explicit selected-property extraction, missing declared title/description slots SHALL use the first observed H1 and first prose paragraph respectively. Existing values SHALL remain authoritative. Frontmatter SHALL be an initial YAML mapping delimited by --- and closed by --- or ...; malformed/unterminated frontmatter SHALL fail parsing.

#### Scenario: Declared title fallback

- **WHEN** a classified Markdown record declares a title slot in its schema but omits its value and has an H1
- **THEN** the H1 supplies title

#### Scenario: Explicit title wins

- **WHEN** frontmatter already supplies title while the document H1 differs
- **THEN** automatic title fallback does not replace the authored value

#### Scenario: Undeclared conventional field

- **WHEN** a classified document has an H1 but its class has no title slot
- **THEN** the H1 does not create an undeclared title property

### Requirement: Section region boundaries

Declared section records SHALL retain their own narrative region through the next equal-or-higher heading. Nested declared entity regions SHALL produce BINDING_OVERLAP. Enriched section narrative SHALL exclude selected property regions; document narrative and source metadata SHALL remain separately attributable. Anchor declarations SHALL supply stable identity for an identified class; heading conventions SHALL own their derived ID/title.

#### Scenario: Nested declared entities

- **WHEN** an explicitly declared section contains another declared entity section
- **THEN** Lore diagnoses the overlapping entity regions

#### Scenario: Selected relation narrative

- **WHEN** an enriched section contains a schema-selected relation region
- **THEN** the relation is extracted without also retaining that selected region as section narrative

### Requirement: Manifest binding shape and identity

A version-1 manifest SHALL accept bindings with document, optional anchor, id and properties, or document, heading_id and properties. heading_id SHALL NOT combine with anchor/id. Targets SHALL already exist, and an explicit id SHALL match the target identity. Unknown binding keys, invalid version, missing/ambiguous targets and identifier/type-designator ownership SHALL be diagnosed; a manifest SHALL NOT classify a new record.

#### Scenario: Unclassified target document

- **WHEN** a manifest binds an ordinary prose file that has no classified document/section entity
- **THEN** the binding fails instead of creating a new entity

#### Scenario: Mismatched target ID

- **WHEN** a binding targets an existing anchored section but supplies a different id
- **THEN** the identity mismatch is diagnosed

### Requirement: Declared reference column
Lore SHALL extract a named Markdown-table column into an existing record's
multivalued reference field through lore:markdown_reference_column with explicit
heading and column. It SHALL preserve row order, skip blank cells and use ordinary
reference target and cardinality validation. It SHALL preserve the unselected
prose/columns as narrative and attach table/cell source provenance. Only selected
cell links SHALL be claimed by the field.

#### Scenario: Integration targets
- **WHEN** a matching table contains target references and other metadata columns
- **THEN** only the selected target column populates the declared field

### Requirement: Missing and invalid table distinction
An absent heading or table SHALL leave the property absent without rejecting
status prose. A selected empty table SHALL supply an empty list. Duplicate heading,
ambiguous tables/selected headers, malformed tables, present tables without the
selected column and competing property/cell ownership SHALL fail explicitly.

#### Scenario: Unspecified integrations
- **WHEN** a selected heading contains prose without a table
- **THEN** the prose remains narrative and no reference list is asserted

#### Scenario: Invalid source table
- **WHEN** a selected table is malformed or two tables match its column
- **THEN** validation reports the source location rather than silently skipping data
