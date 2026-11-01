import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VALUE_MODE,
  compileSchema,
  normalizeSchema,
  schemaHash,
  type AssertedSchema,
} from './index.js';

describe('schema public contracts', () => {
  it('normalizes a user-defined model without concrete Lore types', () => {
    const schema: AssertedSchema = {
      classes: { Record: { attributes: { key: { range: 'string', identifier: true } } } },
      slots: {},
      types: {},
      enums: {},
    };
    const ir = normalizeSchema(schema);
    expect(ir.classes.Record!.slots.key!.mode).toBe(VALUE_MODE.SCALAR);
    expect(ir.classes.Record!.slots.key!.required).toBe(true);
  });
  it('hashes asserted content deterministically', () => {
    const schema: AssertedSchema = { classes: {}, slots: {}, types: {}, enums: {} };
    expect(schemaHash(schema)).toBe(schemaHash(structuredClone(schema)));
  });
  it('ignores object key order but preserves constraints and annotations in schema identity', () => {
    const schema: AssertedSchema = {
      classes: {
        Record: {
          attributes: { title: { range: 'string', required: true } },
          annotations: { 'lore:explore_order': 1, 'lore:explore_roles': ['card'] },
        },
      },
      slots: {},
      types: {},
      enums: {},
    };
    const reordered: AssertedSchema = {
      ...schema,
      classes: {
        Record: {
          annotations: { 'lore:explore_roles': ['card'], 'lore:explore_order': 1 },
          attributes: { title: { required: true, range: 'string' } },
        },
      },
      sourceFiles: ['/another/location/schema.yaml'],
    };
    expect(schemaHash(reordered)).toBe(schemaHash(schema));
    const changed = structuredClone(schema);
    changed.classes.Record!.attributes!.title!.required = false;
    expect(schemaHash(changed)).not.toBe(schemaHash(schema));
    changed.classes.Record!.attributes!.title!.required = true;
    changed.classes.Record!.annotations!['lore:explore_order'] = 2;
    expect(schemaHash(changed)).not.toBe(schemaHash(schema));
  });
  it('hashes equivalent schemas independently of filesystem paths', async () => {
    const body = 'id: https://example.org/hash\nclasses:\n  Thing: {}\n';
    const a = await mkdtemp(join(tmpdir(), 'lore-a-'));
    const b = await mkdtemp(join(tmpdir(), 'lore-b-'));
    await writeFile(join(a, 'schema.yaml'), body);
    await writeFile(join(b, 'schema.yaml'), body);
    const [left, right] = await Promise.all([
      compileSchema(join(a, 'schema.yaml')),
      compileSchema(join(b, 'schema.yaml')),
    ]);
    expect(left.ok && right.ok && left.value.hash).toBe(right.ok && right.value.hash);
  });
  it('changes identity when imported asserted content changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lore-import-'));
    const root = join(directory, 'root.yaml');
    const base = join(directory, 'base.yaml');
    await writeFile(base, 'id: https://example.org/base\nclasses:\n  Base: {}\n');
    await writeFile(
      root,
      'id: https://example.org/root\nimports: [base.yaml]\nclasses:\n  Root: {}\n',
    );
    const first = await compileSchema(root);
    await writeFile(base, 'id: https://example.org/base\nclasses:\n  Changed: {}\n');
    const second = await compileSchema(root);
    expect(first.ok && second.ok && first.value.hash).not.toBe(second.ok && second.value.hash);
    await writeFile(base, 'id: https://example.org/renamed-base\nclasses:\n  Changed: {}\n');
    const renamed = await compileSchema(root);
    expect(renamed.ok && renamed.value.hash).not.toBe(second.ok && second.value.hash);
  });
  it('confines local imports to an optional allowed root before reading them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-import-root-'));
    const nested = join(root, 'nested');
    const entrypoint = join(nested, 'entry.yaml');
    await mkdir(nested);
    await writeFile(join(root, 'outside.yaml'), 'id: https://example.org/outside\nclasses: {}\n');
    await writeFile(
      entrypoint,
      'id: https://example.org/entry\nimports: [../outside.yaml]\nclasses: {}\n',
    );
    const confined = await compileSchema(entrypoint, { allowedRoot: nested });
    expect(confined.ok ? '' : confined.diagnostics[0]?.code).toBe('IMPORT_OUTSIDE_ALLOWED_ROOT');
  });
  it('rejects malformed shapes and extra slot range expressions', async () => {
    const malformed = await compileSchema(
      'test/fixtures/profile-v1/invalid-malformed-required.yaml',
    );
    const extra = await compileSchema('test/fixtures/profile-v1/invalid-extra-slots-range.yaml');
    expect(malformed.ok ? '' : malformed.diagnostics[0]?.category).toBe('parse');
    expect(extra.ok ? '' : extra.diagnostics[0]?.code).toBe('UNSUPPORTED_OPERATIONAL');
    const nested = await compileSchema('test/fixtures/profile-v1/invalid-malformed-attribute.yaml');
    expect(nested.ok ? '' : nested.diagnostics[0]?.code).toBe('INVALID_FIELD_SHAPE');
  });
  it('rejects multiple designators and preserves custom scalar base', () => {
    const schema: AssertedSchema = {
      types: { Code: { typeof: 'string' } },
      classes: {
        Thing: {
          attributes: {
            a: { range: 'string', designatesType: true },
            b: { range: 'string', designatesType: true },
            code: { range: 'Code' },
          },
        },
      },
      slots: {},
      enums: {},
    };
    expect(() => normalizeSchema(schema)).toThrow(/multiple type-designator/);
    const scalar: AssertedSchema = {
      types: { Code: { typeof: 'string' } },
      classes: { Thing: { attributes: { code: { range: 'Code' } } } },
      slots: {},
      enums: {},
    };
    expect(normalizeSchema(scalar).types.Code?.base).toBe('string');
  });
  it('canonicalizes semantic IDs and computes transitive class depth', () => {
    const schema: AssertedSchema = {
      id: 'https://example.org/model#',
      classes: {
        Root: {},
        Middle: { isA: 'Root' },
        Leaf: { isA: 'Middle' },
      },
      slots: {},
      types: {},
      enums: {},
    };
    const ir = normalizeSchema(schema);
    expect(ir.classes.Leaf?.typeId).toBe('https://example.org/model#Leaf');
    expect(ir.classes.Leaf?.depth).toBe(3);
    schema.id = 'https://example.org/model/';
    expect(normalizeSchema(schema).classes.Leaf?.typeId).toBe('https://example.org/model/Leaf');
  });
  it('does not expose internal inline bookkeeping in the public IR', () => {
    const ir = normalizeSchema({
      classes: { Detail: {}, Record: { slots: ['detail'] } },
      slots: { detail: { range: 'Detail', inlined: true } },
      types: {},
      enums: {},
    });
    const slot = ir.classes.Record?.slots.detail;
    expect(slot).toBeDefined();
    expect(Object.keys(slot ?? {})).not.toContain('__explicitInline');
    expect(JSON.stringify(slot)).not.toContain('__explicitInline');
  });
  it('accepts scalar explore views and rejects invalid Lore annotation values', () => {
    expect(
      normalizeSchema({
        annotations: { 'lore:explore_views': 'overview' },
        classes: {},
        slots: {},
        types: {},
        enums: {},
      }),
    ).toBeDefined();
    expect(() =>
      normalizeSchema({
        annotations: { 'lore:explore_views': ['overview', 'not-a-view'] },
        classes: {},
        slots: {},
        types: {},
        enums: {},
      }),
    ).toThrow(/invalid explore views/);
  });
  it('rejects raw reference and refinement errors before induction', () => {
    expect(() =>
      normalizeSchema({
        classes: { Thing: { slots: ['missing'] } },
        slots: {},
        types: {},
        enums: {},
      }),
    ).toThrow(/unknown top-level slot/);
    expect(() =>
      normalizeSchema({
        classes: { Thing: { slotUsage: { missing: { required: true } } } },
        slots: {},
        types: {},
        enums: {},
      }),
    ).toThrow(/slot_usage missing/);
    expect(() =>
      normalizeSchema({
        classes: { Thing: { mixins: ['Missing'] } },
        slots: {},
        types: {},
        enums: {},
      }),
    ).toThrow(/mixin unknown/);
    expect(() =>
      normalizeSchema({
        classes: { Thing: {} },
        slots: { child: { isA: 'missing' } },
        types: {},
        enums: {},
      }),
    ).toThrow(/parent unknown slot/);
    expect(() =>
      normalizeSchema({
        classes: { A: { isA: 'B' }, B: { isA: 'A' } },
        slots: {},
        types: {},
        enums: {},
      }),
    ).toThrow(/class inheritance cycle/);
    expect(() =>
      normalizeSchema({
        classes: { Thing: { slots: ['a'] } },
        slots: { a: { isA: 'b' }, b: { isA: 'a' } },
        types: {},
        enums: {},
      }),
    ).toThrow(/slot inheritance cycle/);
    expect(() =>
      normalizeSchema({
        classes: {
          Base: { slots: ['value'] },
          Child: { isA: 'Base', slotUsage: { value: { range: 'integer' } } },
        },
        slots: { value: { range: 'string' } },
        types: {},
        enums: {},
      }),
    ).toThrow(/incompatible range refinements/);
  });
});

it('shares effective ancestry across mixins, diamonds and cyclic runtime input', async () => {
  const { isRuntimeSubclass } = await import('./index.js');
  const schema = normalizeSchema({
    slots: {},
    types: {},
    enums: {},
    classes: {
      Base: {},
      Trait: { mixin: true },
      Left: { isA: 'Base', mixins: ['Trait'] },
      Right: { isA: 'Base' },
      Leaf: { isA: 'Left', mixins: ['Right'] },
      Unrelated: {},
    },
  });
  expect(isRuntimeSubclass(schema, 'Leaf', 'Trait')).toBe(true);
  expect(isRuntimeSubclass(schema, 'Leaf', 'Base')).toBe(true);
  expect(isRuntimeSubclass(schema, 'Base', 'Leaf')).toBe(false);
  expect(isRuntimeSubclass(schema, 'Leaf', 'Unrelated')).toBe(false);
  schema.classes.Base!.parent = 'Leaf';
  expect(isRuntimeSubclass(schema, 'Leaf', 'Unrelated')).toBe(false);
  expect(isRuntimeSubclass(schema, 'Leaf', 'Trait')).toBe(true);
});
