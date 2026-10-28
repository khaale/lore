import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, snapshotFromBuildResult } from '@khaale/lore-core';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { parseContents, parseFile } from './index.js';

const schemaText = `
name: table-test
classes:
  Thing:
    slots: [id, kind, title, count, enabled, tags, depends_on, single_dep]
slots:
  id: {range: string, identifier: true}
  kind: {range: string, designates_type: true}
  title: {range: string}
  count: {range: integer}
  enabled: {range: boolean}
  tags: {range: string, multivalued: true}
  depends_on: {range: Thing, multivalued: true}
  single_dep: {range: Thing}
`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lore-markdown-tables-'));
  const schemaPath = join(root, 'schema.yaml');
  await writeFile(schemaPath, schemaText);
  return { root, compiled: await compileSchemaOrThrow(schemaPath) };
}

describe('declared Markdown tables', () => {
  it('scans escaped cells, alignment, empty cells, and ignores fenced examples', () => {
    const candidate = parseContents(
      '/workspace/doc.md',
      `## Flows\n\n| ID | Title |\n| :--- | ---: |\n| A | escaped \\| pipe |\n\n\`\`\`\n| fake | row |\n| --- | --- |\n| X | no |\n\`\`\`\n`,
    )[0]!;
    expect(candidate.tables).toHaveLength(1);
    expect(candidate.tables?.[0]?.headers.map((cell) => cell.value)).toEqual(['ID', 'Title']);
    expect(candidate.tables?.[0]?.rows[0]?.cells.map((cell) => cell.value)).toEqual([
      'A',
      'escaped | pipe',
    ]);
    expect(candidate.tables?.[0]?.rows[0]?.cells[1]?.span.end_column).toBeGreaterThan(1);
  });

  it('rejects a pipe-like row without a trailing delimiter and honors matching fences', () => {
    const malformed = parseContents(
      '/workspace/doc.md',
      `## Flows\n\n| ID | Title |\n| --- | --- |\n| A | missing trailing pipe\n`,
    )[0]!;
    expect(malformed.tables?.[0]).toMatchObject({ valid: false });

    const fenced = parseContents(
      '/workspace/doc.md',
      `~~~markdown\n| ID | Title |\n| --- | --- |\n| inside | ignored |\n\`\`\`\n| still | ignored |\n~~~\n\n| ID | Title |\n| --- | --- |\n| outside | selected |\n`,
    )[0]!;
    expect(fenced.tables).toHaveLength(1);
    expect(fenced.tables?.[0]?.rows[0]?.cells[0]?.value).toBe('outside');
  });

  it('materializes typed rows with stable cell provenance and references', async () => {
    const { root, compiled } = await setup();
    const source = join(root, 'doc.md');
    const text = `---
lore:
  tables:
    flows:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns:
        Title: title
        Count: count
        Enabled: enabled
        Tags: tags
        Depends: depends_on
---
## Flows

| ID | Title | Count | Enabled | Tags | Depends |
| --- | --- | --- | --- | --- | --- |
| A | Alpha | 2 | TRUE | ["one", "two"] | ["B"] |
| B | Beta | 3 | false | [] | [] |
`;
    const candidate = parseContents(source, text)[0]!;
    const result = buildGraph([candidate], { root, compiled });
    expect(result.index.diagnostics).toEqual([]);
    expect(result.index.artifacts.A?.data).toMatchObject({
      id: 'A',
      title: 'Alpha',
      count: 2,
      enabled: true,
      tags: ['one', 'two'],
      depends_on: ['B'],
    });
    expect(result.index.edges).toEqual([
      expect.objectContaining({ from: 'A', relation: 'depends_on', to: 'B', surface: 'B' }),
    ]);
    expect(result.index.artifacts.A?.provenance?.properties?.title?.representation).toBe(
      'markdown-table',
    );
    expect(result.index.artifacts.A?.provenance?.properties?.title?.span?.line).toBe(19);
    const snapshot = snapshotFromBuildResult(result);
    expect(snapshot.entities.A?.provenance.properties?.title?.representation).toBe(
      'markdown-table',
    );
  });

  it('normalizes complete WikiLinks and rejects malformed full-cell syntax', async () => {
    const { root, compiled } = await setup();
    const source = join(root, 'doc.md');
    const text = `---
lore:
  tables:
    flows:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns:
        Single: single_dep
        Many: depends_on
---
## Flows

| ID | Single | Many |
| --- | --- | --- |
| A | [[B#fragment]] | ["[[B]]", "[[C\\|label]]"] |
| B |  | [] |
| C |  | [] |
`;
    const result = buildGraph([parseContents(source, text)[0]!], { root, compiled });
    expect(result.index.diagnostics).toEqual([]);
    expect(result.index.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'A', relation: 'single_dep', to: 'B' }),
        expect.objectContaining({ from: 'A', relation: 'depends_on', to: 'B' }),
        expect.objectContaining({ from: 'A', relation: 'depends_on', to: 'C' }),
      ]),
    );

    const malformed = buildGraph(
      [parseContents(source, text.replace('[[B#fragment]]', '[[B#fragment'))[0]!],
      { root, compiled },
    );
    expect(malformed.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'TABLE_VALUE',
    );
  });

  it('rejects malformed selected tables and preserves ordinary unselected tables', async () => {
    const { root, compiled } = await setup();
    const path = join(root, 'doc.md');
    const candidate = parseContents(
      path,
      `---
lore:
  tables:
    flows:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns: {Title: title}
---
## Other
| ID | Title |
| --- | --- |
| ordinary | text |
## Flows
| ID | Title |
| --- | --- |
| A | one | extra |
`,
    )[0]!;
    const result = buildGraph([candidate], { root, compiled });
    expect(result.index.artifacts).toEqual({});
    expect(result.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'TABLE_SYNTAX',
    );
    expect(candidate.tables).toHaveLength(2);
  });

  it('accepts an equivalent companion declaration with cell provenance', async () => {
    const { root, compiled } = await setup();
    const document = join(root, 'doc.md');
    await writeFile(document, `## Flows\n\n| ID | Title |\n| --- | --- |\n| A | Alpha |\n`);
    const manifest = join(root, 'enrich.yaml');
    await writeFile(
      manifest,
      `lore_manifest: 1\ntables:\n  - document: doc.md\n    name: flows\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`,
    );
    const candidates = [...(await parseFile(document)), ...(await parseFile(manifest))];
    const result = buildGraph(candidates, { root, compiled });
    expect(result.index.diagnostics).toEqual([]);
    expect(result.index.artifacts.A?.data.title).toBe('Alpha');
    expect(result.index.artifacts.A?.provenance?.properties?.title?.representation).toBe(
      'markdown-table',
    );
    expect(result.index.artifacts.A?.provenance?.properties?.kind).toMatchObject({
      source: manifest,
      physicalPath: manifest,
      representation: 'markdown-table',
    });
  });

  it('keeps companion declaration diagnostics and Markdown cell provenance on their own files', async () => {
    const { root, compiled } = await setup();
    const document = join(root, 'doc.md');
    await writeFile(document, `## Flows\n\n| ID | Title |\n| --- | --- |\n| A | Alpha\n`);
    const manifest = join(root, 'enrich.yaml');
    await writeFile(
      manifest,
      `lore_manifest: 1\ntables:\n  - document: doc.md\n    name: flows\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`,
    );
    const candidates = [...(await parseFile(document)), ...(await parseFile(manifest))];
    const result = buildGraph(candidates, { root, compiled });
    const syntax = result.index.diagnostics?.find(
      (diagnostic) => diagnostic.code === 'TABLE_SYNTAX',
    );
    expect(syntax).toMatchObject({ source: document });
    expect(syntax?.span?.line).toBe(3);
    expect(syntax?.source).not.toBe(manifest);
  });

  it('attributes companion scope and table-selection diagnostics to the Markdown document', async () => {
    const { root, compiled } = await setup();
    const document = join(root, 'doc.md');
    const manifest = join(root, 'enrich.yaml');
    const declaration = `lore_manifest: 1\ntables:\n  - document: doc.md\n    name: flows\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`;
    await writeFile(manifest, declaration);

    await writeFile(document, '## Flows\n\n## Flows\n');
    const ambiguous = buildGraph([...(await parseFile(document)), ...(await parseFile(manifest))], {
      root,
      compiled,
    });
    const scope = ambiguous.index.diagnostics?.find(
      (diagnostic) => diagnostic.code === 'TABLE_SCOPE_AMBIGUOUS',
    );
    expect(scope).toMatchObject({ source: document, span: { line: 1 } });
    expect(scope?.source).not.toBe(manifest);

    await writeFile(document, '## Flows\n\nNo table here.\n');
    const missing = buildGraph([...(await parseFile(document)), ...(await parseFile(manifest))], {
      root,
      compiled,
    });
    const table = missing.index.diagnostics?.find(
      (diagnostic) => diagnostic.code === 'TABLE_MISSING',
    );
    expect(table).toMatchObject({ source: document, span: { line: 1 } });
    expect(table?.source).not.toBe(manifest);
  });

  it('permits duplicate unmapped headers while mapping decoded headers exactly', async () => {
    const { root, compiled } = await setup();
    const source = join(root, 'doc.md');
    const candidate = parseContents(
      source,
      `---
lore:
  tables:
    flows:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns: {Title: title}
---
## Flows

| ID | Title | Notes | Notes |
| --- | --- | --- | --- |
| A | Alpha | left | right |
`,
    )[0]!;
    const result = buildGraph([candidate], { root, compiled });
    expect(result.index.diagnostics).toEqual([]);
    expect(result.index.artifacts.A?.data.title).toBe('Alpha');
  });

  it('locates missing scopes, outside-root companions, and overlapping declarations', async () => {
    const { root, compiled } = await setup();
    const document = join(root, 'doc.md');
    const text = `---
lore:
  tables:
    flows:
      scope: "## Missing"
      class: Thing
      id_column: ID
      columns: {Title: title}
---
## Flows
| ID | Title |
| --- | --- |
| A | Alpha |
`;
    const missing = buildGraph([parseContents(document, text)[0]!], { root, compiled });
    expect(missing.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'TABLE_SCOPE_MISSING',
    );
    const manifest = join(root, 'outside.yaml');
    const manifestCandidate = parseContents(
      manifest,
      `lore_manifest: 1\ntables:\n  - document: ../outside.md\n    name: flows\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`,
    )[0]!;
    const outside = buildGraph([manifestCandidate, parseContents(document, text)[0]!], {
      root,
      compiled,
    });
    expect(outside.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain('TABLE_PATH');
    const validDocument = parseContents(document, text.replace('## Missing', '## Flows'))[0]!;
    const overlapManifest = parseContents(
      join(root, 'overlap.yaml'),
      `lore_manifest: 1\ntables:\n  - document: doc.md\n    name: companion\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`,
    )[0]!;
    const overlap = buildGraph([validDocument, overlapManifest], { root, compiled });
    expect(overlap.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'TABLE_OVERLAP',
    );
    expect(overlap.index.artifacts).toEqual({});
  });

  it('does not expand declarations with shape errors or duplicate names', async () => {
    const { root, compiled } = await setup();
    const document = join(root, 'doc.md');
    const text = `---
lore:
  tables:
    bad-name!:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns: {Title: title}
    flows:
      scope: "## Flows"
      class: Thing
      id_column: ID
      columns: {Title: title}
---
## Flows

| ID | Title |
| --- | --- |
| A | Alpha |
`;
    const invalidText = text.replace(
      `    flows:\n      scope: "## Flows"\n      class: Thing\n      id_column: ID\n      columns: {Title: title}\n`,
      '',
    );
    const invalid = buildGraph([parseContents(document, invalidText)[0]!], { root, compiled });
    expect(invalid.index.artifacts).toEqual({});
    expect(invalid.index.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['TABLE_NAME']),
    );

    const duplicateManifest = parseContents(
      join(root, 'manifest.yaml'),
      `lore_manifest: 1\ntables:\n  - document: doc.md\n    name: flows\n    scope: "## Flows"\n    class: Thing\n    id_column: ID\n    columns: {Title: title}\n`,
    )[0]!;
    const validText = text.replace(
      `    bad-name!:\n      scope: "## Flows"\n      class: Thing\n      id_column: ID\n      columns: {Title: title}\n`,
      '',
    );
    const duplicate = buildGraph([parseContents(document, validText)[0]!, duplicateManifest], {
      root,
      compiled,
    });
    expect(duplicate.index.artifacts).toEqual({});
    expect(duplicate.index.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      'TABLE_DUPLICATE_NAME',
    );
  });
});
