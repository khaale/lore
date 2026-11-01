import { dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { referenceSlot, type RuntimeSchemaIR } from '@khaale/lore-schema';

export const HIERARCHY_LIMITS = {
  entities: 100_000,
  links: 2_000_000,
  definition: 500,
  hops: 4,
  depth: 32,
  work: 1_000_000,
  page: 100,
  labelBytes: 256,
} as const;
export class HierarchyError extends Error {
  constructor(
    readonly code: 'INVALID_HIERARCHY' | 'HIERARCHY_LIMIT' | 'INVALID_HIERARCHY_REF',
    message: string,
    readonly path = '',
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'HierarchyError';
  }
}
export type HierarchyBasis =
  'model' | 'schema-navigation' | 'source-context' | 'property' | 'derived-placement';
export type HierarchyStep = {
  ownerType: string;
  field: string;
  direction: 'out' | 'in';
  targetTypes?: string[];
};
export type HierarchyVia =
  { kind: 'path'; steps: HierarchyStep[] } | { kind: 'source'; match: 'directory-id' | 'document' };
export type HierarchyNodeDefinition =
  | { key: string; kind: 'type'; type: string; label?: string; includeSubtypes?: boolean }
  | {
      key: string;
      kind: 'group';
      label: string;
      basis: 'schema-navigation' | 'source-context';
      members: string[];
    }
  | { key: string; kind: 'property'; type: string; field: string; label?: string };
export type HierarchyBranch = {
  key: string;
  parent: string;
  child: string;
  via: HierarchyVia;
  alternative?: boolean;
  recursive?: boolean;
};
export type HierarchyPlacementPolicy = {
  branch: string;
  backbone: string[];
  consumers: HierarchyStep[];
  includeDirectParent?: boolean;
};
export type HierarchyDefinition = {
  version: 1;
  nodes: HierarchyNodeDefinition[];
  roots: string[];
  branches: HierarchyBranch[];
  labels?: Record<string, string[]>;
  unassigned?: 'group' | 'omit' | 'error';
  placements?: HierarchyPlacementPolicy[];
};
export type HierarchyQuantity =
  { status: 'exact' | 'lower-bound'; value: number } | { status: 'unknown' };
export type HierarchyEvaluation = {
  branch: string;
  eligible: number;
  zero: number;
  one: number;
  many: number;
  basis: HierarchyBasis;
};
export type HierarchyProposalOptions = {
  types?: string[];
  detail?: 'compact' | 'diagnostic';
  workBudget?: number;
};
export type HierarchyTypeScores = { structureScore: number; connectivityScore: number };
export type HierarchyInstanceScores = HierarchyTypeScores;
export type HierarchyProposal = {
  typeScores: Record<string, HierarchyTypeScores>;
  definition: HierarchyDefinition;
  typeTotals: Record<string, number>;
  declaredOnly: string[];
  diagnostics?: HierarchyEvaluation[];
  coverage: { complete: boolean; examined: number };
};
export type HierarchyReadOptions = {
  definition: HierarchyDefinition;
  parent?: string;
  limit?: number;
  continuation?: string;
  includeScores?: boolean;
  workBudget?: number;
};
export type HierarchyPlacementNode = {
  ref: string;
  label: string;
  basis: HierarchyBasis;
  branchRef: string;
  expandable: 'yes' | 'no' | 'unknown';
  directChildren?: HierarchyQuantity;
  flags?: string[];
} & (
  | { kind: 'entity'; entityId: string; type: string; scores?: HierarchyInstanceScores }
  | { kind: 'group'; entityId?: never; type?: never }
);
export type HierarchyPage = {
  items: HierarchyPlacementNode[];
  continuation?: string;
  coverage: {
    complete: boolean;
    returned: number;
    remaining: number;
    reason: 'complete' | 'page-limit' | 'empty';
  };
  compute: { complete: true; examined: number };
  placement: { complete: boolean; unassigned: number; deferred: number };
};
export type HierarchyInputNode = { id: string; type: string; file: string; source: string };
export type HierarchyInput = {
  schema: RuntimeSchemaIR;
  root: string;
  nodes(): Iterable<HierarchyInputNode>;
  links(): Iterable<{ from: string; relation: string; to: string }>;
  property(id: string, field: string): unknown;
};
const compare = (a: string, b: string) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
const invalid = (path: string, message: string): never => {
  throw new HierarchyError('INVALID_HIERARCHY', message, path);
};
const mapping = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, path: string): string =>
  typeof v === 'string' && v.length > 0 && v.length <= 1024
    ? v
    : invalid(path, 'expected a nonempty bounded string');
const array = (v: unknown, path: string): unknown[] =>
  Array.isArray(v) && v.length <= HIERARCHY_LIMITS.definition
    ? v
    : invalid(path, 'expected a bounded array');
function fields(v: Record<string, unknown>, keys: string[], path: string) {
  for (const key of Object.keys(v))
    if (!keys.includes(key)) invalid(`${path}.${key}`, 'unknown field');
}
function className(schema: RuntimeSchemaIR, value: unknown, path: string): string {
  const name = text(value, path);
  if (!schema.classes[name]) invalid(path, 'unknown type');
  return name;
}
function scalar(schema: RuntimeSchemaIR, type: string, field: unknown, path: string): string {
  const name = text(field, path),
    slot = schema.classes[type]?.slots[name];
  if (!slot || slot.mode !== 'scalar' || slot.multivalued)
    invalid(path, 'expected a declared single scalar field');
  return name;
}
function step(schema: RuntimeSchemaIR, value: unknown, path: string): HierarchyStep {
  if (!mapping(value)) return invalid(path, 'expected a typed path step');
  fields(value, ['ownerType', 'field', 'direction', 'targetTypes'], path);
  const ownerType = className(schema, value.ownerType, `${path}.ownerType`),
    field = text(value.field, `${path}.field`);
  if (!referenceSlot(schema, ownerType, field))
    invalid(`${path}.field`, 'not a declared reference path');
  if (value.direction !== 'in' && value.direction !== 'out')
    invalid(`${path}.direction`, 'expected in or out');
  return {
    ownerType,
    field,
    direction: value.direction as 'out' | 'in',
    ...(value.targetTypes === undefined
      ? {}
      : {
          targetTypes: array(value.targetTypes, `${path}.targetTypes`).map((t, i) =>
            className(schema, t, `${path}.targetTypes[${i}]`),
          ),
        }),
  };
}
/** Shared JSON definition boundary; validates before any source enumeration. */
export function validateHierarchy(schema: RuntimeSchemaIR, raw: unknown): HierarchyDefinition {
  if (!mapping(raw)) return invalid('', 'expected a definition mapping');
  fields(raw, ['version', 'nodes', 'roots', 'branches', 'labels', 'unassigned', 'placements'], '');
  if (raw.version !== 1) invalid('version', 'unsupported hierarchy definition version');
  const keys = new Set<string>();
  const nodes = array(raw.nodes, 'nodes').map((v, i): HierarchyNodeDefinition => {
    const p = `nodes[${i}]`;
    if (!mapping(v)) return invalid(p, 'expected a node');
    const key = text(v.key, `${p}.key`);
    if (keys.has(key)) invalid(`${p}.key`, 'duplicate node key');
    keys.add(key);
    const label = v.label === undefined ? undefined : text(v.label, `${p}.label`);
    if (v.kind === 'type') {
      fields(v, ['key', 'kind', 'type', 'label', 'includeSubtypes'], p);
      if (v.includeSubtypes !== undefined && typeof v.includeSubtypes !== 'boolean')
        invalid(`${p}.includeSubtypes`, 'expected boolean');
      return {
        key,
        kind: 'type',
        type: className(schema, v.type, `${p}.type`),
        ...(label ? { label } : {}),
        ...(v.includeSubtypes === undefined
          ? {}
          : { includeSubtypes: v.includeSubtypes as boolean }),
      };
    }
    if (v.kind === 'property') {
      fields(v, ['key', 'kind', 'type', 'field', 'label'], p);
      const type = className(schema, v.type, `${p}.type`);
      return {
        key,
        kind: 'property',
        type,
        field: scalar(schema, type, v.field, `${p}.field`),
        ...(label ? { label } : {}),
      };
    }
    if (v.kind === 'group') {
      fields(v, ['key', 'kind', 'basis', 'label', 'members'], p);
      if (v.basis !== 'schema-navigation' && v.basis !== 'source-context')
        invalid(`${p}.basis`, 'invalid navigation basis');
      return {
        key,
        kind: 'group',
        basis: v.basis as 'schema-navigation' | 'source-context',
        label: text(label, `${p}.label`),
        members: array(v.members, `${p}.members`).map((m, j) => text(m, `${p}.members[${j}]`)),
      };
    }
    return invalid(`${p}.kind`, 'unknown node kind');
  });
  const ref = (v: unknown, p: string): string => {
    const key = text(v, p);
    if (!keys.has(key)) invalid(p, 'unknown node key');
    return key;
  };
  const roots = array(raw.roots, 'roots').map((v, i) => ref(v, `roots[${i}]`));
  const branchKeys = new Set<string>();
  const branches = array(raw.branches, 'branches').map((v, i): HierarchyBranch => {
    const p = `branches[${i}]`;
    if (!mapping(v)) return invalid(p, 'expected a branch');
    fields(v, ['key', 'parent', 'child', 'via', 'alternative', 'recursive'], p);
    const key = text(v.key, `${p}.key`);
    if (branchKeys.has(key)) invalid(`${p}.key`, 'duplicate branch key');
    branchKeys.add(key);
    const parent = ref(v.parent, `${p}.parent`),
      child = ref(v.child, `${p}.child`);
    if (
      nodes.find((n) => n.key === parent)?.kind !== 'type' ||
      nodes.find((n) => n.key === child)?.kind !== 'type'
    )
      invalid(p, 'relation branches require type nodes');
    for (const flag of ['alternative', 'recursive'])
      if (v[flag] !== undefined && typeof v[flag] !== 'boolean')
        invalid(`${p}.${flag}`, 'expected boolean');
    if (parent === child && !v.recursive)
      invalid(`${p}.recursive`, 'self-reference requires explicit recursion');
    if (!mapping(v.via)) return invalid(`${p}.via`, 'expected a path');
    let via: HierarchyVia;
    if (v.via.kind === 'path') {
      fields(v.via, ['kind', 'steps'], `${p}.via`);
      const steps = array(v.via.steps, `${p}.via.steps`);
      if (!steps.length || steps.length > HIERARCHY_LIMITS.hops)
        invalid(`${p}.via.steps`, 'expected one to four steps');
      via = { kind: 'path', steps: steps.map((s, j) => step(schema, s, `${p}.via.steps[${j}]`)) };
      const childNode = nodes.find((n) => n.key === child)!;
      if (childNode.kind === 'type' && via.steps[0]!.direction === 'out') {
        const owner = via.steps[0]!.ownerType;
        const is = (type: string, base: string, seen = new Set<string>()): boolean =>
          type === base ||
          (!seen.has(type) &&
            [schema.classes[type]?.parent, ...(schema.classes[type]?.mixins ?? [])].some(
              (t) => !!t && is(t, base, new Set(seen).add(type)),
            ));
        if (!is(childNode.type, owner) && !(childNode.includeSubtypes && is(owner, childNode.type)))
          invalid(`${p}.via.steps[0].ownerType`, 'path does not start at the child type');
      }
    } else if (
      v.via.kind === 'source' &&
      (v.via.match === 'directory-id' || v.via.match === 'document')
    ) {
      fields(v.via, ['kind', 'match'], `${p}.via`);
      via = { kind: 'source', match: v.via.match };
    } else return invalid(`${p}.via`, 'unknown path kind');
    return {
      key,
      parent,
      child,
      via,
      ...(v.alternative === undefined ? {} : { alternative: v.alternative as boolean }),
      ...(v.recursive === undefined ? {} : { recursive: v.recursive as boolean }),
    };
  });
  const checkAcyclic = (edges: (key: string) => string[], path: string) => {
    const done = new Set<string>(),
      visiting = new Set<string>();
    const visit = (key: string): void => {
      if (visiting.has(key)) invalid(path, 'cycle requires an explicit recursive branch');
      if (done.has(key)) return;
      visiting.add(key);
      for (const child of edges(key)) visit(child);
      visiting.delete(key);
      done.add(key);
    };
    nodes.forEach((n) => visit(n.key));
  };
  checkAcyclic(
    (key) =>
      branches
        .filter((b) => b.parent === key && !b.alternative && !b.recursive)
        .map((b) => b.child),
    'branches',
  );
  for (const n of nodes)
    if (n.kind === 'group') n.members.forEach((m, i) => ref(m, `nodes.${n.key}.members[${i}]`));
  checkAcyclic((key) => {
    const n = nodes.find((n) => n.key === key);
    return n?.kind === 'group' ? n.members : [];
  }, 'nodes');
  const labels: Record<string, string[]> = {};
  if (raw.labels !== undefined) {
    if (!mapping(raw.labels)) invalid('labels', 'expected label selectors');
    for (const [t, selectors] of Object.entries(raw.labels as Record<string, unknown>)) {
      className(schema, t, `labels.${t}`);
      labels[t] = array(selectors, `labels.${t}`).map((f, i) =>
        scalar(schema, t, f, `labels.${t}[${i}]`),
      );
    }
  }
  if (
    raw.unassigned !== undefined &&
    (typeof raw.unassigned !== 'string' || !['group', 'omit', 'error'].includes(raw.unassigned))
  )
    invalid('unassigned', 'expected group, omit or error');
  const placementBranches = new Set<string>();
  const placements = array(raw.placements ?? [], 'placements').map(
    (v, i): HierarchyPlacementPolicy => {
      const p = `placements[${i}]`;
      if (!mapping(v)) return invalid(p, 'expected a placement policy');
      fields(v, ['branch', 'backbone', 'consumers', 'includeDirectParent'], p);
      const branch = text(v.branch, `${p}.branch`);
      if (!branchKeys.has(branch)) invalid(`${p}.branch`, 'unknown branch');
      if (placementBranches.has(branch)) invalid(`${p}.branch`, 'duplicate placement policy');
      placementBranches.add(branch);
      const backbone = array(v.backbone, `${p}.backbone`).map((b, j) => {
        const k = text(b, `${p}.backbone[${j}]`);
        if (!branchKeys.has(k)) invalid(p, 'unknown backbone branch');
        return k;
      });
      const consumers = array(v.consumers, `${p}.consumers`).map((s, j) =>
        step(schema, s, `${p}.consumers[${j}]`),
      );
      if (!backbone.length || !consumers.length || consumers.length > 4)
        invalid(p, 'placement needs a backbone and one to four consumer steps');
      if (v.includeDirectParent !== undefined && typeof v.includeDirectParent !== 'boolean')
        invalid(p, 'expected boolean owner inclusion');
      return {
        branch,
        backbone,
        consumers,
        ...(v.includeDirectParent === undefined
          ? {}
          : { includeDirectParent: v.includeDirectParent as boolean }),
      };
    },
  );
  return {
    version: 1,
    nodes,
    roots,
    branches,
    labels,
    unassigned: (raw.unassigned ?? 'group') as 'group' | 'omit' | 'error',
    placements,
  };
}

export class HierarchyComputation {
  readonly nodes: HierarchyInputNode[] = [];
  readonly byId = new Map<string, HierarchyInputNode>();
  readonly byType = new Map<string, HierarchyInputNode[]>();
  readonly out = new Map<string, Map<string, Set<string>>>();
  readonly incoming = new Map<string, Map<string, Set<string>>>();
  readonly files = new Map<string, HierarchyInputNode[]>();
  private readonly populations = new Map<string, HierarchyInputNode[]>();
  work = 0;
  constructor(
    readonly input: HierarchyInput,
    readonly budget: number = HIERARCHY_LIMITS.work,
  ) {
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > HIERARCHY_LIMITS.work)
      invalid('workBudget', 'invalid work budget');
    for (const n of input.nodes()) {
      this.tick();
      if (this.nodes.length >= HIERARCHY_LIMITS.entities)
        throw new HierarchyError('HIERARCHY_LIMIT', 'entity input limit');
      this.nodes.push(n);
      this.byId.set(n.id, n);
      if (!this.byType.has(n.type)) this.byType.set(n.type, []);
      this.byType.get(n.type)!.push(n);
      if (n.source === n.file) {
        if (!this.files.has(n.file)) this.files.set(n.file, []);
        this.files.get(n.file)!.push(n);
      }
    }
    let count = 0;
    for (const e of input.links()) {
      if (++count > HIERARCHY_LIMITS.links)
        throw new HierarchyError('HIERARCHY_LIMIT', 'link input limit');
      this.tick();
      for (const [map, from, to] of [
        [this.out, e.from, e.to],
        [this.incoming, e.to, e.from],
      ] as const) {
        if (!map.has(e.relation)) map.set(e.relation, new Map());
        const byNode = map.get(e.relation)!;
        if (!byNode.has(from)) byNode.set(from, new Set());
        byNode.get(from)!.add(to);
      }
    }
  }
  tick(amount = 1) {
    this.work += amount;
    if (this.work > this.budget)
      throw new HierarchyError('HIERARCHY_LIMIT', 'hierarchy work budget exhausted');
  }
  is(type: string, parent: string, seen = new Set<string>()): boolean {
    if (type === parent) return true;
    if (seen.has(type)) return false;
    const c = this.input.schema.classes[type];
    return (
      !!c &&
      [c.parent, ...c.mixins].some(
        (p) => p !== undefined && this.is(p, parent, new Set(seen).add(type)),
      )
    );
  }
  population(type: string, includeSubtypes = true): HierarchyInputNode[] {
    if (!includeSubtypes) return this.byType.get(type) ?? [];
    if (!this.populations.has(type))
      this.populations.set(
        type,
        this.nodes.filter((n) => this.is(n.type, type)),
      );
    return this.populations.get(type)!;
  }
  follow(id: string, steps: HierarchyStep[]): Set<string> {
    let ids = new Set([id]);
    for (const s of steps) {
      const next = new Set<string>(),
        map = (s.direction === 'out' ? this.out : this.incoming).get(s.field);
      for (const from of ids)
        for (const to of map?.get(from) ?? []) {
          this.tick();
          const owner = this.byId.get(s.direction === 'out' ? from : to),
            target = this.byId.get(to);
          if (
            owner &&
            target &&
            this.is(owner.type, s.ownerType) &&
            (!s.targetTypes?.length || s.targetTypes.some((t) => this.is(target.type, t)))
          )
            next.add(to);
        }
      ids = next;
    }
    return ids;
  }
  sourceParents(n: HierarchyInputNode, match: 'document' | 'directory-id'): Set<string> {
    if (match === 'document') {
      if (n.source === n.file) return new Set();
      const roots = this.files.get(n.file) ?? [];
      return new Set(roots.length === 1 ? [roots[0]!.id] : []);
    }
    const parts = new Set(dirname(n.file).split(/[\\/]/));
    return new Set([...parts].filter((id) => id !== n.id && this.byId.has(id)));
  }
  assignments(definition: HierarchyDefinition, b: HierarchyBranch): Map<string, Set<string>> {
    const child = definition.nodes.find((n) => n.key === b.child)!,
      parent = definition.nodes.find((n) => n.key === b.parent)!;
    if (child.kind !== 'type' || parent.kind !== 'type')
      return invalid('branches', 'expected type branch');
    const parents = this.population(parent.type, parent.includeSubtypes ?? false),
      allowed = new Set(parents.map((p) => p.id)),
      out = new Map<string, Set<string>>();
    for (const n of this.population(child.type, child.includeSubtypes ?? false)) {
      this.tick();
      const ids =
        b.via.kind === 'path' ? this.follow(n.id, b.via.steps) : this.sourceParents(n, b.via.match);
      out.set(n.id, new Set([...ids].filter((id) => allowed.has(id))));
    }
    return out;
  }
}

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
        g.one / Math.max(1, g.assignments.size) >= 0.95 &&
        !['reference', 'dependency', 'mixed'].includes(String(role(g))),
    );
    const full = base.filter((g) => g.assignments.size / g.eligible >= 0.8);
    let candidates = full;
    if (candidates.some((g) => role(g) === 'context'))
      candidates = candidates.filter((g) => role(g) === 'context');
    else if (candidates.some((g) => g.physical / g.pairs >= 0.5))
      candidates = candidates.filter((g) => g.physical / g.pairs >= 0.5);
    if (candidates.some((g) => !g.many)) candidates = candidates.filter((g) => !g.many);
    const max = Math.max(0, ...candidates.map((g) => g.one / g.eligible));
    candidates = candidates.filter((g) => max - g.one / g.eligible <= 0.06);
    const maxPhysical = Math.max(0, ...candidates.map((g) => g.physical / g.pairs));
    candidates = candidates.filter((g) => maxPhysical - g.physical / g.pairs <= 0.15);
    const equivalent = (a: Profile, b: Profile) => {
      let shared = 0;
      for (const [id, ps] of a.assignments) {
        const qs = b.assignments.get(id);
        if (qs) {
          shared++;
          if (ps.size !== qs.size || [...ps].some((p) => !qs.has(p))) return false;
        }
      }
      return shared / Math.min(a.assignments.size, b.assignments.size) >= 0.8;
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
      ...base.filter((g) => !chosen.includes(g) && g.one >= 3 && g.origin === 'path'),
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

function hierarchyTypeAdjacency(
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
function hierarchyDistances(c: HierarchyComputation, start: string, adj: Map<string, Set<string>>) {
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
const separation = (distance: number | undefined) =>
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
    for (const [t, d] of descendants) if (t !== type) structureScore += 0.65 ** (d - 1);
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

type PlacementRef = {
  key: string;
  definition: string;
  entity?: string;
  branch?: string;
  ancestors: string[];
  path: string[];
  property?: string;
  unassigned?: boolean;
};
type RawPlacement = {
  key: string;
  entity?: string;
  branch?: string;
  property?: string;
  unassigned?: boolean;
  label?: string;
  basis: HierarchyBasis;
  flags?: string[];
};
export function hierarchyRef(value: PlacementRef): string {
  return 'hierarchy:' + Buffer.from(JSON.stringify(value)).toString('base64url');
}
function parseRef(value: string): PlacementRef {
  try {
    if (typeof value !== 'string' || !value.startsWith('hierarchy:') || value.length > 128 * 1024)
      throw Error();
    const v: unknown = JSON.parse(Buffer.from(value.slice(10), 'base64url').toString());
    if (
      !mapping(v) ||
      typeof v.key !== 'string' ||
      typeof v.definition !== 'string' ||
      !Array.isArray(v.path) ||
      v.path.length > HIERARCHY_LIMITS.depth ||
      !v.path.every((x) => typeof x === 'string') ||
      !Array.isArray(v.ancestors) ||
      v.ancestors.length > HIERARCHY_LIMITS.depth ||
      !v.ancestors.every((x) => typeof x === 'string')
    )
      throw Error();
    for (const k of ['entity', 'branch', 'property'])
      if (v[k] !== undefined && typeof v[k] !== 'string') throw Error();
    return v as unknown as PlacementRef;
  } catch {
    throw new HierarchyError('INVALID_HIERARCHY_REF', 'invalid placement reference');
  }
}
const scalarKey = (value: unknown): string | undefined =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))
    ? JSON.stringify([typeof value, value])
    : undefined;
const shortLabel = (s: string): { label: string; truncated: boolean } => {
  if (Buffer.byteLength(s) <= HIERARCHY_LIMITS.labelBytes) return { label: s, truncated: false };
  let result = '';
  for (const ch of s) {
    if (Buffer.byteLength(result + ch + '…') > HIERARCHY_LIMITS.labelBytes) break;
    result += ch;
  }
  return { label: result + '…', truncated: true };
};
export class HierarchyPlan {
  private readonly definitionKey: string;
  private readonly nodes: Map<string, HierarchyNodeDefinition>;
  private readonly maps = new Map<string, Map<string, Set<string>>>();
  private readonly reverse = new Map<string, Map<string, string[]>>();
  private readonly reachable = new Set<string>();
  private readonly entries = new Set<string>();
  private readonly derived = new Map<string, RawPlacement[]>();
  private readonly propertyGroups = new Map<
    string,
    Map<string, { label: string; ids: string[] }>
  >();
  private scores: Map<string, HierarchyInstanceScores> | undefined;
  private scoreWork = 0;
  private readonly propertyWork = new Map<string, number>();
  private readonly chargedProperties = new Set<string>();
  private readonly planWork: number;
  readonly unassigned: RawPlacement[] = [];
  deferred = 0;
  constructor(
    readonly computation: HierarchyComputation,
    readonly definition: HierarchyDefinition,
  ) {
    this.definitionKey = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
    this.nodes = new Map(definition.nodes.map((n) => [n.key, n]));
    const reach = (key: string, entry = false) => {
      if (entry) this.entries.add(key);
      if (this.reachable.has(key)) return;
      this.reachable.add(key);
      const n = this.nodes.get(key)!;
      if (n.kind === 'group') n.members.forEach((m) => reach(m, true));
      for (const b of definition.branches.filter((b) => b.parent === key && !b.alternative))
        reach(b.child);
    };
    definition.roots.forEach((k) => reach(k, true));
    for (const b of definition.branches.filter(
      (b) => !b.alternative && this.reachable.has(b.parent),
    ))
      this.maps.set(b.key, computation.assignments(definition, b));
    for (const policy of definition.placements ?? []) this.place(policy);
    for (const [key, map] of this.maps) {
      const rev = new Map<string, string[]>();
      for (const [id, ps] of map)
        for (const p of ps) {
          if (!rev.has(p)) rev.set(p, []);
          rev.get(p)!.push(id);
        }
      this.reverse.set(key, rev);
    }
    const derivedIds = new Set(
      [...this.derived.values()].flatMap((rows) =>
        rows.map((r) => JSON.stringify([r.key, r.entity])),
      ),
    );
    for (const key of this.reachable) {
      const n = this.nodes.get(key)!;
      if (n.kind !== 'type') continue;
      if (this.entries.has(key)) {
        const recursive = definition.branches.filter(
          (b) => !b.alternative && b.recursive && b.parent === key && b.child === key,
        );
        if (!recursive.length) continue;
        const seen = new Set(this.population(n, true).map((r) => r.entity!)),
          queue = [...seen];
        for (let i = 0; i < queue.length; i++)
          for (const b of recursive)
            for (const child of this.reverse.get(b.key)?.get(queue[i]!) ?? []) {
              computation.tick();
              if (!seen.has(child)) {
                seen.add(child);
                queue.push(child);
              }
            }
        for (const e of computation.population(n.type, n.includeSubtypes ?? false))
          if (!seen.has(e.id))
            this.unassigned.push({
              key,
              entity: e.id,
              branch: 'unassigned',
              basis: 'derived-placement',
              flags: ['unassigned', 'cycle'],
            });
        continue;
      }
      const incoming = definition.branches.filter(
        (b) => !b.alternative && b.child === key && this.maps.has(b.key),
      );
      for (const entity of computation.population(n.type, n.includeSubtypes ?? false)) {
        if (
          incoming.some((b) => (this.maps.get(b.key)?.get(entity.id)?.size ?? 0) > 0) ||
          derivedIds.has(JSON.stringify([key, entity.id]))
        )
          continue;
        this.unassigned.push({
          key,
          entity: entity.id,
          branch: 'unassigned',
          basis: 'derived-placement',
          flags: ['unassigned'],
        });
      }
    }
    if (definition.unassigned === 'error' && this.unassigned.length)
      throw new HierarchyError('INVALID_HIERARCHY', 'definition leaves unassigned entities');
    this.planWork = computation.work;
  }
  private place(policy: HierarchyPlacementPolicy) {
    const c = this.computation,
      branch = this.definition.branches.find((b) => b.key === policy.branch)!;
    const original = this.maps.get(policy.branch);
    if (!original) {
      this.deferred++;
      return;
    }
    const parent = new Map<string, string>(),
      keyByEntity = new Map<string, Set<string>>();
    let valid = true;
    for (const key of policy.backbone) {
      const b = this.definition.branches.find((b) => b.key === key)!,
        map = this.maps.get(key);
      if (!map) {
        valid = false;
        break;
      }
      for (const [id, ps] of map) {
        if (ps.size > 1) {
          valid = false;
          break;
        }
        if (ps.size) {
          const p = [...ps][0]!;
          if (parent.has(id) && parent.get(id) !== p) valid = false;
          parent.set(id, p);
          for (const [e, k] of [
            [id, b.child],
            [p, b.parent],
          ]) {
            if (!keyByEntity.has(e!)) keyByEntity.set(e!, new Set());
            keyByEntity.get(e!)!.add(k!);
          }
        }
      }
    }
    const ancestors = (id: string): string[] | undefined => {
      const seen = new Set<string>(),
        out: string[] = [];
      while (id) {
        c.tick();
        if (seen.has(id) || out.length > HIERARCHY_LIMITS.depth) return undefined;
        seen.add(id);
        out.push(id);
        id = parent.get(id)!;
      }
      return out;
    };
    if (valid)
      for (const id of parent.keys())
        if (!ancestors(id)) {
          valid = false;
          break;
        }
    for (const [id, ps] of original) {
      const consumers = c.follow(id, policy.consumers);
      if (consumers.size <= 1 && ps.size) continue;
      if (!consumers.size) continue;
      const ids = new Set(consumers);
      if (policy.includeDirectParent) ps.forEach((p) => ids.add(p));
      const paths = valid ? [...ids].map(ancestors) : [];
      const first = paths[0];
      const common =
        first && paths.every((p) => p !== undefined)
          ? first.find((a) => paths.every((p) => p.includes(a)))
          : undefined;
      const keys = common ? keyByEntity.get(common) : undefined;
      if (!common || common === id || keys?.size !== 1) {
        ps.clear();
        this.deferred++;
        continue;
      }
      ps.clear();
      const key = [...keys][0]!;
      const raw: RawPlacement = {
        key: branch.child,
        entity: id,
        branch: branch.key,
        basis: 'derived-placement',
        flags: ['lca-placement'],
      };
      const slot = JSON.stringify([key, common]);
      if (!this.derived.has(slot)) this.derived.set(slot, []);
      this.derived.get(slot)!.push(raw);
    }
  }
  /** Whole selected scope, not the current page; no narrative or property reads. */
  private instanceScores(): Map<string, HierarchyInstanceScores> {
    if (this.scores) {
      this.computation.tick(this.scoreWork);
      return this.scores;
    }
    const startWork = this.computation.work;
    const c = this.computation,
      scope = new Map<string, string>(),
      byType = new Map<string, string[]>();
    for (const key of this.reachable) {
      const n = this.nodes.get(key)!;
      if (n.kind === 'group') continue;
      for (const e of c.population(n.type, n.kind === 'type' && (n.includeSubtypes ?? false))) {
        c.tick();
        scope.set(e.id, e.type);
      }
    }
    const raw = new Map<string, HierarchyInstanceScores>();
    for (const [id, type] of scope) {
      c.tick();
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(id);
      raw.set(id, { structureScore: 0, connectivityScore: 0 });
    }
    const parents = new Map<string, Set<string>>();
    const add = (child: string, parent: string) => {
      c.tick();
      if (!scope.has(child) || !scope.has(parent) || child === parent) return;
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child)!.add(parent);
    };
    for (const map of this.maps.values())
      for (const [id, ps] of map) for (const parent of ps) add(id, parent);
    for (const [slot, rows] of this.derived) {
      const [, parent] = JSON.parse(slot) as [string, string];
      for (const row of rows) if (row.entity) add(row.entity, parent);
    }
    // Multi-source BFS finds nearest actual descendant of each different type.
    for (const [type, ids] of [...byType].sort(([a], [b]) => compare(a, b))) {
      const distance = new Map(ids.map((id) => [id, 0])),
        queue = [...ids];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]!,
          d = distance.get(id)!;
        c.tick();
        if (d && scope.get(id) !== type) raw.get(id)!.structureScore += 0.65 ** (d - 1);
        for (const p of parents.get(id) ?? []) {
          c.tick();
          if (!distance.has(p)) {
            distance.set(p, d + 1);
            queue.push(p);
          }
        }
      }
    }
    const { undirected } = hierarchyTypeAdjacency(
        {
          ...this.definition,
          branches: this.definition.branches.filter((b) => this.maps.has(b.key)),
        },
        [...byType.keys()],
        c,
      ),
      weights = new Map<string, Map<string, number>>();
    for (const type of byType.keys()) {
      const d = hierarchyDistances(c, type, undirected);
      weights.set(
        type,
        new Map([...byType.keys()].map((other) => [other, separation(d.get(other))])),
      );
    }
    const neighborTypes = new Map<string, Set<string>>();
    const neighbor = (id: string, other: string) => {
      const type = scope.get(id),
        target = scope.get(other);
      if (!type || !target || type === target) return;
      if (!neighborTypes.has(id)) neighborTypes.set(id, new Set());
      neighborTypes.get(id)!.add(target);
    };
    for (const map of c.out.values())
      for (const [from, targets] of map)
        for (const to of targets) {
          c.tick();
          neighbor(from, to);
          neighbor(to, from);
        }
    for (const [id, types] of neighborTypes)
      for (const type of [...types].sort(compare)) {
        c.tick();
        raw.get(id)!.connectivityScore += weights.get(scope.get(id)!)!.get(type)!;
      }
    for (const ids of byType.values()) {
      let ms = 0,
        mc = 0;
      for (const id of ids) {
        const r = raw.get(id)!;
        ms = Math.max(ms, r.structureScore);
        mc = Math.max(mc, r.connectivityScore);
      }
      for (const id of ids) {
        const r = raw.get(id)!;
        r.structureScore = ms ? r.structureScore / ms : 0;
        r.connectivityScore = mc ? r.connectivityScore / mc : 0;
      }
    }
    this.scoreWork = c.work - startWork;
    this.scores = raw;
    return raw;
  }
  private population(
    n: Extract<HierarchyNodeDefinition, { kind: 'type' }>,
    entry = false,
  ): RawPlacement[] {
    const recursive = this.definition.branches.filter(
      (b) => !b.alternative && b.recursive && b.child === n.key && b.parent === n.key,
    );
    return this.computation
      .population(n.type, n.includeSubtypes ?? false)
      .filter(
        (e) => !entry || !recursive.some((b) => (this.maps.get(b.key)?.get(e.id)?.size ?? 0) > 0),
      )
      .map((e) => ({ key: n.key, entity: e.id, basis: 'model' }));
  }
  private properties(
    n: Extract<HierarchyNodeDefinition, { kind: 'property' }>,
  ): Map<string, { label: string; ids: string[] }> {
    const startWork = this.computation.work;
    if (!this.propertyGroups.has(n.key)) {
      const groups = new Map<string, { label: string; ids: string[] }>();
      for (const e of this.computation.population(n.type, false)) {
        this.computation.tick();
        const value = this.computation.input.property(e.id, n.field),
          key = scalarKey(value);
        if (key === undefined && value !== null && value !== undefined)
          invalid(`nodes.${n.key}.field`, 'group value is not a single scalar');
        const token =
          key === undefined ? 'missing' : createHash('sha256').update(key).digest('hex');
        if (!groups.has(token))
          groups.set(token, { label: key === undefined ? 'Unassigned' : String(value), ids: [] });
        groups.get(token)!.ids.push(e.id);
      }
      this.propertyGroups.set(n.key, groups);
      this.propertyWork.set(n.key, this.computation.work - startWork);
    } else if (!this.chargedProperties.has(n.key)) {
      this.computation.tick(this.propertyWork.get(n.key));
    }
    this.chargedProperties.add(n.key);
    return this.propertyGroups.get(n.key)!;
  }
  private entry(key: string): RawPlacement[] {
    const n = this.nodes.get(key)!;
    if (n.kind === 'type') return this.population(n, true);
    return [{ key, basis: n.kind === 'property' ? 'property' : n.basis, label: n.label ?? n.key }];
  }
  children(ref?: PlacementRef): RawPlacement[] {
    if (!ref) {
      const rows = this.definition.roots.flatMap((k) => this.entry(k));
      if (this.unassigned.length && this.definition.unassigned !== 'omit')
        rows.push({
          key: '',
          unassigned: true,
          label: 'Unassigned',
          basis: 'derived-placement',
          flags: ['unassigned'],
        });
      return rows;
    }
    if (ref.definition !== this.definitionKey)
      throw new HierarchyError(
        'INVALID_HIERARCHY_REF',
        'placement belongs to a different definition',
      );
    if (ref.unassigned) return this.unassigned;
    const n = this.nodes.get(ref.key);
    if (!n || !this.reachable.has(ref.key))
      throw new HierarchyError('INVALID_HIERARCHY_REF', 'unknown definition occurrence');
    if (
      ref.path.length >= HIERARCHY_LIMITS.depth ||
      (ref.entity && ref.ancestors.includes(ref.entity))
    )
      return [];
    if (n.kind === 'group') {
      if (ref.entity || ref.property)
        throw new HierarchyError(
          'INVALID_HIERARCHY_REF',
          'group reference cannot contain an entity',
        );
      return n.members.flatMap((k) => this.entry(k));
    }
    if (n.kind === 'property') {
      const groups = this.properties(n);
      if (ref.property) {
        const group = groups.get(ref.property);
        if (!group) throw new HierarchyError('INVALID_HIERARCHY_REF', 'unknown property group');
        return group.ids.map((entity) => ({ key: n.key, entity, basis: 'property' }));
      }
      if (ref.entity) return [];
      return [...groups].map(([property, g]) => ({
        key: n.key,
        property,
        label: g.label,
        basis: 'property',
        ...(property === 'missing' ? { flags: ['unassigned'] } : {}),
      }));
    }
    const entity = ref.entity ? this.computation.byId.get(ref.entity) : undefined;
    if (
      !entity ||
      (n.includeSubtypes ? !this.computation.is(entity.type, n.type) : entity.type !== n.type)
    )
      throw new HierarchyError('INVALID_HIERARCHY_REF', 'entity does not belong to the occurrence');
    const rows: RawPlacement[] = [];
    for (const b of this.definition.branches.filter(
      (b) => b.parent === ref.key && !b.alternative,
    )) {
      for (const childId of this.reverse.get(b.key)?.get(entity.id) ?? [])
        rows.push({
          key: b.child,
          entity: childId,
          branch: b.key,
          basis: b.via.kind === 'source' ? 'source-context' : 'model',
        });
    }
    rows.push(...(this.derived.get(JSON.stringify([ref.key, ref.entity])) ?? []));
    return rows;
  }
  page(options: HierarchyReadOptions, offset = 0): { page: HierarchyPage; next?: number } {
    this.computation.work = this.planWork;
    this.chargedProperties.clear();
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > HIERARCHY_LIMITS.page)
      invalid('limit', 'invalid page limit');
    if (options.includeScores !== undefined && typeof options.includeScores !== 'boolean')
      invalid('includeScores', 'expected boolean');
    const parent = options.parent ? parseRef(options.parent) : undefined;
    const rows = this.children(parent);
    rows.sort(
      (a, b) =>
        compare(a.key, b.key) ||
        compare(a.entity ?? a.property ?? '', b.entity ?? b.property ?? '') ||
        compare(a.branch ?? '', b.branch ?? ''),
    );
    const selected = rows.slice(offset, offset + limit);
    const scores =
      options.includeScores && selected.some((r) => r.entity) ? this.instanceScores() : undefined;
    const items = selected.map((raw) => {
      const ancestors = parent?.entity
        ? [...parent.ancestors, parent.entity]
        : (parent?.ancestors ?? []);
      const r: PlacementRef = {
        key: raw.key,
        definition: this.definitionKey,
        ancestors,
        path: parent
          ? [
              ...parent.path,
              JSON.stringify([parent.key, parent.entity, parent.branch, parent.property]),
            ]
          : [],
        ...(raw.entity ? { entity: raw.entity } : {}),
        ...(raw.property ? { property: raw.property } : {}),
        ...(raw.branch ? { branch: raw.branch } : {}),
        ...(raw.unassigned ? { unassigned: true } : {}),
      };
      let label = raw.label ?? this.nodes.get(raw.key)?.label ?? raw.entity ?? raw.key;
      const entity = raw.entity ? this.computation.byId.get(raw.entity) : undefined;
      if (entity) {
        label = entity.id;
        for (const field of this.definition.labels?.[entity.type] ?? []) {
          const v = this.computation.input.property(entity.id, field);
          if (scalarKey(v) !== undefined) {
            label = String(v);
            break;
          }
        }
      }
      const short = shortLabel(label),
        flags = [...(raw.flags ?? [])];
      if (short.truncated) flags.push('label-truncated');
      const atLimit = r.path.length >= HIERARCHY_LIMITS.depth;
      if (atLimit) flags.push('depth-limit');
      const cycle = !!raw.entity && ancestors.includes(raw.entity);
      if (cycle) flags.push('cycle');
      const children = atLimit || cycle ? [] : this.children(r);
      const common = {
        ref: hierarchyRef(r),
        label: short.label,
        basis: raw.basis,
        branchRef: raw.branch ?? raw.key,
        expandable:
          atLimit || (!children.length && this.deferred)
            ? ('unknown' as const)
            : children.length
              ? ('yes' as const)
              : ('no' as const),
        directChildren: atLimit
          ? { status: 'unknown' as const }
          : {
              status: this.deferred ? ('lower-bound' as const) : ('exact' as const),
              value: children.length,
            },
        ...(flags.length ? { flags } : {}),
      };
      return entity
        ? {
            ...common,
            kind: 'entity' as const,
            entityId: entity.id,
            type: entity.type,
            ...(scores?.has(entity.id) ? { scores: { ...scores.get(entity.id)! } } : {}),
          }
        : { ...common, kind: 'group' as const };
    });
    const remaining = Math.max(0, rows.length - offset - items.length);
    return {
      page: {
        items,
        coverage: {
          complete: remaining === 0,
          returned: items.length,
          remaining,
          reason: remaining ? 'page-limit' : items.length ? 'complete' : 'empty',
        },
        compute: { complete: true, examined: this.computation.work },
        placement: {
          complete: this.unassigned.length === 0 && this.deferred === 0,
          unassigned: this.unassigned.length,
          deferred: this.deferred,
        },
      },
      ...(remaining ? { next: offset + items.length } : {}),
    };
  }
}
