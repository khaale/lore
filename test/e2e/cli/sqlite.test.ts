import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { openSqliteWorkspace, refreshSqliteIndex } from '../../../dist/index.js';

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise<void>((done) => child.once('exit', () => done()));
    }
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const sdk = pathToFileURL(resolve('dist/index.js')).href;
function worker(script: string, indexPath: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, indexPath], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const messages: unknown[] = [];
  const pending: Array<{
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  child.on('message', (message) => {
    const waiter = pending.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else messages.push(message);
  });
  child.on('exit', (code, signal) => {
    for (const waiter of pending.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`worker exited ${code}/${signal}: ${stderr}`));
    }
  });
  const next = (): Promise<any> =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolve, reject) => {
          const waiter = {
            resolve,
            reject,
            timer: setTimeout(() => reject(new Error(`worker timeout: ${stderr}`)), 10000),
          };
          pending.push(waiter);
        });
  return { child, next };
}
const record = (title: string, body: string, related = 'b') =>
  `---\nid: a\nkind: Thing\ntitle: ${title}\nrelated: ${related}\n---\n${body}\n`;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lore-sqlite-cli-'));
  directories.push(directory);
  const root = join(directory, 'source');
  await mkdir(root);
  await writeFile(
    join(root, '.lore.yaml'),
    `id: https://example.org/test\nname: test\nclasses:\n  Thing:\n    slots: [id, kind, title, related]\nslots:\n  id: {identifier: true}\n  kind: {designates_type: true}\n  title: {required: true}\n  related: {range: Thing}\n`,
  );
  await writeFile(join(root, 'a.md'), record('Old', 'Old narrative'));
  await writeFile(join(root, 'b.yaml'), 'id: b\nkind: Thing\ntitle: B\n');
  await writeFile(join(root, 'c.yaml'), 'id: c\nkind: Thing\ntitle: C\n');
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, [resolve('dist/cli.js'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });
  const result = JSON.parse(cli('index', '--format', 'sqlite', '--json', root));
  const indexPath = join(root, '.artifact-index/index.sqlite');
  return { root, indexPath, cli, result };
}

it('supports standalone CLI refresh, validation failure and repair with one JSON document', async () => {
  const f = await fixture();
  expect(JSON.parse(f.cli('refresh', '--index', f.indexPath, '--json')).outcome).toBe('unchanged');
  expect(
    JSON.parse(f.cli('refresh', '--index', f.indexPath, '--max-age', '1m', '--json')).outcome,
  ).toBe('reused');
  await writeFile(join(f.root, 'a.md'), record('New', 'New narrative'));
  expect(JSON.parse(f.cli('refresh', '--index', f.indexPath, '--json')).outcome).toBe('updated');
  await writeFile(join(f.root, 'a.md'), '---\nid: invalid\nkind: Thing\n---\n');
  try {
    f.cli('refresh', '--index', f.indexPath, '--json');
    throw new Error('expected failure');
  } catch (error) {
    const failure = error as { status: number; stdout: string };
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stdout).error.code).toBe('REFRESH_FAILED');
  }
  const read = await openSqliteWorkspace({
    indexPath: f.indexPath,
    freshness: { mode: 'indexed' },
  });
  expect((await read.entities.get('a')).item.properties.title).toBe('New');
  await read.close();
  await writeFile(join(f.root, 'a.md'), record('Fixed', 'Fixed narrative'));
  expect(JSON.parse(f.cli('refresh', '--index', f.indexPath, '--json')).outcome).toBe('updated');
});

it('coalesces independent zero-age contenders, reports bounded ownership timeout and recovers', async () => {
  const f = await fixture();
  const holder = worker(
    `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');process.send('held');process.once('message',()=>{db.exec('ROLLBACK');db.close();process.disconnect();});`,
    f.indexPath,
  );
  expect(await holder.next()).toBe('held');
  await expect(
    refreshSqliteIndex({ indexPath: f.indexPath, busyTimeoutMs: 0 }),
  ).rejects.toMatchObject({ code: 'REFRESH_BUSY' });
  const script = `import {refreshSqliteIndex} from ${JSON.stringify(sdk)};const work=refreshSqliteIndex({indexPath:process.argv[1]});process.send('waiting');try {process.send(await work);}catch(e){process.send({error:e.code,message:e.message});}process.disconnect();`;
  const a = worker(script, f.indexPath),
    b = worker(script, f.indexPath);
  expect(await a.next()).toBe('waiting');
  expect(await b.next()).toBe('waiting');
  holder.child.send('release');
  const results = await Promise.all([a.next(), b.next()]);
  expect(results.map((r) => r.outcome).sort()).toEqual(['reused', 'unchanged']);
  expect(results.map((r) => r.lastAttempt.sequence)).toEqual([2, 2]);
  expect((await refreshSqliteIndex({ indexPath: f.indexPath })).lastAttempt.sequence).toBe(3);
});

it('rolls back an updater killed before COMMIT and releases ownership automatically', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'a.md'), record('New', 'New narrative'));
  const writer = worker(
    `import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';import {refreshSqliteIndex} from ${JSON.stringify(sdk)};const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'){writeSync(1,'precommit\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return original.call(this,sql);};await refreshSqliteIndex({indexPath:process.argv[1]});`,
    f.indexPath,
  );
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('precommit timeout')), 10000);
    writer.child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('precommit')) {
        clearTimeout(timeout);
        done();
      }
    });
  });
  const exited = new Promise<void>((done) => writer.child.once('exit', () => done()));
  writer.child.kill('SIGKILL');
  await exited;
  const read = await openSqliteWorkspace({
    indexPath: f.indexPath,
    freshness: { mode: 'indexed' },
  });
  expect((await read.entities.get('a', { include: ['narrative'] })).item.narrative).toContain(
    'Old narrative',
  );
  expect((await read.status()).generationId).toBe(f.result.generationId);
  expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
  expect((await read.entities.get('a')).item.properties.title).toBe('New');
  await read.close();
});

it('pins model, graph and narrative across publication by a separate process', async () => {
  const f = await fixture();
  const reader = worker(
    `import {openSqliteWorkspace} from ${JSON.stringify(sdk)};const workspace=await openSqliteWorkspace({indexPath:process.argv[1],freshness:{mode:'indexed'}});const read=async r=>({entity:await r.entities.get('a',{include:['narrative']}),graph:await r.graph.neighbors(['a'])});await workspace.readSnapshot(async r=>{process.send(await read(r));await new Promise(done=>process.once('message',done));process.send(await read(r));});process.send(await read(workspace));await workspace.close();process.disconnect();`,
    f.indexPath,
  );
  const before = await reader.next();
  await writeFile(join(f.root, 'a.md'), record('New', 'New narrative', 'c'));
  const updated = JSON.parse(f.cli('refresh', '--index', f.indexPath, '--json'));
  reader.child.send('continue');
  expect(await reader.next()).toEqual(before);
  const after = await reader.next();
  expect(after.entity.item.properties.title).toBe('New');
  expect(after.entity.item.narrative).toContain('New narrative');
  expect(after.graph).not.toEqual(before.graph);
  expect(after.entity.snapshot.generationId).toBe(updated.generationId);
  expect(after.graph.snapshot.generationId).toBe(updated.generationId);
});

it.each([1, 999])(
  'rejects unsupported projection version %s without modifying its metadata',
  async (version) => {
    const f = await fixture();
    const db = new DatabaseSync(f.indexPath);
    const original = String(db.prepare('SELECT value FROM lore_meta').get().value);
    const changed = JSON.stringify({ ...JSON.parse(original), version });
    db.prepare('UPDATE lore_meta SET value=?').run(changed);
    await expect(
      openSqliteWorkspace({ indexPath: f.indexPath, freshness: { mode: 'indexed' } }),
    ).rejects.toMatchObject({ code: 'INDEX_REBUILD_REQUIRED' });
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'INDEX_REBUILD_REQUIRED',
    });
    expect(db.prepare('SELECT value FROM lore_meta').get().value).toBe(changed);
    db.close();
  },
);

it('watch republishes valid edits and repairs a missing external schema import', async () => {
  const f = await fixture();
  const cliModule = pathToFileURL(resolve('dist/cli.js')).href;
  const watcher = worker(
    `const sleep=globalThis.setTimeout;let ready=false;globalThis.setTimeout=(fn,ms,...args)=>{if(ms===20&&!ready){ready=true;process.send({ready:true});}return sleep(fn,ms,...args);};process.argv=[process.execPath,'lore','watch','--format','sqlite','--poll','20ms','--debounce','20ms',${JSON.stringify(f.root)}];console.log=value=>process.send({output:value});console.error=value=>process.send({error:String(value)});await import(${JSON.stringify(cliModule)});`,
    f.indexPath,
  );
  expect(await watcher.next()).toMatchObject({
    output: expect.stringContaining('updated: generation'),
  });
  // Wait for the initial watch baseline, rather than racing its startup scan.
  expect(await watcher.next()).toEqual({ ready: true });
  const sql = await openSqliteWorkspace({ indexPath: f.indexPath, freshness: { mode: 'indexed' } });
  const schemaPath = join(f.root, '.lore.yaml');
  const { readFile } = await import('node:fs/promises');
  const model = await readFile(schemaPath, 'utf8');
  await writeFile(schemaPath, model + '\nimports: [../shared]\n');
  expect((await watcher.next()).error).toContain('Schema compilation failed');
  expect((await sql.entities.get('a')).item.properties.title).toBe('Old');
  await writeFile(join(f.root, '../shared.yaml'), 'classes: {}\n');
  expect(await watcher.next()).toMatchObject({
    output: expect.stringContaining('updated: generation'),
  });
  await writeFile(join(f.root, 'a.md'), record('Watched', 'Watch narrative'));
  expect(await watcher.next()).toMatchObject({
    output: expect.stringContaining('updated: generation'),
  });
  expect((await sql.entities.get('a', { include: ['narrative'] })).item.narrative).toContain(
    'Watch narrative',
  );
  await sql.close();
});

it('distinguishes transient read contention from a malformed index and waits before entering callbacks', async () => {
  const f = await fixture();
  const workspace = await openSqliteWorkspace({
    indexPath: f.indexPath,
    freshness: { mode: 'indexed' },
    busyTimeoutMs: 0,
  });
  const holder = worker(
    `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');process.send('held');process.once('message',()=>{db.exec('ROLLBACK');db.close();process.disconnect();});`,
    f.indexPath,
  );
  expect(await holder.next()).toBe('held');
  try {
    await expect(
      openSqliteWorkspace({
        indexPath: f.indexPath,
        freshness: { mode: 'indexed' },
        busyTimeoutMs: 0,
      }),
    ).rejects.toMatchObject({ code: 'INDEX_BUSY' });
    await expect(workspace.status()).rejects.toMatchObject({ code: 'INDEX_BUSY' });
    await expect(
      openSqliteWorkspace({
        indexPath: f.indexPath,
        freshness: { mode: 'indexed' },
        busyTimeoutMs: 25,
      }),
    ).rejects.toMatchObject({ code: 'INDEX_BUSY', details: { busyTimeoutMs: 25 } });
    await expect(
      refreshSqliteIndex({ indexPath: f.indexPath, busyTimeoutMs: 0 }),
    ).rejects.toMatchObject({ code: 'REFRESH_BUSY' });
    let entered = 0;
    await expect(
      workspace.readSnapshot(() => {
        entered++;
      }),
    ).rejects.toMatchObject({ code: 'INDEX_BUSY' });
    expect(entered).toBe(0);
  } finally {
    holder.child.send('release');
    await workspace.close();
  }
});

it('allows two cold processes to wait out a read lock before refresh-on-read callbacks', async () => {
  const f = await fixture();
  const holder = worker(
    `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');process.send('held');process.once('message',()=>{db.exec('ROLLBACK');db.close();process.disconnect();});`,
    f.indexPath,
  );
  expect(await holder.next()).toBe('held');
  const script = `import {openSqliteWorkspace} from ${JSON.stringify(sdk)};const opening=openSqliteWorkspace({indexPath:process.argv[1],freshness:{mode:'refresh-on-read',maxAgeMs:1000},busyTimeoutMs:3000});process.send('waiting');try{const ws=await opening;let calls=0;const result=await ws.readSnapshot(async read=>{calls++;return {description:await read.describe(),record:await read.entities.get('a')};});process.send({calls,snapshot:result.record.snapshot,title:result.record.item.properties.title});await ws.close();}catch(error){process.send({error:error.code,message:error.message});}process.disconnect();`;
  const a = worker(script, f.indexPath),
    b = worker(script, f.indexPath);
  expect(await a.next()).toBe('waiting');
  expect(await b.next()).toBe('waiting');
  holder.child.send('release');
  for (const result of await Promise.all([a.next(), b.next()]))
    expect(result).toMatchObject({
      calls: 1,
      title: 'Old',
      snapshot: { kind: 'sqlite-generation', sourceFreshness: 'checked' },
    });
});

it('keeps cold reopen and refresh stable across independent processes closing WAL connections', async () => {
  const f = await fixture();
  const script = `import {openSqliteWorkspace} from ${JSON.stringify(sdk)};try{for(let i=0;i<30;i++){const ws=await openSqliteWorkspace({indexPath:process.argv[1],freshness:{mode:'refresh-on-read',maxAgeMs:1000},busyTimeoutMs:3000});try {await ws.readSnapshot(async read=>{await read.schema.listTypes();await read.graph.neighborhood(['a'],{depth:1});});}finally{await ws.close();}}process.send({ok:true});}catch(error){process.send({error:error.code,message:error.message});}process.disconnect();`;
  const a = worker(script, f.indexPath),
    b = worker(script, f.indexPath);
  expect(await a.next()).toEqual({ ok: true });
  expect(await b.next()).toEqual({ ok: true });
});
