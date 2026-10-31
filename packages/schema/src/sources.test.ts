import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  normalizeSchema,
  compileSchemaOrThrow,
  compileSchema,
  type AssertedSchema,
} from './index.js';

const source = () => ({
  files: ['input/*.json'],
  entities: [
    {
      name: 'things',
      class: 'Thing',
      at: 'item',
      select: [{ from: 'root', path: ['things'], each: 'items', as: 'item' }],
      key: [{ get: { from: 'item', path: ['code'] } }],
      fields: {
        name: { get: { from: 'item', path: ['name'] } },
        related: {
          pointer_refs: {
            from: 'item',
            member: '$ref',
            rule: 'things',
            descend: [['properties', '*']],
          },
        },
      },
    },
  ],
});
const model = (declaration: unknown): AssertedSchema => ({
  classes: {
    Thing: {
      attributes: {
        id: { identifier: true },
        name: {},
        related: { range: 'Thing', multivalued: true },
        rank: { range: 'integer' },
      },
    },
  },
  slots: {},
  types: {},
  enums: {},
  annotations: { 'lore:sources': { example: declaration } },
});

it('compiles declarations into executable plans without changing unannotated models', () => {
  const ir = normalizeSchema(model(source()));
  expect(ir.sources?.[0]?.entities[0]).toMatchObject({
    identifier: 'id',
    name: 'things',
    class: 'Thing',
  });
  const plain = model(source());
  delete plain.annotations;
  expect(normalizeSchema(plain).sources).toBeUndefined();
  plain.annotations = { 'poc:projections': { example: source() } };
  expect(normalizeSchema(plain).sources).toBeUndefined();
});

it('rejects misplaced declarations including type and enum annotations', () => {
  for (const kind of ['class', 'slot', 'type', 'enum']) {
    const raw = model(source());
    delete raw.annotations;
    const annotation = { 'lore:sources': { example: source() } };
    if (kind === 'class') raw.classes.Thing!.annotations = annotation;
    if (kind === 'slot') raw.slots.note = { annotations: annotation };
    if (kind === 'type') raw.types.Custom = { extra: { annotations: annotation } };
    if (kind === 'enum')
      raw.enums.Custom = { permissibleValues: {}, extra: { annotations: annotation } };
    expect(() => normalizeSchema(raw)).toThrow(/schema-level-only/);
  }
});

it('generates a custom identifier and required type designator and rejects overwriting them', () => {
  const raw = model(source());
  const fields = raw.classes.Thing!.attributes!;
  fields.code = fields.id!;
  delete fields.id;
  fields.kind = { designatesType: true, required: true };
  expect(normalizeSchema(raw).sources?.[0]?.entities[0]).toMatchObject({
    identifier: 'code',
    designator: 'kind',
  });
  (raw.annotations!['lore:sources'] as any).example.entities[0].fields.kind = { literal: 'Other' };
  expect(() => normalizeSchema(raw)).toThrow(/cannot be overwritten/);
});

it('rejects unknown syntax, missing bindings, invalid paths and identity overrides', () => {
  const mutations: Array<(value: any) => void> = [
    (s) => {
      s.extra = true;
    },
    (s) => {
      s.entities[0].key = [{ key: 'root' }];
    },
    (s) => {
      s.files = ['../external.json'];
    },
    (s) => {
      s.files = ['/absolute.json'];
    },
    (s) => {
      s.files = ['a/[bc].json'];
    },
    (s) => {
      s.entities[0].select[0].as = 'root';
    },
    (s) => {
      s.entities[0].select[0].path = [-1];
    },
    (s) => {
      s.entities[0].fields.name = { get: { from: 'missing' } };
    },
    (s) => {
      s.entities[0].fields.name = { eval: 'return 1' };
    },
    (s) => {
      s.entities[0].fields.id = { literal: 'overwritten' };
    },
    (s) => {
      s.entities[0].fields.extra = { literal: 'hidden' };
    },
    (s) => {
      s.entities[0].key = [{ ref: { rule: 'things', key: [{ literal: 'x' }] } }];
    },
    (s) => {
      s.entities[0].fields.related.pointer_refs.descend = [[]];
    },
    (s) => {
      s.entities[0].fields.related.pointer_refs.rule = 'missing';
    },
  ];
  for (const mutate of mutations) {
    const value = source();
    mutate(value);
    expect(() => normalizeSchema(model(value))).toThrow();
  }
});

it('checks statically knowable assignment types and reference target classes', () => {
  for (const value of [
    { literal: 'wrong number' },
    { object: {} },
    { collect: { select: [], value: { literal: 1 } } },
    { ref: { rule: 'things', key: [{ literal: 'x' }] } },
  ]) {
    const raw = model(source());
    (raw.annotations!['lore:sources'] as any).example.entities[0].fields.rank = value;
    expect(() => normalizeSchema(raw)).toThrow(/literal|field|requires|reference/);
  }
  const raw = model(source());
  raw.classes.Other = { attributes: { id: { identifier: true } } };
  raw.classes.Thing!.attributes!.related!.range = 'Other';
  expect(() => normalizeSchema(raw)).toThrow(/reference is incompatible/);
  raw.classes.Thing!.attributes!.related = {
    anyOf: [{ range: 'Thing' }, { range: 'Other' }],
    multivalued: true,
  };
  expect(normalizeSchema(raw).sources).toHaveLength(1);
});

it('composes imported sources once, rejects duplicate names and binds schema identity to rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lore-source-compiler-'));
  try {
    const base =
      'classes:\n  Thing:\n    attributes:\n      id: {identifier: true}\n      name: {}\n      related: {range: Thing, multivalued: true}\n';
    const annotation = `annotations: ${JSON.stringify({ 'lore:sources': { example: source() } })}\n`;
    await writeFile(join(root, 'shared.yaml'), base + annotation);
    await writeFile(join(root, 'left.yaml'), 'imports: [shared]\n');
    await writeFile(join(root, 'right.yaml'), 'imports: [shared]\n');
    await writeFile(join(root, 'model.yaml'), 'imports: [left, right]\n');
    const first = await compileSchemaOrThrow(join(root, 'model.yaml'));
    expect(first.ir.sources).toHaveLength(1);
    const changed = source();
    changed.entities[0]!.fields.name = { get: { from: 'root', path: ['title'] } };
    await writeFile(
      join(root, 'shared.yaml'),
      base + `annotations: ${JSON.stringify({ 'lore:sources': { example: changed } })}\n`,
    );
    expect((await compileSchemaOrThrow(join(root, 'model.yaml'))).hash).not.toBe(first.hash);
    await writeFile(join(root, 'model.yaml'), 'imports: [left, right]\n' + annotation);
    const duplicate = await compileSchema(join(root, 'model.yaml'));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'DUPLICATE_SOURCE' }),
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
