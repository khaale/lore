import { expect, it } from 'vitest';
import { normalizeSchema, schemaHash, type AssertedSchema } from '@khaale/lore-schema';
import { buildGraph } from '@khaale/lore-core';
import { parseContents } from './index.js';
function schema(extra: Record<string, unknown> = {}): AssertedSchema {
  return {
    slots: {},
    types: {},
    enums: {},
    classes: {
      Thing: {
        attributes: {
          id: { identifier: true },
          kind: { designatesType: true },
          links: {
            range: 'Thing',
            multivalued: true,
            annotations: {
              'lore:markdown_reference_column': { heading: '## Calls', column: 'Target' },
              ...extra,
            },
          },
        },
      },
    },
  };
}
function build(body: string, front = '') {
  const model = schema();
  return buildGraph(
    [
      ...parseContents(
        '/workspace/a.md',
        `---\nid: A\nkind: Thing\n${front}---\n# A\n\n## Calls\n${body}`,
      ),
      ...parseContents(
        '/workspace/targets.yaml',
        '- {id: B, kind: Thing}\n- {id: C, kind: Thing}\n',
      ),
    ],
    {
      root: '/workspace',
      compiled: {
        schema: model,
        ir: normalizeSchema(model),
        hash: schemaHash(model),
        dependencies: [],
      },
      strict: true,
    },
  );
}
const table = '\n| Target | Notes |\n| --- | --- |\n| [[B]] | [[C]] and http/rest |\n| | blank |\n';
it('reads only the selected reference column, keeps prose and cell provenance', () => {
  const result = build(table);
  expect(result.index.diagnostics?.filter((d) => d.severity === 'error')).toEqual([]);
  expect(result.index.artifacts.A?.data.links).toEqual(['B']);
  expect((result.index.edges ?? []).filter((e) => e.relation === 'links').map((e) => e.to)).toEqual(
    ['B'],
  );
  expect(result.index.artifacts.A?.body).toContain('http/rest');
  expect(result.index.artifacts.A?.provenance?.properties?.['links[0]']).toMatchObject({
    representation: 'markdown-table',
    span: { line: 11 },
  });
});
it('distinguishes missing tables, explicit empty tables and malformed data', () => {
  expect(build('\nNot yet documented.\n').index.artifacts.A?.data).not.toHaveProperty('links');
  expect(build('\n| Target | Notes |\n| --- | --- |\n').index.artifacts.A?.data.links).toEqual([]);
  for (const [body, code] of [
    [table + table, 'MARKDOWN_TABLE_AMBIGUOUS'],
    [table.replace('Target', 'Other'), 'MARKDOWN_TABLE_COLUMN'],
    [table.replace('| [[B]] | [[C]] and http/rest |', '| [[B]] | broken'), 'MARKDOWN_TABLE_SHAPE'],
    [table.replace('Target | Notes', 'Target | Target'), 'MARKDOWN_TABLE_SHAPE'],
  ] as const)
    expect(build(body).index.diagnostics?.some((d) => d.code === code)).toBe(true);
  expect(
    build(table, 'links: [C]\n').index.diagnostics?.some(
      (d) => d.code === 'MARKDOWN_FRONTMATTER_CONFLICT',
    ),
  ).toBe(true);
});
it('rejects annotation shape, non-reference slots and competing selectors at compilation', () => {
  for (const value of [
    null,
    { heading: 'Calls', column: 'Target' },
    { heading: '## Calls', column: 'Target', extra: true },
  ]) {
    const s = schema({ 'lore:markdown_reference_column': value });
    expect(() => normalizeSchema(s)).toThrow();
  }
  const scalar = schema();
  scalar.classes.Thing!.attributes!.links!.range = 'string';
  expect(() => normalizeSchema(scalar)).toThrow(/multivalued reference/);
  expect(() => normalizeSchema(schema({ 'lore:markdown_selectors': ['## Calls'] }))).toThrow(
    /without lore:markdown_selectors/,
  );
});

it('claims matching table links when frontmatter already owns the same value', () => {
  const result = build(table, 'links: [B]\n');
  expect(result.index.diagnostics?.filter((d) => d.severity === 'error')).toEqual([]);
  expect(
    (result.index.edges ?? []).filter((e) => e.from === 'A' && e.to === 'B').map((e) => e.relation),
  ).toEqual(['links']);
  expect(
    (result.index.edges ?? []).some(
      (e) => e.from === 'A' && e.to === 'C' && e.relation === 'references',
    ),
  ).toBe(true);
  expect(result.index.artifacts.A?.data.links).toEqual(['B']);
  expect(result.index.artifacts.A?.provenance?.properties?.links).toMatchObject({
    representation: 'frontmatter',
  });
});
