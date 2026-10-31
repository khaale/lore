import { chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });

const bundled = await build({
  absWorkingDir: root,
  entryPoints: { cli: 'apps/cli/src/index.ts', index: 'packages/sdk/src/index.ts' },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'bundle',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  legalComments: 'eof',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

for (const output of Object.values(bundled.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (dependency.external && !isBuiltin(dependency.path)) {
      throw new Error(`unbundled runtime dependency: ${dependency.path}`);
    }
  }
}

const declarations = await rollup({
  input: join(root, 'packages/sdk/dist/index.d.ts'),
  external: isBuiltin,
  plugins: [
    dts({
      tsconfig: join(root, 'packages/sdk/tsconfig.json'),
      includeExternal: ['@khaale/lore-core', '@khaale/lore-schema', '@khaale/lore-filesystem'],
    }),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    warn(warning);
  },
});
try {
  await declarations.write({ file: join(dist, 'index.d.ts'), format: 'es' });
} finally {
  await declarations.close();
}
if (/@khaale\/lore-/.test(await readFile(join(dist, 'index.d.ts'), 'utf8'))) {
  throw new Error('public declarations still reference private workspace packages');
}

await chmod(join(dist, 'cli.js'), 0o755);
await mkdir(join(dist, 'licenses'), { recursive: true });
for (const [name, file] of [
  ['yaml', 'LICENSE'],
  ['csv-parse', 'LICENSE'],
  ['ignore', 'LICENSE-MIT'],
  ['marked', 'LICENSE.md'],
]) {
  await copyFile(
    join(root, 'packages/filesystem/node_modules', name, file),
    join(dist, 'licenses', `${name}.txt`),
  );
}
console.log('Built @khaale/lore: CLI, SDK, declarations and dependency licenses');
