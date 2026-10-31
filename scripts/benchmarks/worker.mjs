import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [dist, indexPath, evidence, hub, repeatCount = '20'] = process.argv.slice(2);
const repeats = Number(repeatCount);
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('Invalid repeat count');
const { openSqliteWorkspace } = await import(pathToFileURL(join(dist, 'index.js')));
const rss = process.memoryUsage().rss;
let start = performance.now();
const workspace = await openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } });
const result = { openMs: performance.now() - start, openRssDelta: process.memoryUsage().rss - rss };
try {
  start = performance.now();
  await workspace.entities.get(evidence);
  result.firstGetMs = performance.now() - start;
  start = performance.now();
  await workspace.graph.neighborhood([hub], { depth: 1, maxNodes: 20, maxEdges: 50 });
  result.firstGraphMs = performance.now() - start;
  result.afterFirstReadsRss = process.memoryUsage().rss;
  for (let i = 0; i < repeats; i++) {
    await workspace.entities.get(evidence);
    await workspace.graph.neighborhood([hub], { depth: 1, maxNodes: 20, maxEdges: 50 });
    if ([20, 50, 100, 200].includes(i + 1)) {
      const memory = process.memoryUsage();
      result[`rssAfter${i + 1}`] = memory.rss;
      result[`heapUsedAfter${i + 1}`] = memory.heapUsed;
    }
  }
  result.afterRepeatedReadsRss = process.memoryUsage().rss;
  result.readerPeakRssKiB = process.resourceUsage().maxRSS;
} finally {
  await workspace.close();
}
console.log(JSON.stringify(result));
