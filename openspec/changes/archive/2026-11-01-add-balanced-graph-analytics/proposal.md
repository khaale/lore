## Why

The graph PoC established practical compact topology and analytical algorithms,
but production needs an independently verified technical substrate before deciding
how to expose it. Bulk data balance, generation lifetime and memory limits must
be tested without prematurely expanding the public SDK.

## What Changes

- Implement a private graph computation package with numeric CSR, PageRank,
  deterministic Leiden, type balance and representative summaries.
- Add internal metadata-only adapters for canonical JSON and pinned SQLite sources,
  bounded projection construction and one-entry generation/projection ownership.
- Optimize existing SQLite candidate filtering before hydration, retaining all
  current traversal results and limits.
- Validate conventions, performance and RAM on frozen synthetic 1x/2x and actual
  historical SA; keep root public SDK exports/declarations unchanged.
- Defer public rank/communities, PTC exposure and all membership/quotient/3D adoption.
  The API sketch in design remains a future seam, not this phase's deliverable.

## Capabilities

### New Capabilities

- `core/graph-analysis`: technical projected-topology, ranking/community, balance
  and lifetime semantics, initially internal to the runtime.

### Modified Capabilities

None. Existing SDK traversal behavior remains the contract for the SQL optimization.

## Impact

A private workspace implementation package, internal SDK adapters, pinned MIT
Graphty dependencies, focused tests, research measurements and a root changeset
for faster existing graph reads. No new public methods/types, SQLite format changes,
CLI commands, source annotations or BB adoption. User explicitly selected technical
implementation first; the public API will be agreed separately afterward.
