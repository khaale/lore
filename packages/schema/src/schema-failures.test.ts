import { compileSchema } from './index.js';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('invalid workspace schemas', () => {
  it('rejects malformed nested slot shapes', async () => {
    const result = await compileSchema(
      join(process.cwd(), 'test/fixtures/workspaces/malformed/.lore.yaml'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'INVALID_FIELD_SHAPE')).toBe(true);
    }
  });
  it('rejects conflicting prefixes before indexing', async () => {
    const result = await compileSchema(
      join(process.cwd(), 'test/fixtures/workspaces/invalid-prefix/.lore.yaml'),
    );
    expect(result.ok).toBe(false);
  });
});
