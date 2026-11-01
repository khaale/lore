// Private computation boundary. Never re-export this package from @khaale/lore.
export * from './hierarchy.js';
import { referencePaths, type RuntimeSchemaIR } from '@khaale/lore-schema';
import type { GraphSnapshot } from '@graphty/graph-format';

export const ANALYSIS_LIMITS = {
  nodes: 100_000,
  edges: 1_000_000,
  output: 100,
  representatives: 3,
} as const;
export const ANALYSIS_ERROR = {
  INVALID: 'INVALID_ANALYSIS',
  LIMIT: 'ANALYSIS_LIMIT',
  FAILED: 'ANALYSIS_FAILED',
  CLOSED: 'ANALYSIS_CLOSED',
} as const;
export class AnalysisError extends Error {
  constructor(
    readonly code: (typeof ANALYSIS_ERROR)[keyof typeof ANALYSIS_ERROR],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AnalysisError';
  }
}
export type Identity = { id: string; type: string };
export type InputIdentity = Identity & { key?: number };
export type Triple = { from: string | number; relation: string; to: string | number };
export type AnalysisInput = {
  generation: string | object;
  schema: RuntimeSchemaIR;
  nodes(): Iterable<InputIdentity>;
  // Already canonical, non-generic, one triple per logical edge. Repeatable, not a stream cursor.
  edges(): Iterable<Triple>;
  check(): void;
};
export type Projection = {
  types?: readonly string[];
  relations?: readonly string[];
  direction?: 'out' | 'in' | 'both';
};
export type RankingOptions = { balance?: 'none' | 'type'; limit?: number };
export type Ranked = Identity & { score: number };
export type Group = { anchorId: string; size: number; mass: number; representatives: Ranked[] };
export type AnalysisResult<T> = {
  items: T[];
  isolates: number;
  coverage: {
    complete: boolean;
    examined: number;
    returned: number;
    remaining: number;
    reason: 'complete' | 'empty' | 'output-limit';
  };
};
const compare = (a: string, b: string) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
const fail = (message: string): never => {
  throw new AnalysisError(ANALYSIS_ERROR.INVALID, message);
};
function descendants(
  schema: RuntimeSchemaIR,
  child: string,
  parent: string,
  seen = new Set<string>(),
): boolean {
  if (child === parent) return true;
  if (seen.has(child)) return false;
  seen.add(child);
  const c = schema.classes[child];
  return (
    !!c &&
    [c.parent, ...c.mixins].some((p) => p !== undefined && descendants(schema, p, parent, seen))
  );
}
function projection(input: AnalysisInput, options: Projection) {
  const classes = Object.values(input.schema.classes);
  const normalize = (
    values: readonly string[] | undefined,
    resolve: (s: string) => string | undefined,
  ) => {
    if (values === undefined) return undefined;
    if (!Array.isArray(values) || !values.length) fail('Analysis selectors must not be empty');
    return [
      ...new Set(values.map((v) => resolve(v) ?? fail(`Unknown analysis selector ${v}`))),
    ].sort(compare);
  };
  const types = normalize(
    options.types,
    (v) => classes.find((c) => c.name === v || c.typeId === v)?.name,
  );
  const names = new Set(
    classes.flatMap((c) => referencePaths(input.schema, c.name).map((r) => r.path)),
  );
  const relations = normalize(options.relations, (v) => (names.has(v) ? v : undefined));
  const direction = options.direction ?? 'out';
  if (!['out', 'in', 'both'].includes(direction)) fail('Invalid analysis direction');
  return { types, relations, direction };
}
function bound(options: RankingOptions) {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ANALYSIS_LIMITS.output)
    fail('Invalid analysis output limit');
  const balance = options.balance ?? 'none';
  if (!['none', 'type'].includes(balance)) fail('Invalid balance policy');
  return { limit, balance };
}
function result<T>(
  all: T[],
  limit: number,
  isolates: number,
  total = all.length,
): AnalysisResult<T> {
  const items = all.slice(0, limit),
    remaining = total - items.length;
  return {
    items,
    isolates,
    coverage: {
      complete: !remaining,
      examined: total,
      returned: items.length,
      remaining,
      reason: !total ? 'empty' : remaining ? 'output-limit' : 'complete',
    },
  };
}

class Topology {
  private directed: GraphSnapshot | undefined;
  private undirected: GraphSnapshot | undefined;
  private partition: Uint32Array | undefined;
  private constructor(
    private readonly ids: string[],
    private readonly types: string[],
    private readonly src: Uint32Array<ArrayBuffer>,
    private readonly dst: Uint32Array<ArrayBuffer>,
    readonly isolates: number,
    private readonly direction: 'out' | 'in' | 'both',
  ) {}
  static build(input: AnalysisInput, scope: ReturnType<typeof projection>) {
    input.check();
    const nodes: InputIdentity[] = [],
      positions = new Map<string | number, number>();
    for (const node of input.nodes()) {
      if (scope.types && !scope.types.some((t) => descendants(input.schema, node.type, t)))
        continue;
      const key = node.key ?? node.id;
      if (positions.has(key)) fail(`Duplicate analysis identity ${node.id}`);
      if (nodes.length >= ANALYSIS_LIMITS.nodes)
        throw new AnalysisError(ANALYSIS_ERROR.LIMIT, 'Projected analysis node limit exceeded');
      positions.set(key, nodes.length);
      nodes.push({
        id: node.id,
        type: node.type,
        ...(node.key === undefined ? {} : { key: node.key }),
      });
    }
    const participating = new Uint8Array(nodes.length),
      relations = scope.relations && new Set(scope.relations);
    const eligible = (e: Triple) =>
      positions.has(e.from) && positions.has(e.to) && (!relations || relations.has(e.relation));
    let count = 0;
    for (const e of input.edges())
      if (eligible(e)) {
        if (++count > ANALYSIS_LIMITS.edges)
          throw new AnalysisError(ANALYSIS_ERROR.LIMIT, 'Projected analysis edge limit exceeded');
        participating[positions.get(e.from)!] = 1;
        participating[positions.get(e.to)!] = 1;
      }
    const selected = nodes.filter((_, i) => participating[i]).sort((a, b) => compare(a.id, b.id));
    const dense = new Map<string | number, number>(
      selected.map((node, i) => [node.key ?? node.id, i]),
    );
    const src = new Uint32Array(count),
      dst = new Uint32Array(count);
    let at = 0;
    for (const e of input.edges())
      if (eligible(e)) {
        if (at >= count) fail('Analysis source changed while loading');
        src[at] = dense.get(scope.direction === 'in' ? e.to : e.from)!;
        dst[at++] = dense.get(scope.direction === 'in' ? e.from : e.to)!;
      }
    if (at !== count) fail('Analysis source changed while loading');
    input.check();
    return new Topology(
      selected.map((n) => n.id),
      selected.map((n) => n.type),
      src,
      dst,
      nodes.length - selected.length,
      scope.direction,
    );
  }
  get stats() {
    return {
      nodes: this.ids.length,
      edges: this.src.length,
      isolates: this.isolates,
      numericBytes:
        this.src.byteLength +
        this.dst.byteLength +
        (this.directed?.byteLength({ views: true }) ?? 0) +
        (this.undirected?.byteLength({ views: true }) ?? 0) +
        (this.partition?.byteLength ?? 0),
    };
  }
  private async graph(undirected: boolean) {
    const slot = undirected ? 'undirected' : 'directed';
    if (!this[slot]) {
      const { fromEdgeArrays } = await import('@graphty/graph-format');
      this[slot] = fromEdgeArrays(
        { directed: !undirected, nodeCount: this.ids.length, src: this.src, dst: this.dst },
        { duplicateEdges: undirected ? 'first' : 'keep' },
      );
    }
    return this[slot];
  }
  private priors(balance: 'none' | 'type') {
    const counts = new Map<string, number>();
    for (const t of this.types) counts.set(t, (counts.get(t) ?? 0) + 1);
    const sizes = [...counts.values()].sort((a, b) => a - b),
      middle = Math.floor(sizes.length / 2);
    const median = sizes.length % 2 ? sizes[middle]! : (sizes[middle - 1]! + sizes[middle]!) / 2;
    const q = Float64Array.from(this.types, (t) =>
      balance === 'none' ? 1 : 1 / (1 + counts.get(t)! / median),
    );
    const sum = q.reduce((s, v) => s + v, 0);
    return q.map((v) => v / sum);
  }
  private async scores(undirected: boolean, balance: 'none' | 'type') {
    const graph = await this.graph(undirected),
      { pageRank, personalizedPageRank } = await import('@graphty/algorithms');
    const options = { dampingFactor: 0.85, maxIterations: 200, tolerance: 1e-10 };
    const output =
      balance === 'none'
        ? pageRank(graph, options)
        : personalizedPageRank(graph, this.priors(balance), options);
    const sum = output.scores.reduce((s, v) => s + v, 0);
    if (!output.converged || !(sum > 0) || output.scores.some((v) => !Number.isFinite(v) || v < 0))
      throw new AnalysisError(
        ANALYSIS_ERROR.FAILED,
        'PageRank did not produce finite converged scores',
      );
    // Pinned package uses a legacy dangling-mass scale. Reference fixtures verify
    // normalized fixed-point equivalence; raw library scores never leave this boundary.
    return output.scores.map((v) => v / sum);
  }
  private ranked(i: number, score: number): Ranked {
    return { id: this.ids[i]!, type: this.types[i]!, score };
  }
  async rank(options: RankingOptions = {}) {
    const { limit, balance } = bound(options);
    if (!this.ids.length) return result<Ranked>([], limit, this.isolates);
    const scores = await this.scores(this.direction === 'both', balance);
    const order = [...scores.keys()].sort(
      (a, b) => scores[b]! - scores[a]! || compare(this.ids[a]!, this.ids[b]!),
    );
    return result(
      order.slice(0, limit).map((i) => this.ranked(i, scores[i]!)),
      limit,
      this.isolates,
      order.length,
    );
  }
  async communities(options: RankingOptions = {}) {
    const { limit, balance } = bound(options);
    if (!this.ids.length) return result<Group>([], limit, this.isolates);
    if (!this.partition) {
      const graph = await this.graph(true),
        { leiden } = await import('@graphty/algorithms');
      const p = leiden(graph, {
        resolution: 1,
        randomSeed: 42,
        maxIterations: 10,
        threshold: 1e-7,
      });
      if (
        !Number.isFinite(p.modularity) ||
        p.labels.length !== this.ids.length ||
        p.labels.some((v) => v >= this.ids.length)
      )
        throw new AnalysisError(ANALYSIS_ERROR.FAILED, 'Invalid Leiden partition');
      this.partition = p.labels;
    }
    const scores = await this.scores(true, balance),
      q = this.priors(balance),
      groups = new Map<number, number[]>();
    for (let i = 0; i < this.ids.length; i++) {
      const label = this.partition[i]!;
      const group = groups.get(label) ?? [];
      group.push(i);
      groups.set(label, group);
    }
    const summaries = [...groups.values()]
      .map((members) => {
        const anchorId = this.ids[members[0]!]!;
        const order = [...members].sort(
          (a, b) => scores[b]! - scores[a]! || compare(this.ids[a]!, this.ids[b]!),
        );
        return {
          anchorId,
          size: members.length,
          mass: members.reduce((s, i) => s + q[i]!, 0),
          representatives: order
            .slice(0, ANALYSIS_LIMITS.representatives)
            .map((i) => this.ranked(i, scores[i]!)),
        };
      })
      .sort(
        (a, b) =>
          b.mass - a.mass ||
          compare(a.representatives[0]!.id, b.representatives[0]!.id) ||
          compare(a.anchorId, b.anchorId),
      );
    return result(summaries, limit, this.isolates);
  }
}

export class AnalysisRead {
  constructor(
    private topology: Topology | undefined,
    private checkSource: (() => void) | undefined,
  ) {}
  close() {
    this.topology = undefined;
    this.checkSource = undefined;
  }
  private check() {
    if (!this.topology || !this.checkSource)
      throw new AnalysisError(ANALYSIS_ERROR.CLOSED, 'Analysis callback is closed');
    this.checkSource();
    return this.topology;
  }
  get stats() {
    return this.check().stats;
  }
  private async compute<T>(work: (topology: Topology) => Promise<T>) {
    const topology = this.check();
    let value: T;
    try {
      value = await work(topology);
    } catch (cause) {
      if (cause instanceof AnalysisError) throw cause;
      throw new AnalysisError(ANALYSIS_ERROR.FAILED, 'Graph solver failed', { cause });
    }
    this.check();
    return value;
  }
  rank(options?: RankingOptions) {
    return this.compute((topology) => topology.rank(options));
  }
  communities(options?: RankingOptions) {
    return this.compute((topology) => topology.communities(options));
  }
}

/** One workspace-owned slot. Active callbacks retain their own immutable topology. */
export class GraphAnalysisCache {
  private entry: { generation: string | object; key: string; topology: Topology } | undefined;
  private readonly active = new Set<Promise<unknown>>();
  private closed = false;
  read<T>(
    input: AnalysisInput,
    options: Projection,
    work: (read: AnalysisRead) => T | Promise<T>,
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new AnalysisError(ANALYSIS_ERROR.CLOSED, 'Analysis owner is closed'));
    let finish!: () => void;
    const lifetime = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active.add(lifetime);
    return (async () => {
      let read: AnalysisRead | undefined;
      try {
        input.check();
        const scope = projection(input, options),
          key = JSON.stringify(scope);
        if (this.entry?.key !== key || this.entry.generation !== input.generation)
          this.entry = {
            generation: input.generation,
            key,
            topology: Topology.build(input, scope),
          };
        read = new AnalysisRead(this.entry.topology, () => input.check());
        const value = await work(read);
        input.check();
        return value;
      } finally {
        read?.close();
        this.active.delete(lifetime);
        finish();
      }
    })();
  }
  async close() {
    this.closed = true;
    await Promise.all(this.active);
    this.entry = undefined;
  }
}
