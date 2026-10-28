# Source formats in Lore

Lore reads authored files into one typed graph. The model defines classes,
properties and relations; file formats determine how those values are authored.
Use [LinkML support](linkml-support.md) for the model's supported semantics and
[model patterns](model-patterns.md) for a complete `.lore.yaml` example.

## At a glance

| Format                         | Record layout                                                                     | Lists and nested objects                                                            | Prose and extra structure                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| YAML, YML                      | One mapping, a list of mappings, or multiple `---` documents.                     | Native lists and mappings, validated against the model.                             | YAML manifests can enrich Markdown records and declare tables.                                  |
| JSON                           | One object or an array of objects.                                                | Native arrays and objects.                                                          | No Markdown narrative extraction.                                                               |
| JSONL                          | One object per non-empty physical line.                                           | Arrays and nested objects inside each record.                                       | Useful for generated record streams; not a streaming query service.                             |
| CSV                            | Header row followed by records.                                                   | Flat scalar cells; JSON array/object text is not decoded.                           | A simple option for scalar catalogs, not typed nested records.                                  |
| Markdown, `.md` or `.markdown` | A frontmatter record, explicitly declared section records or declared table rows. | YAML frontmatter and schema-selected sections; flat arrays in declared table cells. | Narrative, typed sections, heading identities, pipe tables, WikiLinks and local Markdown links. |

All formats use the same schema validation, identity and relation rules. They do
not provide a source-editing API or a round-trip serializer. A nested object is
not automatically another graph record; use an explicit record and reference when
it needs its own identity.

Record IDs are unique across the knowledge root, not just within one file. A
classified record whose class has no identifier gets a source-derived ID; moving
the file or reordering a record list can change that identity.

The examples below are alternative representations of records. Do not put all
of them into the same knowledge root with the same IDs. They assume the Decision
model from [model patterns](model-patterns.md), including the existing `ADR-001`.

## YAML

Both `.yaml` and `.yml` are discovered. A record is an ordinary mapping:

```yaml
id: ADR-003
kind: Decision
title: Prefer local processing
status: accepted
depends_on: [ADR-001]
```

A top-level sequence creates one candidate per mapping. Multiple YAML documents
also work:

```yaml
id: ADR-003
kind: Decision
title: Prefer local processing
status: accepted
---
id: ADR-004
kind: Decision
title: Validate locally
status: proposed
depends_on: [ADR-003]
```

Empty/null YAML documents are skipped. A non-empty document must be a mapping or
a sequence of mappings. An arbitrary wrapper such as `records: [...]` does not
automatically unpack its children into records.

YAML values retain parser-provided types. A quoted numeric or boolean value stays
a string; an actual boolean is required for a boolean slot. Multivalued slots
require lists, and inline objects require mappings. Field and nested-value
locations are available when the parser can locate them.

## JSON

Use one object or an array of objects:

```json
[
  {
    "id": "ADR-003",
    "kind": "Decision",
    "title": "Prefer local processing",
    "status": "accepted",
    "depends_on": ["ADR-001"]
  }
]
```

Arrays produce separate records, with source locators such as `decisions.json#1`.
Scalar roots, nested arrays in place of records, JSON comments and trailing
commas are not accepted. Strings are not converted to numbers or booleans.
JSON provides file/record provenance, not precise field token spans.

## JSONL

```jsonl
{"id":"ADR-003","kind":"Decision","title":"Prefer local processing","status":"accepted"}
{"id":"ADR-004","kind":"Decision","title":"Validate locally","status":"proposed","depends_on":["ADR-003"]}
```

Blank lines are ignored. Each remaining physical line must be a complete JSON
object; an array or scalar on a line is rejected. A pretty-printed object spanning
multiple lines is not a JSONL record. Source locators identify the physical line,
such as `decisions.jsonl#line=2`; detailed JSON token provenance is limited.

## CSV

```csv
id,kind,title,status
ADR-003,Decision,Prefer local processing,accepted
ADR-004,Decision,Validate locally,proposed
```

The first row supplies trimmed field names. The parser supports CSV quoting,
escaped quotes and quoted multiline cells; malformed quoting or inconsistent
column counts are errors. Empty lines are skipped and empty cells are omitted
from record properties.

Cells are coerced independently of the schema: case-insensitive `true`/`false`
become booleans, simple integer/decimal strings become numbers, and other text
stays text. This also applies to quoted CSV cells: a quoted `001` is not a reliable
way to preserve a textual identifier with leading zeros. Prefer YAML or JSON for
such values.

CSV does not decode `[...]` or `{...}` cells as lists or inline objects. It cannot
supply a valid multivalued field by writing a JSON array into a cell. Source
locators identify logical data rows (`#row=2` for the first record); available
field spans point to headers rather than precise data-cell tokens.

## Structured Markdown

### File records and narrative

A simple record uses YAML frontmatter:

```markdown
---
id: ADR-003
kind: Decision
title: Prefer local processing
status: accepted
depends_on: [ADR-001]
---

# Prefer local processing

Keep authored knowledge and its validation near the project files.
```

The frontmatter follows the same typed-value rules as YAML. Prose is retained as
narrative and can be requested through SDK entity reads. Do not assume an ordinary
heading supplies a required property: author it explicitly or declare its mapping.
Unclassified prose files can remain unindexed; a heading alone does not create a
typed record.

Narrative retention does not imply full-text search over the entire document.
CLI search visits scalar property values, including nested/list values; SDK/PTC
search currently visits IDs, type identities and top-level scalar properties.
Read narrative explicitly when the task needs the surrounding prose.

### Properties selected from headings

A slot can select an exact heading through its annotations:

```yaml
depends_on:
  range: Decision
  multivalued: true
  annotations:
    'lore:markdown_selectors': ['## Dependencies']
```

The record can then author that property in its body:

```markdown
## Dependencies

- [[ADR-001]]
```

The heading level and normalized text must match. Scalar properties use one
paragraph; multivalued scalar properties use one Markdown list. Typed relation
sections use WikiLinks, with exactly one target for a single-valued relation.
Their text is interpreted as the declared slot, not arbitrary natural-language
extraction. Overlapping/ambiguous selectors, malformed section shapes and competing
property declarations produce diagnostics.

Selected paragraphs and scalar list items are extracted as text. They do not get
the schema-based numeric/boolean conversion used by declared table cells. Use
YAML frontmatter for native numbers, booleans or inline objects, or declared
table cells for supported scalar conversions.

### Section records

One document can declare independently addressable records:

```markdown
---
lore:
  sections:
    local-processing:
      id: ADR-003
      kind: Decision
      title: Prefer local processing
      status: accepted
---

## Local processing {#local-processing}

Keep processing near the authored files.
```

The declaration binds the section to a stable ID and class. It is an explicit
opt-in; Lore does not make every heading into a record.

For numbered headings, a schema-level convention can derive identity and title:

```yaml
annotations:
  'lore:heading_identity':
    - name: decisions
      levels: [2]
      pattern: '^(?<id>ADR-[0-9]+)\. (?<title>.+)$'
```

Use it with a declaration keyed by the derived ID:

```markdown
---
lore:
  sections:
    ADR-003: { kind: Decision, status: accepted }
---

## ADR-003. Prefer local processing

Keep processing near the authored files.
```

Patterns use ECMAScript regex syntax, must be anchored with `^` and `$`, and must
expose named `id` and `title` groups. Heading levels are 1–6. Do not redeclare
heading-owned identity or title in a conflicting property source.

### Declared pipe tables

Ordinary tables remain prose until a `lore.tables` declaration maps them:

```markdown
---
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
---

## Decisions

| ID      | Title                   | Status   | Dependencies |
| ------- | ----------------------- | -------- | ------------ |
| ADR-003 | Prefer local processing | accepted | ["ADR-001"]  |
```

One declaration selects one table under its exact heading scope and fixes the
row class. The class needs exactly one identifier slot; `id_column` supplies it.
Only mapped columns become properties. Headers must identify the selected columns
unambiguously. Each row becomes a record with cell provenance.

Supported tables have leading and trailing pipes, a delimiter row, optional
alignment colons and escaped `\|` cells. Fenced examples are ignored. Multiple
tables in the selected scope, malformed rows or duplicate row IDs are diagnostics.

Cells are interpreted using the slot's schema. Numbers and booleans are converted
to their declared scalar types. Multivalued cells require flat JSON arrays;
reference arrays contain strings. Empty cells give an absent scalar or an empty
list. Inline-object cells and nested arrays/objects in multivalued cells are not
supported. Reference cells accept exact IDs or complete WikiLinks, not arbitrary
Markdown-link syntax.

### Companion YAML manifests

A manifest can enrich an existing record without moving its metadata into the
document:

```yaml
lore_manifest: 1
bindings:
  - document: decisions.md
    anchor: local-processing
    id: ADR-003
    properties:
      depends_on: [ADR-001]
```

Bindings target a document record, an explicit anchor or a configured `heading_id`.
They can add declared properties but cannot own identifier or type-designator
fields. Competing property ownership produces diagnostics rather than an implicit
last-writer-wins merge. Manifests also support table declarations through a
`tables` list with `document`, `name`, `scope`, `class`, `id_column` and `columns`.

## References and links

- Typed relation fields validate their target class and target existence. Prefer
  exact IDs in structured data and WikiLinks in selected Markdown relation sections.
- Bare IDs, supported complete WikiLinks and local Markdown-link forms can resolve
  typed references in ordinary fields. Table cells have the narrower rules above.
- Unclaimed narrative WikiLinks and local Markdown links can create generic
  `references` edges, distinct from domain relations such as `depends_on`.
- HTTP, HTTPS, mail links and fragment-only Markdown links are not traversed as
  local graph references. Code spans and fenced code do not supply narrative links.
- A local file link resolves only when it identifies a suitable unambiguous target.
  Exact record IDs avoid ambiguity when a document contains several records.
- Unresolved narrative WikiLinks produce warnings; unresolved typed references
  are validation errors. Generic links do not substitute for a typed dependency.

## Discovery and validation

Lore discovers supported files below the knowledge root. Root model filenames,
selected schema dependencies, the ignore file and index output are excluded from
record discovery. `.git/` and `.artifact-index/` directories are skipped;
`.artifactignore` supplies Git-style exclusions.

Validate with `lore check --strict <root>`, then rebuild with `lore index <root>`.
Diagnostics can locate a file, record, property, section or table cell depending
on the parser and representation. An error-free check does not imply that every
untyped document became a record; inspect record counts and representative cards.
