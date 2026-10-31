# SQLite research workload

Deterministic, fully generated SA-shaped data for comparing Lore storage and read
implementations. This tooling is repository-local and is not shipped in the public
package. Authored SA data and its live index are never modified.

## Generate and measure

Use the repository Node 24 / pnpm 10.17.0 environment, preserving the existing PATH:

```sh
CI=true pnpm build
node scripts/benchmarks/generate.mjs _tmp/sqlite-benchmark/sa-research-v1 sa-sqlite-v1 1
node scripts/benchmarks/run.mjs _tmp/sqlite-benchmark/sa-research-v1 _tmp/sqlite-benchmark/candidate 20
node scripts/benchmarks/compare.mjs scripts/benchmarks/baselines/2026-10-31-sa-v1.json _tmp/sqlite-benchmark/candidate/results.json
```

Arguments for generation are output directory, seed and number of copies. One
copy is the SA-sized workload. Three or ten copies scale counts, graph components
and files together, retaining per-group degree distributions. Replicas have new
IDs/text; they do not create edges across copies. No connection to SA is required
to generate or benchmark from the checked-in profile.

Both generator and runner refuse nonempty output directories. Keep the corpus
fixed for A/B tests and use a new result directory. The runner's fourth argument
selects another built `dist/` directory, so two implementations can read the same
corpus without replacing one another's build. Build **before** measuring; avoid
concurrent builds or background load. Do not use a live corpus with the runner:
it deliberately changes one generated Markdown document, times refresh, then
restores the original bytes and refreshes again in `finally`.

Each result directory contains `results.json` and its SQLite index. Generated
corpora/results belong under ignored `_tmp/`, not in Git. Raw samples and baseline
metadata are kept in [the baseline JSON](baselines/2026-10-31-sa-v1.json).
`compare.mjs` requires equal content SHA256, root-path length, seed, copy count
and verified logical counts. It rejects a changed fixture rather than printing
a misleading speedup. Input hashing ignores derived state and benchmark metadata;
the runner checks restored authored bytes at completion.

## What the profile preserves

The reference is the previously published SA SQLite generation with 29,055 entities
and 47,304 canonical edges. `profile.mjs INDEX OUTPUT.json` reads it read-only and
retains aggregate information, not original records, IDs, paths or text:

- Counts of the 24 populated types, with the original 49 model class names.
- Counts and **both exact degree histograms** for all 50 combinations of source
  type / relation / target type. Seeded bipartite Havel–Hakimi constructs different
  endpoints with those degrees. This retains the large hubs, not a uniform graph.
- Identifier-length distributions, payload structure/array sizes and text-length
  samples by type, and exact narrative length/UTF-8 byte distributions.
- 1,078 Markdown files (880 classified, 198 unclassified), three JSONL groups,
  and their grouping by type. The anonymized input-directory tree has 884 nodes.
  File/directory name lengths are approximated while preserving unique paths.
- Up to 32 payload shape samples per type. String values become generated
  ASCII/Cyrillic text; unknown nested dictionary keys become synthetic keys.

The generated model is a **statistical scaffold**, not the original LinkML business
model: the 49 class names inherit a simple Entity and one auxiliary inline
BenchmarkPayload class is added. It uses explicit IDs/types, a deterministic
`cohort` scalar for queries and typed relation fields. Original record constraints,
classification, polymorphic payload semantics, clustering/communities, DAG
invariants, token frequencies/compressibility, correlation between different
relation groups and excluded/empty directory traversal are not reproduced.
Same-type links may form self-links/cycles; the scaffold does not assert hierarchy
semantics. Non-finite values or business-specific examples are not copied.

The published reference predates a required/null classification semantic change.
A new ingestion of its adapted model can classify fewer rows. Generation uses
the frozen published statistics, so that ingestion difference cannot silently
change the fixture. This workload targets SQLite layout/read/update comparisons;
it does **not** replace real SA profiling of classification/reference resolution.

## Frozen baseline: 2026-10-31

Measured on Apple M1 Pro, 8 CPUs, 16 GiB, macOS arm64, Node 24.20.0 / SQLite version
recorded in JSON. `CI=true`. SDK/CLI SHA256 identify the measured bundles.

The bundle was frozen under `_tmp/sqlite-benchmark/dist-baseline` **before** the
parallel per-build reference-map optimization. Git HEAD was `a8a269b` with the
uncommitted `lore:sources` implementation. Later builds from this checkout can
therefore be candidates; they must not be presented as the same baseline build.
The local machine was not CPU-isolated and parallel development work was possible.
These are exploratory local timings, not a regression threshold or significance
test. No OS cache flushing or forced GC was performed.

### Fidelity and size

| Measure                            | Published SA reference |       Synthetic baseline |
| ---------------------------------- | ---------------------: | -----------------------: |
| Entities                           |                 29,055 |                   29,055 |
| Canonical edges                    |                 47,304 |                   47,304 |
| Populated types                    |                     24 |                       24 |
| Typed relation groups              |                     50 |                       50 |
| Per-group in/out degree histograms |              reference |              exact match |
| Payload JSON bytes                 |             11,819,637 |      11,832,875 (+0.11%) |
| Stored narrative UTF-8 bytes       |              4,186,132 |                4,186,132 |
| Markdown / JSONL files             |              1,078 / 3 |                1,078 / 3 |
| Markdown/JSONL input bytes         |             21,131,356 |               26,234,886 |
| Corpus root string length          |                     91 |                       99 |
| Database bytes                     |            261,496,832 | 258,707,456 (246.72 MiB) |

Source bytes differ mainly because synthetic records explicitly serialize long
identifiers, type/scaffold fields and link arrays. The payload/narrative and graph
sizes are the closer controls. Similar total database size is not proof of identical
page packing: row shapes, path lengths and validation semantics differ.

Database size is measured **after** the changed-file rebuild and restored-file
rebuild, with all workspace connections closed: WAL = 0, freelist = 0. Table pages
occupy 212,680,704 B; SQL-index pages 46,022,656 B. `dbstat` page allocations,
payload and unused bytes for every table/index are stored separately. Column
content sizes (already included in page allocations, do not sum twice): entity
JSON 38,408,279 B, artifact JSON 53,567,917 B, narrative 4,186,132 B.

### Timings

Warm rows have two unmeasured warmups and 20 measured calls, except the complete
sparse scan (five measured calls). p95 uses nearest rank; with five samples it is
the maximum. Result serialization/byte counting happens outside operation timers.

| Operation                                        |   Median ms |       p95 ms |
| ------------------------------------------------ | ----------: | -----------: |
| Fresh-process indexed open, five processes       |        1.93 |         3.86 |
| First ID read in those processes                 |       10.59 |        12.36 |
| Describe                                         |        2.67 |         5.17 |
| Evidence get                                     |        2.43 |         5.16 |
| Narrative get, 2,927 chars                       |        2.76 |         6.55 |
| Batch 4 / batch 64                               | 2.90 / 6.90 | 4.22 / 10.61 |
| Query 20, scan budget 100                        |        4.13 |         8.36 |
| Filtered query, five matches / budget 100        |        3.58 |         6.10 |
| Sparse query first page, zero matches            |        3.31 |         5.90 |
| Sparse query to completion, 30 pages / one match |      379.95 |       560.85 |
| Search hit / miss, budget 100                    | 3.99 / 3.29 |  6.47 / 4.15 |
| Discovery neighborhood, depth 1                  |       46.97 |        48.94 |
| Observation neighborhood, depth 1                |      370.59 |       379.41 |
| Hub neighborhood, degree 17,277                  |      368.17 |       418.83 |
| Grouped batch 4 + evidence graph                 |      373.13 |       414.50 |
| No-change refresh, maxAge 0                      |      109.00 |       116.84 |
| Get with refresh-on-read, maxAge 0               |      108.11 |       113.40 |
| Get with cached check, maxAge 1,000 ms           |        2.87 |         3.13 |

Initial build: **4,046 ms**, one CLI invocation including process startup and
publication. A single changed Markdown document triggers the current full rebuild:
**4,094 ms**, one refresh measurement; restoration/rebuild is outside that timer.
There are no claimed build p95 values from one sample. The original SA build had
much more classification/reference work, so do not infer a core speedup from this
synthetic build time.

Graph reads are bounded to 20 nodes / 50 edges. A small output still encounters
the large hub/boundary cost; evidence and discovery are intentionally separate
seeds. Result sizes, coverage and actual returned counts are in JSON, including
the empty first page of the sparse query. “Fresh process” means normal OS caching,
not cold physical disk. Open time excludes module import; process time includes
startup/import/open/first get/first graph and has median 462.52 ms.

Open RSS delta median: 1.22 MiB. The mixed warm-read process reached peak RSS
468.38 MiB; the entire run including full fidelity validation and update reached
760.00 MiB. These are whole-process high-water marks, not per-operation allocations
or retained-memory claims. Current memory snapshots are also stored separately.

## Verification

```sh
node --test scripts/benchmarks/generate.test.mjs
pnpm exec eslint scripts/benchmarks/*.mjs
pnpm exec prettier --check scripts/benchmarks
```

Tests verify identical generated bytes for a seed, changed data for another seed,
nonempty-output protection, doubled corpus counts and exact typed degrees through
the real CLI/public SDK, source-free profile capture and A/B input fingerprinting.
The full baseline verifies all 29,055 entities and every group degree histogram
through the public SDK; timings also use only public CLI/SDK APIs. `dbstat` and
optional recognized column-size metrics are introspection outside timed operations.
No source-specific data, benchmark machinery or optimization was added to runtime.

- [x] Capture a source-free statistical profile from the published SA index.
- [x] Implement seeded corpus generation and scalable copies.
- [x] Verify generated data through normal publication and public reads.
- [x] Measure build, updates, indexed/checking reads, graph and storage.
- [x] Preserve raw samples, environment, bundle identity and input fingerprint.
- [x] Provide guarded A/B comparison and document workload limitations.

## Volume and RAM sweep

```sh
node scripts/benchmarks/scale.mjs _tmp/sqlite-benchmark/volume-candidate dist 10
```

The driver measures ¼×, ½×, 1× and 2× sequentially, launches a fresh runner per
volume and removes each generated corpus/index before creating the next. It
refuses to start the next volume with less than 1 GiB free. Only JSON reports
remain; the largest temporary workload is two copies, not an unbounded ramp.
Build once before running and avoid concurrent tests/builds.

Generation also accepts a fourth optional `FRACTION` argument. Smaller graphs
retain a stratified selection of each type and remap removed endpoints to a
retained same-type representative, deduplicating links. Their actual N/E and
degree histograms are checked and recorded, but they are contractions rather
than exact scaled degree distributions. Full independent copies preserve local
degrees; 1×→2× is the cleaner scaling comparison. Directory layout is shared
between replicas, so source-check time need not scale with entity count.

RAM measurements distinguish three processes/scopes:

- Build: peak RSS from the actual CLI process using a small Node preload exit
  probe, including native SQLite allocations, not just the JS heap.
- Indexed reader: five separate fresh processes, recording peak RSS, current RSS
  after first reads and after 20 additional get/hub-neighborhood pairs. These
  never perform validation or builds. Open deltas remain separately available.
- Mixed runner: current/peak RSS after reads and after full fidelity validation
  and changed/restored rebuilds. This deliberately includes test-harness data,
  not a pure production-reader memory budget.

RSS includes runtime, SQLite, native allocations and retained allocator pages.
Repeated-read snapshots are observations, not proof of a leak or leak freedom.
No forced GC or cache flushing is performed. Reports keep raw samples and JS
heap/external memory snapshots where available. Single build timings and four
sizes support empirical trends; they do not establish mathematical complexity.

## Internal graph engine

After `pnpm build`, measure the private graph engine in a fresh process:

```sh
node scripts/benchmarks/analyze.mjs sqlite DISPOSABLE_INDEX.sqlite OUTPUT.json
```

`json` mode accepts a prepared `{index,schema}` fixture. This is repository tooling,
not a public topology-export API. Keep output under ignored `_tmp/` or thread
storage. The runner separates source loading, topology, first/warm ranking and
community summaries; RSS includes six alternating full/small projections.

On 2026-10-31, the historical SA snapshot (29,055 records / 47,304 canonical edges)
measured 131 ms topology preparation, 15 ms warm balanced rank and 228 ms first
community computation on SQLite. The matching JSON/SQLite results were identical;
peak process RSS was 216/540 MiB respectively, and 354 MiB for synthetic SQLite 2×.
Three fresh processes per input, normal OS cache, Node 24.20.0 / M1 Pro / 16 GiB.
These are local observations, not regression thresholds or end-to-end browser SLA.

A separate 24-cycle projection soak plateaued around 361 MiB RSS. After owner close
and diagnostic GC, live JS heap/ArrayBuffers were about 9/0.2 MiB; RSS stayed high.
Numeric topology size and retained live memory do not equal process RSS. Detailed
one-off reports/prototypes belong outside the repository; permanent behavioral
regressions remain in graph/SDK tests.
