import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, checkReport, explore } from '@khaale/lore-core';
import { compileSchema } from '@khaale/lore-schema';
import { discover, parseFile } from './index.js';

type Row = {
  id: string;
  fixture: string;
  workflow: string;
  source?: string;
  path?: string;
  equals?: unknown;
  contains?: unknown;
  matches?: string;
  diagnostic?: string;
};
type Inventory = { constructs: Row[] };
const root = join(process.cwd(), 'test/fixtures/workspaces');
const at = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, part) => {
    const match = /^(.*?)(?:\[(\d+)\])?$/.exec(part);
    if (!match || current === null || current === undefined || typeof current !== 'object')
      return undefined;
    const next = (current as Record<string, unknown>)[match[1]!];
    return match[2] === undefined ? next : Array.isArray(next) ? next[Number(match[2])] : undefined;
  }, value);
const contains = (actual: unknown, expected: unknown): boolean =>
  Array.isArray(actual)
    ? actual.some((item) =>
        typeof expected === 'object' &&
        expected !== null &&
        typeof item === 'object' &&
        item !== null
          ? Object.entries(expected as Record<string, unknown>).every(
              ([k, v]) => (item as Record<string, unknown>)[k] === v,
            )
          : item === expected,
      )
    : false;

describe('filesystem graph fixtures', () => {
  it('validates parsed documents, graphs and exploration results', async () => {
    const inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8')) as Inventory;
    expect(new Set(inventory.constructs.map((row) => row.id)).size).toBe(
      inventory.constructs.length,
    );
    const cache = new Map<
      string,
      { schema: Awaited<ReturnType<typeof compileSchema>>; index?: ReturnType<typeof buildGraph> }
    >();
    for (const row of inventory.constructs) {
      expect(row.fixture).toMatch(/\S/);
      expect(row.workflow).toMatch(/\S/);
      const schemaPath = join(root, row.fixture, '.lore.yaml');
      if (!cache.has(row.fixture)) {
        const schema = await compileSchema(schemaPath);
        const entry: {
          schema: Awaited<ReturnType<typeof compileSchema>>;
          index?: ReturnType<typeof buildGraph>;
        } = { schema };
        if (schema.ok) {
          const files = await discover({
            root: join(root, row.fixture),
            schemaPath,
            ignorePath: join(root, row.fixture, '.artifactignore'),
          });
          const candidates = (await Promise.all(files.map(parseFile))).flat();
          entry.index = buildGraph(candidates, {
            root: join(root, row.fixture),
            compiled: schema.value,
          });
        }
        cache.set(row.fixture, entry);
      }
      const entry = cache.get(row.fixture);
      expect(entry).toBeDefined();
      if (!entry) continue;
      if (row.diagnostic) {
        if (entry.schema.ok)
          expect(entry.index?.index.diagnostics?.map((d) => d.code)).toContain(row.diagnostic);
        else {
          const diagnostics = entry.schema.diagnostics as Array<{ code: string }>;
          const diagnosticCodes = diagnostics.map((d) => d.code);
          expect(diagnosticCodes).toContain(row.diagnostic);
        }
        continue;
      }
      const rowPath = row.path;
      expect(rowPath).toMatch(/\S/);
      if (!rowPath) continue;
      let source: unknown = entry.index?.index;
      if (row.workflow.startsWith('explore:') && entry.index) {
        source = explore(
          entry.index.index,
          row.workflow.slice('explore:'.length),
          row.workflow === 'explore:overview' ? undefined : 'thing-1',
          1,
          entry.index.schema,
        );
      } else if (row.source === 'report' && entry.index) {
        source = checkReport(entry.index.index);
      }
      expect(source).toBeDefined();
      const actual = at(source, rowPath);
      if ('equals' in row) expect(actual).toEqual(row.equals);
      else if ('matches' in row && row.matches !== undefined) {
        expect(actual, row.id).toBeDefined();
        const printable =
          typeof actual === 'string'
            ? actual
            : Array.isArray(actual)
              ? actual
                  .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
                  .join('\n')
              : JSON.stringify(actual);
        expect(printable, row.id).toMatch(new RegExp(row.matches));
      } else expect(contains(actual, row.contains)).toBe(true);
    }
  });
});
