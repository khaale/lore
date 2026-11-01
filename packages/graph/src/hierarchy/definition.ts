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
export const compare = (a: string, b: string) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
export const invalid = (path: string, message: string): never => {
  throw new HierarchyError('INVALID_HIERARCHY', message, path);
};
export const mapping = (v: unknown): v is Record<string, unknown> =>
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
export function className(schema: RuntimeSchemaIR, value: unknown, path: string): string {
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
