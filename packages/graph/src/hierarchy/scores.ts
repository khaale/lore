import { compare, type HierarchyDefinition, type HierarchyTypeScores } from './definition.js';
import type { HierarchyComputation } from './computation.js';

export const STRUCTURE_DECAY = 0.65;

export function hierarchyTypeAdjacency(
  definition: HierarchyDefinition,
  types: string[],
  c: HierarchyComputation,
) {
  const children = new Map(types.map((t) => [t, new Set<string>()])),
    undirected = new Map(types.map((t) => [t, new Set<string>()]));
  const nodeTypes = new Map(
    definition.nodes
      .filter((n) => n.kind === 'type')
      .map((n) => [
        n.key,
        types.filter((t) => (n.includeSubtypes ? c.is(t, n.type) : t === n.type)),
      ]),
  );
  for (const b of definition.branches)
    if (!b.alternative)
      for (const parent of nodeTypes.get(b.parent) ?? [])
        for (const child of nodeTypes.get(b.child) ?? []) {
          c.tick();
          if (parent !== child) {
            children.get(parent)!.add(child);
            undirected.get(parent)!.add(child);
            undirected.get(child)!.add(parent);
          }
        }
  return { children, undirected };
}
export function hierarchyDistances(
  c: HierarchyComputation,
  start: string,
  adj: Map<string, Set<string>>,
) {
  const found = new Map([[start, 0]]),
    q = [start];
  for (let i = 0; i < q.length; i++)
    for (const next of adj.get(q[i]!) ?? []) {
      c.tick();
      if (!found.has(next)) {
        found.set(next, found.get(q[i]!)! + 1);
        q.push(next);
      }
    }
  return found;
}
export const separation = (distance: number | undefined) =>
  distance === undefined ? 1 : 1 - 2 ** -Math.max(0, distance - 1);

/** Relative type diversity, deliberately independent of instance/edge multiplicity. */
export function hierarchyTypeScores(
  c: HierarchyComputation,
  definition: HierarchyDefinition,
): Record<string, HierarchyTypeScores> {
  const types = [...c.byType.keys()]
    .filter((t) => definition.nodes.some((n) => n.kind === 'type' && n.type === t))
    .sort(compare);
  const { children, undirected } = hierarchyTypeAdjacency(definition, types, c),
    neighbors = new Map(types.map((t) => [t, new Set<string>()]));
  for (const ids of c.out.values())
    for (const [from, targets] of ids)
      for (const to of targets) {
        c.tick();
        const a = c.byId.get(from)?.type,
          b = c.byId.get(to)?.type;
        if (a && b && a !== b && neighbors.has(a) && neighbors.has(b)) {
          neighbors.get(a)!.add(b);
          neighbors.get(b)!.add(a);
        }
      }
  const raw = types.map((type) => {
    const descendants = hierarchyDistances(c, type, children),
      near = hierarchyDistances(c, type, undirected);
    let structureScore = 0,
      connectivityScore = 0;
    for (const [t, d] of descendants) if (t !== type) structureScore += STRUCTURE_DECAY ** (d - 1);
    for (const t of neighbors.get(type)!) {
      const d = near.get(t);
      connectivityScore += separation(d);
    }
    return { type, structureScore, connectivityScore };
  });
  const ms = Math.max(0, ...raw.map((r) => r.structureScore)),
    mc = Math.max(0, ...raw.map((r) => r.connectivityScore));
  return Object.fromEntries(
    raw.map((r) => [
      r.type,
      {
        structureScore: ms ? r.structureScore / ms : 0,
        connectivityScore: mc ? r.connectivityScore / mc : 0,
      },
    ]),
  );
}
