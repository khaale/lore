# LinkML support in Lore

Lore implements a bounded LinkML profile for reading and validating local
knowledge. A schema that works in another LinkML tool is not automatically a
supported Lore schema. This reference distinguishes executable semantics from
accepted metadata and unsupported constructs.

Use `.lore.yaml` or `model.yaml` as the root model. If both exist, select one
explicitly. A custom filename also works through CLI `--schema` or SDK
`schemaPath`. The minimal complete model is in [model patterns](model-patterns.md).
See [file formats](file-formats.md) for authoring records against that model.

## Supported model structure

| Construct                                                | What Lore does                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `classes`, `slots`, class `attributes`                   | Builds runtime types and their fields. Class `slots` refer to top-level slot declarations.                                |
| Class `is_a`, `mixins`, `abstract`, `mixin`              | Resolves inherited fields and applicable constraints. Detects inheritance cycles and unknown parents.                     |
| Slot `is_a`, `mixins`, class `slot_usage`                | Resolves inherited slot declarations and refinements. Rejects unknown slots and incompatible range refinements.           |
| `types` with `typeof` or `base`                          | Resolves custom scalar types and their inherited patterns and numeric bounds.                                             |
| `enums.permissible_values`                               | Validates static permissible-value keys. A display description does not become an alternative value.                      |
| `default_range`                                          | Supplies a field's range when none is declared; the fallback is `string`.                                                 |
| `prefixes`, `default_prefix`, `class_uri`, `from_schema` | Resolves logical type identity, including CURIE expansion. URI-looking values are not fetched.                            |
| `imports`                                                | Loads relative local schemas, optionally omitting `.yaml`/`.yml`. `linkml:types` is builtin and needs no network request. |

Imports form a local dependency graph. Cycles, conflicting definitions and
conflicting prefixes produce diagnostics. Absolute filesystem imports, arbitrary
HTTP imports and CURIE imports other than builtin LinkML types are unsupported.
The compiler API can additionally confine imports with `allowedRoot`.

Abstract and mixin markers are represented in runtime discovery and class
selection; do not treat `abstract` alone as a guarantee that an authored record
explicitly naming that class will be rejected.

## Supported field semantics

| Construct                                                         | Behavior and boundary                                                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`                                                        | Missing or empty values are errors.                                                                                                                                               |
| `recommended`                                                     | Missing or empty values produce warnings.                                                                                                                                         |
| `multivalued`                                                     | The authored value must be a list. A scalar is not automatically wrapped as a one-item list.                                                                                      |
| `identifier`                                                      | Provides the logical record ID and makes the field required. Use stable, explicitly authored IDs for linked records.                                                              |
| `key`                                                             | Makes the field required and exposes an identity role for exploration. It is not a replacement for a record identifier or a class-level uniqueness constraint.                    |
| `unique_keys.unique_key_slots`                                    | Enforces single-field or compound uniqueness across instances of the class and its subclasses.                                                                                    |
| Class-valued `range`                                              | Becomes a typed reference when the target class has an identifier, unless explicitly inlined. Resolves targets and validates their types.                                         |
| `inlined: true`                                                   | Validates an embedded object against its class. A class-valued range without an identifier is also treated as an inline object. Inline objects are not independent graph records. |
| `inverse`                                                         | Adds inverse relation presentations/assertions. It does not rewrite authored source files.                                                                                        |
| `pattern`                                                         | Validates strings using ECMAScript regular expressions. Multiple inherited patterns can apply.                                                                                    |
| `minimum_value`, `maximum_value`                                  | Checks applicable value bounds, including bounds inherited through custom types.                                                                                                  |
| `minimum_cardinality`, `maximum_cardinality`, `exact_cardinality` | Checks the number of supplied values. Use `required` as well when absence itself must be rejected.                                                                                |
| `extra_slots.allowed`                                             | Controls whether undeclared fields are allowed for a class during strict validation. A range expression for extra slots is unsupported.                                           |

Reference values can use exact logical IDs and supported WikiLink/Markdown-link
forms. Prefer exact IDs in YAML and JSON. Format-specific restrictions apply to
Markdown relation sections and tables; see [file formats](file-formats.md#references-and-links).

### Scalar types

| Range                                 | Actual validation                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `string`, `str`                       | String value.                                                                                                                             |
| `integer`, `int`                      | JavaScript number with an integer value.                                                                                                  |
| `float`, `double`, `decimal`          | Finite JavaScript number; `decimal` does not provide arbitrary-precision decimal arithmetic.                                              |
| `boolean`, `bool`                     | Boolean value, not the strings `"true"` or `"false"`.                                                                                     |
| `date`                                | Calendar-valid string in `YYYY-MM-DD` form.                                                                                               |
| `datetime`                            | String with date, seconds and timezone, accepted by the runtime's timestamp check.                                                        |
| `time`, `uri`, `uriorcurie`, `ncname` | String-valued ranges. Lore does not enforce their full XML Schema lexical grammars. Add a pattern when the project needs a stricter form. |

Custom scalar types can refine these ranges with `pattern`, `minimum_value` and
`maximum_value`. Keep identifiers and other textual codes quoted in structured
data when they could otherwise be interpreted as numbers.

### Field expressions

Slots support `any_of`, `all_of`, `none_of` and `exactly_one_of`. Their expression
objects can contain `range`, `required`, `pattern`, `equals_string`,
`equals_string_in`, `value_presence`, cardinality constraints and nested boolean expressions.
Supported range alternatives include scalar, reference and inline-object cases;
they do not implement arbitrary LinkML expression evaluation.

For example, this is an expression inside a slot declaration:

```yaml
status:
  range: string
  any_of:
    - equals_string: proposed
    - equals_string: accepted
```

`equals_string` and `equals_string_in` belong inside expression objects. A
standalone top-level slot metaslot with one of those names is not supported.

## Collection and record constraints

`list_elements_unique: true` on a multivalued slot rejects duplicates, including
inherited constraints. Scalar values compare by native value; inline objects
compare structurally, ignoring mapping key order. Identified references compare by
resolved target ID, so two link aliases can be duplicates. Scalar literals and
explicit references in a union remain distinct. Lore does not deduplicate input,
wrap scalars into arrays or relax a true inherited flag.

Classes support `any_of`, `all_of`, `none_of` and `exactly_one_of` over record
expressions containing `slot_conditions` and nested record groups. For example:

```yaml
Selector:
  exactly_one_of:
    - slot_conditions:
        workload: { required: true }
    - slot_conditions:
        application: { required: true }
  attributes:
    workload: { range: string }
    application: { range: string }
```

Class `rules` support optional `preconditions` and required `postconditions` in
that same record-expression vocabulary. A missing precondition applies the rule
unconditionally; an unmatched condition imposes no postcondition. Constraints and
rules apply to descendants and inline instances. They validate values without
inferring data or changing classification. Other record predicates such as `is_a`
in this validation grammar are unsupported.

Slot-expression `value_presence: PRESENT` or `ABSENT` uses the existing required
emptiness policy: missing/null, blank strings and empty lists are absent; false
and zero are present. `required: false` allows a value and does not prohibit it.
Record-level failures use `RECORD_CONSTRAINT` or `CLASS_RULE`; duplicate list
values use `LIST_ELEMENTS_UNIQUE`, with available nested source locations.

Reference unions are checked against the actual target class and inheritance.
Nested references are validated and exposed as owning-entity relations such as
`refinements.scope`; inline objects do not acquire independent IDs. SDK properties
preserve inline shape and replace resolved nested links with target IDs. Ambiguous
dotted selectors and incompatible nested inverse declarations are diagnosed.
Existing derived indexes need rebuilding to establish the stronger validation.

## Record classification

Prefer a declared type-designator slot:

```yaml
slots:
  kind:
    range: string
    designates_type: true
    required: true
```

The record supplies the class name or logical type ID through that slot, commonly
`kind: Decision`. Two designator slots on the same class are invalid.

`classification_rules` has limited runtime behavior: a flat rule's
`slot_conditions` are checked, and any matching rule can select a class. This is
not a general LinkML classifier. In particular, class-level `is_a` conditions and
nested class-level boolean rule trees are not evaluated as such. They can currently
be accepted without diagnostics, so successful compilation is not evidence that
those predicates were enforced. Use an explicit type designator instead of
relying on those forms.

Documents that do not match a type designator, a supported classification rule or
an explicit structured-Markdown declaration do not become records. Verify the
expected record count as well as the absence of diagnostics.

## Accepted metadata is not executable semantics

Common descriptive fields such as `title`, `description`, `aliases`, `comments`,
`notes`, `examples`, mappings and lifecycle metadata can be accepted. Schema
metadata such as `version`, `license`, `settings`, `default_curi_maps` and
`emit_prefixes` can also be accepted without implementing the corresponding
behavior of other LinkML tools.

For example, aliases do not add fuzzy matching, mappings do not merge identities,
and deprecation metadata does not migrate records. `slot_uri` is available as
field metadata; it is not a remote schema lookup. Static enum value descriptions
and meanings do not create additional runtime values. Non-`lore:` annotations
are accepted as annotation data, not custom validators or executable plugins.

## Unsupported operational features

The profile rejects unsupported semantic metaslots with diagnostics such as
`UNSUPPORTED_METASLOT`, `UNSUPPORTED_OPERATIONAL` or
`UNSUPPORTED_LORE_ANNOTATION`. Examples include:

- Dynamic enum mechanisms such as `dynamic_enum` and `reachable_from`.
- Executable or expression-based derivation such as `equals_expression` and
  `member_constraints`.
- Rule `elseconditions`, executable expressions, `open_world` and `bidirectional` behavior.
- Transitive/symmetric inference metaslots such as `transitive` or `symmetric`.
- `extra_slots.range_expression` and `inlined_as_dict`.
- Unknown annotations in the reserved `lore:` namespace.

Lore does not generate domain classes, JSON Schema, RDF or OWL from the model,
execute schema-supplied code, populate calculated fields or modify source data.
It provides its own runtime validation and graph projection, rather than the
complete LinkML toolchain.

## Lore annotations

| Annotation                | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `lore:explore_roles`      | Selects identity, title, summary, card or hidden presentation roles.                   |
| `lore:explore_relation`   | Gives a relation a hierarchy, dependency, reference or context role.                   |
| `lore:explore_label`      | Names the relation in exploration output.                                              |
| `lore:explore_order`      | Sets an integer presentation order.                                                    |
| `lore:explore_views`      | Selects overview, card, tree, neighborhood and impact views.                           |
| `lore:markdown_selectors` | Maps exact Markdown headings to slot values.                                           |
| `lore:heading_identity`   | Declares schema-level heading identity rules with named `id` and `title` regex groups. |

These are Lore-specific annotations, not portable LinkML behavior. Their concrete
authoring forms are described in [file formats](file-formats.md#structured-markdown)
and [model patterns](model-patterns.md).
