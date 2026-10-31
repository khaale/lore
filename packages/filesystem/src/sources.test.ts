import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { discover, readSources } from './index.js';
import { extractSource, SOURCE_LIMITS } from './source-extraction.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lore-source-files-'));
  directories.push(root);
  await cp(resolve('examples/source-documents'), root, {
    recursive: true,
    filter: (path) => !path.includes('.artifact-index'),
  });
  const schemaPath = join(root, '.lore.yaml'),
    compiled = await compileSchemaOrThrow(schemaPath);
  return { root, schemaPath, compiled };
}

it('keeps candidate and failure order across concurrent read batches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-read-batches-'));
  directories.push(root);
  const schemaPath = join(root, '.lore.yaml');
  await writeFile(
    schemaPath,
    'name: batches\nclasses:\n  Thing:\n    attributes:\n      id: {identifier: true}\n',
  );
  const compiled = await compileSchemaOrThrow(schemaPath);
  const paths = Array.from({ length: 20 }, (_, index) =>
    join(root, `file-${String(index).padStart(2, '0')}.json`),
  );
  await Promise.all(paths.map((path, index) => writeFile(path, JSON.stringify({ id: index }))));
  const files = await discover({ root, schemaPath });
  await rm(paths[3]!);
  await writeFile(paths[17]!, '{invalid');
  const result = await readSources({ root, schemaPath }, compiled, files);
  expect(result.candidates.map((candidate) => candidate.data.id)).toEqual(
    Array.from({ length: 20 }, (_, index) => index).filter((index) => index !== 3 && index !== 17),
  );
  expect(result.diagnostics.map(({ code, source }) => ({ code, source }))).toEqual([
    { code: 'PARSE', source: paths[3] },
    { code: 'PARSE', source: paths[17] },
  ]);
});

it('claims declared files once, retains generic records and emits original file pointers', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'ordinary.yaml'), 'id: ordinary\ntype: Api\nname: Ordinary\n');
  const before = await readFile(join(f.root, 'api/orders.yaml'), 'utf8');
  const result = await readSources(f, f.compiled);
  expect(result.diagnostics).toEqual([]);
  expect(result.candidates.filter((candidate) => candidate.declaredClass)).toHaveLength(8);
  expect(result.candidates.some((candidate) => candidate.data.id === 'ordinary')).toBe(true);
  expect(result.candidates.filter((c) => c.declaredClass === 'ApiOperation')).toHaveLength(2);
  const get = result.candidates.find((c) => c.data.method === 'get')!;
  expect(get.source).toBe(join(f.root, 'api/orders.yaml') + '#/paths/~1orders~1{id}/get');
  expect(get.data.id).toBe('openapi/api%2Forders.yaml/operation/%2Forders%2F%7Bid%7D/get');
  expect(await readFile(join(f.root, 'api/orders.yaml'), 'utf8')).toBe(before);
});

it('honors ignores and exclusions, diagnoses overlap/missing literals and permits empty globs', async () => {
  const f = await fixture();
  await writeFile(join(f.root, '.artifactignore'), 'api/\n');
  const result = await readSources(
    { ...f, ignorePath: join(f.root, '.artifactignore') },
    f.compiled,
  );
  expect(result.candidates.filter((candidate) => candidate.declaredClass)).toHaveLength(3);
  expect(result.diagnostics).toEqual([]);
  const plans = f.compiled.ir.sources!;
  plans[0]!.files = ['.lore.yaml'];
  expect((await readSources(f, f.compiled)).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'SOURCE_INPUT' }),
  );
  plans[0]!.files = ['api/*.yaml'];
  plans.push({ ...plans[0]!, name: 'overlap' });
  expect((await readSources(f, f.compiled)).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'SOURCE_OWNERSHIP' }),
  );
});

it('supports JSON documents and detects unsupported/multi-document/wrong-root sources', async () => {
  const f = await fixture();
  const valid = await readSources(f, f.compiled);
  expect(valid.diagnostics).toEqual([]);
  const path = join(f.root, 'api/orders.yaml');
  for (const text of ['a: 1\n---\nb: 2\n', '- a\n- b\n', 'paths: []\ninfo: {title: Empty}\n']) {
    await writeFile(path, text);
    const result = await readSources(f, f.compiled);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_EXTRACTION' }),
    );
  }
  await writeFile(path, 'info: {title: Empty}\n');
  expect((await readSources(f, f.compiled)).diagnostics).toEqual([]);
});

it('resolves keys and recursive pointers, detaches values and keeps IDs after array reordering or label edits', async () => {
  const f = await fixture();
  const [api, db] = f.compiled.ir.sources!;
  const document = {
    info: { title: 'Example' },
    paths: {
      '/x': {
        get: {
          operationId: 'before',
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/X' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        X: {
          type: 'object',
          properties: { self: { $ref: '#/components/schemas/X' }, $ref: { type: 'string' } },
          example: { $ref: 'not a reference' },
        },
      },
    },
  };
  const original = structuredClone(document);
  const records = extractSource(document, api!, ['example'], '/source.yaml');
  const dto = records.find((c) => c.declaredClass === 'ApiSchema')!;
  expect(dto.data.references).toEqual([dto.data.id]);
  (dto.data.definition as any).type = 'changed';
  expect(document).toEqual(original);
  document.paths['/x'].get.operationId = 'after';
  expect(extractSource(document, api!, ['example'], '/source.yaml').map((c) => c.data.id)).toEqual(
    records.map((c) => c.data.id),
  );
  const raw = JSON.parse(await readFile(join(f.root, 'databases/orders.json'), 'utf8')) as {
    objects: Record<string, unknown>[];
  };
  const first = extractSource(raw, db!, ['db'], '/database.json');
  raw.objects.reverse();
  expect(
    extractSource(raw, db!, ['db'], '/database.json')
      .map((c) => c.data.id)
      .sort(),
  ).toEqual(first.map((c) => c.data.id).sort());
  raw.objects.push(raw.objects[0]!);
  expect(() => extractSource(raw, db!, ['db'], '/database.json')).toThrow(/duplicate entity/);
  for (const ref of [
    '#/components/schemas/Missing',
    'other.yaml#/components/schemas/X',
    '#anchor',
  ]) {
    document.components.schemas.X.properties.self.$ref = ref;
    expect(() => extractSource(document, api!, ['example'], '/source.yaml')).toThrow(
      /pointer|references/,
    );
  }
});

it('rejects cyclic input and bounds source depth, work and entity expansion', async () => {
  const f = await fixture(),
    plan = f.compiled.ir.sources![0]!;
  const cyclic: any = { info: { title: 'Cyclic' } };
  cyclic.self = cyclic;
  expect(() => extractSource(cyclic, plan, ['example'], '/source')).toThrow(/cyclic YAML/);
  const deep: any = {};
  let child = deep;
  for (let index = 0; index <= SOURCE_LIMITS.depth; index++) {
    child.next = {};
    child = child.next;
  }
  expect(() => extractSource(deep, plan, ['example'], '/source')).toThrow(/depth limit/);
  expect(() =>
    extractSource({ big: Array(SOURCE_LIMITS.work).fill(0) }, plan, ['example'], '/source'),
  ).toThrow(/work or depth limit/);
  const many = {
    info: { title: 'Many' },
    components: {
      schemas: Object.fromEntries(
        Array.from({ length: SOURCE_LIMITS.entities }, (_, i) => [String(i), {}]),
      ),
    },
  };
  expect(() => extractSource(many, plan, ['example'], '/source')).toThrow(/entity limit/);
});
