import { digest } from './stable-json.js';
import { isAbsolute, resolve } from 'node:path';
import {
  HierarchyComputation,
  HierarchyPlan,
  HierarchyError,
  proposeHierarchy,
  validateHierarchy,
  type HierarchyInput,
  type HierarchyProposal,
  type HierarchyProposalOptions,
  type HierarchyReadOptions,
  type HierarchyPage,
} from '@khaale/lore-graph';
import { getGraphView, SdkError, type ReadSource, type SnapshotInfo } from './reader.js';

export { HierarchyError };
export type {
  HierarchyTypeScores,
  HierarchyInstanceScores,
  HierarchyDefinition,
  HierarchyBranch,
  HierarchyNodeDefinition,
  HierarchyVia,
  HierarchyStep,
  HierarchyPlacementPolicy,
  HierarchyBasis,
  HierarchyQuantity,
  HierarchyPlacementNode,
  HierarchyEvaluation,
  HierarchyProposalOptions,
  HierarchyReadOptions,
} from '@khaale/lore-graph';
export type HierarchyProposalResult = HierarchyProposal & { snapshot: SnapshotInfo };
export type HierarchyReadResult = HierarchyPage & { snapshot: SnapshotInfo };
export interface HierarchyReader {
  propose(options?: HierarchyProposalOptions): Promise<HierarchyProposalResult>;
  read(options: HierarchyReadOptions): Promise<HierarchyReadResult>;
}
export function jsonHierarchyInput(source: ReadSource): HierarchyInput {
  return {
    schema: source.schema,
    root: source.root ?? '',
    *nodes() {
      for (const e of source.entities) {
        const p = e.provenance;
        const file = p.physicalPath || p.source.split('#')[0]!;
        const absolute = isAbsolute(file) ? file : resolve(source.root ?? '.', file);
        const locator = p.source.includes('#')
          ? absolute + p.source.slice(p.source.indexOf('#'))
          : absolute;
        yield { id: e.id, type: e.kind, file: absolute, source: locator };
      }
    },
    *links() {
      for (const e of getGraphView(source).edges)
        for (const p of e.presentations) yield { from: p.from, relation: p.relation, to: p.to };
    },
    property: (id, field) => source.entitiesById.get(id)?.properties[field],
  };
}
/** Uses existing reader lifecycle and ordinary opaque continuation validation only. */
export class HierarchyReaderImpl implements HierarchyReader {
  private cached: { key: string; plan: HierarchyPlan } | undefined;
  constructor(
    private readonly source: ReadSource,
    private scoped = false,
  ) {}
  dispose(): void {
    this.cached = undefined;
    this.scoped = false;
  }
  private input() {
    return this.source.hierarchyInput?.() ?? jsonHierarchyInput(this.source);
  }
  async propose(options: HierarchyProposalOptions = {}): Promise<HierarchyProposalResult> {
    await this.source.revalidate();
    const c = new HierarchyComputation(this.input(), options.workBudget);
    return { ...proposeHierarchy(c, options), snapshot: structuredClone(this.source.state) };
  }
  async read(options: HierarchyReadOptions): Promise<HierarchyReadResult> {
    try {
      await this.source.revalidate();
      const definition = validateHierarchy(this.source.schema, options.definition);
      const key = digest({
        definition,
        parent: options.parent ?? null,
        state: this.source.state.id,
      });
      let offset = 0;
      if (options.continuation) {
        try {
          const v = JSON.parse(Buffer.from(options.continuation, 'base64url').toString()) as {
            key: string;
            offset: number;
          };
          if (v.key !== key || !Number.isSafeInteger(v.offset) || v.offset < 0) throw Error();
          offset = v.offset;
        } catch {
          throw new SdkError('INVALID_CONTINUATION', 'invalid hierarchy continuation');
        }
      }
      const analysisKey = digest({
        definitionText: JSON.stringify(definition),
        budget: options.workBudget ?? null,
        state: this.source.state.id,
      });
      if (this.cached?.key !== analysisKey) this.cached = undefined;
      const plan =
        this.cached?.plan ??
        new HierarchyPlan(new HierarchyComputation(this.input(), options.workBudget), definition);
      const r = plan.page({ ...options, definition }, offset);
      if (this.scoped) this.cached = { key: analysisKey, plan };
      return {
        ...r.page,
        ...(r.next === undefined
          ? {}
          : {
              continuation: Buffer.from(JSON.stringify({ key, offset: r.next })).toString(
                'base64url',
              ),
            }),
        snapshot: structuredClone(this.source.state),
      };
    } catch (error) {
      this.cached = undefined;
      throw error;
    }
  }
}
