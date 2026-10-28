import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileSchema, type DiagnosticCategory } from './index.js';

const root = join(process.cwd(), 'test/fixtures/profile-v1');
const cases = JSON.parse(await readFile(join(root, 'cases.json'), 'utf8')) as Array<{
  path: string;
  valid: boolean;
  category?: DiagnosticCategory;
}>;

describe('LinkML profile compilation', () => {
  it.each(cases)('$path', async ({ path, valid, category }) => {
    const result = await compileSchema(join(root, path));
    expect(result.ok, JSON.stringify(result)).toBe(valid);
    if (!result.ok && category)
      expect(result.diagnostics.map((diagnostic) => diagnostic.category)).toContain(category);
  });
});
