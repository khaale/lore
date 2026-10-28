import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { compileSchema } from '@khaale/lore-schema';
import { buildGraph, type Candidate } from './index.js';

const source = `id: https://example.org/union
name: union
classes:
  Entity:
    attributes:
      id: {range: string, identifier: true}
      kind: {range: string, designates_type: true}
      provenance:
        required: true
        inlined: true
        any_of:
          - range: Origin
          - range: Provenance
      items:
        multivalued: true
        inlined: true
        any_of:
          - range: Origin
          - range: Provenance
      fixed:
        range: string
        inlined: true
        any_of:
          - range: Origin
          - range: Provenance
  Provenance:
    attributes:
      generator: {range: string, required: true, pattern: '^.+$'}
enums:
  Origin:
    permissible_values:
      curated:
      generated:
`;
const candidate = (id: string, values: Record<string, unknown>): Candidate => ({
  source: `/source/${id}.yaml`,
  physicalPath: `/source/${id}.yaml`,
  data: { id, kind: 'Entity', ...values },
  spans: {},
  links: [],
  sections: [],
});

describe('generic union validation', () => {
  it('accepts only matching scalar and recursively valid record branches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lore-union-'));
    try {
      const path = join(dir, 'schema.yaml');
      await writeFile(path, source);
      const result = await compileSchema(path);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const diagnostics = (values: Record<string, unknown>) =>
        buildGraph([candidate('a', values)], { root: '/source', compiled: result.value }).index
          .diagnostics ?? [];
      expect(diagnostics({ provenance: 'curated' }).filter((x) => x.severity === 'error')).toEqual(
        [],
      );
      expect(
        diagnostics({
          provenance: { generator: 'cli' },
          items: ['curated', { generator: 'tool' }],
        }).filter((x) => x.severity === 'error'),
      ).toEqual([]);
      expect(
        diagnostics({ provenance: 'unknown' }).some((x) => x.code === 'BOOLEAN_CONSTRAINT'),
      ).toBe(true);
      expect(
        diagnostics({ provenance: { generator: '' } }).some((x) => x.severity === 'error'),
      ).toBe(true);
      expect(
        diagnostics({ provenance: { generator: 'ok', unexpected: true } }).some(
          (x) => x.severity === 'error',
        ),
      ).toBe(true);
      expect(diagnostics({ provenance: '' }).some((x) => x.code === 'REQUIRED')).toBe(true);
      expect(
        diagnostics({ provenance: 'curated', items: ['curated', 'unknown'] }).some(
          (x) => x.code === 'BOOLEAN_CONSTRAINT',
        ),
      ).toBe(true);
      expect(
        diagnostics({ provenance: 'curated', fixed: { generator: 'cli' } }).some(
          (x) => x.code === 'RANGE',
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
