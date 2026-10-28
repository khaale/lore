# Lore model patterns

## Minimal linked records

Create `knowledge/.lore.yaml`:

```yaml
id: https://example.org/decisions
name: decisions
imports: [linkml:types]
default_range: string
slots:
  id:
    identifier: true
    annotations:
      'lore:explore_roles': [identity]
  kind:
    designates_type: true
    required: true
  title:
    required: true
    annotations:
      'lore:explore_roles': [title]
  status:
    range: DecisionStatus
    required: true
  depends_on:
    range: Decision
    multivalued: true
    annotations:
      'lore:explore_relation': dependency
      'lore:explore_label': depends on
      'lore:explore_views': [card, neighborhood, impact]
classes:
  Decision:
    slots: [id, kind, title, status, depends_on]
enums:
  DecisionStatus:
    permissible_values:
      proposed:
      accepted:
```

Create `knowledge/local-files.md`:

```markdown
---
id: ADR-001
kind: Decision
title: Keep knowledge in files
status: accepted
---

# Keep knowledge in files

Authors use their existing editor and review changes in Git.
```

Create `knowledge/validation.md`:

```markdown
---
id: ADR-002
kind: Decision
title: Validate before indexing
status: accepted
depends_on: [ADR-001]
---

# Validate before indexing

Publish the index only after the authored documents pass validation.
```

Classes, fields, IDs and statuses are examples; adapt them to the actual domain.
Bare IDs are useful in structured relation fields. Markdown-native typed relation
sections can use WikiLinks such as `[[ADR-001]]`. Narrative links remain distinct
from typed domain relations.

## Properties from Markdown sections

A slot annotation can select an exact heading:

```yaml
depends_on:
  range: Decision
  multivalued: true
  annotations:
    'lore:markdown_selectors': ['## Dependencies']
    'lore:explore_relation': dependency
```

The corresponding Markdown section is:

```markdown
## Dependencies

- [[ADR-001]]
```

Heading level and text matter. Use a paragraph for a scalar selected value and
direct list items for a multivalued value. Avoid competing declarations of the
same property in frontmatter, selected sections or manifests.

## Records within a document

Opt in explicitly through frontmatter:

```yaml
lore:
  sections:
    local-files:
      id: ADR-001
      kind: Decision
      title: Keep knowledge in files
      status: accepted
```

Pair it with an anchored heading such as `## Keep knowledge in files {#local-files}`.
Declare any required fields not derived by the chosen representation. Numbered
heading identities can also be configured through schema-level
`lore:heading_identity`; inspect the project's existing rules before changing them.

Companion manifests use `lore_manifest: 1` and `bindings` with a `document`,
optional `anchor`, logical `id` and `properties`. Use them when a document needs
structured enrichment without embedding all metadata into its source. Conflicting
identity or property declarations are diagnostics, not a merge strategy.

## Declared Markdown tables

An explicit declaration maps columns to slots:

```yaml
lore:
  tables:
    decisions:
      scope: '## Decisions'
      class: Decision
      id_column: ID
      columns:
        Title: title
        Status: status
        Dependencies: depends_on
```

The table under `## Decisions` could contain:

```markdown
| ID      | Title                    | Status   | Dependencies |
| ------- | ------------------------ | -------- | ------------ |
| ADR-001 | Keep knowledge in files  | accepted | []           |
| ADR-002 | Validate before indexing | accepted | ["ADR-001"]  |
```

The class comes from the declaration; the ID comes from `id_column`. Multivalued
cells use JSON arrays. Do not declare the same IDs again as separate file records.
Keep declarations and tables out of fenced examples when they should be parsed;
fenced example tables are ignored.

## Exploration metadata

Use `lore:explore_roles` to select identity, title, summary or card fields.
`lore:explore_relation` expresses a relation's presentation role, such as
dependency or hierarchy. `lore:explore_label`, `lore:explore_views` and
`lore:explore_order` configure console exploration. These annotations control
presentation; the relation's target type still comes from `range`.
