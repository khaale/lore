// Repository-internal technical acceptance, not a public SDK example.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { GraphAnalysisCache } from '../../packages/graph/dist/index.js';
import {
  jsonAnalysisInput,
  sqliteAnalysisInput,
} from '../../packages/sdk/dist/graph-analysis-source.js';
import { projectionSource } from '../../packages/sdk/dist/reader.js';
const [mode, path, output] = process.argv.slice(2);
if (!['json', 'sqlite'].includes(mode) || !output)
  throw new Error('Usage: analyze.mjs json|sqlite INPUT OUTPUT.json');
const before = process.memoryUsage(),
  start = performance.now();
let db,
  alive = true;
const check = () => {
  if (!alive) throw new Error('Research source is closed');
};
let input;
if (mode === 'sqlite') {
  db = new DatabaseSync(path, { readOnly: true });
  db.exec('BEGIN');
  input = sqliteAnalysisInput(db, check);
} else {
  const { schema, index } = JSON.parse(await readFile(path, 'utf8'));
  input = jsonAnalysisInput(projectionSource(index, schema), check);
}
const report = {
  mode,
  node: process.version,
  before,
  metadataAndSourceMs: performance.now() - start,
  sourceGeneration: typeof input.generation === 'string' ? input.generation : 'loaded-json-source',
  steps: [],
  policy:
    'private technical layer, caller-owned read-only pinned source, no forced GC; no public graph export implied',
};
const cache = new GraphAnalysisCache();
try {
  let start = performance.now();
  await cache.read(input, {}, async (read) => {
    report.topologyMs = performance.now() - start;
    report.statsBefore = read.stats;
    report.afterTopology = process.memoryUsage();
    for (const balance of ['none', 'type']) {
      start = performance.now();
      const rank = await read.rank({ balance });
      const rankingMs = performance.now() - start;
      start = performance.now();
      const communities = await read.communities({ balance });
      const communitiesMs = performance.now() - start;
      start = performance.now();
      await read.rank({ balance });
      const rankWarmMs = performance.now() - start;
      start = performance.now();
      await read.communities({ balance });
      const communitiesWarmMs = performance.now() - start;
      assert.ok(rank.items.every((n) => Number.isFinite(n.score)));
      const serialized = JSON.stringify({ rank, communities });
      report.steps.push({
        balance,
        rankingMs,
        communitiesMs,
        rankWarmMs,
        communitiesWarmMs,
        serializedBytes: Buffer.byteLength(serialized),
        rank,
        communities,
      });
    }
    report.statsAfter = read.stats;
  });
  report.afterAnalysis = process.memoryUsage();
  // Alternate scopes to exercise the one-entry cache, not an unbounded per-filter map.
  const types = [
    'Container',
    'ExternalContainer',
    'Subsystem',
    'System',
    'Component',
    'Api',
    'Database',
    'Repository',
  ].filter((name) => input.schema.classes[name]);
  report.alternatingRss = [];
  report.alternatingStats = [];
  for (let i = 0; i < 6; i++) {
    await cache.read(input, i % 2 ? { types } : {}, async (read) => {
      await read.rank({ balance: 'type' });
      await read.communities({ balance: 'type' });
      report.alternatingStats.push(read.stats);
    });
    report.alternatingRss.push(process.memoryUsage().rss);
  }
} finally {
  await cache.close();
  alive = false;
  db?.close();
}
report.afterClose = process.memoryUsage();
report.peakRssKiB = process.resourceUsage().maxRSS;
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
