import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { histogram } from './profile.mjs';

export async function verifyCorpus(workspace, profile, manifest) {
  const nodes = new Map(),
    edges = [],
    counts = {};
  let continuation,
    payloadBytes = 0;
  do {
    const page = await workspace.query({ limit: 100, scanBudget: 10000, continuation });
    for (const entity of page.items) {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
      nodes.set(entity.id, entity.type);
      payloadBytes += Buffer.byteLength(JSON.stringify(entity.properties.payload));
      edges.push(
        ...entity.relations.filter((relation) => relation.from === entity.id && !relation.inferred),
      );
    }
    continuation = page.continuation;
  } while (continuation);
  assert.equal(nodes.size, manifest.entities);
  assert.deepEqual(counts, manifest.types);
  assert.equal(edges.length, manifest.edges);
  const groups = new Map();
  for (const edge of edges) {
    const key = JSON.stringify([nodes.get(edge.from), edge.relation, nodes.get(edge.to)]);
    const group = groups.get(key) ?? { out: new Map(), in: new Map(), count: 0 };
    group.count++;
    group.out.set(edge.from, (group.out.get(edge.from) ?? 0) + 1);
    group.in.set(edge.to, (group.in.get(edge.to) ?? 0) + 1);
    groups.set(key, group);
  }
  const expectedRelations = manifest.relationProfile ?? profile.relations;
  const multiplier = manifest.relationProfile ? 1 : manifest.copies;
  assert.equal(groups.size, expectedRelations.length);
  for (const expected of expectedRelations) {
    const group = groups.get(JSON.stringify([expected.from, expected.relation, expected.to]));
    assert.equal(group.count, expected.count * multiplier);
    const out = histogram(
      [...nodes].filter(([, type]) => type === expected.from).map(([id]) => group.out.get(id) ?? 0),
    );
    const incoming = histogram(
      [...nodes].filter(([, type]) => type === expected.to).map(([id]) => group.in.get(id) ?? 0),
    );
    assert.deepEqual(
      out,
      expected.outDegrees.map(([degree, count]) => [degree, count * multiplier]),
    );
    assert.deepEqual(
      incoming,
      expected.inDegrees.map(([degree, count]) => [degree, count * multiplier]),
    );
  }
  const referencePayloadBytes =
    Object.values(profile.types).reduce((sum, type) => sum + type.propertyBytes, 0) *
    manifest.copies *
    (manifest.fraction ?? 1);
  return {
    entities: nodes.size,
    canonicalEdges: edges.length,
    populatedTypes: Object.keys(counts).length,
    typedRelationGroups: groups.size,
    degreeSequencesMatch: true,
    degreeReference: manifest.relationProfile ? 'generated-fraction' : 'original-profile',
    payloadBytes,
    referencePayloadBytes,
    payloadRatio: payloadBytes / referencePayloadBytes,
  };
}
