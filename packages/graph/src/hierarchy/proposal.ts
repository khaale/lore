import { dirname, relative } from 'node:path';
import { referenceSlot } from '@khaale/lore-schema';
import {
  HIERARCHY_LIMITS,
  HierarchyError,
  validateHierarchy,
  invalid,
  className,
  compare,
  type HierarchyInput,
  type HierarchyInputNode,
  type HierarchyProposal,
  type HierarchyProposalOptions,
  type HierarchyNodeDefinition,
  type HierarchyBranch,
  type HierarchyEvaluation,
} from './definition.js';
import { HierarchyComputation } from './computation.js';
import { hierarchyTypeScores } from './scores.js';

// Selection tolerances compare observed coverage/support; they are not confidence scores.
const PROPOSAL_THRESHOLDS = {
  singleParentFraction: 0.95,
  populationCoverage: 0.8,
  physicalSupport: 0.5,
  coverageMargin: 0.06,
  physicalMargin: 0.15,
  equivalentOverlap: 0.8,
  alternativeMatches: 3,
} as const;

type Profile = {
  child: string;
  parents: Set<string>;
  field: string;
  direction: 'in' | 'out';
  origin: 'path' | 'directory-id' | 'document';
  assignments: Map<string, Set<string>>;
  roles: Set<unknown>;
  physical: number;
  pairs: number;
  eligible: number;
  one: number;
  many: number;
};
function physicalPath(input: HierarchyInput, path: string): string[] {
  const p = relative(input.root, dirname(path)).replaceAll('\\', '/');
  return p.startsWith('..') ? [] : p.split('/').filter(Boolean);
}
/** Candidate selection uses ordinal evidence, not names or a semantic-confidence score. */
export function proposeHierarchy(
  c: HierarchyComputation,
  options: HierarchyProposalOptions = {},
): HierarchyProposal {
  if (options.detail !== undefined && !['compact', 'diagnostic'].includes(options.detail))
    invalid('detail', 'unknown detail mode');
  if (options.types) options.types.forEach((t, i) => className(c.input.schema, t, `types[${i}]`));
  const names = [...c.byType.keys()]
      .filter((t) => !options.types || options.types.some((p) => c.is(t, p)))
      .sort(compare),
    allowed = new Set(names),
    profiles = new Map<string, Profile>();
  if (names.length > HIERARCHY_LIMITS.definition)
    throw new HierarchyError('HIERARCHY_LIMIT', 'too many observed types for one definition');
  const add = (
    n: HierarchyInputNode,
    p: HierarchyInputNode,
    field: string,
    direction: 'in' | 'out',
    origin: Profile['origin'],
  ) => {
    if (!allowed.has(n.type) || !allowed.has(p.type) || n.id === p.id) return;
    const owner = direction === 'out' ? n : p,
      slot = referenceSlot(c.input.schema, owner.type, field);
    if (origin === 'path' && !slot) return;
    const key = JSON.stringify([n.type, field, direction, origin]);
    if (!profiles.has(key))
      profiles.set(key, {
        child: n.type,
        parents: new Set(),
        field,
        direction,
        origin,
        assignments: new Map(),
        roles: new Set(),
        physical: 0,
        pairs: 0,
        eligible: c.byType.get(n.type)!.length,
        one: 0,
        many: 0,
      });
    const g = profiles.get(key)!;
    g.parents.add(p.type);
    g.roles.add(slot?.annotations['lore:explore_relation']);
    if (!g.assignments.has(n.id)) g.assignments.set(n.id, new Set());
    const ps = g.assignments.get(n.id)!;
    if (ps.has(p.id)) return;
    ps.add(p.id);
    g.pairs++;
    const nd = dirname(n.file),
      pd = dirname(p.file);
    g.physical +=
      !n.file || !p.file
        ? 0
        : new Set(nd.split(/[\\/]/)).has(p.id)
          ? 1
          : n.file === p.file
            ? 0.7
            : nd.startsWith(pd + '/')
              ? 0.5
              : 0;
  };
  for (const [field, ids] of [...c.out].sort(([a], [b]) => compare(a, b)))
    for (const [id, targets] of ids)
      for (const to of targets) {
        c.tick();
        const n = c.byId.get(id),
          p = c.byId.get(to);
        if (n && p) {
          add(n, p, field, 'out', 'path');
          add(p, n, field, 'in', 'path');
        }
      }
  for (const n of c.nodes) {
    c.tick();
    for (const id of c.sourceParents(n, 'directory-id'))
      add(n, c.byId.get(id)!, '@directory', 'out', 'directory-id');
    for (const id of c.sourceParents(n, 'document'))
      if (c.byId.get(id)) add(n, c.byId.get(id)!, '@document', 'out', 'document');
  }
  const role = (g: Profile) => (g.roles.size === 1 ? [...g.roles][0] : 'mixed');
  for (const g of profiles.values())
    for (const ps of g.assignments.values())
      if (ps.size === 1) g.one++;
      else g.many++;
  const chosen: Profile[] = [],
    alternative: Profile[] = [],
    recursive: Profile[] = [];
  for (const type of names) {
    const gs = [...profiles.values()].filter((g) => g.child === type);
    for (const g of gs.filter(
      (g) =>
        g.parents.size === 1 &&
        g.parents.has(type) &&
        g.one > 1 &&
        !g.many &&
        !['reference', 'dependency', 'mixed'].includes(String(role(g))),
    ))
      recursive.push(g);
    const base = gs.filter(
      (g) =>
        [...g.parents].some((t) => t !== type) &&
        g.one / Math.max(1, g.assignments.size) >= PROPOSAL_THRESHOLDS.singleParentFraction &&
        !['reference', 'dependency', 'mixed'].includes(String(role(g))),
    );
    const full = base.filter(
      (g) => g.assignments.size / g.eligible >= PROPOSAL_THRESHOLDS.populationCoverage,
    );
    let candidates = full;
    if (candidates.some((g) => role(g) === 'context'))
      candidates = candidates.filter((g) => role(g) === 'context');
    else if (candidates.some((g) => g.physical / g.pairs >= PROPOSAL_THRESHOLDS.physicalSupport))
      candidates = candidates.filter(
        (g) => g.physical / g.pairs >= PROPOSAL_THRESHOLDS.physicalSupport,
      );
    if (candidates.some((g) => !g.many)) candidates = candidates.filter((g) => !g.many);
    const max = Math.max(0, ...candidates.map((g) => g.one / g.eligible));
    candidates = candidates.filter(
      (g) => max - g.one / g.eligible <= PROPOSAL_THRESHOLDS.coverageMargin,
    );
    const maxPhysical = Math.max(0, ...candidates.map((g) => g.physical / g.pairs));
    candidates = candidates.filter(
      (g) => maxPhysical - g.physical / g.pairs <= PROPOSAL_THRESHOLDS.physicalMargin,
    );
    const equivalent = (a: Profile, b: Profile) => {
      let shared = 0;
      for (const [id, ps] of a.assignments) {
        const qs = b.assignments.get(id);
        if (qs) {
          shared++;
          if (ps.size !== qs.size || [...ps].some((p) => !qs.has(p))) return false;
        }
      }
      return (
        shared / Math.min(a.assignments.size, b.assignments.size) >=
        PROPOSAL_THRESHOLDS.equivalentOverlap
      );
    };
    candidates.sort(
      (a, b) =>
        b.one - a.one ||
        Number(b.origin === 'path') - Number(a.origin === 'path') ||
        compare(a.field, b.field),
    );
    const unique: Profile[] = [];
    for (const g of candidates) if (!unique.some((p) => equivalent(p, g))) unique.push(g);
    if (unique.length === 1) chosen.push(unique[0]!);
    alternative.push(
      ...base.filter(
        (g) =>
          !chosen.includes(g) &&
          g.one >= PROPOSAL_THRESHOLDS.alternativeMatches &&
          g.origin === 'path',
      ),
    );
  }
  // Prune type-level cycles, preserving declared self-recursion as a finite rule.
  const cyclicTypes = new Set<string>(),
    doneTypes = new Set<string>(),
    stack: string[] = [];
  const findCycles = (type: string) => {
    const i = stack.indexOf(type);
    if (i >= 0) {
      stack.slice(i).forEach((t) => cyclicTypes.add(t));
      return;
    }
    if (doneTypes.has(type)) return;
    stack.push(type);
    const g = chosen.find((g) => g.child === type);
    for (const parent of g?.parents ?? []) if (parent !== type) findCycles(parent);
    stack.pop();
    doneTypes.add(type);
  };
  names.forEach(findCycles);
  const selected = chosen.filter((g) => !cyclicTypes.has(g.child));
  const nodes: HierarchyNodeDefinition[] = names.map((type) => ({
    key: `type:${type}`,
    kind: 'type',
    type,
    label: c.input.schema.classes[type]?.title ?? type,
  }));
  const branches: HierarchyBranch[] = [],
    diagnostics: HierarchyEvaluation[] = [];
  const emit = (g: Profile, alt = false) => {
    for (const parent of [...g.parents].sort(compare)) {
      const key = `branch:${branches.length}`;
      branches.push({
        key,
        parent: `type:${parent}`,
        child: `type:${g.child}`,
        alternative: alt,
        ...(parent === g.child ? { recursive: true } : {}),
        via:
          g.origin === 'path'
            ? {
                kind: 'path',
                steps: [
                  {
                    ownerType: g.direction === 'out' ? g.child : parent,
                    field: g.field,
                    direction: g.direction,
                    targetTypes: [parent],
                  },
                ],
              }
            : { kind: 'source', match: g.origin === 'document' ? 'document' : 'directory-id' },
      });
      const counts = [...g.assignments.values()].map(
        (ps) => [...ps].filter((id) => c.byId.get(id)?.type === parent).length,
      );
      const one = counts.filter((n) => n === 1).length,
        many = counts.filter((n) => n > 1).length;
      diagnostics.push({
        branch: key,
        eligible: g.eligible,
        zero: g.eligible - one - many,
        one,
        many,
        basis: g.origin === 'path' ? 'model' : 'source-context',
      });
    }
  };
  selected.sort((a, b) => compare(a.child, b.child)).forEach((g) => emit(g));
  for (const g of recursive) if (!selected.includes(g)) emit(g);
  alternative
    .sort(
      (a, b) =>
        compare(a.child, b.child) || compare(a.field, b.field) || compare(a.direction, b.direction),
    )
    .forEach((g) => emit(g, true));
  const roots = names
    .filter((t) => !branches.some((b) => !b.alternative && !b.recursive && b.child === `type:${t}`))
    .map((t) => `type:${t}`);
  const remaining = new Set(roots),
    families = new Map<string, string[]>();
  for (const key of roots) {
    let p = c.input.schema.classes[key.slice(5)]?.parent;
    while (p) {
      const count = names.filter((t) => c.is(t, p!)).length;
      if (count / names.length <= 0.5) {
        if (!families.has(p)) families.set(p, []);
        families.get(p)!.push(key);
        break;
      }
      p = c.input.schema.classes[p]?.parent;
    }
  }
  const descriptors: { key: string; types: string[] }[] = [];
  for (const [family, members] of families)
    if (members.length >= 2) {
      const key = `family:${family}`;
      nodes.push({
        key,
        kind: 'group',
        basis: 'schema-navigation',
        label: c.input.schema.classes[family]?.title ?? family,
        members,
      });
      members.forEach((m) => remaining.delete(m));
      descriptors.push({ key, types: members.map((m) => m.slice(5)) });
    }
  for (const key of remaining) descriptors.push({ key, types: [key.slice(5)] });
  const common = (paths: string[][]) =>
    paths.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    }, paths[0] ?? []);
  const navigationRoots: string[] = [],
    dirs = new Map<string, Extract<HierarchyNodeDefinition, { kind: 'group' }>>();
  const dirKey = (parts: string[]): string => {
    if (!parts.length) return '';
    const path = parts.join('/');
    if (!dirs.has(path)) {
      const key = `directory:${path}`,
        parent = dirKey(parts.slice(0, -1));
      const node: Extract<HierarchyNodeDefinition, { kind: 'group' }> = {
        key,
        kind: 'group',
        basis: 'source-context',
        label: parts.at(-1)!,
        members: [],
      };
      dirs.set(path, node);
      nodes.push(node);
      if (parent) {
        const p = nodes.find((n) => n.key === parent)!;
        if (p.kind === 'group') p.members.push(key);
      } else navigationRoots.push(key);
    }
    return dirs.get(path)!.key;
  };
  for (const d of descriptors) {
    const paths = d.types
      .flatMap((t) => c.byType.get(t) ?? [])
      .map((n) => physicalPath(c.input, n.file));
    const parent = dirKey(common(paths));
    if (parent) {
      const p = nodes.find((n) => n.key === parent)!;
      if (p.kind === 'group') p.members.push(d.key);
    } else navigationRoots.push(d.key);
  }
  const labels: Record<string, string[]> = {};
  for (const t of names) {
    const fields = Object.values(c.input.schema.classes[t]!.slots).filter(
      (s) =>
        s.mode === 'scalar' &&
        !s.multivalued &&
        Array.isArray(s.annotations['lore:explore_roles']) &&
        (s.annotations['lore:explore_roles'] as unknown[]).includes('title'),
    );
    if (fields.length) labels[t] = fields.map((s) => s.name);
  }
  const definition = validateHierarchy(c.input.schema, {
    version: 1,
    nodes,
    roots: navigationRoots,
    branches,
    labels,
    unassigned: 'group',
  });
  return {
    definition,
    typeScores: hierarchyTypeScores(c, definition),
    typeTotals: Object.fromEntries(names.map((t) => [t, c.byType.get(t)!.length])),
    declaredOnly: Object.keys(c.input.schema.classes)
      .filter((t) => !c.byType.has(t))
      .sort(compare),
    ...(options.detail === 'diagnostic' ? { diagnostics } : {}),
    coverage: { complete: true, examined: c.work },
  };
}
