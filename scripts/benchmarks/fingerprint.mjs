import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// A/B comparison must consume identical input bytes, not just the same seed.
// Exclude manifest and derived state, including their changing timestamps.
export async function corpusFingerprint(root) {
  const digest = createHash('sha256');
  async function walk(directory, prefix = '') {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name === '.artifact-index' || entry.name === '.benchmark.json') continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
      else {
        const bytes = await readFile(join(directory, entry.name));
        digest.update(`${path}\0${bytes.length}:`).update(bytes);
      }
    }
  }
  await walk(root);
  return digest.digest('hex');
}
