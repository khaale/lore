## Context

Graph algorithms need a canonical, compact topology and explicit lifetime/resource
bounds. Existing JSON and SQLite readers already own logical inverse folding,
inline references and source/index identity. The technical library consumes those
semantics without adding root SDK/PTC methods. Public API and 3D adoption remain
separate work, as requested by the user.

## Goals / Non-Goals

**Goals:** bounded analytical computation, deterministic results, metadata-only
SQLite reads and a private implementation boundary reusable by later interfaces.

**Non-Goals:** public rank/community methods, algorithm registries, solver knobs,
full membership/quotient transport, workers/daemons, analytics persistence, GPU,
authorship inference or automatic consumer adoption.

## Decisions

### Private computation package and source adapters

Keep computation in a private workspace package independent of SDK classes.
SDK-internal adapters supply canonical JSON relations or numeric endpoints from a
caller-owned pinned SQLite transaction. They do not reclassify records, traverse
source files or hydrate all properties/narratives. SQLite numeric keys avoid
recreating long external IDs per edge; external IDs are loaded per node.

Types/relations define an induced scope. Exclude zero-degree nodes from solvers
and report their count separately. Apply the input caps before solver allocation;
output limits do not imply bounded computation. Ordinary SQLite traversals retain
their lazy SQL path, with earlier endpoint filtering before provenance hydration.
Do not load an analytical CSR merely for an ordinary neighborhood read.

### Fixed solver conventions

Use pinned Graphty graph-format/algorithms internally. Preserve parallel canonical
triples for directed ranking; collapse endpoint duplicates for undirected community
analysis, retaining logical self-loops. Keep dependency types out of root public
exports/declarations and load solvers lazily. Public packaging of these dependencies
and their licenses belongs to later API integration.

Verify normalized personalized PageRank against an independent standard recurrence,
including nonuniform priors, dangling nodes, loops and parallel edges: the pinned
package's raw personalized scores use a legacy dangling-mass scale. Normalize only
with that correctness proof; reject non-finite/non-converged results. Use fixed
Leiden defaults and deterministic ID ordering with raw-string fallback for
locale-equivalent IDs. Algorithm upgrades require fresh convention tests.

### Statistical balancing and summaries

Type balance uses q=1/(1+n_type/k), with the median participating type count k.
It changes ranking priors, representatives and group mass/order, not partition
membership. Keep raw group size distinct from mass. Source volume/path/format
cannot establish human authorship or business importance. Isolates are a separate
coverage concern, not meaningful one-node communities or high-value rare records.

Return fresh bounded summaries with at most three representatives and a real-member
anchor independent of representative selection. Anchors only identify a group
within the same source/projection/solver convention; they do not create authored
entities or imply cross-generation correspondence. No full partition export.

### One reusable projection with caller-owned lifetime

Reuse loaded JSON index object identity or existing SQLite generation/schema
identity plus normalized scope/direction. Keep one cache entry, not an unbounded
map of projections/results. Active callbacks retain their own topology across
replacement. Close rejects new reads, waits for active callbacks and releases
cached data. Escaped readers invalidate both topology and source-guard references.
Caller owns transaction/freshness boundaries, concurrency and worker scheduling;
the library does not upgrade freshness or replay work.

## Risks / Trade-offs

- All-relations ranking can mostly measure ownership/deployment hubs. Callers need
  a projection appropriate to their question; balance is not semantic criticality.
- Compact numeric data does not imply low process RSS. Measure transient allocation,
  JSON source ownership and repeated projection changes, including after close.
- Solver package breadth does not prove its conventions. Test the adapter against
  reference graphs and JSON/SQLite parity before any public exposure.
- Representative summaries cannot drive complete 3D expansion. That requires a
  separately agreed bounded membership/quotient contract with generation checks.

## Integration boundary

No root public API or SQLite-format migration is part of this phase. Existing
traversal semantics remain intact. Later SDK/BB integration must explicitly decide
transport, coverage and projection identity. Lore owns canonical topology/solvers;
consumers own scene budgets, disclosure, layout and context. Main-spec sync/archive
is a separate lifecycle step after the SQLite/compact predecessors are reconciled.
