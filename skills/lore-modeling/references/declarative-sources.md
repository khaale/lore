# Nested YAML/JSON sources

Schema-level `annotations.lore:sources` extracts entities from nested documents.
It is directed input mapping, without output generation or source editing.
No OpenAPI/database classes are built into Lore.

## Small complete model

```yaml
name: catalog
classes:
  Table:
    attributes:
      id: { identifier: true }
      name: { required: true }
annotations:
  lore:sources:
    tables:
      files: ['database/*.json']
      entities:
        - name: table
          class: Table
          select:
            - { from: root, path: [tables], each: items, as: table }
          at: table
          key: [{ get: { from: table, path: [name] } }]
          fields:
            name: { get: { from: table, path: [name] } }
```

For `database/main.json` containing `{"tables":[{"name":"orders"}]}`, the ID
is `tables/database%2Fmain.json/table/orders` and provenance points to the original
file at `#/tables/0`. Reordering changes the locator, not this name-based ID.
Run ordinary check/index/watch commands and use the usual SDK query/get/graph APIs.

## Source declarations and ownership

Each named source has nonempty `files` and `entities` arrays, and optional nonblank
static `namespace`. Selectors are root-relative literal paths or globs using `*`,
`**`, `?`. Absolute paths, parent traversal, backslashes, brackets/braces and
negation are unsupported. Selectors resolve from the knowledge root even inside
imported models. Ignores and schema/index exclusions remain authoritative.
Missing/excluded literal inputs are errors; empty globs are valid.

A claimed file must be JSON or single-document YAML with a mapping root. It is
not also parsed as a generic record. Multiple rules inside one source can extract
from the file; two named sources cannot both claim it. Unclaimed files retain
their existing parser behavior. Local imports compose source names uniquely,
without implicit merging/overrides; diamond dependencies participate once.

## Rules and field expressions

A rule has `name`, `class`, optional `select`, `at`, `key` and `fields`.
The class must have exactly one single string-compatible identifier; Lore fills
it and fills any type-designator field with the declared class, including when
that field is required. Field mappings cannot overwrite either. All mapped
fields, including constructed inline fields, must be declared. Extra-slot
permission alone does not make fields selectable in the SDK.

`select` steps have `from`, optional `path`, `each: items/entries`, `as` and optional
exact `keys` filtering. `root` binds the entire document. Bindings preserve value,
key/index and pointer; names cannot shadow existing bindings in the same scope.
Missing/null collections select nothing; present incompatible shapes are errors.
`at` selects the binding used for the record locator. Paths contain property names
or nonnegative integer indexes; omitted paths select the binding itself. Ordinary
paths treat `*` literally.

Each expression has exactly one operator:

| Expression                                      | Result                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| `{literal: value}`                              | Constant JSON data                                     |
| `{get: {from: binding, path: [field]}}`         | Detached copy of selected data                         |
| `{key: binding}`                                | Bound dictionary key or array index                    |
| `{object: {field: expression}}`                 | Constructed object                                     |
| `{collect: {select: [...], value: expression}}` | Collected constructed values                           |
| `{ref: {rule: name, key: [expression]}}`        | ID of a target entity in this document                 |
| `{pointer_refs: {...}}`                         | Unique IDs referenced at configured document positions |

Missing/null constructed object fields are omitted. Copies of nested values keep
internal nulls and structure. No code, templates, arithmetic, environment lookups
or network access are evaluated.

Entity `key` uses only `literal`, `get`, `key`, yielding nonempty strings or finite
numbers. IDs join separately percent-encoded namespace components, rule name and
key components with `/`. Default namespace components are source name and
root-relative file path. Explicit `namespace` replaces them and can preserve IDs
after moves; its author owns collision avoidance. Use logical names rather than
array indexes when reordering should preserve identity. Duplicates are errors.

## References and recursive traversal

Identities are registered before fields, so forward/cyclic links require no
definition copying. `ref` resolves a target rule and key in the current document.
Ordinary mapped reference fields can also contain known IDs of other corpus
entities, which undergo normal graph reference validation.

```yaml
references:
  pointer_refs:
    from: dto
    member: $ref
    rule: schema
    descend:
      - [properties, '*']
      - [items]
      - [allOf, '*']
      - [oneOf, '*']
      - [anyOf, '*']
      - [additionalProperties]
```

`pointer_refs` has optional `select`, then `from`, optional `path`, `member`,
`rule` and optional nonempty `descend` child paths. Here `*` traverses immediate
mapping values or array items. Only declared paths are followed: examples and
properties named `$ref` do not automatically become links. YAML anchors can reuse
child-path lists. URI-fragment decoding and JSON Pointer escaping are respected.
Missing targets, external files, remote URLs and anchor references encountered
in configured positions are errors. `$id` scope and `$dynamicRef` resolution are
not implemented.

Typed nested FK fields produce graph paths such as `foreign_keys.target`.
Individual occurrences remain inline even when identical graph relations merge.

## Limits and lifecycle

Per document: depth 128, 1,000,000 visited/constructed value or selection steps,
100,000 emitted entities. Copying and traversal count toward work. Cyclic YAML
aliases are rejected. Limit failures do not publish truncated results. These are
extraction bounds, not source-byte or decoder-memory guarantees.

Diagnostics identify file, source/rule and available pointer; precise token spans
are not synthesized. Declaration/extraction/validation errors prevent publication
under existing last-valid rules. Input changes and imported declaration edits
participate in ordinary watch/refresh. Unchanged SQLite refresh does not reparse;
indexed SQLite reads need neither source files nor extraction execution.

The packaged `examples/source-documents` model covers operations, named DTOs and
SA database objects/PostgreSQL FKs, preserving raw definitions. It is not a full
OpenAPI/JSON Schema validator. Effective inherited parameters/security/servers,
component wrappers, callbacks/webhooks, external references and SQL/ClickHouse
dependency interpretation are outside the example's semantics.
