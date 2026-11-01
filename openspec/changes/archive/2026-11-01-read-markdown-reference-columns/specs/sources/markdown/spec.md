## ADDED Requirements

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
