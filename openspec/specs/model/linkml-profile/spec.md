# model/linkml-profile

## Purpose

Define the complete supported LinkML subset: local schema composition, induced vocabulary, scalar and record constraints, annotations, accepted metadata and unsupported operations.

## Support boundary

The internal compiler supports optional allowedRoot confinement; this is not a
CLI flag or a public FilesystemWorkspaceOptions field. Public callers select a
local schema path through the CLI or SDK.

This is the single normative specification of Lore's supported LinkML profile,
including schema composition and record validation. It describes the maximum
implemented subset, not compatibility with the complete LinkML toolchain.
The tables below are an index into the requirements in this file. A construct
being accepted as metadata is not a promise that LinkML semantics are executed.

| Area                  | Supported surface                                                                                                                                     | Boundary                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                 | id, name, classes, slots, attributes, slot_usage, default_range                                                                                       | Missing ranges default to string; no built-in domain vocabulary.                                                                                   |
| Composition           | relative imports, built-in linkml:types                                                                                                               | Local YAML closure; no arbitrary remote, absolute or CURIE imports.                                                                                |
| Inheritance           | class/slot is_a and mixins                                                                                                                            | Effective fields and compatible refinements; cycles and unknown definitions rejected.                                                              |
| Type identity         | class_uri, from_schema, prefixes                                                                                                                      | Logical IDs and prefix expansion; no remote resolution.                                                                                            |
| Scalar types          | types.typeof/base, pattern, minimum_value, maximum_value                                                                                              | Inherited scalar refinements, not generated domain types.                                                                                          |
| Enums                 | enums.permissible_values                                                                                                                              | Static keys; descriptions/meanings do not add values. Direct record enum checking stringifies input, unlike stricter expression/SDK filter checks. |
| Field flags           | required, recommended, multivalued, identifier, key                                                                                                   | Required/recommended differ in severity; key alone is not uniqueness.                                                                              |
| Values and relations  | range, inlined, inverse                                                                                                                               | Identified class references versus inline objects; reference resolution is specified in knowledge-graph.                                           |
| Constraints           | pattern, minimum_value, maximum_value, minimum_cardinality, maximum_cardinality, exact_cardinality                                                    | Optional empty values skip value constraints; required controls absence.                                                                           |
| Boolean expressions   | any_of, all_of, none_of, exactly_one_of                                                                                                               | Slot expressions support range, required, pattern, equals_string, equals_string_in, cardinalities and nested boolean expressions.                  |
| Uniqueness and extras | unique_keys.unique_key_slots, extra_slots.allowed                                                                                                     | Class/subclass uniqueness; strict unknown-slot policy.                                                                                             |
| Classification        | designates_type, classification_rules.slot_conditions                                                                                                 | Exact evaluation order and accepted-but-unevaluated forms are owned by [knowledge-graph](../../core/knowledge-graph/spec.md).                      |
| Class markers         | abstract, mixin                                                                                                                                       | Discovery metadata and selection behavior; not a blanket authored-instance prohibition.                                                            |
| Lore annotations      | lore:explore_roles, lore:explore_relation, lore:explore_label, lore:explore_order, lore:explore_views, lore:markdown_selectors, lore:heading_identity | Values validated here; extraction behavior in sources/markdown, presentation behavior in core/exploration.                                         |

### Scalar validation boundaries

| Range                         | Implemented check                                                    |
| ----------------------------- | -------------------------------------------------------------------- |
| string, str                   | JavaScript string                                                    |
| integer, int                  | JavaScript integer number                                            |
| float, double, decimal        | Finite JavaScript number; no arbitrary-precision decimals            |
| boolean, bool                 | Native boolean, without string coercion                              |
| date                          | Calendar-valid YYYY-MM-DD string                                     |
| datetime                      | String with date, seconds and timezone that passes timestamp parsing |
| time, uri, uriorcurie, ncname | String only; full XML Schema lexical grammars not enforced           |

### Accepted descriptive metadata

The compiler accepts the following common descriptive keys in its supported
schema/class/slot/type/enum metadata positions:

`description`, `annotations`, `extensions`, `title`, `alt_descriptions`, `aliases`,
`comments`, `notes`, `todos`, `examples`, `in_subset`, `from_schema`, `rank`,
`deprecated`, `deprecated_element_has_exact_replacement`,
`deprecated_element_has_possible_replacement`, `mappings`, `exact_mappings`,
`narrow_mappings`, `broad_mappings`, `related_mappings`, `close_mappings`,
`see_also`, `source`, `status`, `categories`, `keywords`, `created_by`,
`modified_by`, `created_on`, `last_updated_on`, `contributors`, `definition_uri`,
`local_names`, `structured_aliases`, `in_language`, `conforms_to`, `implements`,
`instantiates`, `imported_from`.

Additional accepted fields are schema `version`, `license`, `default_prefix`,
`default_curi_maps`, `settings`, `source_file`, `emit_prefixes`; slot `slot_uri`;
type `uri`, `type_uri`, `repr`; and enum `enum_uri`. Accepted metadata does not
activate other LinkML tools' behavior. In particular, default_prefix is accepted
but is not an implicit namespace rule beyond the explicit type-ID rules below.
Non-reserved annotations are data. Reserved `lore:` annotations are checked on
schema, class and slot declarations (including attributes and slot_usage); type
and enum annotation payloads are accepted metadata, not executable extensions.
Accepted structure and type checks still apply to fields; this is not a promise
that arbitrary shapes or arbitrary placement are accepted.

### Lore annotation input forms

Except for heading identity, the compiler checks reserved annotation values on
schema/class/slot declarations, including attributes and slot_usage. Acceptance
on a declaration does not imply that every consumer reads that location. The
last column identifies the locations where runtime consumers use the value.
Type/enum annotation payloads remain metadata.

| Annotation              | Accepted form and values                                                                                    | Effective consumer placement                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| lore:explore_roles      | String or array of identity, title, summary, card, hidden                                                   | Effective slots; hidden is a role, not a separate boolean field                                |
| lore:explore_relation   | One of hierarchy, dependency, reference, context                                                            | Class-valued effective slots; core/exploration owns traversal meaning                          |
| lore:explore_label      | Nonblank string                                                                                             | Exploration relation slots                                                                     |
| lore:explore_order      | Integer                                                                                                     | Exploration fields; ties are ordered by field name                                             |
| lore:explore_views      | String or array of overview, card, tree, neighborhood, impact                                               | Class/slot declarations contribute SDK view discovery; effective slots constrain presentation  |
| lore:markdown_selectors | Array of heading-selector strings beginning with one to six # characters and nonblank heading text          | Effective slots; sources/markdown owns exact level/text selection                              |
| lore:heading_identity   | Non-empty array of mappings with unique nonblank name, non-empty levels array of integers 1..6, and pattern | Schema only; pattern must be an anchored valid ECMAScript regex with named id and title groups |

The role/view arrays may be empty; their effect then follows the default
presentation and advertised-view rules of core/exploration and interfaces/sdk.
Heading rules apply only to explicitly declared section entities; they are not
an instruction to classify every matching heading.

### Cardinality precedence

For each field, cardinality precedence is:

1. Visit the concrete class first, then its mixins in declared order recursively,
   then its is_a parent recursively; visit each class once. At each class, apply
   slot_usage before attributes for that field.
2. Apply the named top-level slot declaration.
3. Visit that slot's ancestors depth-first, mixins in declared order before is_a,
   applying each ancestor once.

minimum_cardinality, maximum_cardinality and exact_cardinality each independently
keep their first defined value; zero is defined. A local maximum does not replace
an inherited minimum, and numeric minimum_value/maximum_value tightening is a
separate rule. This order specifies the current supported induction behavior.

### Explicitly outside the executable profile

Dynamic enums (`dynamic_enum`, `reachable_from`), derivation
(`equals_expression`, `member_constraints`), general class `rules`, `open_world`,
`bidirectional`, inference metaslots (`transitive`, `symmetric`),
`inlined_as_dict` and `extra_slots.range_expression` are unsupported. The
classification exception is documented in knowledge-graph: certain richer rule
forms are accepted but not evaluated. Successful compilation alone is therefore
not proof of complete LinkML semantics.

## Requirements

### Requirement: Local import closure

Lore SHALL resolve relative YAML imports recursively, including extensionless .yaml/.yml candidates, and treat built-in LinkML type imports as local runtime primitives without fetching remote schemas.

#### Scenario: Shared definitions

- **WHEN** a model imports a local schema containing a referenced class
- **THEN** compilation includes the class and reports the schema files in its dependency closure

#### Scenario: Unsupported import

- **WHEN** an import is absolute, remote, non-local or cannot be resolved
- **THEN** compilation fails with composition diagnostics rather than fetching it

### Requirement: Composition conflicts

Lore SHALL reject import cycles, duplicate class/slot/type/enum definitions and conflicting prefix mappings across the closure.

#### Scenario: Conflicting prefix

- **WHEN** two imported models bind the same prefix to different expansions
- **THEN** compilation reports PREFIX_CONFLICT

#### Scenario: Cycle

- **WHEN** local imports revisit a schema on the active import path
- **THEN** compilation reports IMPORT_CYCLE

### Requirement: Optional import confinement

When an absolute allowedRoot is supplied to the schema compiler, Lore SHALL check the entrypoint and local import paths against that root before reading them. This is lexical path confinement, not a documented symlink sandbox.

#### Scenario: Outside root

- **WHEN** a local import escapes the supplied allowedRoot
- **THEN** compilation reports IMPORT_OUTSIDE_ALLOWED_ROOT

#### Scenario: Relative allowed root

- **WHEN** allowedRoot is relative
- **THEN** compilation reports INVALID_ALLOWED_ROOT

### Requirement: Schema identity

Lore SHALL derive a deterministic SHA-256 identity from asserted schema content, including imported definitions, constraints and annotations, independently of object key order and generated filesystem locations.

#### Scenario: Relocated equivalent schema

- **WHEN** equivalent schema content is compiled from different directories
- **THEN** its schema hashes agree

#### Scenario: Changed import

- **WHEN** an imported asserted constraint changes
- **THEN** the schema hash changes

### Requirement: Schema driven vocabulary

Lore SHALL compile user-defined classes, class and slot inheritance/mixins, attributes, slots, slot_usage, custom scalar types and static enums without built-in domain class names. Missing ranges SHALL use default_range, falling back to string. It SHALL reject unknown references, incompatible range refinements and inheritance cycles. Abstract and mixin markers SHALL be available as metadata; their record-selection limitations are defined in [knowledge-graph](../../core/knowledge-graph/spec.md).

#### Scenario: Inherited model

- **WHEN** a class inherits required fields and narrows a compatible range
- **THEN** its runtime description includes the induced fields and constraints

#### Scenario: Unknown class

- **WHEN** a slot refers to an undeclared range
- **THEN** normalization fails

### Requirement: Value modes and identifiers

Lore SHALL classify primitive and enum ranges as scalar, identified class ranges as references unless explicitly inlined, and other class ranges as inline objects. Identifier and key fields SHALL be required; key SHALL also expose the exploration identity role. A class SHALL have at most one type-designator slot.

#### Scenario: Explicit inline object

- **WHEN** an identified class range is explicitly inlined
- **THEN** the field is validated as an inline object rather than a graph reference

#### Scenario: Two designators

- **WHEN** one class induces two designates_type slots
- **THEN** compilation fails

### Requirement: Semantic type identities

Lore SHALL expose logical type IDs from class_uri or schema identity plus class name, expand declared prefixes and compute transitive class depth. Inverse slot declarations SHALL resolve to known slots without conflicting inverse pairs.

#### Scenario: Prefix identity

- **WHEN** a class_uri uses a declared prefix
- **THEN** the runtime type ID contains its expansion

#### Scenario: Inverse conflict

- **WHEN** inverse declarations disagree
- **THEN** normalization fails

### Requirement: Executable profile boundary

Lore SHALL diagnose malformed schema shapes, unsupported operational metaslots and unknown reserved lore: annotations. Compilation SHALL distinguish malformed shapes from unsupported-profile diagnostics.

#### Scenario: Dynamic enum

- **WHEN** a model declares an unsupported dynamic enum mechanism
- **THEN** compilation returns an unsupported-profile diagnostic

### Requirement: Supported annotations

On schema/class/slot annotations, Lore SHALL validate exploration roles, relation roles, labels, integer ordering, view selection, Markdown selectors and schema-level heading identity rules. Type/enum annotation data SHALL NOT imply those runtime extensions. Heading identity patterns SHALL be anchored ECMAScript regexes with named id/title groups and levels in 1..6.

#### Scenario: Misplaced heading annotation

- **WHEN** lore:heading_identity is declared on a class or slot
- **THEN** compilation rejects it

#### Scenario: Valid heading rule

- **WHEN** a schema declares a valid named heading identity rule
- **THEN** the runtime model preserves the rule

#### Scenario: Hidden role input

- **WHEN** an effective slot declares lore:explore_roles: [hidden]
- **THEN** the annotation is accepted and the field is excluded from exploration cards under the presentation contract

#### Scenario: Invalid relation role

- **WHEN** a slot declares lore:explore_relation: transitive
- **THEN** compilation reports INVALID_ANNOTATION_VALUE rather than enabling inference

### Requirement: Required and permitted properties

Lore SHALL report missing required values as errors and missing recommended values as warnings. Null, undefined, blank strings and empty arrays SHALL be empty for this check. Strict validation SHALL reject undeclared fields unless extra_slots.allowed permits them.

#### Scenario: Recommended field

- **WHEN** a record omits a recommended field
- **THEN** a warning is reported without alone preventing index publication

#### Scenario: Unknown property

- **WHEN** strict validation encounters an undeclared property on a closed class
- **THEN** UNKNOWN_SLOT is reported

### Requirement: Scalar constraints

Lore SHALL enforce supported scalar ranges, patterns/bounds, cardinalities and enum membership. Direct enum and class-valued branches SHALL use their own checks; they SHALL NOT imply that scalar pattern/bound checks also run on those values. Dates SHALL be calendar-valid YYYY-MM-DD strings; datetimes SHALL include seconds and timezone and pass timestamp parsing. uri, uriorcurie, ncname and time SHALL be string-valued without full lexical grammar enforcement.

#### Scenario: Impossible date

- **WHEN** a date field contains 2026-02-30
- **THEN** a range error is reported

#### Scenario: String boolean

- **WHEN** a boolean field contains the string true
- **THEN** a range error is reported

#### Scenario: Cardinality

- **WHEN** a field has fewer values than minimum_cardinality
- **THEN** a cardinality diagnostic is produced

### Requirement: Collection value shape

Multivalued fields SHALL require arrays rather than automatic scalar wrapping. Optional absent values SHALL NOT be made required solely by a cardinality declaration.

#### Scenario: Scalar in a list field

- **WHEN** a multivalued field contains one scalar rather than an array
- **THEN** Lore reports a value-shape error instead of wrapping the scalar

#### Scenario: Absent optional collection

- **WHEN** an optional field with a minimum cardinality is absent
- **THEN** absence alone does not trigger a required-value error

### Requirement: Inline and boolean constraints

Lore SHALL recursively validate inline objects and supported any_of, all_of, none_of and exactly_one_of slot expressions. Alternative scalar/reference/inline branches SHALL be checked without leaking rejected-branch diagnostics for an accepted union. Record-level boolean constraints SHALL follow the Record expressions requirement below, independently of classification.

#### Scenario: Valid alternative

- **WHEN** a union value satisfies a declared scalar branch
- **THEN** unmatched object branches do not make the value invalid

#### Scenario: Invalid nested record

- **WHEN** an inline object violates a required nested field in every applicable branch
- **THEN** the value is rejected

### Requirement: Corpus uniqueness

Lore SHALL enforce class-level unique_keys constraints, including inherited keys, across instances of the declaring class and its subclasses. The key field marker SHALL NOT by itself enforce corpus uniqueness or replace an identifier.

#### Scenario: Inherited conflict

- **WHEN** two records conflict on an inherited unique key
- **THEN** a UNIQUE_KEY diagnostic identifies the conflict

### Requirement: Static enums and field expression vocabulary

Enums SHALL use permissible_values keys. Direct record checks SHALL compare String(value); expression/SDK checks SHALL require string members. Slot expressions SHALL support range, required, pattern, equals_string, equals_string_in, value_presence, cardinalities and nested any_of/all_of/none_of/exactly_one_of only. Equality metaslots SHALL NOT be standalone slot fields. value_presence SHALL accept PRESENT or ABSENT and follow Lore's existing required-value emptiness policy; false and zero SHALL remain present values.

#### Scenario: Enum label is not a value

- **WHEN** an enum value has a description different from its permissible key
- **THEN** that description does not become an alternative allowed value

#### Scenario: Expression equality

- **WHEN** a slot expression uses equals_string_in with supported alternatives
- **THEN** the runtime checks membership within that expression

#### Scenario: Standalone equality metaslot

- **WHEN** equals_string is placed directly on a slot instead of inside an expression
- **THEN** compilation reports an unsupported metaslot

#### Scenario: Explicit absence

- **WHEN** a slot condition requires ABSENT but the record supplies a nonempty value
- **THEN** the condition fails; required false does not express this prohibition

### Requirement: Metadata and unsupported operations

Accepted metadata SHALL NOT imply execution. Unknown semantic metaslots SHALL be diagnosed. Dynamic enums, derivation, transitive/symmetric inference, inlined_as_dict and extra_slots.range_expression SHALL be unsupported. Class rules SHALL execute only the bounded conditional subset below; elseconditions, bidirectional rules and executable expressions SHALL remain unsupported. Lore SHALL NOT generate classes/JSON Schema/RDF/OWL or execute schema code. Classification acceptance/evaluation SHALL follow [knowledge-graph](../../core/knowledge-graph/spec.md).

#### Scenario: Unsupported inference

- **WHEN** a slot declares the unsupported transitive metaslot
- **THEN** compilation reports an unsupported semantic metaslot

#### Scenario: Accepted descriptive mapping

- **WHEN** a model contains accepted mappings or deprecation metadata
- **THEN** Lore does not merge identities or migrate authored records from that metadata

#### Scenario: Unsupported rule feature

- **WHEN** a class rule contains elseconditions or an executable expression
- **THEN** compilation rejects the unsupported construct rather than ignoring it

### Requirement: Effective constraint induction

Effective fields SHALL combine class/mixin slots, attributes and applicable slot_usage. Required/recommended/multivalued/identifier/key/designator flags SHALL accumulate; patterns combine, numeric bounds tighten and ranges use compatible refinements. slot_usage SHALL refine an applicable field. Each cardinality SHALL keep its first defined value under [cardinality precedence](#cardinality-precedence), without intersecting later declarations.

#### Scenario: Inapplicable refinement

- **WHEN** slot_usage names a field absent from the class and its inherited declarations
- **THEN** normalization fails

#### Scenario: Accumulated requirement

- **WHEN** an inherited required flag is paired with a local false flag
- **THEN** the effective field stays required

#### Scenario: Local cardinality overrides inherited declaration

- **WHEN** a class slot_usage declares maximum_cardinality: 3 and an inherited applicable declaration supplies maximum_cardinality: 1
- **THEN** the effective maximum is 3 because the local value is encountered first, rather than the minimum of both bounds

#### Scenario: Tighter bounds

- **WHEN** compatible inherited/local numeric bounds differ
- **THEN** the effective field uses the tighter supported bounds

### Requirement: Declarative source annotation

Lore SHALL support `lore:sources` only in schema annotations. Its value SHALL be
a mapping of named sources with nonempty file selectors and nonempty entity lists,
with optional nonblank static namespace. Lore SHALL compile the vocabulary
defined in [sources/declarative](../../sources/declarative/spec.md), rejecting
unknown declaration keys/operators, invalid shapes, unknown bindings/rules/classes,
undeclared target fields and statically incompatible assignments. Projected
classes SHALL have one effective string-compatible identifier. Extraction SHALL
fill the identifier and any type-designator field from the generated ID and
declared class respectively, including when those fields are required. Mapped fields
SHALL NOT overwrite it or type designators. Data-dependent validation SHALL
follow the ordinary record validation contract. `poc:projections` SHALL NOT be
an executable alias, and the annotation SHALL NOT enable output generation.

#### Scenario: Valid input mapping

- **WHEN** a model declares valid `lore:sources` rules for a user-defined class
- **THEN** compilation provides their executable input semantics without adding a built-in domain class

#### Scenario: Invalid placement or reference

- **WHEN** `lore:sources` appears on a class/slot or refers to an unknown bound value or target rule
- **THEN** compilation fails before source extraction

#### Scenario: Unselectable field

- **WHEN** a rule assigns an undeclared field even though its class allows extra slots
- **THEN** compilation rejects the assignment rather than producing data hidden from ordinary SDK field selection

### Requirement: Source declaration composition

Lore SHALL compose named source definitions from its local schema import closure
by unique name, visiting a shared dependency once. Distinct duplicate
declarations SHALL fail rather than override or deep-merge. Effective source
declarations SHALL participate in schema identity. File selectors SHALL resolve
against the knowledge root, not the declaring schema's directory.

#### Scenario: Shared imported declaration

- **WHEN** two imports depend on one physical schema declaring a named source
- **THEN** that declaration participates once

#### Scenario: Conflicting source names

- **WHEN** a root and an imported schema each declare the same source name
- **THEN** compilation reports a conflict instead of selecting one

#### Scenario: Extraction edit

- **WHEN** an effective source field mapping changes
- **THEN** the compiled schema identity changes under the existing schema-identity contract

### Requirement: Unique collection elements

Effective multivalued slots SHALL support inherited list_elements_unique. A true inherited constraint SHALL NOT be disabled by a local false value. Duplicate elements SHALL fail validation without deduplicating authored data. Scalar and inline values SHALL use typed structural equality with object key order ignored and array order retained. Resolved references SHALL compare target IDs; scalar/reference unions SHALL retain the distinction between a scalar literal and a resolved reference. A true unique-elements declaration on an effective single-valued slot SHALL be a schema error. Absent optional lists SHALL remain optional.

#### Scenario: Inherited duplicate

- **WHEN** a subclass supplies duplicate elements for a slot inheriting list_elements_unique true
- **THEN** validation reports a duplicate-value error identifying that slot and duplicate element

#### Scenario: Equivalent link surfaces

- **WHEN** two different supported reference surfaces resolve to the same target in a unique list
- **THEN** they are duplicate reference elements

#### Scenario: Inline equality

- **WHEN** two inline objects differ only in mapping key order
- **THEN** they are duplicates in a unique list, including recursively resolved references

### Requirement: Record expressions

Classes SHALL support record-level any_of, all_of, none_of and exactly_one_of over anonymous record expressions containing slot_conditions and nested record boolean groups. Each slot condition SHALL use the supported slot-expression vocabulary against that record. Evaluation SHALL include inherited class/mixin constraints and inline instances. A failed enclosing expression SHALL produce an owning-record diagnostic with a nested location when applicable; failures in branches of a satisfied expression SHALL NOT leak diagnostics. Record constraints SHALL NOT classify records. Other record-expression metaslots SHALL fail compilation rather than imply general classifier/reasoner semantics.

#### Scenario: Exclusive selector

- **WHEN** an inline selector declares exactly_one_of requiring workload or application
- **THEN** one populated field passes and both/neither fail

#### Scenario: Subclass contract

- **WHEN** a subclass omits an inherited record constraint locally
- **THEN** its instances remain subject to that constraint

### Requirement: Bounded conditional class rules

Class rules SHALL support optional preconditions and required postconditions expressed using Record expressions. Omitted preconditions SHALL mean unconditional application. A false precondition SHALL impose no postcondition; a true precondition SHALL require its postcondition. Rules SHALL apply to descendants and inline values, without mutating values, filling defaults or inferring graph assertions. Invalid references in conditions SHALL NOT hide ordinary reference diagnostics.

#### Scenario: Conditional parent

- **WHEN** a rule matches a site's kind and requires parent ABSENT
- **THEN** a populated parent fails the rule while absence passes

#### Scenario: Required parent branch

- **WHEN** a different kind matches a rule requiring parent PRESENT
- **THEN** absence fails and a valid populated reference passes

#### Scenario: Inactive condition

- **WHEN** a record does not match a rule's preconditions
- **THEN** that rule alone emits no postcondition error

### Requirement: Reference column annotation
The supported profile SHALL include lore:markdown_reference_column as executable
metadata on a multivalued reference slot. Its mapping SHALL contain exactly
heading and column with nonempty string values and a valid heading selector.
Invalid shape, scalar/inline/single-reference usage or a competing
lore:markdown_selectors annotation on that slot SHALL fail schema compilation.

#### Scenario: Invalid column declaration
- **WHEN** a scalar field uses a reference-column annotation or its keys are invalid
- **THEN** compilation fails before reading source records
