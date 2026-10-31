## MODIFIED Requirements

### Requirement: Inline and boolean constraints

Lore SHALL recursively validate inline objects and supported any_of, all_of, none_of and exactly_one_of slot expressions. Alternative scalar/reference/inline branches SHALL be checked without leaking rejected-branch diagnostics for an accepted union. Record-level boolean constraints SHALL follow the Record expressions requirement below, independently of classification.

#### Scenario: Valid alternative

- **WHEN** a union value satisfies a declared scalar branch
- **THEN** unmatched object branches do not make the value invalid

#### Scenario: Invalid nested record

- **WHEN** an inline object violates a required nested field in every applicable branch
- **THEN** the value is rejected

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

## ADDED Requirements

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
