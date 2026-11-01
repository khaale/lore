## 1. Compile model-owned source declarations

- [x] 1.1 Add schema-only `lore:sources` parsing and normalized plan types; verify valid declarations compile, invalid placement/unknown keys fail, and models without the annotation retain existing behavior.
- [x] 1.2 Validate lexical bindings, entity identifiers, expression operators, target rules/classes/declared fields and statically knowable types; verify negative compiler fixtures include identity-field overrides and invalid recursive paths.
- [x] 1.3 Compose named sources across local imports and include effective plans in schema identity; verify unique names, diamond imports, duplicate-name errors, and changed-mapping invalidation.

## 2. Discover and extract source records

- [x] 2.1 Add root-relative selector matching and exclusive claiming against eligible discovered files; verify ignore/output/schema exclusions, overlap errors, missing literal inputs, empty globs and unchanged generic parsing of unclaimed files.
- [x] 2.2 Implement binding, field construction and single-document YAML/JSON mapping-root extraction; verify dictionary keys, arrays, optional/empty selections, wrong collection shapes, nested definitions and detached copied values.
- [x] 2.3 Implement two-pass namespaced identities and local key/pointer references; verify forward/cyclic DTO links, escaped pointers, DB reorder stability, operationId-independent identity, duplicate IDs, missing/external targets and the real ordinary `$ref` data regression.
- [x] 2.4 Enforce documented depth/work/entity limits and reject YAML object cycles; verify each failure produces a source/rule diagnostic without successful truncated output.

## 3. Integrate existing graph and index lifecycles

- [x] 3.1 Feed extracted candidates into shared check/index ingestion with physical file/pointer provenance; verify a mixed ordinary/projected corpus, typed nested FK links and public SDK entity/query/graph parity for JSON and SQLite.
- [x] 3.2 Connect watch and conditional refresh to declaration/source changes; verify additions/deletions, imported mapping edits, no-change generation preservation, last-valid retention after extraction failure, repair and published-only SQLite reads without source access.

## 4. Deliver examples and acceptance

- [x] 4.1 Ship readable `lore:sources` OpenAPI and SA database example models, align README/SDK/modeling/usage documentation and add a root changeset; verify examples run through the product path and packed consumers require only `@khaale/lore`.
- [x] 4.2 Run read-only acceptance on the same selected SA inputs with disposable indexes; verify the current baseline of 42 APIs, 2,236 operations, 5,083 DTOs, 26 databases, 419 objects and 278 FK occurrences, explain source drift if counts change, and record actual SDK reads and extraction limitations.
- [x] 4.3 Run `pnpm check`, `pnpm test:cli` and strict OpenSpec validation in the established Node 24.20.0 / pnpm 10.17.0 environment; verify the packed public boundary, inspect scope for source-specific hardcoding/duplicate paths, and mark completed tasks as work finishes.
