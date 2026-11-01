# Lore

**Turn project documents into connected, queryable knowledge—for people and agents.**

Requirements, architecture decisions and plans are easier to trust when you can
check their structure, follow their relationships and find the context behind them.
Lore adds that structure to ordinary files through a CLI and TypeScript SDK.
Keep writing in your editor and reviewing changes in Git; use Lore to validate,
query and explore what you have written.

## What you can do

| Need                              | How Lore helps                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Keep documentation consistent     | Validate required fields, types, allowed values and references against your schema, with diagnostics pointing back to source files. |
| Find the right records            | Query entities by type and properties, or search their text; get structured JSON for scripts and agents.                            |
| Understand dependencies           | Follow incoming and outgoing links, inspect a neighborhood and traverse dependency paths with graph and impact commands.            |
| Navigate a growing knowledge base | Explore schema-configured cards, trees, overviews, neighborhoods and impact views in the console.                                   |
| Automate documentation checks     | Run validation in CI and publish a derived JSON or SQLite index only when the sources are valid.                                    |
| Give agents focused context       | Discover domain types through the SDK, compose bounded query and graph reads, and return compact execution feedback.                |

Use Lore for linked requirements and acceptance criteria, architecture catalogs and
decision records, or product intent and delivery plans. These are possible models,
not fixed templates: your LinkML `.lore.yaml` (or `model.yaml`) defines the domain types,
fields, constraints and relations.

## Your files, your workflow

Lore reads **Markdown, YAML, JSON, JSONL and CSV** under a directory containing
one model file: `.lore.yaml` (recommended) or `model.yaml`. If both exist, select
one explicitly with `--schema` in the CLI or `schemaPath` in the SDK.
Markdown frontmatter, declared sections, heading identities,
companion manifests and declared tables let you add structure to existing documents.
Schema-level `lore:sources` declarations extract entities from nested YAML/JSON,
such as API operations, DTOs and database tables. See the
[working example](examples/source-documents/.lore.yaml) and
[declaration reference](skills/lore-modeling/references/declarative-sources.md).

Source files stay authoritative. Lore writes only a derived JSON or SQLite index, so the
knowledge remains local, versionable and editable with your existing tools.
The runtime is schema-independent and needs no database or hosted service.

## Supported models and formats

Lore supports a focused LinkML profile: classes, inheritance and mixins, typed
fields and relations, inline objects, static enums, uniqueness and value constraints.
Some descriptive metadata is accepted without implementing other LinkML tools'
behavior; unsupported operational metaslots produce diagnostics.
Detailed SDK discovery exposes custom type and relation annotations so consumers
can organize the metamodel without hardcoding domain types in Lore.

| Source       | Main capabilities                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| YAML / YML   | Single records, record lists, multiple documents, native lists and inline objects.                               |
| JSON / JSONL | Objects and object arrays, or one object per JSONL line.                                                         |
| CSV          | Flat records with scalar conversion; no list or object cells.                                                    |
| Markdown     | Frontmatter, narrative, typed sections, heading identities, declared table records and companion YAML manifests. |

The detailed references are packaged with the modeling skill, so they also work
when that skill is installed independently:

- [LinkML support and limitations](skills/lore-modeling/references/linkml-support.md)
- [Source formats and structured Markdown](skills/lore-modeling/references/file-formats.md)

## Quick start

Lore requires Node **24.x**. One package provides the `lore` command and the SDK:

```sh
npm install -g @khaale/lore
lore --help
```

Run a command without a global installation:

```sh
npx @khaale/lore check --strict ./knowledge
```

For scripts, add the same package to your project:

```sh
npm install @khaale/lore
```

```ts
import { openFilesystemWorkspace } from '@khaale/lore';
```

From a source checkout, use Node **24.x** and **pnpm 10.17.0** as declared in
`package.json` and `.node-version`:

```sh
pnpm install --frozen-lockfile
pnpm preflight
pnpm build
```

Try Lore on the included architecture decisions:

```sh
# Validate the decisions and their relationships.
node dist/cli.js check --strict ./examples/decisions

# Find accepted decisions.
node dist/cli.js query --kind Decision --where status=accepted --root ./examples/decisions --json

# Build the index and explore a decision card.
node dist/cli.js index ./examples/decisions
node dist/cli.js explore --view card ./examples/decisions ADR-001
```

For your own knowledge base, add an `.lore.yaml` and documents using its
types, then point the same commands at that directory. The
[decisions example](examples/decisions/.lore.yaml) shows a small linked model.

## CLI

The installed command is `lore`. From a source checkout, the equivalent built
executable is `node dist/cli.js`.

Examples below use `lore` for that executable:

```sh
lore check --strict ./workspace
lore validate --root ./workspace --json
lore get record-1 --root ./workspace --json
lore query --kind Decision --where status=accepted --root ./workspace --json
lore search 'architecture' --root ./workspace --json
lore links record-1 --direction both --root ./workspace --json
lore graph record-1 --depth 2 --root ./workspace --json
lore impact record-1 --depth 2 --root ./workspace --json

lore index ./workspace
lore list --index ./workspace/.artifact-index/index.json
lore refs --index ./workspace/.artifact-index/index.json record-1
lore explore --view card ./workspace record-1
lore watch ./workspace
```

`check`, `validate`, `get`, `query`, `search`, `links`, `graph` and `impact`
read saved source files directly. They require no initialization or local state.
`validate` runs the same strict validation as `check`, using `--root`.
`index` publishes JSON by default; `--format sqlite` selects SQLite. `watch` republishes after valid edits.
Invalid input does not replace the last valid index. `list`, `refs`, `explore`
and the JSON SDK use this saved JSON index; rebuild it after changing documents.

The supported LinkML subset includes unique lists, class-level boolean constraints
and conditional validation rules. Typed references are checked inside inline values
as well as on entities; SDK schema descriptions expose their effective constraints.
See [the supported profile](skills/lore-modeling/references/linkml-support.md).

## SDK and PTC

Use the SDK to build integrations that discover the schema, select relevant
entities and follow their relationships. Reads have explicit limits and coverage,
so callers can tell whether the returned context is complete.

Programmatic tool calling (PTC) lets an agent integration combine dependent reads
in one caller-owned program—for example, query capabilities, collect their graph
context and return a compact result instead of entire documents. Temporary retained
results and execution traces support follow-up reads and inspection.
Use `workspace.call()` to get a result and trace without setting up an execution
runtime or wrapping individual reads:

```ts
const response = await workspace.call(async (read) => read.limitItems(await read.query()));
console.log(response.result, response.trace);
```

Inside PTC, collections and graphs are read in full; `limitItems` and `limitGraph`
create bounded output previews. Use `read.retain()` and `read.results.get()` to
share temporary results between calls on the same workspace.

See the [SDK documentation](docs/sdk.md) for setup and compound examples.

After indexing the decisions example, run a complete query-and-graph example:

```sh
pnpm sdk:example
```

The caller owns execution; Lore does not host an execution server.

### Shared SQLite index

For multiple consumers, initialize a persistent projection including narrative:

```sh
lore index --format sqlite ./workspace
lore refresh --index ./workspace/.artifact-index/index.sqlite --max-age 1s --json
# Optional continuous publication; no daemon is required:
lore watch --format sqlite ./workspace
```

Use `openSqliteWorkspace` from `@khaale/lore` with explicit
`freshness: { mode: 'indexed' }` for source-independent reads, or
`{ mode: 'refresh-on-read', maxAgeMs: 1000 }` for conditional source checking.
Group reads with `readSnapshot` and release the workspace with `close()`.
Unchanged refresh checks size/mtime without rebuilding; changed inputs rebuild
and publish atomically. Failed validation retains the last valid generation.
SQLite supports ordinary bounded SDK reads; PTC remains on the JSON workspace.
Its compact private format uses shared dictionaries and integer graph keys.
Older SQLite indexes require closing consumers and explicitly removing/rebuilding
the derived database; source files are not migrated.
See [SQLite policies and examples](docs/sdk.md#persistent-sqlite-workspace).

## Development

```sh
pnpm check
pnpm test:cli
```

Optional duplicate-code review (downloads the analyzer to the package-manager cache;
adds no project dependency):

```sh
pnpm dlx jscpd@4 --min-lines 10 --min-tokens 100 --max-lines 10000 --max-size 1mb \
  --ignore '**/*.test.ts,**/dist/**,**/node_modules/**' \
  --reporters console,json --output _tmp/duplication packages/*/src apps/*/src
```

Review the reported blocks before extracting helpers. Similar behavior with different
names can escape token matching, while intentional adapter repetition can be harmless.
This is an advisory local check, not a blocking CI threshold.

For storage/performance work, use the seeded [SQLite benchmark corpus and baseline](scripts/benchmarks/README.md).

## Agent skills

Reusable skills for working with Lore live in `skills/`:

- [lore-modeling](skills/lore-modeling/SKILL.md): design schemas, typed documents
  and relationships, then validate the resulting knowledge base.
- [lore-usage](skills/lore-usage/SKILL.md): query and explore knowledge through
  the CLI, SDK and PTC scripts, including retained results and output previews.

Install the skills from the repository:

```sh
npx skills add khaale/lore --skill lore-modeling --skill lore-usage
```

Each skill folder can also be copied into your agent's skill directory. They describe
using Lore in other projects and do not depend on this repository's local planning
files.

See [PUBLISH.md](PUBLISH.md) for the single-package release process and npm setup.

Discover an editable type hierarchy and lazily read its placements with
`workspace.hierarchy.propose()` / `workspace.hierarchy.read()`, or
`lore hierarchy propose|read`. Candidates distinguish observed model relations,
source-context hypotheses and navigation groups; partial alternatives remain
available for review. See [hierarchy contracts and examples](docs/sdk.md#candidate-hierarchies).
