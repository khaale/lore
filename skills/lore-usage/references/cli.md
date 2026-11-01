# Lore CLI

These commands assume an available `lore` executable and a `knowledge/` root.
Substitute actual paths, IDs, classes and fields from the target schema.

Models with `lore:sources` extract nested YAML/JSON entities during the same
check/index/watch commands; no adapter command is required. Source files stay
read-only. Use the packaged `examples/source-documents` model as an example.

## Current-file reads

```sh
lore check --strict knowledge
lore validate --root knowledge --json
lore get ADR-001 --root knowledge --json
lore query --kind Decision --where status=accepted --root knowledge --json
lore search architecture --root knowledge --json
lore links ADR-001 --direction both --root knowledge --json
lore graph ADR-001 --depth 2 --root knowledge --json
lore impact ADR-001 --depth 2 --root knowledge --json
```

These commands read saved sources directly, without initialization or an index.
`validate` uses the same strict validation as `check`, with a `--root` argument.
CLI query filters are top-level equality conditions; repeat `--where` for multiple
conditions. Use the SDK for typed `in` and `present` filters. Search is literal and
case-insensitive, not fuzzy or semantic retrieval. CLI search walks scalar record
properties, including nested and list values; it does not search the entire raw
Markdown narrative.

Choose types and equality filters from the model when they express the question.
Global reads remain useful for inventories and open-ended discovery. For large
JSON outputs, use a caller-owned result file or a PTC program that returns the
requested summary; terminal truncation does not establish complete coverage.

YAML and JSON can contain individual records or record lists; YAML also supports
multiple documents. JSONL requires one object per non-empty line. CSV is flat and
coerces scalar cells. Markdown uses frontmatter or explicitly declared sections
and tables: headings alone do not create typed records. If a check reports fewer
records than expected, inspect classification and declarations before assuming
the files were fully modeled.

For positional-root commands such as `check`, put flags before the root. The
current-file semantic commands accept `--root` and interspersed flags as shown.
Lore discovers `.lore.yaml` or `model.yaml` under the root. If both exist,
select one with `--schema PATH`. That flag also accepts a custom schema filename.

## Index-backed reads

```sh
lore index knowledge
lore list --index knowledge/.artifact-index/index.json
lore refs --index knowledge/.artifact-index/index.json ADR-001
lore explore --view card knowledge ADR-001
lore explore --view neighborhood --depth 2 knowledge ADR-001
lore watch knowledge
```

`list`, `refs`, configured `explore` and the SDK read the saved index. Rebuild it
after authored files or the schema change. `watch` republishes after valid edits;
invalid input preserves the last valid index, which may therefore lag the sources.
Inspect validation diagnostics instead of treating that older index as current.

Configured exploration supports overview, card, tree, neighborhood and impact
views. Their fields and relation roles come from schema annotations; inspect the
model before assuming a dependency or hierarchy presentation.

## SQLite publication and conditional refresh

Flags for `index` and `watch` precede the positional root:

```sh
lore index --format sqlite knowledge
lore watch --format sqlite knowledge
lore refresh --index knowledge/.artifact-index/index.sqlite --max-age 1s --busy-timeout 5s --json
```

JSON remains the default. SQLite's default path is `.artifact-index/index.sqlite`
under the root; `--out PATH` overrides it. Initialization saves source/model/ignore
configuration. Refresh uses that saved configuration; it takes no positional root.
`--max-age` defaults to zero and `--busy-timeout` to five seconds. Outcomes are
`unchanged`, `updated` or `reused`; `--json` emits one result document. Failure emits
an `error` object with code, message and details and exits nonzero. Recent failed
checks are propagated during max-age reuse. Failed validation preserves the old
projection, and a later refresh can repair it. Eligible-path discovery and size/mtime
checks still cost work on unchanged input; there is no fixed latency guarantee.

SQLite stores narrative with model/data/graph in one generation. Use the ordinary
SQLite SDK to read it; existing `list`, `refs` and JSON-index exploration still use
JSON. Watch is optional, and independent consumers coordinate refresh through
SQLite ownership. Authored files remain externally owned.

Private SQLite format 2 uses compact shared dictionaries and materialized integer
edges/arcs. On `INDEX_REBUILD_REQUIRED` for an older format, close consumers,
remove the disposable database and `-wal`/`-shm` sidecars, then initialize again.
Do not edit or migrate authored records to repair a derived-format mismatch.

## Hierarchy candidates

`lore hierarchy propose --index PATH --format json|sqlite --json` produces an
editable proposal envelope. Save it and pass it (or its bare `definition`) to
`lore hierarchy read --index PATH --format json|sqlite --definition FILE --json`.
Read one parent's immediate children with `--parent REF`, `--limit N` and an opaque
`--continuation`. JSON also uses the existing `--root`, `--schema`, `--ignore`
saved-index checks; SQLite uses the indexed model without implicit refresh.
Text proposal counts are global observed type totals, not local subtree counts.
Use diagnostic detail for branch eligible/zero/one/many; review alternatives and
source-context hypotheses before adopting a tree. No authored files are changed.

Add `--scores` to hierarchy read for independent individual structure/connectivity
hints on real entities. They are normalized across the selected scope per actual
type, never across only the current page. The calculation adds bounded whole-scope
work; ordinary reads omit scores. Groups are not scored, and ordering is unchanged.
