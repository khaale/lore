## Context

See [proposal.md](proposal.md) for motivation and capability ownership. The schema compiler already has slot expression parsing, inherited field induction and an internal ClassExpr used for classification. Core separately validates records and resolves top-level references. The SDK has shared JSON/SQLite read semantics; SQLite stores the compiled read model and source configuration from the implemented `add-sqlite-index` change.

Read-only investigation of SA's original 45-class model produced 48 unsupported-metaslot diagnostics: 46 list_elements_unique, one DeploymentSelector.exactly_one_of and one DeploymentSite.rules. A disposable copy with only those constructs removed compiled, but classified zero records without the separate tooling profile's type map. Adding exact classifiers exposed two validation gaps: Component.parent accepted a DeploymentSite despite its RuntimeEntity/Subsystem union, and an inline position_refinements.scope pointing to a missing record produced no error or relation. The adapted BB model additionally opens some classes and changes Component.parent cardinality; it is not the acceptance source of truth for this change.

Standard semantics are grounded in the primary LinkML definitions of [list_elements_unique](https://linkml.io/linkml-model/latest/docs/list_elements_unique/), [slot expressions and presence](https://linkml.io/linkml-model/latest/docs/SlotExpression/) and [record rules](https://linkml.io/linkml/schemas/advanced.html#rules). Lore continues to publish its own bounded executable profile, including its existing empty-value policy.

## Goals / Non-Goals

**Goals:** preserve original schema constraints, validate reference targets recursively, and let ordinary public readers discover the contract they actually execute. Use one semantic implementation across current-source CLI, JSON and SQLite publication/read paths.

**Non-Goals:** importing SA's entire tooling-profile format; arbitrary schema overlays; automatic scalar-to-list coercion or deduplication; most-specific/heuristic classification; executable rule expressions; elseconditions/bidirectional inference; remote ontology resolution; generators, source-collection services, waiver/severity policies; BB UI changes. No property-index/storage framework or new consistency token is required.

## Decisions

### 1. Extend asserted definitions and effective IR at their current owners

Add the unique-elements flag, record expressions and conditional rules to schema parsing/structure checks and effective normalization. Keep new validation record expressions separate from classification_rules: the latter's accepted-but-unevaluated forms do not silently acquire new classification semantics.

The record-expression grammar contains slot_conditions and nested any_of/all_of/none_of/exactly_one_of. Slot conditions reuse the existing supported SlotExpr grammar plus value_presence PRESENT/ABSENT. Other record predicates, including is_a in this new validation grammar, remain diagnosed. Class rules support optional preconditions and required postconditions; ordinary descriptive rule metadata can follow the existing metadata policy. No elseconditions or generated values.

Class constraints and rules from a class, mixins and ancestors are conjunctive obligations, visited once in the established ancestor order. Unique true accumulates like other required constraint flags; false cannot relax inherited true. Reject true on an effective single-valued slot. Existing cardinality/range induction stays intact.

Use one side-effect-free predicate evaluator for condition/branch checks and one diagnostic-producing validation traversal. Satisfied alternatives do not leak errors from rejected branches. Presence shares current required-value emptiness: missing/null, blank strings and empty lists are absent; false/zero are present. Normal validation still reports invalid references even when a conditional precondition fails.

### 2. Resolve reference-aware constraints using actual targets

Separate value-shape checks from target-aware checks while sharing the normalized expression vocabulary. Evaluate reference constraints against the resolved target class and its ancestry, not merely the fact that a nonempty string could refer to a class. Combine inherited base range and all effective boolean restrictions; do not select only the base range or first alternative.

Retain existing scalar/reference selection: a supported bare scalar literal stays literal even when it matches an ID; explicit WikiLink/Markdown link surfaces select reference handling. Preserve enum/inline provenance unions without reclassifying inline values as entities.

Walk declared inline objects and arrays recursively. Validate each nested reference and collect an assertion from the owning entity with a schema path such as position_refinements.scope. Array indices stay in concrete diagnostic/source paths, e.g. position_refinements[0].scope, and do not split graph relation vocabulary. Reuse available spans/provenance; introduce no new audit identity. A schema path that collides with a literal dotted field or another incompatible effective selector fails normalization. This gives callers stable selectors without creating graph nodes for value objects.

Use the same path resolver in core graph construction, canonical SDK graph preparation/SQLite adjacency publication, relation metadata and nested entity projection. Predicates and projection must not disagree on which union branch was accepted. Top-level inverse declarations retain current behavior; no inverse links are invented for unannotated nested fields. A nested inverse that cannot target the owning entity with a compatible declared range is rejected rather than producing an ill-typed inverse assertion.

### 3. Validate list uniqueness without rewriting authored values

Run uniqueness with normalized validation values after reference resolution. Scalars compare by native typed value; arrays by order; objects by recursively sorted mapping keys. References compare by resolved target ID, so supported link aliases for one entity count as duplicates. Union values retain a branch tag distinguishing a scalar literal from a reference; nested inline objects use their recursively normalized references.

Do not collapse duplicate authored assertions or alter source properties to make validation pass. Report an owning slot/path and duplicate occurrence using existing diagnostic conventions. Optional absent collections are not made required. Do not add list uniqueness to corpus unique_keys: they govern different scopes.

### 4. Reuse existing classification and publication inputs

No typemap option, sidecar, aliases API or extra freshness dependency is introduced. Existing designators and classification_rules retain their current behavior. For SA acceptance, compile the original model unchanged to establish constraint support; for classifying test records, add existing flat classification_rules only to a disposable acceptance copy or use a self-contained fixture. Record that source schemas without classifiers are not self-sufficient for classification. Do not add SA conventions to Lore or change SA files.

Runtime IR additions must round-trip through SQLite and public package output. If an existing private SQLite format cannot represent the required model, bump its private format and require explicit rebuild; do not add migrations. A new binary does not prove an existing saved projection passed the new validator. Rebuild for acceptance and rollout of the stronger contract.

### 5. Expose an executable contract through public descriptions

Add exported public DTOs for slot/record expressions and conditional rules. Keep existing FieldDescription properties and append constraints describing effective patterns, scalar bounds, uniqueness and boolean expressions. Add effective recordConstraints/rules to TypeDescription and a referencePaths catalog with stable selectors/target expressions for nested relations.

DTOs describe supported semantics and use public names, not internal AssertedSchema/RuntimeSchemaIR or private workspace imports. Both readers return detached values and matching metadata for one loaded generation. Avoid advertising every Entity subclass as allowed when the effective expression narrows it. Recursive inline class descriptions reference their class vocabulary instead of infinitely expanding a schema tree.

SDK property projection retains inline shape and array positions, replacing only resolved nested references with target IDs. Existing selection, lexical search scope, graph direction/limits, narrative opt-in and pagination/freshness remain unchanged. PTC consumes the shared read/schema changes and requires no new execution policy.

## Risks / Trade-offs

- **Schemas now expose previously accepted bad targets** → classify this as a correctness change, preserve diagnostics and require validation/rebuild; never relax ranges, cardinality or unknown-slot checks to make SA pass.
- **Raw link spellings differ from identity equality** → define reference-aware unique equality explicitly and test aliases, literal-vs-reference unions and inline mappings once at the owning boundary.
- **Nested selectors touch graph metadata and projections** → share path resolution and reject ambiguous spellings; test one JSON/SQLite parity flow with bounds rather than duplicating the parser matrix.
- **SA has constraints outside its metamodel** → loading the model does not claim execution of tooling-profile path checks, generator policies or metadata annotations such as sa_doc_relation_severity. List these limits in acceptance.
- **Private IR change may invalidate disposable indexes** → document explicit rebuild and use a fresh derived acceptance output; no migration compatibility framework.

## Migration Plan

Implement against the already completed SQLite change and keep its unrelated lifecycle requirements intact. Add product-independent schema/record fixtures, public DTO and CLI/packed-consumer checks, and update documentation and root changeset. Rebuild only disposable projections for acceptance. When the original SA model is locally available, compile it unchanged, then validate a deliberately scoped complete fixture corpus with existing classification_rules in a disposable acceptance copy; report any source-data violations separately rather than editing SA or relaxing the model. Existing broad BB indexes include evidence classes outside this model and are not a promise that all 29,055 records are valid instances of the original metamodel.

Sync the completed add-sqlite-index delta before this delta, or reconcile their ordering explicitly. When this change is eventually synced, update the profile's support table and unsupported prose together with its requirements; main current-state specs remain untouched during planning.
