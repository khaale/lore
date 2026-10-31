import { mkdir, readFile, writeFile, rm, cp, statfs, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateCorpus } from './generate.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [directory, selectedDist = 'dist', sampleCount = '10'] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node scale.mjs NEW_RESULTS_DIRECTORY [DIST] [SAMPLES]');
const output = resolve(directory);
await mkdir(output, { recursive: false });
const workspace = join(output, '.workspace');
await mkdir(workspace);
const profile = JSON.parse(await readFile(new URL('./sa-profile.json', import.meta.url), 'utf8'));
const results = [];
async function layout(root) {
  let files = 0,
    directories = 0,
    bytes = 0;
  async function walk(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const p = join(path, item.name);
      if (item.isDirectory()) {
        directories++;
        await walk(p);
      } else {
        files++;
        bytes += (await stat(p)).size;
      }
    }
  }
  await walk(root);
  return { files, directories, bytes };
}
try {
  const dist = join(workspace, 'dist');
  await cp(resolve(selectedDist), dist, { recursive: true });
  for (const [label, copies, fraction] of [
    ['025', 1, 0.25],
    ['050', 1, 0.5],
    ['100', 1, 1],
    ['200', 2, 1],
  ]) {
    const free = await statfs(output);
    if (free.bavail * free.bsize < 1024 ** 3)
      throw new Error('Less than 1 GiB free; refusing the next scale');
    const root = join(workspace, 'data'),
      measurement = join(workspace, 'measurement');
    process.stderr.write(`Scale ${label}: generate, measure, then remove data/index\n`);
    try {
      const manifest = await generateCorpus({
        output: root,
        seed: 'sa-sqlite-v1',
        copies,
        fraction,
        profile,
      });
      const inputLayout = await layout(root);
      // Fresh process per size: RSS high-water marks and JS caches must not
      // carry over from a previous size or from corpus generation.
      await new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL('./run.mjs', import.meta.url)),
            root,
            measurement,
            sampleCount,
            dist,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        child.stderr.pipe(process.stderr);
        child.on('error', reject);
        child.on('exit', (code, signal) =>
          code === 0 ? done() : reject(new Error(`Scale ${label} failed: ${code}/${signal}`)),
        );
      });
      const result = JSON.parse(await readFile(join(measurement, 'results.json'), 'utf8'));
      result.scale = {
        label,
        requestedFactor: copies * fraction,
        method:
          fraction < 1
            ? 'stratified node contraction with same-type endpoint remapping/deduplication'
            : 'independent full-profile copies',
        inputLayout,
        finalMeasurementLayout: await layout(measurement),
      };
      await writeFile(join(output, `${label}.json`), JSON.stringify(result, null, 2) + '\n');
      results.push(result);
      process.stderr.write(
        `Scale ${label}: ${manifest.entities} entities, ${manifest.edges} edges, ${result.storage.databaseBytes} DB bytes\n`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(measurement, { recursive: true, force: true });
    }
  }
  const larger = results.slice(-2),
    before = larger[0],
    after = larger[1];
  const exponent = (a, b) =>
    Math.log(b / a) /
    Math.log(
      (after.fidelity.entities + after.fidelity.canonicalEdges) /
        (before.fidelity.entities + before.fidelity.canonicalEdges),
    );
  const summary = {
    scope:
      'Four local measurements, not a mathematical complexity proof. 1x/2x preserve local degree distributions; smaller graphs use contraction.',
    runs: results.map((r) => ({
      factor: r.scale.requestedFactor,
      entities: r.fidelity.entities,
      edges: r.fidelity.canonicalEdges,
      inputFiles: r.corpus.sourceFiles,
      inputDirectories: r.scale.inputLayout.directories,
      inputBytes: r.corpus.sourceBytes,
      databaseBytes: r.storage.databaseBytes,
      buildMs: r.initialBuildMs,
      changedRefreshMs: r.changedRefreshMs,
      buildPeakRssKiB: r.buildMemory.peakRssKiB,
      isolatedReaderPeakRssKiB: r.freshProcess.readerPeakRssKiB,
      isolatedReaderAfterFirstReadsRss: r.freshProcess.afterFirstReadsRss,
      isolatedReaderAfterRepeatedReadsRss: r.freshProcess.afterRepeatedReadsRss,
      mixedProcessPeakRssKiB: r.memory.wholeProcessPeakRssKiB,
      operations: Object.fromEntries(
        Object.entries(r.operations).map(([name, value]) => [
          name,
          { medianMs: value.milliseconds.median, p95Ms: value.milliseconds.p95 },
        ]),
      ),
    })),
    localExponents1xTo2x: {
      build: exponent(before.initialBuildMs, after.initialBuildMs),
      changedRefresh: exponent(before.changedRefreshMs, after.changedRefreshMs),
      databaseBytes: exponent(before.storage.databaseBytes, after.storage.databaseBytes),
      noChangeRefresh: exponent(
        before.operations.refreshUnchanged.milliseconds.median,
        after.operations.refreshUnchanged.milliseconds.median,
      ),
      indexedGet: exponent(
        before.operations.getEvidence.milliseconds.median,
        after.operations.getEvidence.milliseconds.median,
      ),
      graphHub: exponent(
        before.operations.graphHub.milliseconds.median,
        after.operations.graphHub.milliseconds.median,
      ),
    },
  };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
