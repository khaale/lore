import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function randomFromSeed(seed) {
  let state = 2166136261;
  for (const character of String(seed))
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
function expand(bins) {
  return bins.flatMap(([value, count]) => Array(count).fill(value));
}

// Match string lengths and ASCII/Cyrillic byte proportions without copying text.
function text(shape, random) {
  const chars = shape.chars,
    extra = Math.min(chars, Math.max(0, shape.bytes - chars));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz     ',
    cyrillic = 'абвгдежзиклмнопрстуфхцчшщэюя';
  let result = '';
  for (let index = 0; index < chars; index++) {
    const useCyrillic =
      Math.floor(((index + 1) * extra) / chars) > Math.floor((index * extra) / chars);
    const letters = useCyrillic ? cyrillic : alphabet;
    result += letters[Math.floor(random() * letters.length)];
  }
  return result;
}
function materialize(shape, random) {
  if (shape.kind === 'null') return null;
  if (shape.kind === 'string') return text(shape, random);
  if (shape.kind === 'boolean') return random() < 0.5;
  if (shape.kind === 'number')
    return shape.integer ? Math.floor(random() * 10 ** Math.min(8, shape.digits)) : random() * 100;
  if (shape.kind === 'array')
    return Array.from({ length: shape.count }, (_, index) =>
      materialize(shape.items[index % shape.items.length], random),
    );
  return Object.fromEntries(
    Object.entries(shape.fields).map(([key, value]) => [key, materialize(value, random)]),
  );
}

// Bipartite Havel-Hakimi preserves both degree sequences for each typed relation.
// Seeded tie ranks randomize endpoints without retaining the original topology.
function connect(group, from, to, random) {
  const sourceDegrees = shuffle(expand(group.outDegrees), random);
  const targetDegrees = shuffle(expand(group.inDegrees), random);
  const sources = from
    .map((node, index) => ({ node, degree: sourceDegrees[index], tie: random() }))
    .sort((a, b) => b.degree - a.degree || a.tie - b.tie);
  const heap = [];
  const higher = (a, b) =>
    a.remaining > b.remaining || (a.remaining === b.remaining && a.tie < b.tie);
  function push(item) {
    heap.push(item);
    let index = heap.length - 1;
    while (index) {
      const parent = (index - 1) >> 1;
      if (!higher(heap[index], heap[parent])) break;
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  }
  function pop() {
    const result = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let index = 0;
      while (true) {
        let next = index;
        const left = index * 2 + 1,
          right = left + 1;
        if (left < heap.length && higher(heap[left], heap[next])) next = left;
        if (right < heap.length && higher(heap[right], heap[next])) next = right;
        if (next === index) break;
        [heap[index], heap[next]] = [heap[next], heap[index]];
        index = next;
      }
    }
    return result;
  }
  to.forEach((node, index) => {
    if (targetDegrees[index]) push({ node, remaining: targetDegrees[index], tie: random() });
  });
  let edges = 0;
  for (const { node, degree } of sources) {
    const selected = [];
    for (let index = 0; index < degree; index++) {
      const target = pop();
      if (!target?.remaining)
        throw new Error(
          `Non-graphical degree sequence: ${group.from}/${group.relation}/${group.to}`,
        );
      (node.relations[group.relation] ??= []).push(target.node.id);
      target.remaining--;
      selected.push(target);
      edges++;
    }
    for (const target of selected) if (target.remaining) push(target);
  }
  if (heap.length || edges !== group.count)
    throw new Error('Degree sequence did not conserve edge count');
}
function modelFor(profile) {
  const relations = [...new Set(profile.relations.map((group) => group.relation))];
  if (relations.some((name) => ['id', 'type', 'name', 'cohort', 'payload'].includes(name)))
    throw new Error('Relation collides with benchmark scaffold');
  return {
    id: 'https://example.org/lore/sqlite-statistical-benchmark',
    name: 'sa-statistical-benchmark',
    classes: {
      Entity: {
        abstract: true,
        attributes: {
          id: { identifier: true },
          type: { designates_type: true, required: true },
          name: { required: true },
          cohort: { range: 'integer' },
          payload: { range: 'BenchmarkPayload', inlined: true },
          ...Object.fromEntries(
            relations.map((relation) => [relation, { range: 'Entity', multivalued: true }]),
          ),
        },
      },
      ...Object.fromEntries(
        profile.reference.classes
          .filter((name) => name !== 'Entity')
          .map((name) => [name, { is_a: 'Entity' }]),
      ),
      BenchmarkPayload: { extra_slots: { allowed: true } },
    },
  };
}
function sourcePath(specification, number, extension, directories) {
  const directory = specification.directory === -1 ? '' : directories[specification.directory];
  let stem = `file_${String(number).padStart(5, '0')}`;
  const targetLength = specification.relativeLength ?? 70;
  stem = stem.padEnd(
    Math.max(stem.length, targetLength - directory.length - extension.length - (directory ? 1 : 0)),
    'x',
  );
  return directory ? `${directory}/${stem}${extension}` : `${stem}${extension}`;
}

export async function generateCorpus({
  output,
  seed = 'sa-sqlite-v1',
  copies = 1,
  fraction = 1,
  profile,
}) {
  if (!Number.isSafeInteger(copies) || copies < 1)
    throw new Error('copies must be a positive integer');
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
    throw new Error('fraction must be in (0,1]');
  output = resolve(output);
  try {
    if ((await readdir(output)).length)
      throw new Error('Refusing to overwrite a nonempty output directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(output, { recursive: true });
  const random = randomFromSeed(seed);
  let allNodes = [],
    files = [];
  let ordinal = 0,
    fileNumber = 0;
  for (let copy = 0; copy < copies; copy++) {
    const directories = [];
    for (const [index, spec] of profile.directories.entries()) {
      const name = `d${index.toString(36)}`.padEnd(spec.length, 'x');
      directories.push(spec.parent === -1 ? name : `${directories[spec.parent]}/${name}`);
    }
    const pools = {};
    for (const [name, type] of Object.entries(profile.types)) {
      const lengths = shuffle(expand(type.idLengths), random),
        narratives = shuffle(expand(type.narrativeLengths), random);
      pools[name] = Array.from({ length: type.count }, (_, index) => {
        const prefix = `e${(ordinal++).toString(36).padStart(5, '0')}`;
        const node = {
          id: prefix.padEnd(Math.max(prefix.length, lengths[index]), 'x'),
          type: name,
          name: `Synthetic ${name} ${index}`,
          cohort: index % 20,
          payload: materialize(
            type.templates[Math.floor(random() * type.templates.length)],
            random,
          ),
          relations: {},
          narrative: narratives[index] ? text(narratives[index], random) : undefined,
        };
        allNodes.push(node);
        return node;
      });
    }
    for (const group of profile.relations)
      connect(group, pools[group.from], pools[group.to], random);
    const remaining = Object.fromEntries(
      Object.entries(pools).map(([type, nodes]) => [type, shuffle([...nodes], random)]),
    );
    for (const file of profile.files) {
      const nodes = Object.entries(file.types).flatMap(([type, count]) =>
        remaining[type].splice(0, count),
      );
      const path = sourcePath(file, fileNumber++, `.${file.kind}`, directories);
      files.push({ path, nodes, kind: file.kind });
    }
    for (const file of profile.unclassified)
      files.push({
        path: sourcePath(file, fileNumber++, '.md', directories),
        kind: 'md',
        nodes: [],
        text: text({ chars: Math.round(file.bytes / 1.3), bytes: file.bytes }, random),
      });
    if (Object.values(remaining).some((nodes) => nodes.length))
      throw new Error('File layout did not consume every entity');
  }
  let fractionRelations;
  if (fraction < 1) {
    const byType = Object.fromEntries(
      Object.keys(profile.types).map((type) => [
        type,
        allNodes.filter((node) => node.type === type),
      ]),
    );
    const kept = new Set(),
      replacement = new Map();
    for (const nodes of Object.values(byType)) {
      const count = Math.max(1, Math.round(nodes.length * fraction));
      const retained = Array.from(
        { length: count },
        (_, index) => nodes[Math.floor((index * nodes.length) / count)],
      );
      retained.forEach((node) => kept.add(node.id));
      nodes.forEach((node, index) => replacement.set(node.id, retained[index % count].id));
    }
    allNodes = allNodes.filter((node) => kept.has(node.id));
    for (const node of allNodes)
      for (const [name, targets] of Object.entries(node.relations))
        node.relations[name] = [
          ...new Set(targets.map((id) => (kept.has(id) ? id : replacement.get(id)))),
        ];
    const unclassified = files.filter((file) => file.text !== undefined),
      keepUnclassified = new Set(
        Array.from(
          { length: Math.round(unclassified.length * fraction) },
          (_, i) => unclassified[Math.floor(i / fraction)].path,
        ),
      );
    files = files
      .map((file) => ({ ...file, nodes: file.nodes.filter((node) => kept.has(node.id)) }))
      .filter((file) => file.nodes.length || keepUnclassified.has(file.path));
    const types = new Map(allNodes.map((node) => [node.id, node.type])),
      groups = new Map();
    for (const node of allNodes)
      for (const [relation, targets] of Object.entries(node.relations))
        for (const target of targets) {
          const to = types.get(target),
            key = JSON.stringify([node.type, relation, to]);
          const group = groups.get(key) ?? {
            from: node.type,
            relation,
            to,
            count: 0,
            out: new Map(),
            in: new Map(),
          };
          group.count++;
          group.out.set(node.id, (group.out.get(node.id) ?? 0) + 1);
          group.in.set(target, (group.in.get(target) ?? 0) + 1);
          groups.set(key, group);
        }
    const histogram = (values) =>
      [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort(
        (a, b) => a[0] - b[0],
      );
    fractionRelations = [...groups.values()].map((group) => ({
      from: group.from,
      relation: group.relation,
      to: group.to,
      count: group.count,
      outDegrees: histogram(
        allNodes
          .filter((node) => node.type === group.from)
          .map((node) => group.out.get(node.id) ?? 0),
      ),
      inDegrees: histogram(
        allNodes.filter((node) => node.type === group.to).map((node) => group.in.get(node.id) ?? 0),
      ),
    }));
  }
  await writeFile(join(output, '.lore.yaml'), JSON.stringify(modelFor(profile), null, 2) + '\n');
  await writeFile(join(output, '.artifactignore'), '.benchmark.json\n');
  let sourceBytes = 0;
  for (const file of files) {
    const records = file.nodes.map(({ id, type, name, cohort, payload, relations }) => ({
      id,
      type,
      name,
      cohort,
      payload,
      ...relations,
    }));
    let content;
    if (!file.nodes.length) content = file.text;
    else if (file.kind === 'jsonl')
      content = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    else {
      if (records.length !== 1) throw new Error('Markdown grouping expects one entity per file');
      content = `---\n${Object.entries(records[0])
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n')}\n---\n${file.nodes[0].narrative ?? ''}`;
    }
    await mkdir(dirname(join(output, file.path)), { recursive: true });
    await writeFile(join(output, file.path), content);
    sourceBytes += Buffer.byteLength(content);
  }
  const firstMarkdown = files.find((file) => file.nodes.length && file.kind === 'md');
  const incident = new Map();
  for (const node of allNodes)
    for (const targets of Object.values(node.relations))
      for (const target of targets) {
        incident.set(node.id, (incident.get(node.id) ?? 0) + 1);
        incident.set(target, (incident.get(target) ?? 0) + 1);
      }
  const hub = [...allNodes].sort(
    (a, b) => (incident.get(b.id) ?? 0) - (incident.get(a.id) ?? 0),
  )[0];
  const manifest = {
    version: 1,
    seed,
    copies,
    profileVersion: profile.version,
    entities: allNodes.length,
    edges: allNodes.reduce(
      (sum, node) =>
        sum + Object.values(node.relations).reduce((n, targets) => n + targets.length, 0),
      0,
    ),
    sourceFiles: files.length,
    sourceBytes,
    types: Object.fromEntries(
      Object.keys(profile.types).map((name) => [
        name,
        allNodes.filter((node) => node.type === name).length,
      ]),
    ),
    ...(fraction < 1 ? { fraction, relationProfile: fractionRelations } : {}),
    samples: {
      evidence:
        allNodes.find((node) => node.type === 'DependencyObservation')?.id ?? allNodes[0].id,
      discovery: allNodes.find((node) => node.type === 'DependencyDiscovery')?.id ?? allNodes[0].id,
      narrative: firstMarkdown.nodes[0].id,
      changedFile: firstMarkdown.path,
      hub: hub.id,
      hubDegree: incident.get(hub.id) ?? 0,
      sparseType: Object.entries(profile.types).sort((a, b) => a[1].count - b[1].count)[0][0],
    },
  };
  await writeFile(join(output, '.benchmark.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, seed = 'sa-sqlite-v1', copies = '1', fraction = '1'] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node generate.mjs OUTPUT [SEED] [COPIES] [FRACTION]');
  const profile = JSON.parse(await readFile(new URL('./sa-profile.json', import.meta.url), 'utf8'));
  console.log(
    JSON.stringify(
      await generateCorpus({
        output,
        seed,
        copies: Number(copies),
        fraction: Number(fraction),
        profile,
      }),
      null,
      2,
    ),
  );
}
