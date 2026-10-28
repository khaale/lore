import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildGraph, snapshotFromBuildResult } from '@khaale/lore-core';
import { parseFile } from './index.js';
import type { RuntimeSchemaIR, RuntimeSlot } from '@khaale/lore-schema';

const slot = (name: string, extra: Partial<RuntimeSlot> = {}): RuntimeSlot => ({
  name,
  range: name === 'depends' ? 'Thing' : 'string',
  required: name === 'id' || name === 'kind',
  recommended: false,
  multivalued: false,
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
  name: 'document-enrichment',
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
        name: slot('name'),
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
  hash: 'document-enrichment-schema',
  schema: { classes: {}, slots: { depends: { range: 'Thing' } }, types: {}, enums: {} },
  ir: schema,
  dependencies: [],
} as never;

describe('document enrichment', () => {
  it('assembles anchored sections and manifest properties without duplicate entities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-document-enrichment-'));
    const doc = join(root, 'doc.md');
    const manifest = join(root, 'enrich.yaml');
    await writeFile(
      doc,
      `---\nid: doc\nkind: Thing\nlore:\n  sections:\n    one: {id: one, kind: Thing}\n    two: {id: two, kind: Thing}\n---\n# Document\n\n## One {#one}\n\n### Depends\n\n[[two]]\n\n## Two {#two}\n\n### Depends\n\n[[one]]\n\nNarrative link [elsewhere](elsewhere.md).\n`,
    );
    await writeFile(
      manifest,
      `lore_manifest: 1\nbindings:\n  - document: doc.md\n    anchor: one\n    id: one\n    properties:\n      status: enriched\n`,
    );
    const candidates = [...(await parseFile(doc)), ...(await parseFile(manifest))];
    const result = buildGraph(candidates, { root, compiled, strict: true });
    expect(result.index.diagnostics).toEqual([]);
    expect(Object.keys(result.index.artifacts).sort()).toEqual(['doc', 'one', 'two']);
    expect(result.index.artifacts.one?.data.status).toBe('enriched');
    expect(result.index.edges).toContainEqual(
      expect.objectContaining({ from: 'one', relation: 'depends', to: 'two' }),
    );
    expect(result.index.edges).toContainEqual(
      expect.objectContaining({ from: 'two', relation: 'depends', to: 'one' }),
    );
    const snapshot = snapshotFromBuildResult(result);
    expect(snapshot.entities.one?.provenance.properties?.status?.representation).toBe('manifest');
    expect(snapshot.relations[0]?.provenance?.representation).toBe('markdown');
  });

  it('diagnoses invalid opted-in selectors and manifest shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-document-enrichment-shape-'));
    const doc = join(root, 'doc.md');
    const manifest = join(root, 'enrich.yaml');
    await writeFile(
      doc,
      `---\nid: doc\nkind: Thing\nlore:\n  sections:\n    one: {id: one, kind: Thing}\n---\n# Document\n\n## One {#one}\n`,
    );
    await writeFile(
      manifest,
      `lore_manifest: "1"\nextra: true\nbindings:\n  - document: doc.md\n    anchor: 7\n    id: one\n    properties: {status: active}\n    extra: true\n`,
    );
    const parsed = await parseFile(manifest);
    expect(parsed[0]?.parseDiagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['BINDING_VERSION', 'BINDING_KEY', 'BINDING_ANCHOR']),
    );
  });
});
