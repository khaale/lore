# PTC API

Node 24, ESM. Use an available `@khaale/lore` installation and project configuration:

```js
import { openFilesystemWorkspace } from '@khaale/lore';
const workspace = await openFilesystemWorkspace({ root: 'knowledge' });
```

Optional `schemaPath`, `indexPath`, `ignorePath` override defaults; reuse supplied
paths. Defaults: `.lore.yaml` or `model.yaml`, `.artifact-index/index.json`,
`.artifactignore` under root. The SDK reads an existing index; it does not build it.

## Call and result shapes

This call counts the whole workspace. Other operations below are independent
choices for the question, not additional steps to append to every program.

```js
const response = await workspace.call(async (read) => {
  const records = await read.query({ select: ['id'] });
  return { count: records.items.length, coverage: records.coverage };
});
if (response.status === 'failed') throw new Error(response.error.message);
console.log(response.result, response.trace);
```

`call` returns `{status: 'completed', result, trace, events, ...}` or
`{status: 'failed', error: {code, message}, trace, events, ...}`. The callback reader
is valid during that call; normal JavaScript computation can use its full results.

| Result            | Shape                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Collection        | `{items, coverage, snapshot}`; no pagination inside PTC                     |
| Entity            | `{id, type, typeId, properties, relations, narrative?, provenance?}`        |
| One entity read   | `{item: Entity, coverage, snapshot}`                                        |
| Batch entity read | Collection of Entity plus `missingIds`                                      |
| Search            | Collection of `{item: Entity, matches: [{field, representation, snippet}]}` |
| Graph             | `{seedIds, nodes, edges, coverage: {nodes, edges, next}, snapshot}`         |

Domain field values, including selected references, are in `entity.properties`.
A single reference is a target ID; a multivalued reference is an ID array. Absent
values are omitted, authored empty lists remain empty. `relations` contains
`{from, relation, to, direction, inferred, provenance?}`; inferred inverse links
are not added as authored property values.

## Choose a read

These methods are on `read` inside the callback. Parameter values come from the
question and model; the API does not define domain class or field names.

| Method                           | Input and result                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.listTypes({text})`       | Optional text filter; Collection of `{name, typeId, label?, description?, abstract, mixin}`                                                                                        |
| `schema.describeType(typeName)`  | Description with `fields: [{name, range, valueKind, cardinality, enumValues, ...}]`; `valueKind` is scalar, reference or inline-object; `cardinality.multivalued` identifies lists |
| `query({type, where, select})`   | All options optional; Collection of Entity with selected properties and relations already present                                                                                  |
| `search({text, types})`          | Required text, optional type names; match entities identify records, and explanations identify matching fields                                                                     |
| `entities.get(id, options)`      | One Entity; throws `MISSING_ENTITY` when absent                                                                                                                                    |
| `entities.getMany(ids, options)` | Batch result; duplicate IDs deduplicated, missing IDs reported; `[]` returns an empty collection                                                                                   |

Query conditions are a conjunction of top-level fields: `{[fieldName]: {eq: value}}`,
`{in: nonemptyValues}` or `{present: boolean}`. Equality/membership also match
multivalued scalar and reference fields. Use `type` and conditions when they express
the scope; use JavaScript for other predicates and aggregations.

`id`, `type` and `typeId` are always present on the Entity envelope. `select`
chooses model properties: omitted means all declared fields, `[]` means none,
`['id']` reads identities. Selecting `type` requests a model property with that
name, which need not exist. Different types need not share field names. For an
`UNKNOWN_FIELD`, check that particular type and projection rather than reusing a
field list across unrelated types. Inline values stay in properties, not separate
graph nodes. Search is literal, case-insensitive over IDs, types and top-level
scalar properties; it does not search narrative or nested/list values.

## Read values, prose or source locations

Query properties can be used directly. To read additional facets, entity options
are `{select, include, narrativeMaxBytes}`. `include` accepts `properties`,
`relations`, `narrative`, `provenance`; get/getMany default to properties, relations
and provenance. Narrative requires an explicit request. Query/search do not supply
narrative/provenance by default.

For source locations of already chosen IDs, even across different types:

```js
const details = await read.entities.getMany(ids, {
  select: [],
  include: ['provenance'],
});
const locations = details.items.map(({ id, provenance }) => ({
  id,
  source: provenance?.source,
  location: provenance?.location,
  span: provenance?.span,
}));
```

Provenance lives at `entity.provenance`, not `entity.source`. Its shape is
`{authority, source, location?, representation, span?, properties?, narrative?}`.
For prose, independently use `entities.get(id, {select: [], include: ['narrative']})`
and read `result.item.narrative`. Narrative exceeding `narrativeMaxBytes` raises
`NARRATIVE_LIMIT`; the workspace default is 64 KiB.

## Graph operations

`graph.neighbors`, `neighborhood`, `subgraph`, `boundary` accept IDs, arrays of
entities, or entity collections from query/getMany. Search matches must first be
unwrapped to their `item`. Empty selections return empty graphs in PTC.

Options: `direction: 'in' | 'out' | 'both'`, `relations: fieldNames`,
`nodeTypes: typeNames`; neighborhood additionally requires `depth` (0..32).
Neighbors selects adjacent records; neighborhood follows paths to that depth;
subgraph connects selected seeds; boundary selects connections crossing the set.
Node-type filters affect returned nodes; traversal may pass through other types.

```js
const graph = await read.graph.neighborhood(records, graphOptions);
return read.limitGraph(graph);
```

`graphOptions` includes the depth and relation semantics chosen for the task.
Nodes contain `id`, `type`, `distance`, `trace` and optional provenance; edges
contain `from`, `relation`, `to`, `inferred`, visibility flags and presentations.
Direct membership and transitive reachability are different questions.

## Output and follow-up calls

`limitItems(collection, count = 20)` and `limitGraph(graph, {nodes: 20, edges: 40})`
make previews without altering full results. Coverage records omitted counts and
`output-limit`; graph coverage separates nodes/edges. Preview nodes are compact,
and edges whose visible endpoints were removed are omitted. Project long text or
nested values before printing; keep full requested exports in a caller-owned file
when appropriate. Tool truncation does not establish result completeness.

To reuse a value later, `read.retain(value)` returns a reference. In another call
on the **same workspace/process**, `await read.results.get(reference)` returns
`{value, ...metadata}`. `results.describe/release` and `workspace.results` are also
available. No manual runtime/scope is needed. Default TTL: 5 minutes; shared result
budget: 16 MiB. Retention is optional and does not refresh source data.

PTC checks inputs on entry/completion. `STALE_STATE` or `SCHEMA_MISMATCH` requires
explicitly refreshing the appropriate inputs; no automatic replay occurs. Failed
calls do not roll back caller effects. Outside PTC, query/search/catalog methods
return pages with optional `continuation`; an empty scan-budget page can still
have a continuation. Graph inputs use only supplied items, including when a caller
passes a page or preview.

## SQLite ordinary reader

This PTC reference describes `openFilesystemWorkspace`. A shared SQLite index uses
`openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } })` or explicit
`refresh-on-read` policy from `@khaale/lore`, with bounded ordinary reads,
`readSnapshot` and `close()`. It has no PTC `call`, retained results or traces.
See [SDK documentation](../../../docs/sdk.md#persistent-sqlite-workspace).

## Effective model constraints

Use `schema.describeType(actualType)` for effective field `constraints`, class
`recordConstraints`, conditional `rules` and `referencePaths`. Nested selectors
such as `refinements.scope` work with bounded graph reads; inline objects stay
within their owning entity and nested links are projected as target IDs. Optional
public metadata fields describe the supported executable subset. Discovery does
not revalidate an older saved projection; rebuild after validation upgrades.

## Candidate hierarchy navigation

Use `workspace.hierarchy.propose()` for an editable type-tree starting point;
review alternatives/source-context hypotheses with the user before treating them
as the intended view. Save `result.definition`, then call
`workspace.hierarchy.read({definition, parent?, limit?, continuation?})` for root
or immediate children. Reuse opaque placement refs; virtual groups are not entity
IDs. Hydrate selected real IDs with `entities.getMany`, and obtain bounded
canonical crosslinks with `graph.subgraph`. Do not treat a child page as a complete
global inventory or quotient graph. Preserve separate page/computation/placement
coverage and distinguish global type totals from local immediate child counts.
Labels use explicit scalar selectors with ID fallback. See the
[SDK hierarchy contract](../../../docs/sdk.md#candidate-hierarchies) for editable
branches, grouping and optional checked LCA display placement.

`proposal.typeScores[type]` contains two independent relative focus hints, both
0..1 within the current corpus and candidate. `structureScore` sums unique
descendant types with distance decay 0.65, then divides by the largest sum.
`connectivityScore` counts unique observed neighbor types weighted by separation
in the undirected candidate hierarchy: adjacent types contribute 0, distance d
contributes `1 - 2^(-(d-1))`, disconnected types contribute 1; it is normalized
separately. Alternatives/navigation groups and LCA execution are excluded from
this calculation; source-context hypotheses and polymorphic type branches count.
Self-type recursion adds no diversity. Multiplying records/edges does not increase
the scores. They suggest initial focus without hiding any type; never sum them
into a single importance score. Zero connectivity can accompany a strong
structural backbone. These are not semantic confidence, criticality, probabilities
or comparable values across corpora; schema granularity and a wrong candidate
hierarchy can change them. Editing a definition does not recompute proposal scores.

For individual focus, opt into `hierarchy.read({definition, includeScores:true})`.
Real entity nodes then carry `scores: {structureScore, connectivityScore}`. These
are normalized separately among all selected entities of the same actual type,
including unassigned members, and remain independent of page size or occurrence.
Structure uses distinct **different** actual descendant types with shortest-distance
0.65 decay after selected placement policies. Connectivity uses that entity's own
unique neighboring types with the same type-hierarchy separation weights described
above; it is not an entity-to-entity distance or same-type bridge metric. Only
selected-scope endpoints participate. Resolved placement coverage still applies.
Default reads omit scores; requesting them adds budgeted whole-scope computation.
Do not sum these hints, interpret zero as absence of value, or compare across types
as though their denominators were shared. Virtual groups have no scores.
