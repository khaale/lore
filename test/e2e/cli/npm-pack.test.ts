import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repository = process.cwd();
const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('public package distribution', () => {
  it('installs one tarball with working CLI, typed SDK and self-contained skills', async () => {
    const client = await mkdtemp(join(tmpdir(), 'lore-package-'));
    try {
      const packed = JSON.parse(
        run(
          'npm',
          [
            'pack',
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            client,
            '--cache',
            join(client, 'cache'),
          ],
          repository,
        ),
      ) as Array<{ filename: string; files: Array<{ path: string }> }>;
      const archive = join(client, packed[0].filename);
      const entries = packed[0].files.map(({ path }) => path);
      const allowedFiles = new Set([
        'package.json',
        'README.md',
        'LICENSE',
        'CHANGELOG.md',
        'PUBLISH.md',
        'docs/sdk.md',
        'examples/decisions/.lore.yaml',
        'examples/decisions/local-files.md',
        'examples/decisions/validation.md',
      ]);
      for (const file of entries) {
        expect(
          allowedFiles.has(file) ||
            file.startsWith('dist/') ||
            file.startsWith('skills/') ||
            file.startsWith('examples/source-documents/'),
          file,
        ).toBe(true);
        expect(file).not.toMatch(/\.test\.[cm]?js$/);
        expect(file).not.toContain('.artifact-index/');
      }
      expect(entries).toContain('dist/index.d.ts');
      expect(entries).toContain('skills/lore-modeling/references/linkml-support.md');
      expect(entries).toContain('skills/lore-usage/references/scripts.md');
      await writeFile(
        join(client, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
      );
      run(
        'npm',
        [
          'install',
          archive,
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          '--cache',
          join(client, 'cache'),
        ],
        client,
      );
      const installed = join(client, 'node_modules/@khaale/lore');
      const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as {
        name: string;
        license: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(manifest.name).toBe('@khaale/lore');
      expect(manifest.license).toBe('MIT');
      expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
      expect(JSON.stringify(manifest)).not.toContain('workspace:');
      const bin = join(client, 'node_modules/.bin/lore');
      const model = join(installed, 'examples/decisions');
      expect(run(process.execPath, [bin, '--help'], client)).toContain('lore');
      expect(run(process.execPath, [bin, 'check', '--strict', model], client)).toContain(
        'checked: 2 artifacts',
      );
      run(process.execPath, [bin, 'index', model], client);
      await writeFile(
        join(client, 'smoke.mjs'),
        `
import assert from 'node:assert/strict';
import { openFilesystemWorkspace, openSqliteWorkspace, refreshSqliteIndex } from '@khaale/lore';
const workspace = await openFilesystemWorkspace({ root: process.argv[2] });
const saved = await workspace.call(async read => read.retain(await read.query()));
assert.equal(saved.status, 'completed');
const loaded = await workspace.call(async read => {
  const { value } = await read.results.get(saved.result);
  const graph = await read.graph.neighborhood(value, {depth: 1});
  return { records: read.limitItems(value), graph: read.limitGraph(graph) };
});
assert.equal(loaded.status, 'completed');
assert.equal(loaded.result.records.items.length, 2);
assert.equal(loaded.result.graph.edges.length, 1);
const sqlitePath = process.argv[3];
const sqlite = await openSqliteWorkspace({indexPath: sqlitePath, freshness: {mode: 'indexed'}});
assert.equal((await sqlite.query({limit: 2})).items.length, 2);
assert.equal((await sqlite.describe()).snapshot.kind, 'sqlite-generation');
const hp=await sqlite.hierarchy.propose();
assert.equal(hp.definition.version,1);
assert.equal(typeof Object.values(hp.typeScores)[0].structureScore,'number');
assert.ok((await sqlite.hierarchy.read({definition:hp.definition,includeScores:true})).items.length);
assert.ok((await workspace.hierarchy.propose()).definition.nodes.length);
assert.equal((await refreshSqliteIndex({indexPath: sqlitePath})).outcome, 'unchanged');
await sqlite.close();
const constrained=await openSqliteWorkspace({indexPath:process.argv[4],freshness:{mode:'indexed'}});
const ownerType=await constrained.schema.describeType('Owner');
assert.deepEqual(ownerType.annotations,{'bb:group':{id:'architecture'}});
assert.deepEqual(ownerType.fields.find(f=>f.name==='labels').annotations,{});
assert.deepEqual(ownerType.referencePaths.find(p=>p.path==='refinements.scope').annotations,{});
assert.equal(ownerType.fields.find(f=>f.name==='labels').constraints.listElementsUnique,true);
assert.equal((await constrained.schema.describeType('Choice')).recordConstraints[0].exactlyOneOf.length,2);
assert.equal((await constrained.entities.get('owner')).item.properties.refinements[0].scope,'runtime');
assert.equal((await constrained.graph.neighbors(['owner'],{relations:['refinements.scope']})).edges.length,1);
await constrained.close();
const projected=await openSqliteWorkspace({indexPath:process.argv[5],freshness:{mode:'indexed'}});
assert.equal((await projected.query({type:'ApiOperation'})).items.length,2);
const table=(await projected.query({type:'DatabaseObject',where:{name:{eq:'public.заказ'}}})).items[0];
assert.equal(table.properties.definition.columns[0].data_type,'uuid');
assert.equal((await projected.graph.neighbors([table.id],{relations:['foreign_keys.target']})).edges.length,1);
await projected.close();
const columns=await openSqliteWorkspace({indexPath:process.argv[6],freshness:{mode:'indexed'}});
assert.deepEqual((await columns.entities.get('a')).item.properties.targets,['b']);
assert.equal((await columns.entities.get('c')).item.properties.targets,undefined);
assert.equal((await columns.graph.neighbors(['a'],{relations:['targets']})).edges.length,1);
assert.deepEqual((await columns.schema.describeType('Thing')).fields.find(f=>f.name==='targets').annotations['lore:markdown_reference_column'],{heading:'## Calls',column:'Target'});
await columns.close();
console.log('sdk-ok');
`,
      );
      const constrainedRoot = join(client, 'constraints');
      await cp(join(repository, 'test/fixtures/record-constraints'), constrainedRoot, {
        recursive: true,
      });
      const constrainedModel = join(constrainedRoot, 'model.yaml');
      await writeFile(
        constrainedModel,
        (await readFile(constrainedModel, 'utf8')).replace(
          '  Owner:\n',
          "  Owner:\n    annotations:\n      'bb:group': {id: architecture}\n",
        ),
      );
      await writeFile(
        join(constrainedRoot, 'records.yaml'),
        "- {id: runtime, type: Runtime, name: Runtime}\n- id: owner\n  type: Owner\n  name: Owner\n  refinements: [{scope: '[[runtime]]', note: test}]\n  choice: {workload: work}\n",
      );
      run(process.execPath, [bin, 'check', '--strict', constrainedRoot], client);
      const constrainedSqlite = join(client, 'constraints.sqlite');
      run(
        process.execPath,
        [bin, 'index', '--format', 'sqlite', '--out', constrainedSqlite, constrainedRoot],
        client,
      );
      const sqlitePath = join(client, 'knowledge.sqlite');
      run(
        process.execPath,
        [bin, 'index', '--format', 'sqlite', '--out', sqlitePath, model],
        client,
      );
      const sourcesRoot = join(installed, 'examples/source-documents');
      expect(run(process.execPath, [bin, 'check', sourcesRoot], client)).toContain(
        'checked: 8 artifacts',
      );
      const sourcesSqlite = join(client, 'sources.sqlite');
      run(
        process.execPath,
        [bin, 'index', '--format', 'sqlite', '--out', sourcesSqlite, sourcesRoot],
        client,
      );
      const columnsRoot = join(client, 'reference-columns');
      await cp(join(repository, 'test/fixtures/reference-columns'), columnsRoot, {
        recursive: true,
      });
      run(process.execPath, [bin, 'check', '--strict', columnsRoot], client);
      const columnsSqlite = join(client, 'columns.sqlite');
      run(
        process.execPath,
        [bin, 'index', '--format', 'sqlite', '--out', columnsSqlite, columnsRoot],
        client,
      );
      expect(
        run(
          process.execPath,
          ['smoke.mjs', model, sqlitePath, constrainedSqlite, sourcesSqlite, columnsSqlite],
          client,
        ).trim(),
      ).toBe('sdk-ok');
      await cp(join(repository, 'test/types/consumer-valid.ts'), join(client, 'consumer-valid.ts'));
      await cp(
        join(repository, 'test/types/consumer-invalid.ts'),
        join(client, 'consumer-invalid.ts'),
      );
      const base = JSON.parse(await readFile(join(repository, 'tsconfig.base.json'), 'utf8')) as {
        compilerOptions: Record<string, unknown>;
      };
      await writeFile(
        join(client, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            ...base.compilerOptions,
            noEmit: true,
            declaration: false,
            declarationMap: false,
            sourceMap: false,
          },
          include: ['consumer-valid.ts', 'consumer-invalid.ts'],
        }),
      );
      run(
        process.execPath,
        [join(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
        client,
      );
    } finally {
      await rm(client, { recursive: true, force: true });
    }
  }, 120_000);
});
