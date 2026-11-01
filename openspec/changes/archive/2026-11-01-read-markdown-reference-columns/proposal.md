## Why

SA has101 explicit runtime integration rows but its connected model does not read
them. Whole-heading reference selectors also reject valid status prose on cards
without integration tables. A column-specific mapping is needed without changing
externally owned cards or weakening existing reference-section validation.

## What Changes

- Add lore:markdown_reference_column with explicit heading and column on a
  multivalued reference field of the containing record.
- Read exact cells from a unique valid table; retain source/cell provenance and
  ordinary target validation. Keep other columns and status prose as narrative.
- Treat absent heading/table as no authored value; reject malformed/ambiguous
  tables, missing columns and competing property ownership.
- Configure and verify a separate SA integration model/index candidate, then
  coordinate explicit BB adoption. No hardcoded SA parser or score formula change.

## Capabilities

### Modified Capabilities

- sources/markdown: reference-column extraction into an existing record.
- model/linkml-profile: supported executable annotation and shape validation.

## Impact

Schema compiler, core materialization, public authoring documentation/skill,
regression and packed CLI tests, root changeset. No new SDK methods, index-format
migration, source-card edits, inline relation objects or protocol parsing.
