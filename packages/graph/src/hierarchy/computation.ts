import { dirname } from 'node:path';
import { isRuntimeSubclass } from '@khaale/lore-schema';
import {
  HIERARCHY_LIMITS,
  HierarchyError,
  invalid,
  type HierarchyInput,
  type HierarchyInputNode,
  type HierarchyDefinition,
  type HierarchyBranch,
  type HierarchyStep,
} from './definition.js';

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
  is(type: string, parent: string): boolean {
    return isRuntimeSubclass(this.input.schema, type, parent);
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
