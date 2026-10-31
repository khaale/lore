# `@khaale/lore`

Schema-independent, read-only TypeScript access to an indexed filesystem workspace.
The SDK never changes source files. The JSON reader uses a saved index from
`lore index <root>`; the SQLite reader can conditionally refresh its derived
projection. Node 24 is required.

Nested YAML/JSON entities declared with schema-level `lore:sources` use the same
query/get/graph APIs. Index/check/watch and SQLite refresh execute mappings;
saved-index readers consume published entities. Mapped fields must be declared
to be SDK-selectable. Provenance retains original files and record pointers.
See [source declarations](../skills/lore-modeling/references/declarative-sources.md).

```ts
import { openFilesystemWorkspace } from '@khaale/lore';

const workspace = await openFilesystemWorkspace({ root: '/work/project' });

const page = await workspace.query({ limit: 20 });
console.log({
  ...page,
  items: page.items.map(({ id, type }) => ({ id, type })),
});
```

By default, the SDK discovers `.lore.yaml` (or `model.yaml`) under `root` and reads
`.artifact-index/index.json`. Supply `schemaPath`, `indexPath` and `ignorePath` when
the project uses different paths. If both default model names exist, select one
explicitly; neither is parsed as a knowledge record. Other options include
`maxPageSize`, `maxScanBudget` and `maxNarrativeBytes`.

Entity results contain identity, selected properties and relations, plus explicitly
requested narrative or provenance. Per-field capability metadata is not returned.
`entities.getMany([])` returns a complete empty collection.

Selected reference fields are also available in `item.properties`: a single
reference is a resolved target ID, and a multivalued reference is an array of IDs.
For example, `item.properties.owner` or `item.properties.depends_on` can be read
without inspecting `relations`. Absent values are omitted; authored empty reference
lists stay empty. These values describe asserted outgoing references. Inferred
inverse links and relation provenance remain available in `item.relations`.

## Discover effective constraints

`schema.describeType(name)` extends the existing type description with effective
`recordConstraints`, conditional `rules` and `referencePaths`. A field's
`constraints` describe patterns (including custom scalar types), bounds,
`listElementsUnique` and supported boolean expressions. These additive metadata
properties are optional in the public types; new descriptions populate them.
Use the existing type catalog to discover the vocabulary before requesting a type.

```ts
const type = await workspace.schema.describeType('ActualType');
for (const field of type.fields) {
  console.log(field.name, field.constraints);
}
console.log(type.recordConstraints, type.rules, type.referencePaths);
```

This is the executable Lore subset, not a full export of authored LinkML metadata.
`relationTargets` lists possible compatible classes under the effective reference
expression; individual values still must satisfy value constraints. Nested paths
such as `refinements.scope` are graph relation selectors. Array positions stay in
source locations, not in relation names. Inline values remain properties of their
owning entity, with resolved nested references projected as target IDs.
Recursive inline schemas refer to their class vocabulary; the path catalog stops
at a repeated class, while declared deeper paths can still be used as selectors.
Class validation rules do not classify records. Use the existing designator or
`classification_rules`; no separate typemap is required.

After upgrading to stronger validation, rebuild derived projections to establish
that the data passed it. Opening an old saved index does not revalidate its records.

## Read operations

- `describe()` reports schema identity, types, configured views and capabilities.
- `schema.listTypes()` and `schema.describeType()` discover vocabulary and constraints.
- `entities.get()` and `entities.getMany()` return selected fields, optional narrative,
  relations and source provenance.
- `query()` accepts typed `eq`, `in` and `present` conditions with explicit pagination.
- `search()` performs literal case-insensitive text search.
- `explore()` returns configured overview, card, tree, neighborhood and impact views.
- `graph.neighbors()`, `neighborhood()`, `subgraph()` and `boundary()` expose graph context
  around seed sets with bounded node and edge coverage.

Use the supplied model or SDK metadata to select actual domain types and fields.
Discover only the vocabulary needed for the question. Query already returns the
selected properties; an additional get/getMany is useful for different fields or
facets such as narrative and provenance. Use where/select for a scoped task and
ordinary JavaScript for computations beyond the filter vocabulary. Whole-corpus
reads are appropriate for global inventories and statistics. Inline values need
not be separate graph entities; traversal depends on the model's relation semantics.
The SDK does not infer vocabulary, translate terms, stem words or perform fuzzy matching.
Query/search continuations are opaque and bound to the query and read snapshot.
A finite `scanBudget` can stop before a full page is found; preserve coverage and
follow the continuation within the caller's own work budget.

All graph methods accept ID arrays, arrays of entities (only `id` is used), or
entity collections returned by `query` and `entities.getMany`:

```ts
const records = await read.query({ type: actualType });
const graph = await read.graph.neighborhood(records, { depth: 1 });
```

Only the supplied items become seeds. Passing an ordinary SDK page or an output
preview does not load omitted items or follow its continuation.

Graph options include `direction`, `relations`, `nodeTypes`, `maxNodes` and
`maxEdges`; `neighborhood` also requires finite `depth`. Node type filters affect
returned summaries, while filtered intermediate nodes remain traversable. Edges
retain stored orientation and expose inverse presentations without duplicate assertions.
Node and edge coverage are independent; a bounded graph result has no implicit
continuation. A complete empty result differs from incomplete traversal.

`readSnapshot()` groups reads of the same loaded source. Ordinary reader methods
check saved inputs before each operation and throw `SdkError` with code
`STALE_STATE` when they have changed. For a program checked on both entry and
completion, use `workspace.call()`; neither API automatically replays caller code.
Freshness is `saved-indexed`: an index is a saved projection, not a live database.
Other branchable errors include `UNKNOWN_TYPE`, `UNKNOWN_FIELD`,
`UNSUPPORTED_FILTER`, `UNSUPPORTED_VIEW`, `MISSING_ENTITY`, `INVALID_LIMIT`,
`NARRATIVE_LIMIT` and `INVALID_CONTINUATION`.

## Persistent SQLite workspace

Initialize once with `lore index --format sqlite /work/project`. The default output
is `/work/project/.artifact-index/index.sqlite`. SQLite stores the compiled model,
entity properties, graph and narrative together. It uses Node's built-in SQLite;
no database server or native dependency installation is needed.

The current private SQLite format is version 2: properties/provenance are stored
once, paths/types/predicates are shared, and integer graph edges/arcs are materialized
in the publication transaction. Raw differences retain source-facing values for
explore and empty-reference facets; external IDs and read results are unchanged.
Earlier SQLite formats report `INDEX_REBUILD_REQUIRED`. Close their consumers,
remove the disposable index database and its `-wal`/`-shm` sidecars, then initialize
again with `lore index --format sqlite`. There is no automatic migration or dual
reader. JSON indexes are unaffected.

```ts
import { openSqliteWorkspace, refreshSqliteIndex } from '@khaale/lore';

const indexPath = '/work/project/.artifact-index/index.sqlite';
const workspace = await openSqliteWorkspace({
  indexPath,
  freshness: { mode: 'refresh-on-read', maxAgeMs: 1000 },
  busyTimeoutMs: 5000,
});
try {
  const context = await workspace.readSnapshot(async (read) => ({
    description: await read.describe(),
    records: await read.entities.getMany(['record-1'], { include: ['narrative'] }),
    graph: await read.graph.neighborhood(['record-1'], { depth: 1 }),
  }));
  console.log(context);
  console.log(await workspace.status());
  // Also available independently, including from a short-lived process:
  console.log(await refreshSqliteIndex({ indexPath, maxAgeMs: 1000 }));
} finally {
  await workspace.close();
}
```

Choose `freshness: { mode: 'indexed' }` to read only the published generation,
without consulting the source root, model files or ignore file. This works while
sources are unavailable and reports `sourceFreshness: 'not-checked'`. Opening takes
only `indexPath`, policy and optional limits; it does not discover source files.

`refresh-on-read` uses the source configuration saved during initialization. It
checks once before each operation or grouped `readSnapshot` callback. `maxAgeMs`
allows reuse of the most recent completed attempt, including a failed attempt;
a recent failure raises `REFRESH_FAILED` rather than serving older data as checked.
Zero (the default) performs a new check for later requests; overlapping requests
share a completed check across processes. `status()` reads metadata without a
source check and reports the generation, last successful `checkedAt` and latest
attempt separately. Timestamps are Unix milliseconds.

Unchanged inputs preserve the generation and skip parsing, graph construction and
entity writes. Checking still discovers eligible paths and compares size/mtime
for sources, the model dependency closure and ignore file. Changed inputs trigger
a full validated rebuild. Same-size edits that restore mtime are outside this
freshness guarantee; source files themselves are not transactional. Refresh uses
a single discovery pass for a rebuild and records input size/mtime before reading.
It publishes validated data read during that build without a post-build stability
check. Edits made after that baseline are detected by a later source check;
`maxAgeMs` still controls when the next check runs. A checked read does not prove
that all authored files were read from one instant in time.

A grouped reader pins one SQLite read transaction, including model, graph and
explicitly requested narrative, while another process may publish a new generation.
Callbacks run once; an escaped callback reader raises `SNAPSHOT_CLOSED`. Subsequent
scopes adopt the newly published generation. `close()` rejects new reads and waits
for active callbacks. Do not call and await `close()` from inside its own callback.
Consumer mutation of returned values does not change subsequent reads.

SQLite returns a distinct snapshot with `kind: 'sqlite-generation'`, `generationId`,
`schemaHash`, `sourceFreshness` and, for checked reads, `checkedAt`. A check is an
observation of sources, not proof they remain unchanged until callback completion.
Query/search continuations bind to the generation; unchanged checks preserve them,
publication invalidates them. Ordinary pagination, scan budgets, graph limits and
narrative limits apply. Narrative is stored but omitted unless requested. Configured
global exploration may materialize the corpus; bounded entity/query/graph reads
use indexed rows and adjacency without loading the entire corpus at open.

`SqliteIndexError.code` distinguishes `INDEX_NOT_FOUND`, `INDEX_REBUILD_REQUIRED`, `INDEX_BUSY`,
`REFRESH_BUSY`, `REFRESH_FAILED` and `SNAPSHOT_CLOSED`. Validation diagnostics are
available in error details. Failed refresh preserves the previous valid generation;
indexed readers can still use it explicitly. Writer ownership uses SQLite WAL and
a bounded asynchronous wait (`busyTimeoutMs`, default 5000), and is released by
process termination. The same `busyTimeoutMs` also bounds asynchronous retries for
opening/status and entering read transactions, including transient WAL recovery
contention. Exhausted reader waits raise `INDEX_BUSY`; refresh ownership/startup
waits raise `REFRESH_BUSY`. These do not mean the index needs rebuilding. Zero
means an immediate contention result. Waiting yields to the event loop; the SDK
does not install a blocking SQLite busy timeout or retry an entered callback.
Genuine malformed/unsupported storage still raises `INDEX_REBUILD_REQUIRED`.
Use a local filesystem suitable for SQLite WAL. Long-running
read transactions can retain WAL pages, so keep callbacks reasonably short.

No daemon is required: callers can refresh, or use `lore refresh --index PATH`.
Optional `lore watch --format sqlite ROOT` publishes after external edits. Several
consumers may share the same database. Keep the database at its initialized path;
reinitialize to change source configuration. For unsupported storage versions,
create a fresh output with `lore index --format sqlite --out NEW_PATH ROOT`; no
in-place format migration is provided. The ordinary SQLite workspace does not
provide the JSON reader's PTC `call`, retained results or traces.

## Programmatic tool calling (PTC)

Use `workspace.call()` to run a program with automatic operation feedback. Call
SDK methods directly; Lore returns the program result, structured events and a
compact trace. Executions end automatically, including on failure. The caller owns
the process; Lore does not host an executor or arbitrary-code endpoint.

Inside PTC, query, search and schema discovery return complete collections with
`items`, `coverage` and `snapshot`. They have no pagination options or continuation
tokens. Graph operations also return the complete selected graph. Choose direction,
relations, node types and neighborhood depth to express the graph you need. Empty
seed arrays return an empty graph inside PTC.

```js
async function previewSelection(workspace, queryOptions = {}) {
  return workspace.call(async (read) => {
    const records = await read.query({ ...queryOptions, select: ['id'] });
    return {
      count: records.items.length,
      preview: read.limitItems(
        { ...records, items: records.items.map(({ id, type }) => ({ id, type })) },
        10,
      ),
    };
  });
}
```

The identity-preview helper uses the question's type and conditions; `{}` deliberately
selects the whole workspace. For answers needing values, select those fields and
adapt the output projection. Compute requested values inside the program before
returning the answer. Query output needs no mandatory getMany or graph step.
Check `response.status` before using its result.

Outside PTC, the paginated SDK uses one `Page<T>` contract for query, search and
`schema.listTypes()`: `items`, `coverage`, `snapshot` and optional `continuation`.
Pass `limit` and the returned continuation to fetch another page. Query and search
also accept `scanBudget` to bound the number of examined entities.

## Output previews

Use complete selected results for computation; limit only what you return.
Project the required values before printing: item counts do not bound the size of
nested arrays or long text. For requested full exports, save the full result to a
caller-owned file and return its location with a concise summary.

The output helpers are:

- `read.limitItems(collection, count = 20)` returns a collection preview.
- `read.limitGraph(graph, { nodes: 20, edges: 40 })` limits a compact graph preview without per-node provenance, traversal traces or
  relation presentations. Both
  settings are optional. Edges whose visible endpoints were removed are omitted.
  A graph preview contains nodes, edges, coverage and snapshot; it does not copy
  the potentially large input seed list.

The helpers preserve the original results. Truncation sets `coverage.complete` to
false and `reason` to `output-limit`; `remaining` reports omitted items when known.
Graph coverage reports nodes and edges separately. A zero limit gives an empty
preview. Invalid limits produce `INVALID_LIMIT`.

## Results between calls

A workspace automatically owns its temporary results and traces. Retain selected
records, IDs or computed values when a later call will reuse them. There is no need
to retain every intermediate result. Given query options derived from the task,
save a value in one call and retrieve it in another without a runtime or scope:

```ts
const saved = await workspace.call(async (read) => read.retain(await read.query(queryOptions)));
if (saved.status === 'failed') throw new Error(saved.error.message);
const reference = saved.result;

const response = await workspace.call(async (read) => {
  const { value: records } = await read.results.get(reference);
  return read.limitItems(
    { ...records, items: records.items.map(({ id, type }) => ({ id, type })) },
    5,
  );
});
```

A reference preserves its value's TypeScript type. `read.results.describe/get/release`
work within a program; `workspace.results` exposes the same operations between
programs. `workspace.trace.get(executionId)` reads stored trace details. Each
workspace has isolated state. Executions do not replay caller code, and retained
values do not refresh source data or the saved index.

Results and traces remain in memory within configured TTL and quotas. They are
not shared with another workspace or persisted across processes. Functions, live
handles, cycles, non-finite numbers, undefined values and explicitly sensitive
values cannot be retained. Releasing a result frees it immediately; dropping the
workspace makes its temporary state eligible for garbage collection.

The callback reader is valid only during its call. Failed calls return `status:
'failed'` and an error code and message; completed calls return `status: 'completed'`
and a typed result. A partial output preview is still a completed call.

PTC validates source freshness before entering the program and after it completes.
Reads within a call use the same in-memory source without repeated filesystem scans.
A change detected at either boundary fails the call with `STALE_STATE`; no automatic
replay occurs. A failed call does not roll back caller side effects or retained values.

## Session limits

Configure PTC once when opening a workspace:

```ts
const workspace = await openFilesystemWorkspace({
  root: 'examples/decisions',
  ptc: { ttlMs: 300_000, maxRetainedBytes: 16 * 1024 * 1024 },
});
```

| Option                | Default    | Purpose                                                     |
| --------------------- | ---------- | ----------------------------------------------------------- |
| `ttlMs`               | 300,000    | Lifetime of retained results and traces.                    |
| `maxRetainedBytes`    | 16,777,216 | Total retained result budget.                               |
| `maxTombstones`       | 128        | Bounded history of expired, evicted or released handles.    |
| `maxTraceEvents`      | 100        | Maximum stored details and outcome summaries per execution. |
| `maxTraceBytes`       | 65,536     | Maximum rendered trace size per execution.                  |
| `maxStoredTraceBytes` | 524,288    | Total stored trace budget.                                  |

`now` can supply a clock for deterministic execution. `response.events` contains
structured operation feedback; `response.trace` is a bounded compact rendering.
`errorReport` counts failed operations and reports retained and omitted error
summaries. Read results are complete before output previewing; retention and trace
quotas are independent of query pagination. One retained value may use the entire
result budget; an oversized write is rejected before evicting existing values.

The low-level `createPtcRuntime()` API remains available to callers that wrap
functions outside the workspace SDK. Workspace calling requires no manual setup.

Run the complete example after indexing the included decisions:

```sh
node dist/cli.js index examples/decisions
pnpm sdk:example
```

See `scripts/ptc-example.mjs` for two calls sharing retained context and returning
limited collection and graph previews.
