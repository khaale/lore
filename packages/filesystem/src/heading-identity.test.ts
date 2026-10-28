import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '@khaale/lore-core';
import { parseFile } from './index.js';
import type { RuntimeSchemaIR, RuntimeSlot } from '@khaale/lore-schema';

const slot = (name: string, extra: Partial<RuntimeSlot> = {}): RuntimeSlot => ({
  name,
  range: name === 'depends' ? 'Thing' : 'string',
  required: name === 'id' || name === 'kind',
  recommended: false,
  multivalued: name === 'depends',
  identifier: name === 'id',
  key: false,
  mode: name === 'depends' ? 'reference' : 'scalar',
  designatesType: name === 'kind',
  patterns: [],
  anyOf: [],
  allOf: [],
  noneOf: [],
  exactlyOneOf: [],
  annotations: {},
  ...extra,
});
const schema: RuntimeSchemaIR = {
  name: 'heading-identity',
  headingIdentity: [
    { name: 'numbered', levels: [2], pattern: '^(?<id>A-[0-9]+)\\. (?<title>.+)$' },
  ],
  classes: {
    Thing: {
      name: 'Thing',
      typeId: 'Thing',
      mixins: [],
      abstract: false,
      mixin: false,
      slots: {
        id: slot('id'),
        kind: slot('kind'),
        title: slot('title'),
        status: slot('status'),
        depends: slot('depends', { annotations: { 'lore:markdown_selectors': ['### Depends'] } }),
      },
      classificationRules: [],
      uniqueKeys: {},
      allowExtra: false,
      depth: 1,
      designatorSlot: 'kind',
      annotations: {},
    },
  },
  types: {},
  enums: {},
  designators: {},
};
const compiled = {
  hash: 'heading-identity-schema',
  schema: { classes: {}, slots: { depends: { range: 'Thing' } }, types: {}, enums: {} },
  ir: schema,
  dependencies: [],
} as any;

describe('heading identity enrichment', () => {
  it('materializes compact declarations and preserves heading provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-heading-identity-'));
    const document = join(root, 'doc.md');
    await writeFile(
      document,
      `---\nlore:\n  sections:\n    A-02: {kind: Thing, status: working}\n---\n# Document\n\n## A-02. Platform support\n\n### Depends\n\n[[A-02]]\n\n## Next\n\nNarrative.\n`,
    );
    const [candidate] = await parseFile(document);
    const result = buildGraph([candidate!], { root, compiled, strict: true });
    expect(result.index.diagnostics).toEqual([]);
    expect(Object.keys(result.index.artifacts)).toEqual(['A-02']);
    expect(result.index.artifacts['A-02']?.data).toMatchObject({
      id: 'A-02',
      title: 'Platform support',
    });
    expect(result.index.artifacts['A-02']?.provenance?.properties?.id?.representation).toBe(
      'markdown',
    );
    expect(result.index.artifacts['A-02']?.body).not.toContain('### Depends');
  });

  it('rejects overlapping rules for a targeted heading with a span', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-heading-identity-ambiguous-'));
    const document = join(root, 'doc.md');
    await writeFile(
      document,
      `---\nlore:\n  sections:\n    A-02: {kind: Thing}\n---\n## A-02. Platform support\n`,
    );
    const [candidate] = await parseFile(document);
    const overlapping = {
      ...schema,
      headingIdentity: [
        ...schema.headingIdentity!,
        { name: 'same', levels: [2], pattern: '^(?<id>[A-Z]-[0-9]+)\\. (?<title>.+)$' },
      ],
    };
    const result = buildGraph([candidate!], {
      root,
      compiled: { ...compiled, ir: overlapping },
      strict: true,
    });
    expect(result.index.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BINDING_AMBIGUOUS', span: { line: 6, column: 1 } }),
      ]),
    );
  });

  it('rejects heading_id target combinations before resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-heading-identity-target-mode-'));
    const manifest = join(root, 'enrich.yaml');
    await writeFile(
      manifest,
      `lore_manifest: 1\nbindings:\n  - document: doc.md\n    heading_id: A-02\n    anchor: section\n    id: A-02\n    properties: {status: bad}\n`,
    );
    const [candidate] = await parseFile(manifest);
    expect(candidate?.parseDiagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['BINDING_TARGET_MODE', 'BINDING_SHAPE']),
    );
  });
});
