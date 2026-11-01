## Context

See proposal for the accepted compact-with-arcs choice. The research prototype
proved lossless original-SA round trips and SQL graph derivation on six fixtures;
production uses lazy SDK decoding and broader model parity coverage.

## Goals / Non-Goals

Preserve the existing public reader contract while removing redundant persisted
representations. Do not migrate old derived indexes, change source ownership,
move classification/validation into SQL, add compression or change query budgets.

## Decisions

- Use private format version 2. Retain the metadata/model/input table names for
  lifecycle ownership; reject previous formats with close/remove/rebuild guidance.
- Integer entity keys follow existing scan ordinal (key minus one). Dictionaries
  hold types/URIs, physical paths/locator prefixes and predicates. Properties,
  provenance and narrative are stored once. A typed raw delta records only the
  changed/removed data fields and artifact metadata differences needed to restore
  source-facing reads. Pack only known provenance/path fields; arbitrary authored
  `source` properties must never be mistaken for encoded paths.
- Load validated semantic entities/relations first. Create target lookup tables,
  edges, extra presentations and arcs via setwise SQL. Source validation uses the
  existing per-build lookup maps; SQL lookup tables serve the loaded projection,
  not a second source classification pass.
- Stage entity/predicate locale ranks in JS, matching `localeCompare`; use those
  integer ranks in SQL ordering. Match first-compatible model slot inverse lookup,
  including nested reference paths. Keep explicit/inferred presentations distinct.
- Keep dictionaries lightweight and metadata-only. Bounded reads load entities,
  relations/edges/arcs on demand; only whole-corpus explore builds a full index.
  Readers reconstruct the same external keys, relation orientations and facets.
- Preserve the current single compile/discovery and pre-read stamp baseline, no
  post-read source-stability rejection. Existing writer transaction, failure and
  reader-lifetime controls remain around the new writer.
- Retain PK/UNIQUE during load and build secondary indexes after loading within
  the same transaction, as already implemented. No multi-row JS insertion scheme.

## Risks / Trade-offs

- Raw semantic values differ from artifact values → compare reconstructed artifacts
  and public explore, including missing/null/empty and nested reference forms.
- SQL collation differs from locale order → persist locale ranks and test Unicode.
- Inverse/self edges have subtle folding → test against the shared JSON reader on
  adversarial fixtures, including duplicate provenance and implicit presentations.
- Joined graph reads may cost more → measure full build/read/refresh pipelines on
  the same frozen generated corpus; report each workload, not isolated insert time.
- Earlier completed deltas remain unsynced → sync SQLite and declarative-source
  predecessors first; this delta adds compact guarantees without restating them.

## Migration Plan

Close consumers of a previous-format index, remove its disposable database and
sidecars, then run `lore index --format sqlite` again. No silent migration or dual
reader. Live SA/BB indexes and global installation are outside this implementation.

## Volume and memory acceptance

Use sequential quarter/half/full/double generated volumes, cleaning temporary
inputs and derived indexes after each. Require at least 1 GiB free before the
next volume. Separate the actual CLI build process, fresh indexed readers and
the mixed validation/update harness for RSS measurements. Record native-inclusive
peak RSS and snapshots after first/repeated reads; do not infer retained memory
or leak freedom from a high-water mark. Keep raw samples and actual graph counts.
