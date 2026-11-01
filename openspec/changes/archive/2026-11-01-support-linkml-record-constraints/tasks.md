## 1. Extend the bounded schema vocabulary

- [x] 1.1 Add asserted/runtime unique-elements flags, record expressions, conditional rules and presence parsing/shape validation at the existing schema owner; verify valid constructs compile and invalid shape/unsupported rules fail with precise paths rather than being ignored.
- [x] 1.2 Normalize inherited/mixin constraints and unique flags without weakening current range/cardinality induction or changing classification_rules evaluation; verify diamond inheritance visits obligations once and local false cannot disable unique true.

## 2. Validate records and resolved reference values

- [x] 2.1 Implement shared record-expression and conditional-rule evaluation for top-level and inline records; verify exclusive selector one/both/neither cases, PRESENT/ABSENT, inactive/unconditional rules, inherited rules and branch-diagnostic isolation using focused synthetic fixtures.
- [x] 2.2 Correct effective union/reference checks after actual target resolution; verify a broad inherited Entity range with a narrowed two-class union rejects the wrong subtype and accepts both permitted branches, while existing literal/reference and scalar/inline provenance unions retain their behavior.
- [x] 2.3 Traverse nested inline references, collect owning-entity assertions with stable schema-path selectors and concrete diagnostic/source paths, and reject ambiguous selectors/incompatible nested inverses; verify missing/wrong nested targets fail and valid inline arrays create the expected edges without standalone inline nodes.
- [x] 2.4 Enforce unique collection values using reference-aware structural equality without data rewriting; verify duplicate scalar, resolved alias, inline object key-order and inherited cases, plus distinct literal/reference union values and optional absent collections.

## 3. Expose and read the effective model

- [x] 3.1 Export additive public field/record/rule constraint DTOs and nested reference-path descriptions; verify describeType exposes the effective executable contract, including restricted target unions, without private package imports or infinite recursive expansion.
- [x] 3.2 Project resolved nested references into properties while preserving inline shape, literal branches and available relation provenance; verify existing top-level field/facet behavior plus a representative get/getMany/query projection.
- [x] 3.3 Use the same nested selector semantics in canonical graph preparation and SQLite adjacency reads; verify JSON/SQLite schema/property/graph parity, selector/direction behavior and existing independent graph bounds on one integration fixture.
- [x] 3.4 Verify the effective IR round-trips through supported publication formats and packed public declarations; if its private SQLite representation changes incompatibly, bump the disposable format and prove rebuild guidance instead of adding migrations. Confirm source files remain untouched.

## 4. Complete product and acceptance gates

- [x] 4.1 Update README, SDK docs and modeling/usage skills with the bounded profile, recursive references, constraint discovery and rebuild implications; add a root-package changeset and verify examples use only @khaale/lore. Identify support-table/unsupported-prose edits needed at later spec sync without presenting planned behavior as current main specs.
- [x] 4.2 Extend the packed-consumer boundary with typed constraint descriptions and CLI/JSON/SQLite reads; verify existing consumers still work, schema/record validation does not alter authored files and installation needs no private workspace dependency.
- [x] 4.3 When the supplied SA metamodel is available, compile it unchanged and use existing classification_rules in a disposable acceptance copy for record classification and exercise a scoped complete acceptance corpus, including both previously missed reference failures; record model acceptance separately from existing SA data violations and excluded tooling policies. Otherwise record optional-corpus unavailability; keep mandatory fixtures project-independent.
- [x] 4.4 Run pnpm check, pnpm test:cli and strict change validation using the repository execution capsule; verify the implemented public contract agrees with these deltas and reconcile sync ordering with add-sqlite-index before declaring the change ready for archive.
