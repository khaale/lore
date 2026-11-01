## Decisions

Use a single typed annotation per multivalued reference slot:

```yaml
integrates_with:
  range: RuntimeEntity
  multivalued: true
  annotations:
    'lore:markdown_reference_column':
      heading: '### Интеграции'
      column: 'Целевой контейнер'
```

The annotation is a mapping with exactly heading/column. Validate shape, reference
mode and multivalued cardinality at compilation. Forbid competing whole-heading
selection on the same slot. Existing selector behavior remains unchanged.

Select the exact normalized heading and its section extent. No heading or no
pipe tables means no extracted property; status prose is not an empty-list
assertion. With tables present require exactly one containing the exact column;
duplicate selected headers, multiple matches, malformed tables and missing columns
are errors. Nonempty cells use the existing table reference conversion/target
validation; blank cells are skipped, an explicit empty table supplies an empty
list. Preserve row order and let ordinary cardinality/unique-value rules apply.
No row entities or guessed IDs, value transformations, fuzzy headers or executable
callbacks. No parsing of protocol strings.

Retain unselected columns and prose in narrative. Claim only WikiLinks in selected
cells to avoid a redundant generic assertion. Attach per-cell spans and table
property provenance. Existing frontmatter/manifest ownership conflict checks apply.
Multiple selected columns may own distinct fields, but two fields claiming the
same table column are ambiguous. Root package discovery exposes the annotation
through existing effective annotations.

Full SA acceptance must validate all current sources, preserve the entity set and
all prior canonical triples, and add exactly the101 checked pairs (including11
from be-plan). Separate JSON/SQLite candidates; no old index/config overwrite.
The BB owner adopts same corpus IDs after packed runtime verification. Source
cards remain externally owned and unchanged. Score experiments use own structure
and do not alter the shipped connectivity formula.
