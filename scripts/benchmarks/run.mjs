import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { verifyCorpus } from './verify.mjs';
import { corpusFingerprint } from './fingerprint.mjs';

const exec = promisify(execFile);
export function summarize(samples) {
  const values = [...samples].sort((a, b) => a - b);
  const at = (p) => values[Math.max(0, Math.ceil(values.length * p) - 1)];
  return {
    n: values.length,
    min: values[0],
    median: at(0.5),
    p95: at(0.95),
    max: values.at(-1),
    samples,
  };
}
async function measure(iterations, work, warmups = 2) {
  for (let i = 0; i < warmups; i++) await work();
  const samples = [],
    bytes = [],
    returned = [];
  let example;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(),
      result = await work();
    samples.push(performance.now() - start);
    bytes.push(Buffer.byteLength(JSON.stringify(result)));
    returned.push(result.items?.length ?? result.edges?.length ?? (result.item ? 1 : undefined));
    example = {
      items: result.items?.length,
      edges: result.edges?.length,
      pages: result.pages,
      narrativeChars: result.item?.narrative?.length,
      outcome: result.outcome,
      coverage: result.coverage,
      groupedItems: result.entities?.items?.length,
      groupedEdges: result.graph?.edges?.length,
    };
  }
  return { milliseconds: summarize(samples), resultBytes: summarize(bytes), returned, example };
}
async function sizeIfPresent(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}
function storage(indexPath) {
  const db = new DatabaseSync(indexPath, { readOnly: true });
  try {
    const objects = db
      .prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")
      .all();
    const pages = db
      .prepare(
        'SELECT name,sum(pgsize) bytes,sum(payload) payloadBytes,sum(unused) unusedBytes FROM dbstat GROUP BY name ORDER BY bytes DESC',
      )
      .all();
    const contentBytes = {};
    for (const object of objects.filter((object) => object.type === 'table')) {
      const table = `"${object.name.replaceAll('"', '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      for (const column of columns.filter((column) =>
        ['entity', 'artifact', 'narrative', 'properties', 'raw_delta', 'provenance'].includes(
          column.name,
        ),
      )) {
        contentBytes[`${object.name}.${column.name}`] = db
          .prepare(`SELECT coalesce(sum(length(CAST("${column.name}" AS BLOB))),0) n FROM ${table}`)
          .get().n;
      }
    }
    return {
      contentBytes,
      sqlite: db.prepare('SELECT sqlite_version() version').get().version,
      pageSize: db.prepare('PRAGMA page_size').get().page_size,
      pages: db.prepare('PRAGMA page_count').get().page_count,
      freePages: db.prepare('PRAGMA freelist_count').get().freelist_count,
      objects: pages.map((row) => ({
        ...row,
        type: objects.find((object) => object.name === row.name)?.type ?? 'internal',
      })),
      rows: Object.fromEntries(
        objects
          .filter((object) => object.type === 'table')
          .map((object) => [
            object.name,
            db.prepare(`SELECT count(*) n FROM "${object.name.replaceAll('"', '""')}"`).get().n,
          ]),
      ),
    };
  } finally {
    db.close();
  }
}

export async function runBenchmark({ root, output, samples = 20, dist = resolve('dist') }) {
  root = resolve(root);
  output = resolve(output);
  dist = resolve(dist);
  if (!Number.isSafeInteger(samples) || samples < 5) throw new Error('Use at least 5 samples');
  try {
    if ((await readdir(output)).length)
      throw new Error('Refusing to overwrite nonempty result directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(output, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, '.benchmark.json'), 'utf8'));
  const profile = JSON.parse(await readFile(new URL('./sa-profile.json', import.meta.url), 'utf8'));
  const { openSqliteWorkspace, refreshSqliteIndex } = await import(
    pathToFileURL(join(dist, 'index.js'))
  );
  const indexPath = join(output, 'index.sqlite');
  const report = {
    version: 1,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      executable: process.execPath,
      platform: platform(),
      os: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      cpuCount: cpus().length,
      totalMemory: totalmem(),
      ci: process.env.CI === 'true',
    },
    build: {
      git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
      sdkSha256: createHash('sha256')
        .update(await readFile(join(dist, 'index.js')))
        .digest('hex'),
      cliSha256: createHash('sha256')
        .update(await readFile(join(dist, 'cli.js')))
        .digest('hex'),
    },
    corpus: {
      ...manifest,
      rootLength: root.length,
      sha256: await corpusFingerprint(root),
      reference: profile.reference,
    },
    policy: {
      freshness: 'indexed unless operation name specifies checking',
      cold: 'fresh process with normal OS cache; no cache flushing',
      warmups: 2,
      samples,
      serialization: 'result byte counting is outside operation timer',
      writes:
        'single changed Markdown document triggers current full rebuild; restore is outside timer',
    },
    operations: {},
  };
  let start = performance.now();
  await exec(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('./memory-probe.mjs', import.meta.url)),
      join(dist, 'cli.js'),
      'index',
      '--format',
      'sqlite',
      '--out',
      indexPath,
      root,
    ],
    {
      env: {
        ...process.env,
        CI: 'true',
        LORE_BENCHMARK_MEMORY_PATH: join(output, 'build-memory.json'),
      },
    },
  );
  report.initialBuildMs = performance.now() - start;
  report.buildMemory = JSON.parse(await readFile(join(output, 'build-memory.json'), 'utf8'));
  process.stderr.write(
    `Built ${manifest.entities} entities in ${Math.round(report.initialBuildMs)} ms\n`,
  );
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const { stdout } = await exec(process.execPath, [
      fileURLToPath(new URL('./worker.mjs', import.meta.url)),
      dist,
      indexPath,
      manifest.samples.evidence,
      manifest.samples.hub,
    ]);
    cold.push({ ...JSON.parse(stdout), processMs: performance.now() - started });
  }
  report.freshProcess = Object.fromEntries(
    Object.keys(cold[0]).map((key) => [key, summarize(cold.map((row) => row[key]))]),
  );
  const workspace = await openSqliteWorkspace({ indexPath, freshness: { mode: 'indexed' } });
  try {
    const batch = (await workspace.query({ limit: 64 })).items.map((entity) => entity.id);
    const tasks = {
      describe: () => workspace.describe(),
      getEvidence: () => workspace.entities.get(manifest.samples.evidence),
      getNarrative: () =>
        workspace.entities.get(manifest.samples.narrative, { include: ['narrative'] }),
      getMany4: () => workspace.entities.getMany(batch.slice(0, 4)),
      getMany64: () => workspace.entities.getMany(batch),
      query20: () => workspace.query({ limit: 20, scanBudget: 100 }),
      queryFiltered: () =>
        workspace.query({ where: { cohort: { eq: 0 } }, limit: 20, scanBudget: 100 }),
      querySparseFirstPage: () =>
        workspace.query({ type: manifest.samples.sparseType, limit: 20, scanBudget: 100 }),
      searchHit: () =>
        workspace.search({ text: 'Synthetic Dependency', limit: 20, scanBudget: 100 }),
      searchMiss: () =>
        workspace.search({ text: 'impossible_search_token_83', limit: 20, scanBudget: 100 }),
      graphEvidence: () =>
        workspace.graph.neighborhood([manifest.samples.evidence], {
          depth: 1,
          maxNodes: 20,
          maxEdges: 50,
        }),
      graphDiscovery: () =>
        workspace.graph.neighborhood([manifest.samples.discovery], {
          depth: 1,
          maxNodes: 20,
          maxEdges: 50,
        }),
      graphHub: () =>
        workspace.graph.neighborhood([manifest.samples.hub], {
          depth: 1,
          maxNodes: 20,
          maxEdges: 50,
        }),
      groupedPreview: () =>
        workspace.readSnapshot(async (read) => ({
          entities: await read.entities.getMany(batch.slice(0, 4)),
          graph: await read.graph.neighbors([manifest.samples.evidence], {
            maxNodes: 20,
            maxEdges: 50,
          }),
        })),
    };
    for (const [name, work] of Object.entries(tasks)) {
      report.operations[name] = await measure(samples, work);
      process.stderr.write(
        `${name}: ${report.operations[name].milliseconds.median.toFixed(2)} ms median\n`,
      );
    }
    report.operations.querySparseComplete = await measure(
      5,
      async () => {
        let continuation,
          items = [],
          pages = 0;
        do {
          const page = await workspace.query({
            type: manifest.samples.sparseType,
            limit: 20,
            scanBudget: 1000,
            continuation,
          });
          items.push(...page.items);
          continuation = page.continuation;
          pages++;
        } while (continuation);
        return { items, pages };
      },
      1,
    );
    report.memory = {
      afterReadWorkloads: process.memoryUsage(),
      readWorkloadsPeakRssKiB: process.resourceUsage().maxRSS,
    };
    report.fidelity = await verifyCorpus(workspace, profile, manifest);
    report.operations.refreshUnchanged = await measure(samples, () =>
      refreshSqliteIndex({ indexPath, maxAgeMs: 0 }),
    );
    const checked = await openSqliteWorkspace({
      indexPath,
      freshness: { mode: 'refresh-on-read', maxAgeMs: 1000 },
    });
    try {
      report.operations.checkedCachedGet = await measure(samples, () =>
        checked.entities.get(manifest.samples.evidence),
      );
    } finally {
      await checked.close();
    }
    const strict = await openSqliteWorkspace({
      indexPath,
      freshness: { mode: 'refresh-on-read', maxAgeMs: 0 },
    });
    try {
      report.operations.checkedEveryReadGet = await measure(samples, () =>
        strict.entities.get(manifest.samples.evidence),
      );
    } finally {
      await strict.close();
    }
    const changedPath = join(root, manifest.samples.changedFile),
      original = await readFile(changedPath, 'utf8');
    try {
      await writeFile(changedPath, original + '\nSynthetic changed narrative for update timing.\n');
      start = performance.now();
      const update = await refreshSqliteIndex({ indexPath });
      report.changedRefreshMs = performance.now() - start;
      assert.equal(update.outcome, 'updated');
    } finally {
      await writeFile(changedPath, original);
      await refreshSqliteIndex({ indexPath });
    }
    report.memory.afterValidationAndUpdate = process.memoryUsage();
    report.memory.wholeProcessPeakRssKiB = process.resourceUsage().maxRSS;
  } finally {
    await workspace.close();
  }
  report.storage = storage(indexPath);
  assert.equal(
    await corpusFingerprint(root),
    report.corpus.sha256,
    'Benchmark did not restore the original corpus',
  );
  report.storage.databaseBytes = await sizeIfPresent(indexPath);
  report.storage.walBytes = await sizeIfPresent(indexPath + '-wal');
  report.storage.shmBytes = await sizeIfPresent(indexPath + '-shm');
  report.storage.inputToDatabaseRatio = report.storage.databaseBytes / manifest.sourceBytes;
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, output, samples = '20', dist = resolve('dist')] = process.argv.slice(2);
  if (!root || !output)
    throw new Error('Usage: node run.mjs CORPUS RESULT_DIRECTORY [SAMPLES] [DIST]');
  const report = await runBenchmark({ root, output, samples: Number(samples), dist });
  console.log(
    JSON.stringify({
      entities: report.fidelity.entities,
      edges: report.fidelity.canonicalEdges,
      buildMs: report.initialBuildMs,
      changedRefreshMs: report.changedRefreshMs,
      databaseBytes: report.storage.databaseBytes,
    }),
  );
}
