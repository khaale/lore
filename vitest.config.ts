import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@khaale/lore-core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@khaale/lore-filesystem': fileURLToPath(
        new URL('./packages/filesystem/src/index.ts', import.meta.url),
      ),
      '@khaale/lore-schema': fileURLToPath(
        new URL('./packages/schema/src/index.ts', import.meta.url),
      ),
      '@khaale/lore-sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 15000,
  },
});
