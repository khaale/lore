import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { compileSchema } from './index.js';

it('compiles and induces list/record/rule constraints while keeping classifier semantics separate', async () => {
  const source = await readFile(resolve('test/fixtures/record-constraints/model.yaml'), 'utf8');
  const dir = await mkdtemp(join(tmpdir(), 'lore-constraints-schema-'));
  try {
    const path = join(dir, 'model.yaml');
    await writeFile(path, source + `\n  # no effect\n`);
    const result = await compileSchema(path);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    expect(result.value.ir.classes.Choice!.recordConstraints?.[0]?.exactlyOneOf).toHaveLength(2);
    expect(result.value.ir.classes.Site!.rules).toHaveLength(2);
    expect(result.value.ir.classes.Owner!.slots.parent?.listElementsUnique).toBe(true);
    expect(result.value.ir.classes.Choice!.classificationRules).toEqual([]);
    for (const [addition, code] of [
      [
        'classes:\n  Bad:\n    attributes:\n      value: {list_elements_unique: true}\n',
        'NORMALIZATION_FAILED',
      ],
      ['classes:\n  Bad:\n    rules: [{preconditions: {}}]\n', 'INVALID_FIELD_SHAPE'],
      [
        'classes:\n  Bad:\n    rules: [{postconditions: {}, elseconditions: {}}]\n',
        'UNSUPPORTED_METASLOT',
      ],
      [
        'classes:\n  Bad:\n    rules: [{postconditions: {slot_conditions: {missing: {value_presence: MAYBE}}}}]\n',
        'INVALID_PRESENCE',
      ],
      [
        'classes:\n  Entity:\n    attributes:\n      id: {identifier: true}\n  Owner:\n    is_a: Entity\n    attributes:\n      nested: {range: Value, inlined: true}\n      nested.scope: {range: Entity}\n  Value:\n    attributes:\n      scope: {range: Entity}\n',
        'NORMALIZATION_FAILED',
      ],
      [
        'classes:\n  Entity:\n    attributes:\n      id: {identifier: true}\n  Owner:\n    is_a: Entity\n    attributes:\n      nested: {range: Value, inlined: true}\n  Value:\n    attributes:\n      scope: {any_of: [{any_of: [{range: Target}]}], inverse: back}\n  Target:\n    is_a: Entity\n    attributes:\n      back: {range: Value}\n',
        'NORMALIZATION_FAILED',
      ],
    ]) {
      await writeFile(path, addition!);
      const invalid = await compileSchema(path);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.diagnostics.some((d) => d.code === code)).toBe(true);
    }
    await writeFile(
      path,
      `classes:\n  Base:\n    attributes:\n      values: {multivalued: true, list_elements_unique: true}\n    rules: [{postconditions: {slot_conditions: {values: {required: true}}}}]\n  Left: {is_a: Base}\n  Right: {is_a: Base}\n  Leaf:\n    is_a: Left\n    mixins: [Right]\n    slot_usage:\n      values: {list_elements_unique: false}\n`,
    );
    const inherited = await compileSchema(path);
    expect(inherited.ok).toBe(true);
    if (inherited.ok) {
      expect(inherited.value.ir.classes.Leaf!.rules).toHaveLength(1);
      expect(inherited.value.ir.classes.Leaf!.slots.values?.listElementsUnique).toBe(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
