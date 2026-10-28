import { describe, expect, it } from 'vitest';
import { snapshotFromBuildResult } from './index.js';

describe('semantic snapshots', () => {
  it('rejects a build containing error diagnostics', () => {
    expect(() =>
      snapshotFromBuildResult({
        index: {
          version: 2,
          schema_hash: 'schema-1',
          artifacts: {},
          edges: [],
          diagnostics: [{ severity: 'error', code: 'BAD', message: 'invalid' }],
        },
        schema: { name: 'test', classes: {}, types: {}, enums: {}, designators: {} },
      }),
    ).toThrow(/error diagnostic/);
  });
});
