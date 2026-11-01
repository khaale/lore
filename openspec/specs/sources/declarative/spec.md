# sources/declarative

## Purpose

Extract addressable entities and typed relationships from nested local documents
using model-owned declarations, independently of source-specific domain formats.

## Requirements

### Requirement: Directed document extraction

Lore SHALL execute declared input mappings over single-document YAML or JSON
mapping roots and produce ordinary candidates for existing class validation,
graph construction and selected index publication. Unsupported document formats,
multi-document YAML and non-mapping roots SHALL fail. No format-specific class
names or parsing branches SHALL be required to express the documented OpenAPI
and SA database examples. This mechanism SHALL NOT write sources, export
documents or imply reversibility.

#### Scenario: Two distinct document formats

- **WHEN** valid OpenAPI and custom database source declarations are selected
- **THEN** one source-independent vocabulary extracts their declared user-defined entity classes

#### Scenario: Read-only source

- **WHEN** extraction and index publication complete
- **THEN** authored document bytes remain unchanged

### Requirement: Collection binding and field construction

`select` SHALL bind ordered `entries` or `items` from a named binding and literal
path, preserving value, key/index and escaped source pointer, with optional exact
`keys` filtering. The document root SHALL be bound as `root`. Paths SHALL contain
literal property names or nonnegative integer indexes. Missing/null collections
SHALL produce no bindings; present incompatible collection shapes SHALL fail.
Binding names SHALL NOT shadow `root` or an existing binding in their lexical
scope. `at` SHALL choose the emitted record's source binding. Field expressions SHALL
support exactly one of `literal`, `get`, `key`, `object`, `collect`, `ref` or
`pointer_refs`. Missing/null constructed object fields SHALL be omitted, while
copied nested values SHALL retain structure and nulls. Produced values SHALL be
detached from input data. Empty selections SHALL be successful empty results.

#### Scenario: Paths and methods

- **WHEN** rules bind path dictionary entries and filter their children to declared method keys
- **THEN** each method/path yields its own candidate with access to both bound keys

#### Scenario: Nested columns

- **WHEN** a field copies a table's structured definition
- **THEN** columns remain nested values without becoming independent entities

#### Scenario: Empty optional collection

- **WHEN** a document omits an optional collection selected by a rule
- **THEN** that selection emits no records or collected values

### Requirement: Stable declared identities

Each rule SHALL declare a unique name, class, source binding and nonempty key
expression list using only `literal`, `get` or bound `key` expressions yielding
nonempty strings or finite numbers. Generated identities
SHALL concatenate separately percent-encoded namespace components, rule name and
key components. Without explicit namespace the namespace components SHALL be
source name and root-relative file path; a nonblank static namespace SHALL
replace them when declared. Generated identity SHALL fill the class identifier.
Duplicate rule keys/pointers SHALL fail extraction; corpus-wide identity
collisions SHALL remain errors under ordinary graph validation. Source-derived
default identities SHALL NOT promise stability after file moves.

#### Scenario: Reordered database objects

- **WHEN** table key expressions use namespace/name and the document array is reordered
- **THEN** table identities and resolved FK targets remain unchanged

#### Scenario: Changed operation label

- **WHEN** operation keys use path/method and operationId changes
- **THEN** the operation retains its identity

#### Scenario: Duplicate table key

- **WHEN** two selected objects evaluate to the same rule key
- **THEN** extraction fails instead of retaining only one

### Requirement: Declared local entity references

Lore SHALL resolve `ref` by target rule and key expressions and `pointer_refs`
by configured reference member and extracted target pointer. Targets SHALL be
registered before fields are resolved, allowing forward and cyclic links without
copying target definitions. Both lookup forms SHALL be scoped to the current
source document. Local URI-fragment pointers SHALL be decoded with JSON Pointer
escaping respected. Recursive traversal SHALL follow only declared nonempty
child paths, with `*` matching immediate array or mapping children. Missing,
malformed, external-file, remote, anchor and dynamic reference targets encountered
in those configured positions SHALL fail rather than be fetched or silently
dropped. Ordinary mapped reference values SHALL still undergo existing typed
reference validation.

#### Scenario: Recursive DTO

- **WHEN** a DTO points to itself or another later-declared DTO
- **THEN** extraction produces references without recursively expanding the definition

#### Scenario: Reference-like ordinary data

- **WHEN** examples contain `$ref` or a DTO defines a property named `$ref`, outside configured reference positions
- **THEN** the values remain data and do not create spurious graph links

#### Scenario: Missing FK target

- **WHEN** a database FK key does not identify an extracted target table
- **THEN** extraction fails with the source/rule and available pointer identified

### Requirement: Existing read and publication contracts

Extracted candidates SHALL participate in existing model validation and typed
reference resolution together with ordinary corpus records. Published entities
SHALL retain physical source file and escaped record pointer through existing
provenance, without invented token spans. The same extracted content SHALL be
available through JSON and SQLite publication and existing entity/query/graph
APIs. Extraction errors SHALL prevent publication under existing last-valid
index rules; successful partial documents SHALL NOT be published after another
selected document fails. Graph normalization SHALL retain its existing semantics
for repeated relation occurrences.

#### Scenario: Table provenance

- **WHEN** a table is extracted from an object array
- **THEN** its entity provenance identifies the original file and current array record pointer

#### Scenario: Invalid source after publication

- **WHEN** a selected document acquires an unresolved reference
- **THEN** rebuilding fails and the previous valid derived data remains available

#### Scenario: Two FKs to one table

- **WHEN** two inline FK records target the same table through the same declared relation path
- **THEN** both occurrences remain in entity properties while the graph uses its existing canonical relation deduplication

### Requirement: Bounded extraction failure

Extraction SHALL reject cyclic YAML alias structures and enforce per-document
limits of 128 nesting levels, 1,000,000 visited/constructed value or selection
steps, and 100,000 emitted entities. Recursive traversal, value copying and
collection expansion SHALL count toward work limits. Limit failures SHALL be
diagnosed with the source/rule and available pointer, without truncation being
reported as a successful complete extraction. These limits SHALL NOT imply a
hard source-byte or decoder-memory bound.

#### Scenario: Excessive expansion

- **WHEN** a declared selection or recursive traversal exceeds its work limit
- **THEN** extraction fails and no truncated candidate set is published

#### Scenario: Cyclic YAML alias

- **WHEN** a parsed source contains an object cycle through YAML aliases
- **THEN** extraction reports an error rather than looping or expanding it
