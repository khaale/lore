import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { compileSchema } from '@khaale/lore-schema';
import { buildGraph, type Candidate } from './index.js';

const schema = `id: https://example.org/union-reference
name: union-reference
classes:
  Entity:
    attributes:
      id: {range: string, identifier: true}
      kind: {range: string, designates_type: true}
      authors:
        range: Person
        required: true
        multivalued: true
        any_of:
          - range: Person
          - range: NonEmptyString
      owner: {range: Person, required: true}
  Person:
    attributes:
      id: {range: string, identifier: true}
      kind: {range: string, designates_type: true}
types:
  NonEmptyString:
    typeof: string
    pattern: '^.+$'
`;
const candidate = (id: string, kind: string, data: Record<string, unknown> = {}): Candidate => ({
  source: `/source/${id}.yaml`,
  physicalPath: `/source/${id}.yaml`,
  data: { id, kind, ...data },
  spans: {},
  links: [],
  sections: [],
});

describe('reference and scalar unions', () => {
  it('retains bare literals, resolves explicit links and keeps strict ordinary references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lore-union-reference-'));
    try {
      const path = join(dir, 'schema.yaml');
      await writeFile(path, schema);
      const compiled = await compileSchema(path);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const person = candidate('person_1', 'Person');
      const graph = (authors: string[], owner = 'person_1') =>
        buildGraph([candidate('document', 'Entity', { authors, owner }), person], {
          root: '/source',
          compiled: compiled.value,
        }).index;
      const mixed = graph(['[[person_1]]', 'person_1', 'Author literal']);
      expect(mixed.diagnostics?.filter((d) => d.severity === 'error') ?? []).toEqual([]);
      expect(mixed.artifacts.document?.data.authors).toEqual([
        '[[person_1]]',
        'person_1',
        'Author literal',
      ]);
      expect(
        (mixed.edges ?? []).filter((edge) => edge.relation === 'authors').map((edge) => edge.to),
      ).toEqual(['person_1']);
      expect(
        (graph(['[[unknown]]']).diagnostics ?? []).some(
          (d) => d.code === 'BROKEN_REFERENCE' && d.slot === 'authors',
        ),
      ).toBe(true);
      expect(
        (graph(['Author literal'], 'missing').diagnostics ?? []).some(
          (d) => d.code === 'BROKEN_REFERENCE' && d.slot === 'owner',
        ),
      ).toBe(true);
      expect(
        (graph(['Author literal'], '').diagnostics ?? []).some(
          (d) => d.code === 'REQUIRED' && d.slot === 'owner',
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
