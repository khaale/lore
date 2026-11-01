## 1. Compact writer and reconstruction

- [x] 1.1 Implement version-2 dictionaries, compact entity/raw delta and typed provenance codecs; verify exact semantic/artifact round trips including null/empty/nested/raw source fields.
- [x] 1.2 Implement setwise target lookup, canonical edges/presentations/arcs with locale ranks; verify JSON graph parity across inverse/self/orphan/multiple-provenance fixtures.
- [x] 1.3 Integrate transactional writer, deferred indexes and version validation; verify unchanged/failure/rebuild guidance and existing concurrency/kill tests.

## 2. Lazy read surfaces

- [x] 2.1 Adapt entity/scan/artifact/narrative/relation reads to compact tables; verify ordinary public and packed reads, empty reference facets and global explore parity.
- [x] 2.2 Adapt bounded graph reads and candidate enumeration with integer joins; verify order, inverse/hidden traversal, coverage and continuation regression cases.

## 3. Acceptance and delivery

- [x] 3.1 Run original-SA projection round trips and frozen synthetic full pipeline A/B; record actual build/read/refresh/storage differences without changing live data or the frozen baseline.
- [x] 3.2 Align README/SDK/usage docs and root changeset with format/rebuild guidance; verify existing single-pass/declarative deltas remain coherent.
- [x] 3.3 Run pnpm check, pnpm test:cli, strict OpenSpec and diff checks, inspect scope and mark completed tasks.
- [x] 3.4 Measure quarter/half/full/double generated volumes sequentially with bounded disk use and cleanup; retain actual N/E, timing/size samples and isolated CLI-build/reader RSS peaks, repeat-read snapshots and explain empirical scaling limits.
