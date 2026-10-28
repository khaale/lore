#!/usr/bin/env node
import { compileSchema } from '@khaale/lore-schema';
import {
  discover,
  parseFile,
  publishIndex,
  readIndex,
  PollWatcher,
  discoverSchemaDependencies,
  MODEL_FILENAMES,
  resolveSchemaPath,
} from '@khaale/lore-filesystem';
import {
  buildGraph,
  snapshotFromBuildResult,
  checkReport,
  createSemanticReadSession,
  explore,
  renderExplore,
  type IndexV2,
  type Diagnostic,
  type ReadDirection,
  type SemanticReadReport,
} from '@khaale/lore-core';
import { join, resolve } from 'node:path';
import { access } from 'node:fs/promises';

type Args = {
  command: string;
  root: string;
  schema: string;
  ignore: string;
  index: string;
  json: boolean;
  raw: boolean;
  strict: boolean;
  kind?: string;
  id?: string;
  view?: string;
  depth: number;
  out?: string;
  poll: number;
  debounce: number;
  direction: ReadDirection;
  relation?: string;
  text?: string;
  where: string[];
};
function parse(argv: string[]): Args {
  const command = argv[0] ?? 'help';
  const a: Args = {
    command,
    root: '.',
    schema: '',
    ignore: '',
    index: '',
    json: false,
    raw: false,
    strict: true,
    depth: 1,
    poll: 150,
    debounce: 300,
    direction: 'both',
    where: [],
  };
  const definitions: Record<
    string,
    Record<string, { kind: 'string' | 'bool' | 'int' | 'duration'; help: string; default?: string }>
  > = {
    check: {
      ignore: { kind: 'string', help: 'ignore file' },
      json: { kind: 'bool', help: 'JSON diagnostics' },
      schema: { kind: 'string', help: 'LinkML schema' },
      strict: { kind: 'bool', help: 'reject undeclared slots', default: 'true' },
    },
    index: {
      ignore: { kind: 'string', help: 'ignore file' },
      json: { kind: 'bool', help: 'JSON diagnostics' },
      out: { kind: 'string', help: 'index output' },
      schema: { kind: 'string', help: 'LinkML schema' },
      strict: { kind: 'bool', help: 'strict', default: 'true' },
    },
    list: {
      index: {
        kind: 'string',
        help: 'index path',
        default: '.artifact-index/index.json',
      },
      kind: { kind: 'string', help: 'filter kind' },
    },
    refs: {
      index: {
        kind: 'string',
        help: 'index path',
        default: '.artifact-index/index.json',
      },
    },
    explore: {
      depth: { kind: 'int', help: 'maximum traversal depth (0..32)', default: '1' },
      index: { kind: 'string', help: 'persisted index' },
      json: { kind: 'bool', help: 'JSON output' },
      raw: { kind: 'bool', help: 'include raw artifact data in card' },
      schema: { kind: 'string', help: 'LinkML schema' },
      view: { kind: 'string', help: 'view: overview, card, tree, neighborhood, or impact' },
    },
    get: {
      json: { kind: 'bool', help: 'JSON output' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    search: {
      json: { kind: 'bool', help: 'JSON output' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    query: {
      json: { kind: 'bool', help: 'JSON output' },
      kind: { kind: 'string', help: 'runtime class or semantic type identity' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
      where: { kind: 'string', help: 'top-level equality filter (repeatable)' },
    },
    links: {
      direction: { kind: 'string', help: 'relation direction: in, out, or both', default: 'both' },
      json: { kind: 'bool', help: 'JSON output' },
      relation: { kind: 'string', help: 'relation name filter' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    graph: {
      depth: { kind: 'int', help: 'maximum traversal depth (0..32)', default: '1' },
      json: { kind: 'bool', help: 'JSON output' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    impact: {
      depth: { kind: 'int', help: 'maximum traversal depth (0..32)', default: '1' },
      json: { kind: 'bool', help: 'JSON output' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    validate: {
      json: { kind: 'bool', help: 'JSON output' },
      root: { kind: 'string', help: 'workspace root' },
      schema: { kind: 'string', help: 'LinkML schema' },
    },
    watch: {
      debounce: { kind: 'duration', help: 'debounce interval', default: '300ms' },
      ignore: { kind: 'string', help: 'ignore file' },
      out: { kind: 'string', help: 'index output' },
      poll: { kind: 'duration', help: 'filesystem polling interval', default: '150ms' },
      schema: { kind: 'string', help: 'LinkML schema' },
      strict: { kind: 'bool', help: 'strict', default: 'true' },
    },
    help: {},
  };
  if (!definitions[command]) return a;
  const vals = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const positional: string[] = [];
  let parsingFlags = true;
  const interspersed = new Set(['get', 'search', 'query', 'links', 'graph', 'impact', 'validate']);
  const flagUsage = (): string => {
    const lines = [`Usage of ${command}:`];
    for (const [name, definition] of Object.entries(definitions[command]!).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(
        `  -${name}${definition.kind === 'bool' ? '' : ` ${definition.kind === 'int' ? 'int' : definition.kind === 'duration' ? 'duration' : 'string'}`}`,
      );
      lines.push(
        `    \t${definition.help}${definition.default === undefined ? '' : ` (default ${definition.kind === 'string' ? JSON.stringify(definition.default) : definition.default})`}`,
      );
    }
    return `${lines.join('\n')}\n`;
  };
  const flagError = (message: string): never => {
    process.stderr.write(`${message}\n${flagUsage()}`);
    throw new Error(message);
  };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i]!;
    if ((!parsingFlags && !interspersed.has(command)) || x === '-' || !x.startsWith('-')) {
      parsingFlags = false;
      positional.push(x);
      continue;
    }
    if (x === '--') {
      parsingFlags = false;
      continue;
    }
    const rawFlag = x.replace(/^-+/, ''),
      equal = rawFlag.indexOf('='),
      k = equal < 0 ? rawFlag : rawFlag.slice(0, equal);
    const definition = definitions[command][k];
    if (!definition) flagError(`flag provided but not defined: -${k}`);
    const inline = equal < 0 ? undefined : rawFlag.slice(equal + 1);
    if (definition!.kind === 'bool') {
      const value = inline ?? 'true';
      if (value !== 'true' && value !== 'false')
        flagError(`invalid boolean value ${JSON.stringify(value)} for -${k}: parse error`);
      vals.set(k, value);
      continue;
    }
    const v = inline ?? argv[++i];
    if (v === undefined) flagError(`flag needs an argument: -${k}`);
    if (definition!.kind === 'int' && !Number.isInteger(Number(v)))
      flagError(`invalid value ${JSON.stringify(v)} for flag -${k}: parse error`);
    if (k === 'where') repeated.set(k, [...(repeated.get(k) ?? []), v!]);
    else vals.set(k, v!);
  }
  const semanticCommand = interspersed.has(command);
  a.root = semanticCommand
    ? (vals.get('root') ?? '.')
    : command === 'refs' || command === 'list'
      ? '.'
      : (positional[0] ?? '.');
  a.schema = vals.get('schema') ?? '';
  a.ignore = vals.get('ignore') ?? join(a.root, '.artifactignore');
  a.index =
    vals.get('index') ??
    vals.get('out') ??
    (command === 'list' || command === 'refs'
      ? join('.artifact-index', 'index.json')
      : join(a.root, '.artifact-index', 'index.json'));
  const out = vals.get('out'),
    kind = vals.get('kind'),
    id = semanticCommand ? positional[0] : command === 'refs' ? positional[0] : positional[1],
    view = vals.get('view');
  if (out !== undefined) a.out = out;
  if (kind !== undefined) a.kind = kind;
  if (id !== undefined) a.id = id;
  if (view !== undefined) a.view = view;
  if (command === 'search' && id !== undefined) a.text = id;
  if (command === 'query') {
    a.where = repeated.get('where') ?? [];
    parseWhere(a.where);
  }
  const direction = vals.get('direction');
  if (direction !== undefined) {
    if (direction !== 'in' && direction !== 'out' && direction !== 'both')
      flagError(
        `invalid value ${JSON.stringify(direction)} for flag -direction: expected in, out, or both`,
      );
    a.direction = direction as ReadDirection;
  }
  const relation = vals.get('relation');
  if (relation !== undefined) a.relation = relation;
  a.json = vals.get('json') === 'true';
  a.raw = vals.get('raw') === 'true';
  a.strict = vals.get('strict') !== 'false';
  a.depth = Number(vals.get('depth') ?? 1);
  const duration = (name: string, value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    const match =
      value === '0'
        ? /^(0)$/.exec(value)
        : /^(-?(?:\d+(?:\.\d+)?|\.\d+))(ns|us|µs|ms|s|m|h)$/.exec(value);
    if (!match) flagError(`invalid value ${JSON.stringify(value)} for flag -${name}: parse error`);
    const factor =
      match![2] === 'h'
        ? 3_600_000
        : match![2] === 'm'
          ? 60_000
          : match![2] === 's'
            ? 1_000
            : match![2] === 'ms' || !match![2]
              ? 1
              : match![2] === 'us' || match![2] === 'µs'
                ? 0.001
                : 0.000001;
    return Number(match![1]) * factor;
  };
  a.poll = duration('poll', vals.get('poll'), 150);
  a.debounce = duration('debounce', vals.get('debounce'), 300);
  if (!Number.isInteger(a.depth) || a.depth < 0 || a.depth > 32)
    throw new Error('depth must be between 0 and 32');
  if (command === 'explore' && positional.length > 2)
    throw new Error('explore accepts a root and optional artifact id');
  if (
    semanticCommand &&
    positional.length !== (command === 'query' || command === 'validate' ? 0 : 1)
  )
    throw new Error(`${command} received an invalid number of positional arguments`);
  return a;
}
function usage() {
  console.log(`lore - LinkML-driven artifact graph

Usage:
  lore check [root] [flags]
  lore index [root] [flags]
  lore watch [root] [flags]
  lore list [--index path] [--kind Kind]
  lore refs <id> [--index path]
  lore explore [flags] [root] [id]
  lore get <id> [--root PATH] [--schema PATH] [--json]
  lore search <text> [--root PATH] [--schema PATH] [--json]
  lore query [--kind CLASS] [--where SLOT=VALUE]... [--root PATH] [--schema PATH] [--json]
  lore links <id> [--direction in|out|both] [--relation NAME] [--root PATH] [--schema PATH] [--json]
  lore graph <id> [--depth N] [--root PATH] [--schema PATH] [--json]
  lore impact <id> [--depth N] [--root PATH] [--schema PATH] [--json]
  lore validate [--root PATH] [--schema PATH] [--json]

Common flags:
  --schema PATH    LinkML schema (auto: ${MODEL_FILENAMES.join(' or ')} under root)
  --ignore PATH    Git-compatible exclusions (default: <root>/.artifactignore)
  --strict         reject properties not declared by the resolved kind (default true)`);
}
async function build(a: Args) {
  const compiled = await compileSchema(resolve(a.schema));
  if (!compiled.ok) {
    const error = new Error(compiled.diagnostics.map((d) => d.message).join('\n')) as Error & {
      diagnostics: unknown[];
    };
    error.diagnostics = compiled.diagnostics;
    throw error;
  }
  const files = await discover({
    root: a.root,
    schemaPath: a.schema,
    ignorePath: a.ignore,
    outputPath: a.index,
    dependencies: compiled.value.dependencies,
  });
  const cs = [];
  const parseErrors: Diagnostic[] = [];
  for (const f of files) {
    try {
      cs.push(...(await parseFile(f)));
    } catch (e) {
      parseErrors.push({ severity: 'error', code: 'PARSE', message: String(e), source: f });
    }
  }
  const result = buildGraph(cs, {
    root: resolve(a.root),
    compiled: compiled.value,
    strict: a.strict,
  });
  result.index.diagnostics!.push(...parseErrors);
  return result;
}

function printDiagnostics(diagnostics: Diagnostic[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(diagnostics.length ? diagnostics : null, null, 2));
    return;
  }
  for (const diagnostic of diagnostics) {
    let location = diagnostic.source ?? '';
    if (diagnostic.span?.line && diagnostic.span.column)
      location = `${location}:${diagnostic.span.line}:${diagnostic.span.column}`;
    if (diagnostic.artifact) location += ` [${diagnostic.artifact}]`;
    if (diagnostic.slot) location += `.${diagnostic.slot}`;
    console.log(
      `${diagnostic.severity.toUpperCase().padEnd(7)} ${diagnostic.code.padEnd(24)} ${location}: ${diagnostic.message}`,
    );
  }
}

function parseWhere(values: string[]): Array<{ slot: string; value: string | number | boolean }> {
  return values.map((input) => {
    const separator = input.indexOf('=');
    if (separator <= 0)
      throw new Error(`invalid --where ${JSON.stringify(input)}; expected SLOT=VALUE`);
    const slot = input.slice(0, separator);
    const raw = input.slice(separator + 1);
    if (!raw) throw new Error(`invalid --where ${JSON.stringify(input)}; value must not be empty`);
    let value: string | number | boolean = raw;
    if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      const number = Number(raw);
      if (!Number.isFinite(number))
        throw new Error(`invalid --where ${JSON.stringify(input)}; number must be finite`);
      value = number;
    } else if (
      raw.startsWith('"') ||
      raw.startsWith('{') ||
      raw.startsWith('[') ||
      raw === 'null'
    ) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'string' && typeof parsed !== 'number' && typeof parsed !== 'boolean')
          throw new Error('value must be a scalar');
        value = parsed;
      } catch (error) {
        throw new Error(
          `invalid --where ${JSON.stringify(input)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { slot, value };
  });
}

function formatSemanticValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderSemanticRead(report: SemanticReadReport): string {
  const lines: string[] = [];
  if (report.operation === 'get') {
    lines.push(`${report.entity.id} (${report.entity.kind}, ${report.entity.typeId})`);
    for (const [path, value] of Object.entries(report.entity.properties).sort(([left], [right]) =>
      left.localeCompare(right),
    ))
      lines.push(`  ${path}: ${formatSemanticValue(value)}`);
  } else if (report.operation === 'search') {
    lines.push(`search: ${report.matches.length} match${report.matches.length === 1 ? '' : 'es'}`);
    for (const match of report.matches)
      lines.push(
        `${match.entity.id}: ${match.matches.map((item) => `${item.path}=${formatSemanticValue(item.value)}`).join(', ')}`,
      );
  } else if (report.operation === 'query') {
    lines.push(
      `query: ${report.entities.length} entit${report.entities.length === 1 ? 'y' : 'ies'}`,
    );
    report.entities.forEach((entity) =>
      lines.push(`${entity.id} (${entity.kind}, ${entity.typeId})`),
    );
  } else if (report.operation === 'links') {
    lines.push(`links: ${report.links.length}`);
    report.links.forEach((link) => lines.push(`${link.from} -[${link.relation}]-> ${link.to}`));
  } else if (report.operation === 'graph') {
    lines.push(`graph: ${report.nodes.length} node${report.nodes.length === 1 ? '' : 's'}`);
    report.nodes.forEach((node) => lines.push(`${node.id} [d=${node.distance}]`));
    report.links.forEach((link) => lines.push(`${link.from} -[${link.relation}]-> ${link.to}`));
  } else {
    lines.push(
      `impact: ${report.impacts.length} affected entr${report.impacts.length === 1 ? 'y' : 'ies'}`,
    );
    report.impacts.forEach((impact) =>
      lines.push(
        `${impact.id} [d=${impact.distance}] ${impact.path.map((link) => `${link.from} -[${link.relation}]-> ${link.to}`).join(' ; ')}`,
      ),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function runSemanticRead(a: Args): Promise<void> {
  const built = await build(a);
  const errors = (built.index.diagnostics ?? []).filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(errors.map((d) => d.message).join('\n'));
  const session = createSemanticReadSession({
    snapshot: snapshotFromBuildResult(built),
    schema: built.schema,
    schemaHash: built.index.schema_hash,
  });
  let report: SemanticReadReport;
  if (a.command === 'get') {
    if (!a.id) throw new Error('get requires an entity ID');
    report = session.get(a.id);
  } else if (a.command === 'search') {
    if (a.text === undefined) throw new Error('search requires literal text');
    report = session.search(a.text);
  } else if (a.command === 'query') {
    report = session.query(a.kind, parseWhere(a.where));
  } else if (a.command === 'links') {
    if (!a.id) throw new Error('links requires an entity ID');
    report = session.links(a.id, a.direction, a.relation);
  } else if (a.command === 'graph') {
    if (!a.id) throw new Error('graph requires an entity ID');
    report = session.graph(a.id, a.depth);
  } else {
    if (!a.id) throw new Error('impact requires an entity ID');
    report = session.impact(a.id, a.depth);
  }
  process.stdout.write(
    a.json ? `${JSON.stringify(report, null, 2)}\n` : renderSemanticRead(report),
  );
}

async function main() {
  const rawArgs = process.argv.slice(2);
  try {
    const a = parse(rawArgs);
    if (a.command === 'help' || a.command === '--help' || a.command === '-h') {
      usage();
      return;
    }
    if (
      [
        'check',
        'validate',
        'index',
        'get',
        'query',
        'search',
        'links',
        'graph',
        'impact',
        'explore',
        'watch',
      ].includes(a.command)
    ) {
      a.schema = await resolveSchemaPath(a.root, a.schema || undefined);
    }
    if (a.command === 'check' || a.command === 'validate' || a.command === 'index') {
      const r = await build(a);
      const report = checkReport(r.index);
      if (a.command === 'check' || a.command === 'validate') {
        if (a.json) console.log(JSON.stringify(report, null, 2));
        else {
          printDiagnostics(report.diagnostics, false);
          console.log(
            `checked: ${report.summary.artifacts} artifacts, ${report.summary.edges} edges, ${report.summary.diagnostics} diagnostics (errors: ${report.summary.errors}, warnings: ${report.summary.warnings})`,
          );
          console.log('Classes:');
          for (const entry of report.classes)
            console.log(`  ${entry.class.padEnd(24)} ${entry.count} (${entry.type_id ?? ''})`);
        }
        if (report.summary.errors) {
          console.error('validation failed');
          process.exitCode = 1;
        }
        return;
      }
      if (report.summary.errors) {
        printDiagnostics(report.diagnostics, a.json);
        throw new Error('validation failed; last-known-good index was not replaced');
      }
      printDiagnostics(report.diagnostics, a.json);
      const portable: IndexV2 = {
        ...r.index,
        edges: r.index.edges?.length ? r.index.edges : null,
        diagnostics: r.index.diagnostics?.length ? r.index.diagnostics : null,
        artifacts: Object.fromEntries(
          Object.entries(r.index.artifacts).map(([id, artifact]) => [
            id,
            artifact.links?.length
              ? artifact
              : (() => {
                  const { links: _links, ...withoutLinks } = artifact;
                  return withoutLinks;
                })(),
          ]),
        ),
      };
      await publishIndex(a.index, portable);
      console.log(
        `indexed: ${report.summary.artifacts} artifacts, ${report.summary.edges} edges -> ${a.index}`,
      );
      return;
    }
    if (a.command === 'list') {
      const raw = (await readIndex(a.index)) as IndexV2;
      const idx: IndexV2 = { ...raw, edges: raw.edges ?? [], diagnostics: raw.diagnostics ?? [] };
      for (const id of Object.keys(idx.artifacts).sort()) {
        const x = idx.artifacts[id]!;
        if (!a.kind || x.kind === a.kind)
          console.log(`${x.id.padEnd(24)} ${x.kind.padEnd(24)} ${x.source}`);
      }
      return;
    }
    if (a.command === 'refs') {
      if (a.json) throw new Error('unknown option --json');
      if (!a.id) throw new Error('refs requires artifact id');
      const raw = (await readIndex(a.index)) as IndexV2;
      const idx: IndexV2 = { ...raw, edges: raw.edges ?? [], diagnostics: raw.diagnostics ?? [] };
      if (!idx.artifacts[a.id]) throw new Error(`artifact ${a.id} not found`);
      for (const e of (idx.edges ?? []).filter((x) => x.from === a.id || x.to === a.id)) {
        const incoming = e.to === a.id;
        console.log(
          `${incoming ? '<-' : '->'} ${e.relation.padEnd(18)} ${incoming ? e.from : e.to}${e.inferred ? ' inferred' : ''}${e.generic ? ' generic' : ''}`,
        );
      }
      return;
    }
    if (a.command === 'explore') {
      try {
        await access(a.index);
      } catch {
        throw new Error(`explore index ${a.index} not found; run lore index ${a.root} first`);
      }
      const raw = (await readIndex(a.index)) as IndexV2;
      const idx: IndexV2 = { ...raw, edges: raw.edges ?? [], diagnostics: raw.diagnostics ?? [] };
      const schema = await compileSchema(resolve(a.schema));
      if (!schema.ok) throw new Error(schema.diagnostics.map((d) => d.message).join('\n'));
      if (schema.value.hash !== idx.schema_hash)
        throw new Error(
          `explore schema hash mismatch for ${a.index}; rebuild with lore index ${a.root}`,
        );
      const report = explore(
        idx,
        a.view ?? (a.id ? 'card' : 'overview'),
        a.id,
        a.depth,
        schema.value.ir,
        {
          schemaPath: a.schema,
          indexPath: a.index,
          schemaHash: idx.schema_hash,
          raw: a.raw,
          human: !a.json,
        },
      );
      if (a.json) console.log(JSON.stringify(report, null, 2));
      else process.stdout.write(renderExplore(report));
      return;
    }
    if (['get', 'search', 'query', 'links', 'graph', 'impact'].includes(a.command)) {
      await runSemanticRead(a);
      return;
    }
    if (a.command === 'watch') {
      const watcher = new PollWatcher(a.poll, a.debounce);
      const initialDependencies = await discoverSchemaDependencies(resolve(a.schema));
      const watchOptions = {
        root: a.root,
        schemaPath: a.schema,
        ignorePath: a.ignore,
        outputPath: a.index,
        dependencies: initialDependencies,
      };
      const rebuild = async () => {
        try {
          const r = await build(a);
          const currentSchema = await compileSchema(resolve(a.schema));
          if (currentSchema.ok)
            watchOptions.dependencies = [...new Set(currentSchema.value.dependencies)];
          else
            watchOptions.dependencies = [
              ...new Set([
                ...watchOptions.dependencies,
                ...(await discoverSchemaDependencies(resolve(a.schema))),
              ]),
            ];
          const report = checkReport(r.index);
          if (!report.summary.errors) {
            const portable: IndexV2 = {
              ...r.index,
              edges: r.index.edges?.length ? r.index.edges : null,
              diagnostics: r.index.diagnostics?.length ? r.index.diagnostics : null,
              artifacts: Object.fromEntries(
                Object.entries(r.index.artifacts).map(([id, artifact]) => [
                  id,
                  artifact.links?.length
                    ? artifact
                    : (() => {
                        const { links: _links, ...withoutLinks } = artifact;
                        return withoutLinks;
                      })(),
                ]),
              ),
            };
            await publishIndex(a.index, portable);
            console.log(`indexed ${Object.keys(r.index.artifacts).length} artifacts`);
          } else
            console.log(
              `validation failed for ${report.summary.artifacts} artifacts (${report.summary.errors} errors); index unchanged`,
            );
        } catch (e) {
          console.error(`reindex: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      await rebuild();
      await watcher.run(watchOptions, rebuild);
      return;
    }
    throw new Error(
      `unknown command ${JSON.stringify(a.command)}\n\n${(() => {
        const output: string[] = [];
        const original = console.log;
        console.log = (value?: unknown) =>
          output.push(
            value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value),
          );
        try {
          usage();
        } finally {
          console.log = original;
        }
        return output.join('\n') + '\n';
      })()}`,
    );
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  }
}
void main();
