import { mkdtemp, writeFile, readFile, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '@khaale/lore-core';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import {
  discover,
  parseContents,
  parseFile,
  publishIndex,
  snapshot,
  PollWatcher,
  readIndex,
} from './index.js';

describe('filesystem projections', () => {
  it('retains Markdown structure and source coordinates across plain text and linked fragments', () => {
    const text = [
      '---',
      'id: sample',
      'meta:',
      '  label: Пример',
      '---',
      '# **Title**',
      '',
      'Plain *emphasis* and `code`.',
      '',
      '## Links',
      '',
      '- **[local](next.md)**',
      '- [[target]]',
      '',
      '<a href="elsewhere.md">',
      '',
      '[inside](inside.md)',
      '',
      '</a>',
      '',
    ].join('\r\n');
    const candidate = parseContents('/workspace/sample.md', text)[0]!;
    expect(candidate.observedTitle).toBe('**Title**');
    expect(candidate.observedDescription).toBe('Plain *emphasis* and `code`.');
    expect(
      candidate.sections.map(({ heading, blocks, lists }) => ({ heading, blocks, lists })),
    ).toEqual([
      { heading: '**Title**', blocks: ['Plain *emphasis* and `code`.'], lists: [] },
      {
        heading: 'Links',
        blocks: ['[inside](inside.md)'],
        lists: [['**[local](next.md)**', '[[target]]']],
      },
    ]);
    expect(candidate.links).toEqual([
      { syntax: 'markdown', target: 'next.md', label: 'local', span: { line: 12, column: 5 } },
      { syntax: 'wiki', target: 'target', span: { line: 13, column: 3 } },
      { syntax: 'markdown', target: 'inside.md', label: 'inside', span: { line: 17, column: 1 } },
    ]);
    expect(candidate.spans['meta.label']).toEqual({ line: 4, column: 10 });
  });

  it.skipIf(process.platform === 'win32')('does not enter ignored directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-ignored-directory-'));
    const ignored = join(root, 'dependencies');
    await mkdir(ignored);
    await writeFile(join(root, 'record.yaml'), 'id: kept');
    const ignorePath = join(root, '.artifactignore');
    await writeFile(ignorePath, 'dependencies/\n');
    await chmod(ignored, 0);
    try {
      expect(await discover({ root, ignorePath })).toEqual([join(root, 'record.yaml')]);
    } finally {
      await chmod(ignored, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses YAML/JSON lists, multi-document YAML, CSV scalars, and Markdown links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-fs-'));
    await writeFile(join(root, 'list.json'), '[{"id":"a"},{"id":"b"}]');
    await writeFile(join(root, 'docs.yaml'), 'id: a\n---\nid: b\n');
    await writeFile(join(root, 'rows.csv'), 'id,count,enabled\na,2,true\n');
    await writeFile(
      join(root, 'page.md'),
      '# Title\n\n[[a]] [local](other.md) [web](https://example.org)\n```\n[[ignored]]\n```\n',
    );
    expect((await parseFile(join(root, 'list.json'))).map((x) => x.source)).toEqual([
      join(root, 'list.json') + '#1',
      join(root, 'list.json') + '#2',
    ]);
    expect((await parseFile(join(root, 'docs.yaml'))).map((x) => x.source)).toEqual([
      join(root, 'docs.yaml') + '#doc=1',
      join(root, 'docs.yaml') + '#doc=2',
    ]);
    expect((await parseFile(join(root, 'rows.csv')))[0]?.data).toMatchObject({
      count: 2,
      enabled: true,
    });
    expect((await parseFile(join(root, 'page.md')))[0]?.links.map((x) => x.target)).toEqual([
      'a',
      'other.md',
    ]);
  });
  it('materializes a table as one declared scalar paragraph and rejects multiple paragraphs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-table-summary-'));
    const schemaPath = join(root, '.lore.yaml');
    await writeFile(
      schemaPath,
      `name: table-summary
classes:
  Report:
    slots: [id, kind, acceptance_summary]
slots:
  id: {range: string, identifier: true}
  kind: {range: string, designates_type: true}
  acceptance_summary:
    range: string
    required: true
    annotations:
      lore:markdown_selectors: ['## Проверка по AcceptanceExample']
`,
    );
    const schema = await compileSchemaOrThrow(schemaPath);
    const source = join(root, 'report.md');
    await writeFile(
      source,
      `---
id: report
kind: Report
---
# Report

## Проверка по AcceptanceExample

| AcceptanceExample | Status | What was checked |
| --- | --- | --- |
| AC-READ | PASS | Read saved files |

## Свидетельства

Read command completed.
`,
    );
    const parsed = (await parseFile(source))[0];
    expect(parsed).toBeDefined();
    if (!parsed) return;
    const acceptanceSection = parsed.sections.find(
      (section) => section.heading === 'Проверка по AcceptanceExample',
    );
    expect(acceptanceSection?.blocks).toHaveLength(1);
    expect(acceptanceSection?.lists).toEqual([]);
    const acceptanceSummary = acceptanceSection?.blocks[0];
    expect(acceptanceSummary).toContain('AC-READ');
    expect(acceptanceSummary).toContain('Read saved files');
    const valid = buildGraph([parsed], { root: process.cwd(), compiled: schema });
    const artifact = valid.index.artifacts[parsed.data.id as string];
    expect(artifact?.body).toContain('| AcceptanceExample | Status | What was checked |');
    expect(artifact?.data.acceptance_summary).toBe(acceptanceSummary);
    expect(
      valid.index.diagnostics?.filter((diagnostic) => diagnostic.slot === 'acceptance_summary'),
    ).toEqual([]);

    const sourceText = await readFile(source, 'utf8');
    const sectionStart = sourceText.indexOf('\n## Проверка по AcceptanceExample');
    const nextSection = sourceText.indexOf('\n## Свидетельства', sectionStart);
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(nextSection).toBeGreaterThan(sectionStart);
    const negativeText =
      sourceText.slice(0, sectionStart) +
      '\n## Проверка по AcceptanceExample\n\nFirst paragraph.\n\nSecond paragraph.\n' +
      sourceText.slice(nextSection);
    const negativeCandidate = parseContents(source, negativeText)[0];
    expect(
      negativeCandidate?.sections.find((section) => section.heading === acceptanceSection?.heading)
        ?.blocks,
    ).toEqual(['First paragraph.', 'Second paragraph.']);
    if (!negativeCandidate) return;
    const invalid = buildGraph([negativeCandidate], { root: process.cwd(), compiled: schema });
    expect(
      invalid.index.diagnostics
        ?.filter((diagnostic) => diagnostic.slot === 'acceptance_summary')
        .map((diagnostic) => diagnostic.code),
    ).toEqual(['MARKDOWN_SLOT_SHAPE', 'REQUIRED']);
  });
  it('scans deterministically and excludes schema, ignore, index, git, and ignored paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-scan-'));
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, '.artifact-index'), { recursive: true });
    await mkdir(join(root, 'ignored'), { recursive: true });
    await writeFile(join(root, '.lore.yaml'), 'classes: {}');
    await writeFile(join(root, '.artifactignore'), 'ignored/\n');
    await writeFile(join(root, '.artifact-index/index.json'), '{}');
    await writeFile(join(root, 'b.yaml'), 'id: b');
    await writeFile(join(root, 'a.md'), '# a');
    await writeFile(join(root, 'ignored/x.yaml'), 'id: x');
    expect(
      await discover({
        root,
        schemaPath: join(root, '.lore.yaml'),
        ignorePath: join(root, '.artifactignore'),
        outputPath: join(root, '.artifact-index/index.json'),
      }),
    ).toEqual([join(root, 'a.md'), join(root, 'b.yaml')]);
  });
  it('applies ordered gitignore negation and anchored rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-ignore-'));
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, '.artifactignore'), '*.yaml\n!keep.yaml\n/nested/\n');
    await writeFile(join(root, 'drop.yaml'), 'id: drop');
    await writeFile(join(root, 'keep.yaml'), 'id: keep');
    await writeFile(join(root, 'nested', 'keep.yaml'), 'id: nested');
    expect(await discover({ root, ignorePath: join(root, '.artifactignore') })).toEqual([
      join(root, 'keep.yaml'),
    ]);
  });
  it('supports escaped comment/negation syntax and rejects malformed patterns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-ignore-shapes-'));
    await writeFile(join(root, 'keep.yaml'), 'id: keep');
    await writeFile(join(root, '!keep.yaml'), 'id: literal');
    await writeFile(join(root, '#note.yaml'), 'id: comment');
    await writeFile(join(root, '.artifactignore'), '# comment\n\\!keep.yaml\n\\#note.yaml\n');
    const paths = await discover({ root, ignorePath: join(root, '.artifactignore') });
    expect(paths).toEqual([join(root, 'keep.yaml')]);
    await writeFile(join(root, '.artifactignore'), '[unterminated\n');
    await expect(discover({ root, ignorePath: join(root, '.artifactignore') })).rejects.toThrow(
      /invalid ignore pattern/,
    );
  });
  it('matches globstar paths with zero or more directory components', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-ignore-globstar-'));
    await mkdir(join(root, 'nested', 'deep'), { recursive: true });
    await writeFile(join(root, 'nested', 'drop.yaml'), 'id: nested');
    await writeFile(join(root, 'nested', 'deep', 'drop.yaml'), 'id: deep');
    await writeFile(join(root, '.artifactignore'), 'nested/**/drop.yaml\n');
    expect(await discover({ root, ignorePath: join(root, '.artifactignore') })).toEqual([]);
  });
  it('serializes and publishes complete JSON atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-publish-'));
    const path = join(root, '.artifact-index/index.json');
    const value = { version: 2, artifacts: {}, edges: [], diagnostics: [] };
    await publishIndex(path, value);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(value);
  });
  it('reports missing and malformed index files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-read-index-'));
    const missing = join(root, 'missing.json');
    await expect(readIndex(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    const malformed = join(root, 'malformed.json');
    await writeFile(malformed, '{\n');
    await expect(readIndex(malformed)).rejects.toBeInstanceOf(SyntaxError);
  });
  it('watches schema/dependency/ignore inputs with a bounded injected clock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lore-watch-'));
    const schema = join(root, '.lore.yaml');
    const dependency = join(root, 'shared.yaml');
    const ignore = join(root, '.artifactignore');
    await writeFile(schema, 'classes: {}');
    await writeFile(dependency, 'classes: {}');
    await writeFile(ignore, 'ignored/\n');
    const stamps = await snapshot({
      root,
      schemaPath: schema,
      ignorePath: ignore,
      dependencies: [dependency],
      outputPath: join(root, '.artifact-index/index.json'),
    });
    expect(stamps.map((x) => x.path)).toEqual([ignore, schema, dependency]);
    let tick = 0;
    let changed = false;
    const controller = new AbortController();
    const watcher = new PollWatcher(1, 0, {
      now: () => tick,
      sleep: async () => {
        tick++;
        if (!changed) {
          changed = true;
          await writeFile(dependency, 'classes: {Changed: {}}');
        }
      },
    });
    let calls = 0;
    await watcher.run(
      { root, schemaPath: schema, ignorePath: ignore, dependencies: [dependency] },
      () => {
        calls++;
        controller.abort();
        return Promise.resolve();
      },
      controller.signal,
    );
    expect(calls).toBe(1);
  });
});
