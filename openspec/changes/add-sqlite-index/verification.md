# Implementation verification

Runtime capsule: Node `/Users/aleksander_khanteev/.nvm/versions/node/v24.20.0/bin/node`
24.20.0, pnpm in the same directory, 10.17.0. Commands preserve the existing PATH
with that directory prepended and use `CI=true`. `pnpm preflight` passed.

## Storage and concurrency

The private implementation lives in the SDK implementation package; the published
package bundles it and uses only Node's built-in SQLite. No authored source writes,
daemon, incremental updater, generic storage framework or SQLite PTC were added.
JSON remains the CLI default and the strict filesystem SDK remains available.

Focused tests cover ordinary read parity, lazy JSON graph preparation, offline
narrative, mutation isolation, scan continuations, eligible path/model/import/ignore
changes, no-change parsing/write avoidance, mid-build instability, failure age,
callback lifetime and close. Built-package process tests hold independent SQLite
readers across publication, coordinate zero-age refresh contenders behind a writer,
exercise immediate ownership timeout, and SIGKILL an actual refresher at a precommit
barrier. The previous generation survives and another process acquires ownership.
CLI tests cover initialization, refresh JSON/error output, repair and optional watch;
packed consumers cover root SDK exports, declarations and CLI without workspace deps.

## Disposable SA measurement (2026-10-30)

Used the read-only source/model/ignore configuration already supplied by bb-lore.
Wrote a new database under the system temporary directory, leaving the authored
corpus and bb-lore's existing JSON index unchanged. This is a local observation,
not an SLA. Runtime imports/process startup are excluded from the SDK operation
measurements. Filesystem caches were not flushed: “cold open” means a fresh process,
not cold physical disk. Full initialization includes a short-lived CLI process.

Corpus: 29,055 entities, 47,304 canonical edges (the existing source representation
has about 48,081 edges), 49 types. Inputs remain 1,078 Markdown and 3 JSONL files.

| Measurement | Observed result |
| --- | ---: |
| Full initialization / validated publication | 44.0 s |
| SQLite database after connections close | 261,496,832 bytes (249.4 MiB) |
| Fresh-process open (3 processes) | 1.37–2.11 ms |
| Open RSS delta | 1.14–1.20 MiB |
| Open JS heap delta | about 29 KiB |
| Schema describe | 10.0–10.9 ms |
| Bounded query, 20 items / scan budget 100 | 5.7–7.6 ms |
| ID entity read | 2.9–3.6 ms |
| Literal search, limit 20 / scan budget 100 | 3.6–3.9 ms |
| No-change refresh, 15 sequential checks | 186.6–272.3 ms; median 214.7 ms |
| Two overlapping same-process zero-age refreshes | 191–215 ms; unchanged + reused |

The first query selects a JSONL evidence entity with no narrative. A separate
Markdown check used `adr_001`, whose stored narrative has 3,073 characters:
explicit narrative reads were 2.2–14.1 ms (median 3.15 ms); depth-one graph reads
returned 2 nodes / 1 edge in 2.7–6.1 ms (median 3.32 ms). The first fresh-process
graph read on the JSONL seed took 40–42 ms, so small output alone does not guarantee
single-digit latency. Graph selection and source/entity metadata affect the cost.

For comparison, the earlier JSON baseline measured about 175 ms for discovery plus
stamps, 164 ms for an empty strict SDK read and 863 ms for a metadata-only grouped
scope with eager graph preparation. SQLite no-change refresh still walks sources;
its benefit is explicit check reuse, shared publication and source-independent reads.
No-change refresh is approximately 0.2 s here, rather than an in-memory timestamp lookup.

Narrative text totals about 3.06 million characters; it does not explain the database
size. Persisted entity JSON is about 33.8 MB, source artifact JSON about 45.5 MB and
canonical edge JSON about 22.5 MB; raw relation representations, SQL rows/indexes and
page overhead add more. This first version favors semantic parity and durable reads.
Full rebuild time and database footprint remain limitations; incremental rebuild,
compaction and further normalization are not part of this change.

## Specification lifecycle

Main specifications remain the pre-change current state until delta sync/archive.
When syncing the completed delta, also update the `core/index` Purpose (currently
JSON-only) and `openspec/config.yaml` context sentence that says only JSON is
published. The delta owners stay core/index, sources/discovery, interfaces/sdk and
interfaces/cli; no storage-provider hierarchy is introduced.

## Final gates

- `pnpm check`: passed, 22 files / 135 tests, including lint, formatting, build,
  public consumer declarations and packed installation.
- `pnpm test:cli`: passed, 4 files / 12 tests, with built CLI/SDK.
- `openspec validate add-sqlite-index --strict`: passed.
- `git diff --check`: passed.

All 21 implementation tasks are complete. Delta sync/archive and package publication
remain separate lifecycle actions.

## BB cold-open contention correction

A separate process holding a valid WAL database in exclusive locking mode reproduced
cold open returning INDEX_REBUILD_REQUIRED. Its SQLite BUSY cause was being wrapped
as unsupported storage. This confirms the classification defect; the exact original
live BB WAL/recovery event was not captured.

The correction preserves BUSY/LOCKED internally and bounds asynchronous reader
open/status/transaction-entry waits with busyTimeoutMs. Timeout reports INDEX_BUSY;
refresh startup/ownership still reports REFRESH_BUSY. Invalid storage remains a
rebuild error. Waiting closes failed reader connections before yielding, permits a
same-process timer to release a lock, and never retries an entered caller callback.
No database migration or corpus rebuild is needed.

Regression coverage includes zero and nonzero exhausted reader waits, refresh header
contention, two cold processes proceeding after a held lock is released, 30 concurrent
cold reopen/read/close iterations per worker, and a busy-shaped caller error propagated
once. Final gates: pnpm check 22 files / 139 tests; pnpm test:cli 4 files / 15 tests;
strict change validation and diff check passed.

Corrected package: `/private/tmp/lore-sqlite-busy-fix/khaale-lore-0.1.0.tgz`, SHA1
`7f3079e70e5cb38cd36863d5e1bf78896ce5bc75`. Sent to BB for vendor/install and live
acceptance; global ~/.local installation also updated and its INDEX_BUSY export
verified. All 24 tasks, including the acceptance-discovered correction, are complete.
