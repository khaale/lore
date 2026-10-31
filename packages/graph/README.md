# Private graph computation

Repository implementation module, **not a public package/API**. The public
`@khaale/lore` declarations and exports do not expose it. SDK rank/community APIs,
PTC adapters and BB 3D adoption remain separate interface work. Do not require
users/plugins to install or import workspace packages.

The module accepts an immutable, repeatable canonical metadata source and builds a
bounded numeric graph. JSON canonicalization and pinned SQLite metadata adapters
live in `packages/sdk/src/graph-analysis-source.ts` to avoid reversing SDK ownership
or duplicating canonical inverse/inline reference rules here. SQLite supplies its
integer endpoint keys directly: external string IDs are loaded once per node,
not recreated for every edge. No properties/narrative are hydrated by that adapter.
The JSON source already holds its index and canonical view; their cost remains
part of the loaded JSON reader, not something a CSR can remove.

`GraphAnalysisCache.read(source, projection, callback)` owns one reusable projection.
A loaded JSON index object or existing SQLite generation/schema identity determines
reuse. A source's check callback enforces its caller-owned read lifetime; SQLite
also requires an open transaction. The module does not refresh sources or upgrade
freshness. Active reads survive cache replacement; `close()` rejects new reads and
waits for active callbacks. Escaped read objects are invalidated and release their
source/topology references. All asynchronous analysis work must be awaited inside
the callback. Workers, concurrency, I/O boundaries and external effects stay with
the caller.

Internal rank/communities return plain bounded summaries. Solver/CSR types are not
returned. Scope types include descendants and relations select canonical predicates;
both endpoints must be in scope. Zero-degree nodes are reported separately. Input
caps are 100,000 projected nodes / 1,000,000 canonical edges; output caps are 100
nodes/groups and three representatives per group. Counts are not hard byte/RSS or
wall-clock guarantees. A metadata source can still require a scan of the underlying
source before its projected counts are known.

PageRank uses damping .85, max200/tolerance1e-10, with full-scope normalization.
Independent fixtures verify the pinned Graphty personalized solver's normalized
fixed point against standard dangling-mass redistribution. The library's raw legacy
mass is not returned. Leiden uses resolution1/seed42/max10 passes/threshold1e-7;
its partition is independent of balance. Type balance q=1/(1+n_type/k), with k the
median populated participating type size, changes priors, representatives and group
mass/order. Group anchor is its minimum actual ID (locale ordering + raw tie break),
not a persistent model entity or cross-generation identity. Groups do not export
members or quotient links in this technical phase.

Run `pnpm build` and the focused graph/SQLite tests before the repository gates.
`scripts/benchmarks/analyze.mjs sqlite INDEX OUTPUT.json` measures the internal
metadata/topology/solver/output stages in a fresh process. `json` mode accepts a
prepared `{index,schema}` research fixture. It is deliberately not a public SDK
example or a product migration command. Benchmark commands and dated measurements are documented in
[scripts/benchmarks](../../scripts/benchmarks/README.md).
