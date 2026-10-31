import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as filesystem from '@khaale/lore-filesystem';
import { compileSchemaOrThrow } from '@khaale/lore-schema';
import { buildGraph } from '@khaale/lore-core';
import {
  openFilesystemWorkspace,
  openSqliteWorkspace,
  refreshSqliteIndex,
  type IndexedReadSnapshot,
} from './index.js';
import { initializeSqliteIndex } from './sqlite-index.js';
import { ReadSnapshotImpl, projectionSource } from './reader.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const model = `id: https://example.org/sqlite
name: sqlite-test
classes:
  Thing:
    slots: [id, kind, title, status, tags, related, incoming, detail]
  Special:
    is_a: Thing
  Details:
    attributes:
      rank: {range: integer}
      note: {range: string}
slots:
  id: {identifier: true}
  kind: {designates_type: true}
  title:
    required: true
    annotations: {'lore:explore_roles': title}
  status: {range: State}
  tags: {multivalued: true}
  related:
    range: Thing
    multivalued: true
    inverse: incoming
    annotations: {'lore:explore_relation': dependency}
  incoming: {range: Thing, multivalued: true, inverse: related}
  detail: {range: Details, inlined: true}
enums:
  State:
    permissible_values: {accepted: {}, draft: {}}
`;
const document = (title = 'Alpha', body = 'Original narrative') =>
  `---\nid: a\nkind: Thing\ntitle: ${title}\nstatus: accepted\nrelated: [b]\ntags: [one, two]\ndetail: {rank: 2, note: nested}\n---\n\n# Heading\n\n${body}\n`;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lore-sqlite-'));
  directories.push(directory);
  const root = join(directory, 'knowledge');
  const schemaPath = join(root, '.lore.yaml');
  const indexPath = join(directory, 'projection.sqlite');
  await mkdir(root);
  await writeFile(schemaPath, model);
  await writeFile(join(root, 'a.md'), document());
  await writeFile(
    join(root, 'b.yaml'),
    'id: b\nkind: Special\ntitle: Beta\nstatus: draft\nrelated: [c]\n',
  );
  await writeFile(join(root, 'c.yaml'), 'id: c\nkind: Thing\ntitle: Gamma\nrelated: []\n');
  const compiled = await compileSchemaOrThrow(schemaPath);
  const candidates = (
    await Promise.all(['a.md', 'b.yaml', 'c.yaml'].map((p) => filesystem.parseFile(join(root, p))))
  ).flat();
  const built = buildGraph(candidates, { root, compiled, strict: true });
  const jsonPath = join(root, '.artifact-index/index.json');
  await filesystem.publishIndex(jsonPath, built.index);
  await initializeSqliteIndex({ root, indexPath });
  return { directory, root, schemaPath, indexPath, jsonPath, built };
}
const withoutSnapshot = <T extends { snapshot: unknown }>(value: T) => {
  const { snapshot: _snapshot, ...result } = value;
  return result;
};

describe('SQLite projection and ordinary SDK', () => {
  it('shares lazy JSON graph preparation across readers without making metadata/query pay for it', async () => {
    const f = await fixture();
    const source = projectionSource(f.built.index, f.built.schema);
    const relations = source.relations;
    let preparations = 0;
    Object.defineProperty(source, 'relations', {
      get() {
        preparations++;
        return relations;
      },
    });
    const first = new ReadSnapshotImpl(source);
    await first.describe();
    await first.query({ limit: 1 });
    expect(preparations).toBe(0);
    await first.graph.neighbors(['a']);
    await new ReadSnapshotImpl({ ...source }).graph.neighborhood(['a'], { depth: 2 });
    // Spreading source above observes the test getter once; graph construction observes it once.
    expect(preparations).toBe(2);
  });

  it('matches JSON schema, projections, filters, search and graph semantics', async () => {
    const f = await fixture();
    const json = await openFilesystemWorkspace({ root: f.root, indexPath: f.jsonPath });
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
    });
    try {
      expect(withoutSnapshot(await sql.schema.describeType('Thing'))).toEqual(
        withoutSnapshot(await json.schema.describeType('Thing')),
      );
      for (const options of [
        {},
        { type: 'Thing', where: { status: { eq: 'accepted' as const } } },
        { where: { related: { present: false } } },
        { where: { tags: { in: ['two'] } } },
        { select: ['related', 'incoming', 'detail'] },
      ]) {
        expect(withoutSnapshot(await sql.query(options))).toEqual(
          withoutSnapshot(await json.query(options)),
        );
      }
      expect(withoutSnapshot(await sql.search({ text: 'a' }))).toEqual(
        withoutSnapshot(await json.search({ text: 'a' })),
      );
      expect(withoutSnapshot(await sql.entities.getMany(['b', 'absent', 'a', 'a']))).toEqual(
        withoutSnapshot(await json.entities.getMany(['b', 'absent', 'a', 'a'])),
      );
      expect(withoutSnapshot(await sql.entities.getMany([]))).toEqual(
        withoutSnapshot(await json.entities.getMany([])),
      );
      for (const id of ['a', 'b', 'c']) {
        const options = {
          include: ['properties', 'relations', 'narrative', 'provenance'] as const,
        };
        expect(withoutSnapshot(await sql.entities.get(id, options))).toEqual(
          withoutSnapshot(await json.entities.get(id, options)),
        );
      }
      for (const options of [
        {},
        { direction: 'in' as const },
        { relations: ['incoming'] },
        { nodeTypes: ['Special'] },
        { maxNodes: 2, maxEdges: 1 },
      ]) {
        expect(withoutSnapshot(await sql.graph.neighbors(['b'], options))).toEqual(
          withoutSnapshot(await json.graph.neighbors(['b'], options)),
        );
        expect(
          withoutSnapshot(await sql.graph.neighborhood(['a'], { ...options, depth: 2 })),
        ).toEqual(withoutSnapshot(await json.graph.neighborhood(['a'], { ...options, depth: 2 })));
        expect(withoutSnapshot(await sql.graph.subgraph(['a', 'b'], options))).toEqual(
          withoutSnapshot(await json.graph.subgraph(['a', 'b'], options)),
        );
        expect(withoutSnapshot(await sql.graph.boundary(['b'], options))).toEqual(
          withoutSnapshot(await json.graph.boundary(['b'], options)),
        );
      }
      expect(withoutSnapshot(await sql.explore({ view: 'card', root: 'a' }))).toEqual(
        withoutSnapshot(await json.explore({ view: 'card', root: 'a' })),
      );
      await expect(sql.query({ where: { unknown: { eq: 'x' } } })).rejects.toMatchObject({
        code: 'UNKNOWN_FIELD',
      });
      await expect(sql.graph.neighbors([])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    } finally {
      await sql.close();
    }
  });

  it('keeps indexed data and narrative available offline without leaking mutable values', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
    });
    await rename(f.root, join(f.directory, 'offline'));
    try {
      expect((await sql.entities.get('a')).item).not.toHaveProperty('narrative');
      const read = await sql.entities.get('a', { include: ['narrative'] });
      expect(read.item.narrative).toContain('Original narrative');
      expect(read.snapshot).toMatchObject({
        kind: 'sqlite-generation',
        sourceFreshness: 'not-checked',
      });
      read.item.properties.title = 'mutated';
      read.snapshot.generationId = 'mutated';
      expect((await sql.entities.get('a')).item.properties.title).toBe('Alpha');
      await expect(
        sql.entities.get('a', { include: ['narrative'], narrativeMaxBytes: 1 }),
      ).rejects.toMatchObject({ code: 'NARRATIVE_LIMIT' });
      expect((await sql.schema.listTypes()).items.length).toBe(3);
      await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
        code: 'REFRESH_FAILED',
      });
      expect((await sql.entities.get('a')).item.properties.title).toBe('Alpha');
    } finally {
      await sql.close();
    }
  });

  it('skips source parsing and entity writes when unchanged and coalesces zero-age checks', async () => {
    const f = await fixture();
    const db = new DatabaseSync(f.indexPath);
    db.exec(
      'CREATE TABLE changed_rows(id TEXT); CREATE TRIGGER entity_write AFTER INSERT ON lore_entities BEGIN INSERT INTO changed_rows VALUES(new.id); END;',
    );
    const parse = vi.spyOn(filesystem, 'parseFile');
    try {
      const [first, second] = await Promise.all([
        refreshSqliteIndex({ indexPath: f.indexPath }),
        refreshSqliteIndex({ indexPath: f.indexPath }),
      ]);
      expect(first.outcome).toBe('unchanged');
      expect(second.outcome).toBe('reused');
      expect(first.generationId).toBe(second.generationId);
      expect(parse).not.toHaveBeenCalled();
      expect(db.prepare('SELECT count(*) n FROM changed_rows').get()!.n).toBe(0);
      const later = await refreshSqliteIndex({ indexPath: f.indexPath });
      expect(later.outcome).toBe('unchanged');
      expect(later.lastAttempt.sequence).toBe(first.lastAttempt.sequence + 1);
    } finally {
      db.close();
    }
  });

  it('preserves generation on failed refresh and shares cached attempts without reporting failure as fresh', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'refresh-on-read' },
    });
    const old = await sql.entities.get('a');
    await writeFile(join(f.root, 'a.md'), document('New title', 'New narrative'));
    expect((await refreshSqliteIndex({ indexPath: f.indexPath, maxAgeMs: 60000 })).outcome).toBe(
      'reused',
    );
    const changed = await sql.entities.get('a', { include: ['narrative'] });
    expect(changed.item.narrative).toContain('New narrative');
    expect(changed.snapshot.generationId).not.toBe(old.snapshot.generationId);
    await writeFile(join(f.root, 'b.yaml'), 'id: b\nkind: Special\n');
    await expect(sql.query({})).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    await expect(
      refreshSqliteIndex({ indexPath: f.indexPath, maxAgeMs: 60000 }),
    ).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect((await sql.status()).generationId).toBe(changed.snapshot.generationId);
    expect((await sql.status()).lastAttempt.status).toBe('failed');
    await writeFile(join(f.root, 'b.yaml'), 'id: b\nkind: Special\ntitle: Fixed\n');
    expect((await sql.entities.get('b')).item.properties.title).toBe('Fixed');
    await sql.close();
  });

  it('keeps bounded sparse pages, binds continuations to generations and isolates read scopes', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
    });
    const page = await sql.query({ where: { status: { eq: 'draft' } }, limit: 1, scanBudget: 1 });
    expect(page.items).toEqual([]);
    expect(page.coverage).toMatchObject({ complete: false, examined: 1, reason: 'scan-budget' });
    expect(
      (
        await sql.query({
          where: { status: { eq: 'draft' } },
          limit: 1,
          scanBudget: 1,
          continuation: page.continuation!,
        })
      ).items[0]?.id,
    ).toBe('b');
    await refreshSqliteIndex({ indexPath: f.indexPath });
    await sql.query({
      where: { status: { eq: 'draft' } },
      limit: 1,
      scanBudget: 1,
      continuation: page.continuation!,
    });
    let escaped: IndexedReadSnapshot | undefined;
    await sql.readSnapshot(async (read) => {
      escaped = read;
      const before = await read.entities.get('a', { include: ['narrative'] });
      await writeFile(join(f.root, 'a.md'), document('Changed', 'Updated body'));
      await refreshSqliteIndex({ indexPath: f.indexPath });
      const other = await sql.entities.get('a', { include: ['narrative'] });
      expect(other.item.properties.title).toBe('Changed');
      expect(other.snapshot.generationId).not.toBe(before.snapshot.generationId);
      expect(await read.entities.get('a', { include: ['narrative'] })).toEqual(before);
      expect((await read.graph.neighbors(['a'])).snapshot.generationId).toBe(
        before.snapshot.generationId,
      );
    });
    await expect(escaped!.query({})).rejects.toMatchObject({ code: 'SNAPSHOT_CLOSED' });
    await expect(
      sql.query({
        where: { status: { eq: 'draft' } },
        limit: 1,
        scanBudget: 1,
        continuation: page.continuation!,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTINUATION' });
    let entered = 0;
    await expect(
      sql.readSnapshot(() => {
        entered++;
        throw new Error('callback');
      }),
    ).rejects.toThrow('callback');
    expect(entered).toBe(1);
    await sql.close();
    await expect(sql.describe()).rejects.toMatchObject({ code: 'SNAPSHOT_CLOSED' });
  });

  it('observes path-set, model-selection, dependency and ignore changes', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'd.yaml'), 'id: d\nkind: Thing\ntitle: Delta\n');
    expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
    await rm(join(f.root, 'd.yaml'));
    expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
    await writeFile(join(f.root, 'model.yaml'), model);
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
    await rm(join(f.root, 'model.yaml'));
    await writeFile(f.schemaPath, model + '\nimports: [./base]\n');
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
    await writeFile(join(f.root, 'base.yaml'), 'classes: {}\n');
    await refreshSqliteIndex({ indexPath: f.indexPath });
    await writeFile(join(f.root, 'base.yaml'), 'classes: {}\ndescription: Changed import\n');
    expect((await refreshSqliteIndex({ indexPath: f.indexPath })).outcome).toBe('updated');
    await writeFile(join(f.root, '.artifactignore'), 'c.yaml\n');
    // Existing b -> c reference makes this exclusion invalid, preserving the previous generation.
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
  });
  it('rejects mid-build changes and keeps the previous generation', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
    });
    const old = await sql.entities.get('a', { include: ['narrative'] });
    await writeFile(join(f.root, 'a.md'), document('Candidate', 'Candidate narrative'));
    const original = filesystem.parseFile;
    let changed = false;
    vi.spyOn(filesystem, 'parseFile').mockImplementation(async (path) => {
      const result = await original(path);
      if (!changed) {
        changed = true;
        await writeFile(join(f.root, 'a.md'), document('Concurrent edit', 'Different body'));
      }
      return result;
    });
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toThrow(
      'Sources changed during refresh',
    );
    expect(await sql.entities.get('a', { include: ['narrative'] })).toEqual(old);
    vi.restoreAllMocks();
    await refreshSqliteIndex({ indexPath: f.indexPath });
    expect((await sql.entities.get('a')).item.properties.title).toBe('Concurrent edit');
    await sql.close();
  });

  it('waits for active callbacks when closing and performs one grouped source check', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'refresh-on-read' },
    });
    const sequence = (await sql.status()).lastAttempt.sequence;
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const scope = sql.readSnapshot(async (read) => {
      await read.describe();
      await read.query({});
      entered();
      await gate;
      return read.entities.get('a');
    });
    await ready;
    expect((await sql.status()).lastAttempt.sequence).toBe(sequence + 1);
    let closed = false;
    const closing = sql.close().then(() => {
      closed = true;
    });
    await expect(sql.describe()).rejects.toMatchObject({ code: 'SNAPSHOT_CLOSED' });
    expect(closed).toBe(false);
    release();
    await scope;
    await closing;
    expect(closed).toBe(true);
  });

  it('retries a repaired source after a failed attempt ages out', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'b.yaml'), 'id: b\nkind: Special\n');
    await expect(refreshSqliteIndex({ indexPath: f.indexPath })).rejects.toMatchObject({
      code: 'REFRESH_FAILED',
    });
    await writeFile(join(f.root, 'b.yaml'), 'id: b\nkind: Special\ntitle: Repaired\n');
    await expect(
      refreshSqliteIndex({ indexPath: f.indexPath, maxAgeMs: 60000 }),
    ).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 60001);
    expect((await refreshSqliteIndex({ indexPath: f.indexPath, maxAgeMs: 60000 })).outcome).toBe(
      'updated',
    );
  });
  it('does not expose a generation after invalid initialization or replace a valid one on reinitialization', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
    });
    const old = await sql.entities.get('a');
    await writeFile(join(f.root, 'b.yaml'), 'id: b\nkind: Special\n');
    const freshPath = join(f.directory, 'invalid.sqlite');
    await expect(
      initializeSqliteIndex({ root: f.root, indexPath: freshPath }),
    ).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    await expect(
      openSqliteWorkspace({ indexPath: freshPath, freshness: { mode: 'indexed' } }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      initializeSqliteIndex({ root: f.root, indexPath: f.indexPath }),
    ).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect(await sql.entities.get('a')).toEqual(old);
    await sql.close();
  });
  it('yields during read contention so a same-process lock owner can release, without replaying caller errors', async () => {
    const f = await fixture();
    const sql = await openSqliteWorkspace({
      indexPath: f.indexPath,
      freshness: { mode: 'indexed' },
      busyTimeoutMs: 1000,
    });
    const holder = new DatabaseSync(f.indexPath);
    holder.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
    let held = true;
    const release = setTimeout(() => {
      holder.exec('ROLLBACK');
      holder.close();
      held = false;
    }, 10);
    try {
      expect((await sql.status()).generationId).toBe((await sql.describe()).snapshot.generationId);
      const busy = Object.assign(new Error('caller error, not connection startup'), { errcode: 5 });
      let calls = 0;
      await expect(
        sql.readSnapshot(() => {
          calls++;
          throw busy;
        }),
      ).rejects.toBe(busy);
      expect(calls).toBe(1);
    } finally {
      clearTimeout(release);
      if (held) holder.close();
      await sql.close();
    }
  });
});
