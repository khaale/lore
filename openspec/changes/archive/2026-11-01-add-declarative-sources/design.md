## Context

See [proposal.md](./proposal.md) for motivation and the
[product example](../../../examples/source-documents/.lore.yaml) for concrete declarations.
The existing source boundary produces candidates for class validation and graph
construction. Both JSON and SQLite indexing already depend on that boundary;
readers consume saved entities, rather than executing source adapters on reads.

This crosses compiler, discovery and ingestion boundaries, so a design is needed.
The compiled source plan covers file claiming, declaration validation, bounded
execution and source-refresh integration through the existing ingestion boundary.

## Goals / Non-Goals

**Goals:** a small source-independent input mapping, with declarations owned by
the model and extracted entities usable through existing read APIs. Keep format
knowledge in examples and model declarations. Preserve structured definitions
without translating arbitrary OpenAPI/JSON Schema constraints into LinkML.

**Non-Goals:** exports, inverse mappings, editing sources, source-specific adapter
registries, custom code execution, remote/external reference resolution, a full
OpenAPI validator or a database SQL parser. No query-performance work is included.

## Decisions

### 1. Schema-level `lore:sources`, with named sources

Use the reserved annotation namespace and input-oriented name agreed with the
user. A source definition contains nonempty `files` selectors, optional static
`namespace`, and a nonempty `entities` list. No `poc:projections` compatibility alias is added.

Illustrative product declaration:

```yaml
annotations:
  lore:sources:
    openapi:
      files: ['generated/apis/*/OpenAPI-definition.yaml']
      entities:
        - name: operation
          class: ApiOperation
          select:
            - { from: root, path: [paths], each: entries, as: route }
            - from: route
              each: entries
              as: operation
              keys: [get, put, post, delete, options, head, patch, trace]
          at: operation
          key: [{ key: route }, { key: operation }]
          fields:
            name: { key: route }
            method: { key: operation }
            path: { key: route }
            definition: { get: { from: operation } }
```

The classes and fields above are user-defined LinkML vocabulary, not built-ins.
Both this example and the DB example declare typed fields for data the SDK must
expose; allowing undeclared extras alone does not make them SDK-selectable.

Within local imports, source definitions compose by unique source name. Duplicate
names across distinct declarations are compilation errors, not implicit deep
merges or overrides. A diamond import visits each physical dependency once.
All file selectors remain workspace-root-relative, regardless of declaration
location. This makes imported source snippets reusable across roots without
changing the existing relative-schema-import contract.

Alternative: separate adapter files and registry. Rejected for this change: the
model already supplies composition, vocabulary and invalidation dependencies.

### 2. Compile a bounded expression vocabulary

Retain the proven PoC vocabulary:

| Construct                           | Meaning                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `select`                            | Ordered binding steps with `from`, property/index `path`, `each: entries/items`, `as`, and optional `keys` filter |
| `at`                                | Binding whose source pointer identifies the emitted entity                                                        |
| `key` on entity                     | Ordered expressions producing nonempty string/finite-number identity components                                   |
| `literal`, `get`, `key` expressions | Constant data, selected value, or bound collection key                                                            |
| `object`, `collect`                 | Construct fields or collect constructed values from nested selections                                             |
| `ref`                               | Resolve another entity rule and its evaluated key components                                                      |
| `pointer_refs`                      | Collect local-pointer targets using an explicit member, target rule, initial selection and recursive child paths  |

Expressions have exactly one recognized operator. Paths are arrays of literal
property names or nonnegative integer indexes; `*` is a wildcard only in recursive
child paths. Literal `*` keys remain selectable through ordinary `get` paths.
No templates, regex evaluation, arithmetic, environment lookup or executable code
are introduced. YAML anchors can reuse recursive child paths in one file.
Identity keys use only `literal`, `get` or bound `key` expressions, so they do not
depend on links being resolved. Binding names cannot shadow `root` or another
binding in the same lexical scope.

Compilation validates shapes, unknown keys/operators, lexical binding references,
target rules/classes/fields and statically known assignment/reference types.
Projected classes must have exactly one effective string-compatible identifier;
the generated identity fills that slot. A declared type-designator field is filled
with the rule's class, including when required. Rules cannot overwrite the generated
identifier or a type-designator slot through `fields`. Data-dependent value and
constraint checks remain with the existing record validator. Normalize the plan
with the compiled model and include its semantics in the existing schema hash.

Missing/null selection collections produce no bindings; a present wrong-shaped
collection fails. Zero matches is a valid empty result. Missing/null constructed
object fields are omitted, matching PoC behavior; nested values copied by `get`
retain their internal nulls, array order and object structure. Copies are detached.

Alternative: general JSONPath or an embedded programming language. Deferred:
neither is required by the two demonstrated inputs, and both enlarge semantics.

### 3. Claim eligible files before generic record parsing

Match root-relative literal paths and `*`, `**`, `?` globs against the existing
eligible discovered file set. Ignore rules, schema exclusions and derived-output
exclusions remain authoritative. Reject absolute selectors and `..` traversal.
Literal missing/ineligible inputs are diagnosed; a glob with no matches is valid.
Only single-document YAML and JSON mapping roots are supported initially.

A matched file is owned by exactly one named source; overlapping source claims
fail, while multiple rules inside one source are supported. Do not also emit a
generic whole-document record. An unclaimed file follows its existing parser.
No extension-based OpenAPI/DB autodetection or magic format name is introduced.

### 4. Register identities before constructing references

Resolve each document in two passes. Register entity keys and source pointers,
then evaluate fields and links. A document-local lookup avoids dereferencing DTO
cycles or copying definitions. Duplicate keys or pointers within a rule fail;
ordinary corpus validation also detects collisions with other documents/sources.

The default identity namespace consists of source name and root-relative file
path. An optional authored `namespace` replaces that default for a stable logical
source; its author owns collision avoidance. Append rule name and evaluated key
components, percent-encoding components separately and joining with `/`.
Document moves change default identities; array reordering does not change keys
based on schema/table names. `ref` and `pointer_refs` target rules in the same
source/document. Normal explicitly constructed reference fields can still link
to existing corpus IDs through the ordinary graph resolver.

Local pointer references are URI-fragment-decoded and matched to entity pointers,
with JSON Pointer escaping respected. Missing, malformed, external-file, remote,
anchor and dynamic references encountered in configured positions fail. Recursive
traversal follows only declared child paths; examples/default values do not turn
into links unless the model explicitly selects them. The real `$ref`-named DTO
property is the regression fixture for this distinction.

Alternative: scan every object for `$ref`. Rejected by the real SA counterexample.

### 5. Reuse candidates, validation and publication

Produce candidates with declared class, generated identifier, mapped fields,
physical source path and escaped record pointer. The pointer is consumed by SDK
provenance/navigation, as demonstrated by the PoC. Do not add snapshot metadata,
invent token spans or build a separate projected-entity reader. Preserve existing
canonical edge merging: multiple FK occurrences remain inline even when their
owner/relation/target edges merge.

Integrate into shared ingestion used by check, index, watch and SQLite refresh.
Observe matching source additions/deletions and schema-import declaration edits
through existing input stamps; do not expand source dependencies through `$ref`.
Unchanged SQLite refresh keeps its existing no-parse/no-rewrite path. Failed
compilation/extraction/validation prevents publication under existing last-valid
rules. Published SQLite reads remain source-independent.

### 6. Bound extraction work without a new options API

Initial fixed per-document limits: nesting depth 128, 1,000,000 visited/constructed
value or selection steps, and 100,000 emitted entities. Count recursion,
collection expansion, reference traversal and copied values against the work
budget. Reject cyclic YAML alias structures; do not follow object cycles. A limit
failure is an error, never truncated successful output. These are extraction
bounds, not a hard source-byte or parser-memory guarantee. Record errors with
the existing diagnostic surface, identifying file, source/rule and available
pointer; no new persistent diagnostics subsystem is needed.

## Risks / Trade-offs

- **A DSL grows into a programming language** → keep the enumerated operators;
  accept extensions only for demonstrated source requirements.
- **OpenAPI extraction is mistaken for full format support** → document that raw
  definitions are retained, while inheritance, component wrappers, external refs,
  callbacks and schema validation are not implemented by the example.
- **References are over-extracted from examples** → use declared traversal and
  test property names and data containing `$ref`.
- **A shared namespace creates duplicate IDs** → fail publication explicitly;
  default to file-scoped identity and document relocation behavior.
- **Limits interrupt an otherwise parseable document** → report the failure and
  preserve the prior index; do not silently omit entities.
- **Import composition surprises** → unique source names and no implicit override.
- **PoC speed is overstated** → its 0.52s omitted decoding/publication; acceptance
  reports correctness and whole-command timing separately, with no speed SLA.

## Migration Plan

Models without `lore:sources` keep existing behavior. There is no migration from
the unpublished PoC annotation. Adopt a source by adding its declarations and
user-defined classes, then explicitly rebuild the selected derived index.
Existing JSON schema-hash checks apply; SQLite publication stores the new compiled
model and data together. Removing the annotation and rebuilding restores generic
parsing. No storage migration or automatic SA/BB binding change is required.

Reconcile the earlier completed changes when syncing specs; do not overwrite
their SQLite or LinkML requirements with the older main-spec text.
