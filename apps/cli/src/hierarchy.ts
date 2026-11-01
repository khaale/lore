import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  openFilesystemWorkspace,
  openSqliteWorkspace,
  type HierarchyDefinition,
} from '@khaale/lore-sdk';

const help =
  'usage: lore hierarchy propose|read --index PATH [--format json|sqlite] [--root PATH] [--schema PATH] [--definition FILE] [--parent REF] [--limit N] [--scores] [--json]';
export async function runHierarchy(args: string[]): Promise<void> {
  try {
    await execute(args);
  } catch (error) {
    if (args.includes('--json'))
      console.log(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : String(error),
            ...(error && typeof error === 'object' && 'code' in error ? { code: error.code } : {}),
            ...(error && typeof error === 'object' && 'path' in error ? { path: error.path } : {}),
          },
        }),
      );
    throw error;
  }
}
async function execute(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(help);
    return;
  }
  const command = args.shift();
  if (command !== 'propose' && command !== 'read') throw Error(help);
  const values = new Map<string, string>();
  let json = false,
    includeScores = false;
  const flags = new Set([
    'index',
    'format',
    'root',
    'schema',
    'ignore',
    'definition',
    'parent',
    'limit',
    'continuation',
    'detail',
    'work-budget',
  ]);
  for (let i = 0; i < args.length; i++) {
    const raw = args[i]!;
    if (raw === '--scores') {
      includeScores = true;
      continue;
    }
    if (raw === '--json') {
      json = true;
      continue;
    }
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match || !flags.has(match[1]!)) throw Error(`unknown hierarchy flag ${raw}`);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw Error(`missing value for ${raw}`);
    values.set(match[1]!, value);
  }
  for (const flag of command === 'propose'
    ? ['definition', 'parent', 'limit', 'continuation']
    : ['detail'])
    if (values.has(flag)) throw Error(`--${flag} is not supported by hierarchy ${command}`);
  if (command === 'propose' && includeScores)
    throw Error('--scores is only supported by hierarchy read');
  const format = values.get('format') ?? 'json';
  if (format !== 'json' && format !== 'sqlite') throw Error('format must be json or sqlite');
  if (format === 'sqlite' && (values.has('schema') || values.has('ignore')))
    throw Error('SQLite reads use the indexed model; --schema/--ignore are JSON options');
  const root = resolve(values.get('root') ?? '.'),
    indexPath = resolve(
      values.get('index') ??
        join(root, '.artifact-index', `index.${format === 'json' ? 'json' : 'sqlite'}`),
    );
  const workspace =
    format === 'sqlite'
      ? await openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } })
      : await openFilesystemWorkspace({
          root,
          indexPath,
          ...(values.has('schema') ? { schemaPath: resolve(values.get('schema')!) } : {}),
          ...(values.has('ignore') ? { ignorePath: resolve(values.get('ignore')!) } : {}),
        });
  try {
    const workBudget = values.has('work-budget') ? Number(values.get('work-budget')) : undefined;
    if (command === 'propose') {
      const detail = values.get('detail') ?? 'compact';
      if (detail !== 'compact' && detail !== 'diagnostic')
        throw Error('detail must be compact or diagnostic');
      const result = await workspace.hierarchy.propose({
        detail,
        ...(workBudget === undefined ? {} : { workBudget }),
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const nodes = new Map(result.definition.nodes.map((n) => [n.key, n]));
      let printed = 0;
      const show = (key: string, prefix: string, seen: Set<string>) => {
        if (printed >= 500) return;
        printed++;
        const n = nodes.get(key)!;
        console.log(
          prefix +
            (n.label ?? (n.kind === 'group' ? n.key : n.type)) +
            (n.kind === 'type' ? ` · ${result.typeTotals[n.type] ?? 0}` : ''),
        );
        if (seen.has(key)) {
          console.log(prefix + '  ↻');
          return;
        }
        const next = new Set(seen).add(key);
        if (n.kind === 'group') for (const m of n.members) show(m, prefix + '  ', next);
        for (const b of result.definition.branches.filter(
          (b) => b.parent === key && !b.alternative,
        ))
          show(b.child, prefix + '  ', next);
      };
      console.log('Type counts: global observed totals; repeated occurrences are not additive.');
      for (const r of result.definition.roots) show(r, '', new Set());
      if (printed >= 500) console.log('text preview truncated at 500 placements; use --json');
      const alternatives = result.definition.branches.filter((b) => b.alternative).length;
      if (alternatives)
        console.log(`alternatives: ${alternatives} (use --json for editable definition)`);
    } else {
      const path = values.get('definition');
      if (!path) throw Error('hierarchy read requires --definition FILE');
      const raw: unknown = JSON.parse(await readFile(resolve(path), 'utf8'));
      const definition =
        raw && typeof raw === 'object' && 'definition' in raw
          ? (raw as { definition: HierarchyDefinition }).definition
          : (raw as HierarchyDefinition);
      const result = await workspace.hierarchy.read({
        definition,
        ...(includeScores ? { includeScores: true } : {}),
        ...(values.has('parent') ? { parent: values.get('parent')! } : {}),
        ...(values.has('limit') ? { limit: Number(values.get('limit')) } : {}),
        ...(values.has('continuation') ? { continuation: values.get('continuation')! } : {}),
        ...(workBudget === undefined ? {} : { workBudget }),
      });
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        for (const n of result.items)
          console.log(
            `${n.label}${n.directChildren?.status === 'exact' ? ` · children ${n.directChildren.value}` : ''}${n.kind === 'entity' && n.scores ? ` · structure ${n.scores.structureScore.toFixed(3)} / connectivity ${n.scores.connectivityScore.toFixed(3)}` : ''}${n.flags?.length ? ` [${n.flags.join(', ')}]` : ''}\n  ${n.ref}`,
          );
        if (result.continuation) console.log(`continuation: ${result.continuation}`);
        if (!result.placement.complete)
          console.log(
            `unassigned: ${result.placement.unassigned}; deferred: ${result.placement.deferred}`,
          );
      }
    }
  } finally {
    if ('close' in workspace) await workspace.close();
  }
}
