import { createHash } from 'node:crypto';
import {
  HIERARCHY_LIMITS,
  HierarchyError,
  invalid,
  mapping,
  compare,
  type HierarchyBasis,
  type HierarchyDefinition,
  type HierarchyNodeDefinition,
  type HierarchyPlacementPolicy,
  type HierarchyInstanceScores,
  type HierarchyReadOptions,
  type HierarchyPage,
} from './definition.js';
import type { HierarchyComputation } from './computation.js';
import {
  hierarchyTypeAdjacency,
  hierarchyDistances,
  separation,
  STRUCTURE_DECAY,
} from './scores.js';

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
        const population = computation.population(n.type, n.includeSubtypes ?? false);
        computation.tick(population.length);
        for (const e of population)
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
      const population = computation.population(n.type, n.includeSubtypes ?? false);
      computation.tick(population.length);
      for (const entity of population) {
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
      if (!consumers.size) continue;
      const ids = new Set(consumers);
      if (policy.includeDirectParent) ps.forEach((p) => ids.add(p));
      if (ids.size <= 1 && ps.size) continue;
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
        if (d && scope.get(id) !== type) raw.get(id)!.structureScore += STRUCTURE_DECAY ** (d - 1);
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
    const population = this.computation.population(n.type, n.includeSubtypes ?? false);
    // Charge before allocating occurrences, including repeated type placements.
    this.computation.tick(population.length);
    return population
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
    this.computation.tick();
    return [{ key, basis: n.kind === 'property' ? 'property' : n.basis, label: n.label ?? n.key }];
  }
  children(ref?: PlacementRef): RawPlacement[] {
    if (!ref) {
      const rows = this.definition.roots.flatMap((k) => this.entry(k));
      if (this.unassigned.length && this.definition.unassigned !== 'omit') {
        this.computation.tick();
        rows.push({
          key: '',
          unassigned: true,
          label: 'Unassigned',
          basis: 'derived-placement',
          flags: ['unassigned'],
        });
      }
      return rows;
    }
    if (ref.definition !== this.definitionKey)
      throw new HierarchyError(
        'INVALID_HIERARCHY_REF',
        'placement belongs to a different definition',
      );
    if (ref.unassigned) {
      this.computation.tick(this.unassigned.length);
      return this.unassigned;
    }
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
        this.computation.tick(group.ids.length);
        return group.ids.map((entity) => ({ key: n.key, entity, basis: 'property' }));
      }
      if (ref.entity) return [];
      this.computation.tick(groups.size);
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
      const childIds = this.reverse.get(b.key)?.get(entity.id) ?? [];
      this.computation.tick(childIds.length);
      for (const childId of childIds)
        rows.push({
          key: b.child,
          entity: childId,
          branch: b.key,
          basis: b.via.kind === 'source' ? 'source-context' : 'model',
        });
    }
    const derived = this.derived.get(JSON.stringify([ref.key, ref.entity])) ?? [];
    this.computation.tick(derived.length);
    for (const row of derived) rows.push(row);
    return rows;
  }
  page(options: HierarchyReadOptions, offset = 0): { page: HierarchyPage; next?: number } {
    // Replay logical evaluation cost on cache hits so a warm plan cannot bypass
    // workBudget. Lazy scores/groups charge their saved cost once per page.
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
