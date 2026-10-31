// Reads an existing index only; stores aggregate shapes/degrees, never IDs/text.
import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { CompactReader, EDGE_SELECT } from '../../packages/sdk/dist/sqlite-storage.js';

export const histogram = (values) =>
  [...values.reduce((bins, value) => bins.set(value, (bins.get(value) ?? 0) + 1), new Map())].sort(
    (a, b) => a[0] - b[0],
  );
function shape(value, vocabulary, depth = 0) {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string')
    return { kind: 'string', chars: value.length, bytes: Buffer.byteLength(value) };
  if (typeof value === 'number')
    return {
      kind: 'number',
      digits: String(Math.abs(value)).length,
      integer: Number.isInteger(value),
    };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value))
    return {
      kind: 'array',
      count: value.length,
      items: value.slice(0, 8).map((item) => shape(item, vocabulary, depth + 1)),
    };
  if (depth > 24) throw new Error('Profile shape exceeds supported depth');
  return {
    kind: 'object',
    fields: Object.fromEntries(
      Object.entries(value).map(([key, item], index) => [
        vocabulary.has(key) ? key : `field_${index}`.padEnd(key.length, 'x'),
        shape(item, vocabulary, depth + 1),
      ]),
    ),
  };
}

export function captureProfile(indexPath) {
  const db = new DatabaseSync(indexPath, { readOnly: true });
  try {
    const metadata = JSON.parse(db.prepare('SELECT value FROM lore_meta').get().value);
    const model = JSON.parse(db.prepare('SELECT value FROM lore_model').get().value);
    const vocabulary = new Set(
      Object.values(model.classes).flatMap((cls) => Object.keys(cls.slots)),
    );
    const compact = db
      .prepare('PRAGMA table_info(lore_entities)')
      .all()
      .some((column) => column.name === 'external_id')
      ? new CompactReader(db)
      : undefined;
    const rows = compact
      ? db
          .prepare('SELECT * FROM lore_entities ORDER BY id')
          .all()
          .map((row) => {
            const entity = compact.entity(row);
            return {
              id: entity.id,
              type: entity.kind,
              entity: JSON.stringify(entity),
              artifact: JSON.stringify(compact.artifact(row, entity)),
              narrative: row.narrative,
            };
          })
      : db
          .prepare('SELECT id,type,entity,artifact,narrative FROM lore_entities ORDER BY ordinal')
          .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const types = {};
    const files = new Map();
    const directoryIds = new Map([['', -1]]),
      directories = [];
    function directory(path) {
      const parts = relative(metadata.config.root, path).split('/');
      parts.pop();
      let prefix = '',
        parent = -1;
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        if (!directoryIds.has(prefix)) {
          directoryIds.set(prefix, directories.length);
          directories.push({ parent, length: part.length });
        }
        parent = directoryIds.get(prefix);
      }
      return parent;
    }
    for (const row of rows) {
      const entity = JSON.parse(row.entity),
        artifact = JSON.parse(row.artifact);
      row.properties = entity.properties;
      const type = (types[row.type] ??= {
        count: 0,
        idLengths: [],
        narrative: [],
        templates: [],
        markdown: 0,
        jsonl: 0,
        propertyBytes: 0,
      });
      type.count++;
      type.idLengths.push(row.id.length);
      if (row.narrative !== null)
        type.narrative.push({
          chars: row.narrative.length,
          bytes: Buffer.byteLength(row.narrative),
        });
      type.propertyBytes += Buffer.byteLength(JSON.stringify(entity.properties));
      type[extname(artifact.physical_path) === '.jsonl' ? 'jsonl' : 'markdown']++;
      const file = files.get(artifact.physical_path) ?? {
        kind: extname(artifact.physical_path) === '.jsonl' ? 'jsonl' : 'md',
        directory: directory(artifact.physical_path),
        relativeLength: relative(metadata.config.root, artifact.physical_path).length,
        types: {},
      };
      file.types[row.type] = (file.types[row.type] ?? 0) + 1;
      files.set(artifact.physical_path, file);
    }
    // Systematically sample the ordered type population, not just its first rows.
    // Values become shapes containing lengths only; source strings never escape.
    for (const [name, type] of Object.entries(types)) {
      const population = rows.filter((row) => row.type === name);
      type.templates = Array.from({ length: Math.min(32, population.length) }, (_, i) =>
        shape(
          population[Math.floor((i * population.length) / Math.min(32, population.length))]
            .properties,
          vocabulary,
        ),
      );
      type.idLengths = histogram(type.idLengths);
      type.narrativeLengths = histogram(type.narrative.map((text) => JSON.stringify(text))).map(
        ([text, count]) => [JSON.parse(text), count],
      );
      delete type.narrative;
    }
    const groups = new Map();
    const edgeValues = compact
      ? db
          .prepare(`${EDGE_SELECT} ORDER BY e.id`)
          .all()
          .map((row) => compact.edge(row))
      : db
          .prepare('SELECT value FROM lore_edges ORDER BY ordinal')
          .all()
          .map((row) => JSON.parse(row.value));
    for (const edge of edgeValues) {
      const from = byId.get(edge.from),
        to = byId.get(edge.to);
      const key = JSON.stringify([from.type, edge.relation, to.type]);
      const group = groups.get(key) ?? {
        from: from.type,
        relation: edge.relation,
        to: to.type,
        count: 0,
        out: new Map(),
        in: new Map(),
      };
      group.count++;
      group.out.set(from.id, (group.out.get(from.id) ?? 0) + 1);
      group.in.set(to.id, (group.in.get(to.id) ?? 0) + 1);
      groups.set(key, group);
    }
    const relations = [...groups.values()].map((group) => ({
      from: group.from,
      relation: group.relation,
      to: group.to,
      count: group.count,
      outDegrees: histogram(
        rows.filter((row) => row.type === group.from).map((row) => group.out.get(row.id) ?? 0),
      ),
      inDegrees: histogram(
        rows.filter((row) => row.type === group.to).map((row) => group.in.get(row.id) ?? 0),
      ),
    }));
    const inputs = db.prepare('SELECT path,size FROM lore_inputs ORDER BY path').all();
    const unclassified = inputs.filter(
      (input) => extname(input.path) === '.md' && !files.has(input.path),
    );
    return {
      version: 1,
      description:
        'SA-derived statistical workload; no original records, IDs, paths or text. Simplified generated constraints, not the authored SA model.',
      reference: {
        rootLength: metadata.config.root.length,
        entities: rows.length,
        canonicalEdges: metadata.edgeCount,
        modelClasses: Object.keys(model.classes).length,
        sourceBytes: inputs.reduce((sum, input) => sum + input.size, 0),
        narrativeBytes: rows.reduce((sum, row) => sum + Buffer.byteLength(row.narrative ?? ''), 0),
        classes: Object.keys(model.classes).sort(),
        ...Object.fromEntries(
          ['md', 'jsonl'].map((ext) => [
            ext,
            {
              files: inputs.filter((input) => extname(input.path) === `.${ext}`).length,
              bytes: inputs
                .filter((input) => extname(input.path) === `.${ext}`)
                .reduce((sum, input) => sum + input.size, 0),
            },
          ]),
        ),
      },
      types,
      files: [...files.values()],
      unclassified: unclassified.map((input) => ({
        bytes: input.size,
        directory: directory(input.path),
        relativeLength: relative(metadata.config.root, input.path).length,
      })),
      directories,
      relations,
    };
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith('/profile.mjs')) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error('Usage: node profile.mjs INDEX OUTPUT.json');
  await writeFile(process.argv[3], JSON.stringify(captureProfile(process.argv[2]), null, 2) + '\n');
}
