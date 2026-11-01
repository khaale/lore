## Context

Praxis (399/1,003) and SA (36,630/64,798) research snapshots established a useful
starting algorithm, not universal semantic correctness. Model hierarchy, instance
placement and screen importance are different concerns. BB reviewed the proposed
consumer boundary; its existing all-entity viewer is not an acceptance consumer
of a new lazy page API.

## Goals / Non-Goals

Provide editable type/navigation definitions and lazy instance children. Reuse
flat reads. No new snapshot/expected-generation/lease/fingerprint public protocol,
hosted jobs, view registry, source writes, generic importance solver API, association-edge
conversion, package/version joins or full-topology export.

## Decisions

### Composition matrix

| Consumer need | Existing operation / phase-one addition |
| --- | --- |
| Vocabulary, fields, annotations | schema.listTypes / describeType |
| Flat typed/filtered/scalar pages | query; unchanged |
| Hydrate selected real IDs | entities.getMany; unchanged |
| Canonical visible links | graph.subgraph; unchanged bounds/coverage |
| Full-scope candidate checks | shared internal typed-path profiler; not assembled from partial pages |
| Exact scalar group/count | shared grouping helper, optional explicit hierarchy property group; a general aggregate endpoint is a future seam |
| Editable organization | hierarchy.propose convenience |
| Roots / lazy children / placement | hierarchy.read convenience |

Two methods are the current useful facade, not a target limit. Helpers for typed
path evaluation and grouping remain reusable; do not build an arbitrary private
query language inside read or duplicate query/getMany. Batch parent expansion,
quotients and a general public aggregate API need separate demonstrated demand.

### Definition and workflow

Use a JSON-compatible discriminated definition version 1: named navigation/type
occurrences, explicit branch keys and directed typed steps (at most four), optional
recursion, caller label selectors, alternatives, exact property groups and placement
policies. Groups carry basis model/schema-navigation/source-context/property/
derived-placement as appropriate. Repeated types under different parents are valid.
Source-context never becomes a canonical reference. Proposal diagnostics do not
change the algorithm or definition.

The caller saves and edits this value. read validates types, fields, group selectors,
keys, paths, recursion and limits before instance work. No compiled-hierarchy handle
or registration call. Initial proposals retain declared-only/inline vocabulary
separately from active entity types. Scope/subclass handling is explicit.

Default proposals use schema/user labels and typeTotal (global, not a local count).
Instance labels use explicit scalar selectors, including model-declared title roles,
then ID fallback; truncate UTF-8 safely with a flag. No heuristic title/name lookup.

### Shared computation

Keep generic hierarchy computation private. Build from canonical topology plus
source descriptors, not full narrative/property hydration. Reuse JSON canonical
views and SQLite integer metadata reads; ordinary get/query must remain lazy.
Selective properties are fetched only for explicit grouping or returned labels.
No new storage layout or dependency. Source checking remains the existing reader's
responsibility. Ordinary continuations retain existing validation internally;
definition edits invalidate a prior page cursor without a new public identity API.

The starting algorithm profiles child-type/relation/direction axes over all eligible
children, not independent parent-type fragments. Observe distinct parent endpoints,
coverage and cycles; prefer declared context roles, then physical support (0.15 evidence margin within the selected coverage tier). Prune only conflicting cycle members, preserving their descendants. Preserve
functional partial axes as alternatives. Recover meaningful schema families and
source-directory/document navigation instead of a flat leftover list. No domain-name
dictionary, parent/owner priority or semantic confidence score.

### Instance read

read returns one bounded direct-child page for root or a returned opaque serializable
placement ref. Group refs are not entity IDs. Repeated occurrences and recursion
include their branch context; no global entity dedup across different viewpoints.
Default output is ref/kind/label/basis, entityId/type for entities, branchRef,
expandable yes/no/unknown and optional directChildren count. directChildren counts
placements immediately below that ref, including virtual groups. Other quantities,
if requested, must say distinct entities versus occurrences. Unknown is not zero.
Properties/crosslinks use getMany/subgraph. No canonical quotient is implied.

Compute coverage, page coverage and deferred placement are separate. Validate finite
input/definition/depth/work/output bounds. Starting caps: topology100k nodes/2m
logical link presentations, definition500 occurrences, path4 hops, traversal depth32, page20/max100,
work1m steps. Exact counts require complete work; on exhaustion fail or mark unknown,
never infer exactness from a partial page. These are not byte/RSS/latency guarantees.

Selected LCA rules specify backbone and consumer paths, owner inclusion and an
unassigned policy. Only a checked forest is supported initially. A multi-parent DAG,
cycle, disconnected/outside-scope consumer or missing unique ancestor defers placement.
Evaluate over declared placement scope, not viewport. Unsupported proposals can
carry a deferred policy. Preserve canonical facts and original IDs.

### CLI and acceptance

Use hierarchy propose/read with --format json|sqlite, --index, and JSON opener's
root/schema/ignore settings. SQLite hierarchy defaults to indexed reads; existing
refresh is explicit and separate. --json propose emits the envelope; --definition
accepts the bare definition or that envelope's definition. Text is compact. No new
definition-only format or automatic index rebuild.

Test three consumer compositions: propose/edit/read+getMany; flat query+getMany;
hierarchy visible IDs+subgraph. Exercise JSON/SQLite/PTC and installed root package.
Use renamed/reordered synthetic fixtures, cycles, disconnected LCA, polymorphism,
partial owner axes, source-document groups and exact typed scalar keys. Real
Praxis/SA are opt-in read-only research comparisons; no live bindings/reindex.

## Risks / Trade-offs

- Heuristics are viewpoint-dependent → alternatives, explicit basis and editable definitions.
- Flat pages cannot prove aggregate counts → shared full-scope bounded computation.
- Schema/source families are navigation, not containment → discriminated basis/ref kinds.
- Full metadata scans can cost memory/time → metadata-only SQLite path, finite input/work caps, measure actual SA and ordinary read startup.
- Third corpus unavailable → document two-corpus validation; do not invent a gate.
- Importance and layout remain unresolved → explicitly deferred, not hidden in hierarchy scores.

### Independent focus hints

Follow-up user steering adds two compact per-type focus hints to the proposal,
not a ranking API: independent normalized structural descendant diversity and
hierarchy-separated neighbor-type diversity. No top-K, filtering, total score,
explanation payload or placement effect. The usage skill records formulas and
caveats; the editable definition remains independent of these proposal metrics.

### Optional individual scores

`hierarchy.read({includeScores:true})` adds the same two independent numbers inside
`scores` on entity nodes only, never virtual groups. Normalization is per actual
entity type over the entire selected hierarchy scope, including unassigned members.
Repeated occurrences share their entity's scores. Active branch maps and selected
LCA placements define actual entity adjacency; no source/group navigation creates
new canonical links. Structure sums distinct different descendant types, using
shortest entity placement distance with 0.65 decay. A multi-source reverse BFS per
descendant type avoids BFS per entity and counts each descendant type once.
Connectivity uses each entity's own distinct canonical neighbor types and the
existing type-hierarchy separation weights. It does not measure actual entity
geodesics, detect same-type bridges, or imply semantic importance. All score work
is charged to the existing finite budget and can fail explicitly on large/complex
inputs. No new cache/session/snapshot API. No score sorting or filtering.
CLI `hierarchy read --scores` opts in; public types, skill and examples explain
scope, formulas and the extra whole-scope cost.

### Callback-scoped reuse

A grouped reader retains at most one hierarchy computation/placement plan keyed
by its validated definition and work budget within that reader's fixed source.
Parent, continuation and page size select pages from the plan. Individual scores
remain lazy and do not appear in plain responses. A changed definition/budget or
failed read evicts the entry; callback completion/failure releases it, including
when a consumer retains a reader reference. No cross-callback cache, new public
handle, formula or freshness policy is introduced. Definition validation and
ordinary source revalidation still precede cache use. Cached analysis and lazy
properties/scores remain charged against the selected budget; compute.examined
reports retained evaluation work, not the cost of the latest response. Page
construction, child enumeration/sorting and label hydration are not cached.
