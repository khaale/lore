import { describe, expect, it } from 'vitest';
import { normalizeSchema, type AssertedSchema } from './index.js';

const base = (annotation: unknown): AssertedSchema => ({
  annotations: { 'lore:heading_identity': annotation },
  classes: {},
  slots: {},
  types: {},
  enums: {},
});

describe('heading identity profile annotation', () => {
  it('preserves valid rules in Runtime IR', () => {
    const ir = normalizeSchema(
      base([{ name: 'assumptions', levels: [2, 3], pattern: '^(?<id>A-[0-9]+)\\. (?<title>.+)$' }]),
    );
    expect(ir.headingIdentity).toEqual([
      { name: 'assumptions', levels: [2, 3], pattern: '^(?<id>A-[0-9]+)\\. (?<title>.+)$' },
    ]);
  });

  it.each([
    ['invalid regex', [{ name: 'x', levels: [2], pattern: '^(?<id>x)(?<title>' }], /ECMAScript/],
    [
      'unanchored pattern',
      [{ name: 'x', levels: [2], pattern: '(?<id>x) (?<title>.+)' }],
      /fully anchored/,
    ],
    ['missing groups', [{ name: 'x', levels: [2], pattern: '^(x) (.+)$' }], /named id and title/],
    [
      'invalid levels',
      [{ name: 'x', levels: [0, 7], pattern: '^(?<id>x) (?<title>.+)$' }],
      /integers from 1/,
    ],
    [
      'duplicate names',
      [
        { name: 'x', levels: [2], pattern: '^(?<id>x) (?<title>.+)$' },
        { name: 'x', levels: [3], pattern: '^(?<id>y) (?<title>.+)$' },
      ],
      /duplicate heading identity rule name/,
    ],
  ])('rejects %s', (_label, rules, expected) => {
    expect(() => normalizeSchema(base(rules))).toThrow(expected);
  });

  it('rejects the convention on class and slot annotations', () => {
    expect(() =>
      normalizeSchema({
        classes: {
          Thing: {
            annotations: {
              'lore:heading_identity': [
                { name: 'x', levels: [2], pattern: '^(?<id>x) (?<title>.+)$' },
              ],
            },
          },
        },
        slots: {
          title: {
            annotations: {
              'lore:heading_identity': [
                { name: 'x', levels: [2], pattern: '^(?<id>x) (?<title>.+)$' },
              ],
            },
          },
        },
        types: {},
        enums: {},
      }),
    ).toThrow(/schema-level-only/);
  });
});
