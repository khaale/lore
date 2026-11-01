import { referencePaths, referenceSlot } from '@khaale/lore-schema';
import { HierarchyReaderImpl, type HierarchyReader } from './hierarchy.js';
import type { HierarchyInput } from '@khaale/lore-graph';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  explore as coreExplore,
  snapshotFromBuildResult,
  type Artifact,
  type ExploreReport,
  type IndexV2,
  type SemanticEntity,
  type SemanticRelation,
  type SourceDescriptor,
  type SourceSpan as CoreSourceSpan,
} from '@khaale/lore-core';
import {
  discoverSchemaDependencies,
  resolveSchemaPath,
  readIndex,
  snapshot as filesystemSnapshot,
  type FileStamp,
} from '@khaale/lore-filesystem';
import {
  compileSchemaOrThrow,
  type RuntimeClass,
  type RuntimeSchemaIR,
  type RuntimeSlot,
  type SlotExpr,
  type ClassExpr,
} from '@khaale/lore-schema';
import {
  createPtcRuntime,
  type PtcResponse,
  type PtcRuntimeOptions,
  type PtcScope,
  type PtcSession,
  type ResultReference,
  type ResultStore,
  type RetainOptions,
  type TraceStore,
} from './ptc.js';

export const SDK_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 100,
  defaultScanBudget: 100,
  maxScanBudget: 10_000,
  maxNarrativeBytes: 64 * 1024,
  defaultGraphNodes: 1_000,
  maxGraphNodes: 10_000,
  defaultGraphEdges: 2_000,
  maxGraphEdges: 20_000,
} as const;

export type WorkspaceAuthority = 'filesystem';
export type ScalarValue = string | number | boolean;
export type EntityFacet = 'properties' | 'narrative' | 'provenance' | 'relations';
export type Continuation = string;
export type CapabilityMode = 'read-only' | 'unavailable';
export type Capability = {
  supported: boolean;
  mode: CapabilityMode;
  detail?: string;
};
export type WorkspaceCapabilities = {
  describe: Capability;
  schemaDiscovery: Capability;
  entityReads: Capability;
  lexicalSearch: Capability;
  structuredQuery: Capability;
  configuredExplore: Capability;
  narrative: Capability;
  provenance: Capability;
};
export type SourceSpan = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};
export type SourceProvenance = {
  authority: WorkspaceAuthority;
  source: string;
  location?: string;
  representation: string;
  span?: SourceSpan;
};
export type EntityProvenance = SourceProvenance & {
  narrative?: SourceProvenance;
  properties?: Record<string, SourceProvenance>;
};
export type SnapshotInfo = {
  id: string;
  authority: WorkspaceAuthority;
  schemaHash: string;
  freshness: 'saved-indexed';
};
export type CoverageReason =
  'complete' | 'page-limit' | 'scan-budget' | 'empty' | 'missing-selection' | 'output-limit';
export type Coverage = {
  complete: boolean;
  examined: number;
  returned: number;
  remaining: number | undefined;
  reason: CoverageReason;
};
export type SchemaIdentity = {
  name: string;
  id?: string;
  hash: string;
};
export type TypeSummary = {
  name: string;
  typeId: string;
  label?: string;
  description?: string;
  abstract: boolean;
  mixin: boolean;
};
export type Collection<T> = {
  items: T[];
  coverage: Coverage;
  snapshot: SnapshotInfo;
};
export type Page<T> = Collection<T> & { continuation?: Continuation };
export type PageOptions = { limit?: number; continuation?: Continuation };
export type TypeCatalogOptions = PageOptions & { text?: string };
export type TypeCatalogPage = Page<TypeSummary>;
export type SlotConstraintExpression = {
  range?: string;
  required?: boolean;
  valuePresence?: 'PRESENT' | 'ABSENT';
  equalsString?: string;
  equalsStringIn?: string[];
  pattern?: string;
  minimumCardinality?: number;
  maximumCardinality?: number;
  exactCardinality?: number;
  anyOf?: SlotConstraintExpression[];
  allOf?: SlotConstraintExpression[];
  noneOf?: SlotConstraintExpression[];
  exactlyOneOf?: SlotConstraintExpression[];
};
export type RecordConstraintExpression = {
  slotConditions?: Record<string, SlotConstraintExpression>;
  anyOf?: RecordConstraintExpression[];
  allOf?: RecordConstraintExpression[];
  noneOf?: RecordConstraintExpression[];
  exactlyOneOf?: RecordConstraintExpression[];
};
export type ConditionalRule = {
  preconditions?: RecordConstraintExpression;
  postconditions: RecordConstraintExpression;
};
export type FieldConstraints = {
  patterns: string[];
  minimumValue?: unknown;
  maximumValue?: unknown;
  listElementsUnique: boolean;
  anyOf: SlotConstraintExpression[];
  allOf: SlotConstraintExpression[];
  noneOf: SlotConstraintExpression[];
  exactlyOneOf: SlotConstraintExpression[];
};
export type ReferencePathDescription = {
  path: string;
  annotations: Record<string, unknown>;
  relationTargets: string[];
  constraints: FieldConstraints;
};
export type FieldDescription = {
  name: string;
  annotations: Record<string, unknown>;
  description?: string;
  range: string;
  valueKind: 'scalar' | 'inline-object' | 'reference';
  required: boolean;
  recommended: boolean;
  cardinality: {
    multivalued: boolean;
    minimum?: number;
    maximum?: number;
    exact?: number;
  };
  enumValues: string[];
  relationTargets: string[];
  inverse?: string;
  constraints?: FieldConstraints;
};
export type TypeDescription = TypeSummary & {
  annotations: Record<string, unknown>;
  recordConstraints?: RecordConstraintExpression[];
  rules?: ConditionalRule[];
  referencePaths?: ReferencePathDescription[];
  schema: SchemaIdentity;
  parent?: string;
  mixins: string[];
  fields: FieldDescription[];
  views: string[];
  snapshot: SnapshotInfo;
};
export type Relation = {
  from: string;
  relation: string;
  to: string;
  direction: 'out' | 'in';
  inferred: boolean;
  provenance?: SourceProvenance;
};
export type Entity = {
  id: string;
  type: string;
  typeId: string;
  properties: Record<string, unknown>;
  narrative?: string;
  relations: Relation[];
  provenance?: EntityProvenance;
};
export type EntityReadResult = {
  item: Entity;
  snapshot: SnapshotInfo;
  coverage: Coverage;
};
export type EntityManyReadResult = {
  items: Entity[];
  missingIds: string[];
  snapshot: SnapshotInfo;
  coverage: Coverage;
};
export type GetOptions = {
  select?: readonly string[];
  include?: readonly EntityFacet[];
  narrativeMaxBytes?: number;
};
export type QueryFilter =
  { eq: ScalarValue } | { in: readonly ScalarValue[] } | { present: boolean };
export type QueryWhere = Readonly<Record<string, QueryFilter>>;
export type QueryOptions = PageOptions & {
  type?: string;
  where?: QueryWhere;
  select?: readonly string[];
  scanBudget?: number;
};
export type QueryResult = Page<Entity>;
export type SearchOptions = PageOptions & {
  text: string;
  types?: readonly string[];
  scanBudget?: number;
};
export type MatchExplanation = {
  field: string;
  representation: 'id' | 'type' | 'type-id' | 'property';
  snippet: string;
};
export type SearchMatch = {
  item: Entity;
  matches: MatchExplanation[];
};
export type SearchResult = Page<SearchMatch> & {
  searchableFields: string[];
};
export type ExploreOptions = {
  view: string;
  root?: string;
  depth?: number;
};
export type ExploreResult = {
  view: string;
  report: ExploreReport;
  coverage: Coverage;
  snapshot: SnapshotInfo;
};
export type GraphDirection = 'in' | 'out' | 'both';
export type GraphOptions = {
  direction?: GraphDirection;
  relations?: readonly string[];
  nodeTypes?: readonly string[];
  maxNodes?: number;
  maxEdges?: number;
};
export type NeighborhoodOptions = GraphOptions & {
  depth: number;
};
export type GraphTraceStep = {
  from: string;
  relation: string;
  to: string;
  inferred: boolean;
};
export type GraphRelationPresentation = GraphTraceStep & {
  provenance?: SourceProvenance;
};
export type GraphNode = {
  id: string;
  type: string;
  typeId: string;
  distance: number;
  trace: GraphTraceStep[];
  provenance?: EntityProvenance;
};
export type GraphEdge = GraphRelationPresentation & {
  fromVisible: boolean;
  toVisible: boolean;
  presentations: GraphRelationPresentation[];
};
export type GraphCoverageReason =
  'complete' | 'empty' | 'node-limit' | 'edge-limit' | 'output-limit';
export type GraphCoverageDimension = {
  complete: boolean;
  examined: number;
  returned: number;
  remaining: number | undefined;
  reason: GraphCoverageReason;
};
export type GraphCoverage = {
  nodes: GraphCoverageDimension;
  edges: GraphCoverageDimension;
  next: 'none' | 'new-request';
};
export type GraphResult = {
  seedIds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  coverage: GraphCoverage;
  snapshot: SnapshotInfo;
};
export type GraphPreview = {
  nodes: Pick<GraphNode, 'id' | 'type' | 'distance'>[];
  edges: Pick<GraphEdge, 'from' | 'relation' | 'to' | 'inferred' | 'fromVisible' | 'toVisible'>[];
  coverage: GraphCoverage;
  snapshot: SnapshotInfo;
};
export type GraphInput =
  readonly (string | { id: string })[] | { readonly items: readonly { id: string }[] };

export interface GraphReader {
  neighbors(input: GraphInput, options?: GraphOptions): Promise<GraphResult>;
  neighborhood(input: GraphInput, options: NeighborhoodOptions): Promise<GraphResult>;
  subgraph(input: GraphInput, options?: GraphOptions): Promise<GraphResult>;
  boundary(input: GraphInput, options?: GraphOptions): Promise<GraphResult>;
}
export type WorkspaceDescription = {
  authority: WorkspaceAuthority;
  schema: SchemaIdentity;
  capabilities: WorkspaceCapabilities;
  types: TypeSummary[];
  views: string[];
  snapshot: SnapshotInfo;
};

export type SdkErrorCode =
  | 'SETUP_FAILED'
  | 'SCHEMA_MISMATCH'
  | 'UNKNOWN_TYPE'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_FILTER'
  | 'UNSUPPORTED_VIEW'
  | 'MISSING_ENTITY'
  | 'INVALID_LIMIT'
  | 'INVALID_ARGUMENT'
  | 'NARRATIVE_LIMIT'
  | 'STALE_STATE'
  | 'INVALID_CONTINUATION';

export class SdkError extends Error {
  readonly code: SdkErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: SdkErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SdkError';
    this.code = code;
    this.details = details;
  }
}

export type FilesystemWorkspaceOptions = {
  root: string;
  schemaPath?: string;
  indexPath?: string;
  ignorePath?: string;
  maxPageSize?: number;
  maxScanBudget?: number;
  maxNarrativeBytes?: number;
  ptc?: PtcRuntimeOptions;
};
export interface SchemaReader {
  listTypes(options?: TypeCatalogOptions): Promise<TypeCatalogPage>;
  describeType(type: string): Promise<TypeDescription>;
}

export interface EntityReader {
  get(id: string, options?: GetOptions): Promise<EntityReadResult>;
  getMany(ids: readonly string[], options?: GetOptions): Promise<EntityManyReadResult>;
}

export interface ReadSnapshot {
  readonly snapshot: SnapshotInfo;
  readonly schema: SchemaReader;
  readonly entities: EntityReader;
  readonly graph: GraphReader;
  readonly hierarchy: HierarchyReader;
  describe(): Promise<WorkspaceDescription>;
  query(options: QueryOptions): Promise<QueryResult>;
  search(options: SearchOptions): Promise<SearchResult>;
  explore(options: ExploreOptions): Promise<ExploreResult>;
}

export type PtcQueryOptions = Omit<QueryOptions, 'limit' | 'scanBudget' | 'continuation'>;
export type PtcSearchOptions = Omit<SearchOptions, 'limit' | 'scanBudget' | 'continuation'>;
export type PtcGraphOptions = Omit<GraphOptions, 'maxNodes' | 'maxEdges'>;
export interface PtcGraphReader {
  neighbors(input: GraphInput, options?: PtcGraphOptions): Promise<GraphResult>;
  neighborhood(
    input: GraphInput,
    options: PtcGraphOptions & { depth: number },
  ): Promise<GraphResult>;
  subgraph(input: GraphInput, options?: PtcGraphOptions): Promise<GraphResult>;
  boundary(input: GraphInput, options?: PtcGraphOptions): Promise<GraphResult>;
}
export interface PtcRead extends Omit<ReadSnapshot, 'schema' | 'query' | 'search' | 'graph'> {
  readonly schema: {
    listTypes(options?: Pick<TypeCatalogOptions, 'text'>): Promise<Collection<TypeSummary>>;
    describeType(type: string): Promise<TypeDescription>;
  };
  readonly results: ResultStore;
  readonly graph: PtcGraphReader;
  retain<T>(value: T, options?: RetainOptions): Promise<ResultReference<T>>;
  limitItems<T>(result: Collection<T>, limit?: number): Collection<T>;
  limitGraph(result: GraphPreview, limits?: { nodes?: number; edges?: number }): GraphPreview;
  query(options?: PtcQueryOptions): Promise<Collection<Entity>>;
  search(options: PtcSearchOptions): Promise<Omit<SearchResult, 'continuation'>>;
}

export interface Workspace {
  readonly authority: WorkspaceAuthority;
  readonly schema: SchemaReader;
  readonly entities: EntityReader;
  readonly graph: GraphReader;
  readonly hierarchy: HierarchyReader;
  readonly results: ResultStore;
  readonly trace: TraceStore;
  describe(): Promise<WorkspaceDescription>;
  query(options: QueryOptions): Promise<QueryResult>;
  search(options: SearchOptions): Promise<SearchResult>;
  explore(options: ExploreOptions): Promise<ExploreResult>;
  readSnapshot<T>(callback: (read: ReadSnapshot) => Promise<T> | T): Promise<T>;
  call<T>(callback: (read: PtcRead) => Promise<T> | T): Promise<PtcResponse<T>>;
}

export type SourceEntity = SemanticEntity & { narrative?: string };
export type ReadSource = {
  root?: string;
  hierarchyInput?: () => HierarchyInput;
  authority: WorkspaceAuthority;
  schema: RuntimeSchemaIR;
  schemaIdentity: SchemaIdentity;
  entities: SourceEntity[];
  entitiesById: Pick<ReadonlyMap<string, SourceEntity>, 'get' | 'has'>;
  relationsByEntity: Pick<ReadonlyMap<string, readonly SemanticRelation[]>, 'get'>;
  relations: SemanticRelation[];
  index: IndexV2;
  state: SnapshotInfo;
  storage?: {
    count: number;
    scan(position: number, count: number): SourceEntity[];
    artifact(id: string): Artifact | undefined;
    fullIndex(): IndexV2;
  };
  graphView?: () => GraphView;
  revalidate: () => void | Promise<void>;
  maxPageSize: number;
  maxScanBudget: number;
  maxNarrativeBytes: number;
};

const SUPPORTED_VIEWS = ['overview', 'card', 'tree', 'neighborhood', 'impact'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: unknown): value is ScalarValue =>
  (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
  !(typeof value === 'number' && !Number.isFinite(value));
const clone = <T>(value: T): T => structuredClone(value);
const compareStrings = (left: string, right: string): number => left.localeCompare(right);
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  return value;
}
const stableJson = (value: unknown): string => JSON.stringify(stableValue(value));
const digest = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');
const encodeToken = (value: unknown): Continuation => {
  const payload = stableJson(value);
  const envelope = `${Buffer.from(payload).toString('base64url')}.${digest(value)}`;
  return envelope;
};

type ContinuationPayload = {
  version: 1;
  kind: 'types' | 'query' | 'search';
  workspace: string;
  state: string;
  fingerprint: string;
  position: number;
};
function decodeToken(token: Continuation, expected: Omit<ContinuationPayload, 'position'>): number {
  const parts = token.split('.');
  if (parts.length !== 2) throw new SdkError('INVALID_CONTINUATION', 'continuation is malformed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as unknown;
  } catch (error) {
    throw new SdkError(
      'INVALID_CONTINUATION',
      'continuation payload is not valid JSON',
      {},
      { cause: error },
    );
  }
  if (!isRecord(parsed) || parts[1] !== digest(parsed))
    throw new SdkError('INVALID_CONTINUATION', 'continuation integrity check failed');
  const payload = parsed as Partial<ContinuationPayload>;
  if (
    payload.version !== expected.version ||
    payload.kind !== expected.kind ||
    payload.workspace !== expected.workspace ||
    payload.state !== expected.state ||
    payload.fingerprint !== expected.fingerprint ||
    typeof payload.position !== 'number' ||
    !Number.isInteger(payload.position) ||
    payload.position < 0
  )
    throw new SdkError('INVALID_CONTINUATION', 'continuation does not belong to this read');
  return payload.position;
}

function validateLimit(limit: number | undefined, max: number): number {
  const actual = limit ?? SDK_LIMITS.defaultPageSize;
  if (!Number.isInteger(actual) || actual < 1 || actual > max)
    throw new SdkError('INVALID_LIMIT', `limit must be an integer between 1 and ${max}`, {
      limit: actual,
    });
  return actual;
}
function validateScanBudget(scanBudget: number | undefined, max: number): number {
  const actual = scanBudget ?? SDK_LIMITS.defaultScanBudget;
  if (!Number.isInteger(actual) || actual < 1 || actual > max)
    throw new SdkError('INVALID_LIMIT', `scanBudget must be an integer between 1 and ${max}`, {
      limit: actual,
    });
  return actual;
}

function sourceSpan(value: CoreSourceSpan | undefined): SourceSpan | undefined {
  if (!value) return undefined;
  return {
    line: value.line,
    column: value.column,
    ...(value.end_line === undefined ? {} : { endLine: value.end_line }),
    ...(value.end_column === undefined ? {} : { endColumn: value.end_column }),
  };
}
function provenance(authority: WorkspaceAuthority, descriptor: SourceDescriptor): SourceProvenance {
  const span = sourceSpan(descriptor.span);
  return {
    authority,
    source: descriptor.source,
    location: descriptor.physicalPath,
    representation: descriptor.representation,
    ...(span === undefined ? {} : { span }),
  };
}
function entityProvenance(authority: WorkspaceAuthority, value: SourceEntity): EntityProvenance {
  const span = sourceSpan(value.provenance.span);
  const narrative = value.provenance.narrative
    ? provenance(authority, value.provenance.narrative)
    : undefined;
  const properties = value.provenance.properties
    ? Object.fromEntries(
        Object.entries(value.provenance.properties).map(([field, descriptor]) => [
          field,
          provenance(authority, descriptor),
        ]),
      )
    : undefined;
  return {
    authority,
    source: value.provenance.source,
    location: value.provenance.physicalPath,
    representation: 'entity',
    ...(span === undefined ? {} : { span }),
    ...(narrative === undefined ? {} : { narrative }),
    ...(properties === undefined ? {} : { properties }),
  };
}
function sourceViews(schema: RuntimeSchemaIR): string[] {
  const configured = new Set<string>();
  for (const runtimeClass of Object.values(schema.classes)) {
    for (const value of annotationValues(runtimeClass.annotations['lore:explore_views']))
      configured.add(value);
    for (const slot of Object.values(runtimeClass.slots))
      for (const value of annotationValues(slot.annotations['lore:explore_views']))
        configured.add(value);
  }
  if (configured.size === 0) return [...SUPPORTED_VIEWS];
  return [
    'overview',
    ...[...configured].filter((view) => view !== 'overview').sort(compareStrings),
  ];
}
function annotationValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}
function schemaIdentity(schema: RuntimeSchemaIR, hash: string): SchemaIdentity {
  return {
    name: schema.name,
    hash,
    ...(schema.schemaId === undefined ? {} : { id: schema.schemaId }),
  };
}
function typeSummary(runtimeClass: RuntimeClass): TypeSummary {
  return {
    name: runtimeClass.name,
    typeId: runtimeClass.typeId,
    ...(runtimeClass.title === undefined ? {} : { label: runtimeClass.title }),
    ...(runtimeClass.description === undefined ? {} : { description: runtimeClass.description }),
    abstract: runtimeClass.abstract,
    mixin: runtimeClass.mixin,
  };
}
function resolveClass(schema: RuntimeSchemaIR, identity: string): RuntimeClass | undefined {
  return Object.values(schema.classes).find(
    (runtimeClass) => runtimeClass.name === identity || runtimeClass.typeId === identity,
  );
}
function isSubclass(
  schema: RuntimeSchemaIR,
  child: string,
  parent: string,
  seen = new Set<string>(),
): boolean {
  if (child === parent) return true;
  if (seen.has(child)) return false;
  seen.add(child);
  const runtimeClass = schema.classes[child];
  return Boolean(
    runtimeClass &&
    [runtimeClass.parent, ...runtimeClass.mixins]
      .filter((name): name is string => Boolean(name))
      .some((name) => isSubclass(schema, name, parent, seen)),
  );
}
function slotExpressionDescription(e: SlotExpr): SlotConstraintExpression {
  const value = Object.fromEntries(
    Object.entries(e).filter(([key, value]) => key !== 'extra' && value !== undefined),
  );
  for (const key of ['anyOf', 'allOf', 'noneOf', 'exactlyOneOf'] as const)
    if (e[key]) value[key] = e[key].map(slotExpressionDescription);
  return clone(value);
}
function recordExpressionDescription(e: ClassExpr): RecordConstraintExpression {
  return {
    ...(e.slotConditions
      ? {
          slotConditions: Object.fromEntries(
            Object.entries(e.slotConditions).map(([k, v]) => [k, slotExpressionDescription(v)]),
          ),
        }
      : {}),
    ...Object.fromEntries(
      (['anyOf', 'allOf', 'noneOf', 'exactlyOneOf'] as const)
        .filter((k) => e[k] !== undefined)
        .map((k) => [k, e[k]!.map(recordExpressionDescription)]),
    ),
  };
}
function fieldDescription(schema: RuntimeSchemaIR, slot: RuntimeSlot): FieldDescription {
  const enumValues = schema.enums[slot.range]?.values ?? [];
  type Match = boolean | undefined;
  const all = (values: Match[]): Match =>
    values.includes(false) ? false : values.includes(undefined) ? undefined : true;
  const any = (values: Match[]): Match =>
    values.includes(true) ? true : values.includes(undefined) ? undefined : false;
  const possible = (type: string, e: SlotExpr): Match => {
    const conditions: Match[] = [];
    if (e.range) conditions.push(!!schema.classes[e.range] && isSubclass(schema, type, e.range));
    if (e.valuePresence === 'ABSENT') conditions.push(false);
    if (e.pattern !== undefined || e.equalsString !== undefined || e.equalsStringIn !== undefined)
      conditions.push(undefined);
    if (e.anyOf?.length) conditions.push(any(e.anyOf.map((e) => possible(type, e))));
    if (e.allOf?.length) conditions.push(all(e.allOf.map((e) => possible(type, e))));
    if (e.noneOf?.length) {
      const match = any(e.noneOf.map((e) => possible(type, e)));
      conditions.push(match === undefined ? undefined : !match);
    }
    if (e.exactlyOneOf?.length) {
      const matches = e.exactlyOneOf.map((e) => possible(type, e));
      const yes = matches.filter((v) => v === true).length,
        unknown = matches.filter((v) => v === undefined).length;
      conditions.push(yes > 1 || yes + unknown < 1 ? false : unknown ? undefined : true);
    }
    return all(conditions);
  };
  const relationTargets =
    slot.mode === 'reference'
      ? Object.values(schema.classes)
          .filter(
            (c) =>
              (!schema.classes[slot.range] || isSubclass(schema, c.name, slot.range)) &&
              possible(c.name, {
                anyOf: slot.anyOf,
                allOf: slot.allOf,
                noneOf: slot.noneOf,
                exactlyOneOf: slot.exactlyOneOf,
              }) !== false,
          )
          .map((c) => c.name)
          .sort(compareStrings)
      : [];
  const type = schema.types[slot.range];
  const bounds = (a: unknown, b: unknown, minimum: boolean): unknown =>
    a === undefined
      ? b
      : b === undefined
        ? a
        : typeof a === 'number' && typeof b === 'number'
          ? minimum
            ? Math.max(a, b)
            : Math.min(a, b)
          : typeof a === 'string' && typeof b === 'string'
            ? minimum
              ? a > b
                ? a
                : b
              : a < b
                ? a
                : b
            : a;
  const minimumValue = bounds(slot.minimumValue, type?.minimumValue, true),
    maximumValue = bounds(slot.maximumValue, type?.maximumValue, false);
  return {
    name: slot.name,
    annotations: clone(slot.annotations),
    constraints: {
      patterns: [...new Set([...slot.patterns, ...(type?.patterns ?? [])])],
      listElementsUnique: slot.listElementsUnique === true,
      ...(minimumValue === undefined ? {} : { minimumValue: clone(minimumValue) }),
      ...(maximumValue === undefined ? {} : { maximumValue: clone(maximumValue) }),
      anyOf: slot.anyOf.map(slotExpressionDescription),
      allOf: slot.allOf.map(slotExpressionDescription),
      noneOf: slot.noneOf.map(slotExpressionDescription),
      exactlyOneOf: slot.exactlyOneOf.map(slotExpressionDescription),
    },
    ...(slot.description === undefined ? {} : { description: slot.description }),
    range: slot.range,
    valueKind: slot.mode,
    required: slot.required,
    recommended: slot.recommended,
    cardinality: {
      multivalued: slot.multivalued,
      ...(slot.minimumCardinality === undefined ? {} : { minimum: slot.minimumCardinality }),
      ...(slot.maximumCardinality === undefined ? {} : { maximum: slot.maximumCardinality }),
      ...(slot.exactCardinality === undefined ? {} : { exact: slot.exactCardinality }),
    },
    enumValues: [...enumValues].sort(compareStrings),
    relationTargets,
    ...(slot.inverse === undefined ? {} : { inverse: slot.inverse }),
  };
}
function typeDescription(source: ReadSource, runtimeClass: RuntimeClass): TypeDescription {
  return {
    ...typeSummary(runtimeClass),
    annotations: clone(runtimeClass.annotations),
    recordConstraints: (runtimeClass.recordConstraints ?? []).map(recordExpressionDescription),
    rules: (runtimeClass.rules ?? []).map((r) => ({
      ...(r.preconditions ? { preconditions: recordExpressionDescription(r.preconditions) } : {}),
      postconditions: recordExpressionDescription(r.postconditions),
    })),
    referencePaths: referencePaths(source.schema, runtimeClass.name).map(({ path, slot }) => {
      const d = fieldDescription(source.schema, slot);
      return {
        path,
        annotations: d.annotations,
        relationTargets: d.relationTargets,
        constraints: d.constraints!,
      };
    }),
    schema: source.schemaIdentity,
    ...(runtimeClass.parent === undefined ? {} : { parent: runtimeClass.parent }),
    mixins: [...runtimeClass.mixins].sort(compareStrings),
    fields: Object.values(runtimeClass.slots)
      .sort((left, right) => compareStrings(left.name, right.name))
      .map((slot) => fieldDescription(source.schema, slot)),
    views: sourceViews(source.schema).filter(
      (view) =>
        view === 'overview' ||
        Object.values(runtimeClass.slots).some((slot) =>
          annotationValues(slot.annotations['lore:explore_views']).includes(view),
        ) ||
        annotationValues(runtimeClass.annotations['lore:explore_views']).includes(view),
    ),
    snapshot: source.state,
  };
}
function workspaceCapabilities(): WorkspaceCapabilities {
  const readOnly: Capability = { supported: true, mode: 'read-only' };
  return {
    describe: readOnly,
    schemaDiscovery: readOnly,
    entityReads: readOnly,
    lexicalSearch: readOnly,
    structuredQuery: readOnly,
    configuredExplore: readOnly,
    narrative: {
      supported: true,
      mode: 'read-only',
      detail: 'saved indexed narrative',
    },
    provenance: readOnly,
  };
}
function coverage(
  examined: number,
  returned: number,
  remaining: number | undefined,
  reason: CoverageReason,
): Coverage {
  return {
    complete: remaining === 0,
    examined,
    returned,
    remaining,
    reason,
  };
}
type BoundedScan<T> = {
  items: T[];
  position: number;
  examined: number;
  complete: boolean;
  reason: CoverageReason;
};
function boundedScan<T>(
  entities: readonly SourceEntity[],
  position: number,
  limit: number,
  scanBudget: number,
  match: (entity: SourceEntity) => T | undefined,
): BoundedScan<T> {
  const items: T[] = [];
  let examined = 0;
  let cursor = position;
  while (cursor < entities.length && examined < scanBudget && items.length < limit) {
    const item = match(entities[cursor]!);
    cursor += 1;
    examined += 1;
    if (item !== undefined) items.push(item);
  }
  const complete = cursor >= entities.length;
  return {
    items,
    position: cursor,
    examined,
    complete,
    reason: complete ? 'complete' : items.length >= limit ? 'page-limit' : 'scan-budget',
  };
}
function fingerprint(value: unknown): string {
  return digest(value);
}
function snapshotId(authority: WorkspaceAuthority, schemaHash: string, stateKey: string): string {
  return `${authority}:${digest({ schemaHash, stateKey }).slice(0, 24)}`;
}
function buildState(
  authority: WorkspaceAuthority,
  schemaHash: string,
  stateKey: string,
): SnapshotInfo {
  return {
    id: snapshotId(authority, schemaHash, stateKey),
    authority,
    schemaHash,
    freshness: 'saved-indexed',
  };
}

function validateIndex(value: unknown): IndexV2 {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    typeof value.schema_hash !== 'string' ||
    !isRecord(value.artifacts)
  )
    throw new SdkError('SETUP_FAILED', 'filesystem index has an invalid persisted shape');
  const artifacts: Record<string, Artifact> = {};
  for (const [id, raw] of Object.entries(value.artifacts)) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.kind !== 'string' ||
      typeof raw.type_id !== 'string' ||
      typeof raw.source !== 'string' ||
      typeof raw.physical_path !== 'string' ||
      !isRecord(raw.data)
    )
      throw new SdkError('SETUP_FAILED', `filesystem index artifact ${id} has an invalid shape`);
    artifacts[id] = raw as unknown as Artifact;
  }
  return {
    version: 2,
    schema_hash: value.schema_hash,
    artifacts,
    edges: Array.isArray(value.edges) ? (value.edges as IndexV2['edges']) : null,
    diagnostics: Array.isArray(value.diagnostics)
      ? (value.diagnostics as IndexV2['diagnostics'])
      : null,
  };
}
async function fileStamp(path: string): Promise<FileStamp> {
  try {
    const info = await stat(path);
    return { path, size: info.size, mtimeMs: info.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, size: -1, mtimeMs: -1 };
    throw error;
  }
}
function sameStamps(left: readonly FileStamp[], right: readonly FileStamp[]): boolean {
  return stableJson(left) === stableJson(right);
}
function filesystemSourceOptions(
  options: FilesystemWorkspaceOptions,
  root: string,
  schemaPath: string,
  indexPath: string,
  dependencies: string[],
) {
  return {
    root,
    schemaPath,
    ignorePath: options.ignorePath ?? join(root, '.artifactignore'),
    outputPath: indexPath,
    dependencies,
  };
}
function indexEntityRelations(
  relations: readonly SemanticRelation[],
): Map<string, SemanticRelation[]> {
  const byEntity = new Map<string, SemanticRelation[]>();
  const add = (id: string, relation: SemanticRelation): void => {
    const entries = byEntity.get(id);
    if (entries) entries.push(relation);
    else byEntity.set(id, [relation]);
  };
  for (const relation of relations) {
    if (relation.generic) continue;
    add(relation.from, relation);
    if (relation.to !== relation.from) add(relation.to, relation);
  }
  return byEntity;
}

async function openFilesystemSource(options: FilesystemWorkspaceOptions): Promise<ReadSource> {
  const root = resolve(options.root);
  const indexPath = resolve(options.indexPath ?? join(root, '.artifact-index', 'index.json'));
  const ignorePath = resolve(options.ignorePath ?? join(root, '.artifactignore'));
  try {
    const schemaPath = await resolveSchemaPath(root, options.schemaPath);
    const compiled = await compileSchemaOrThrow(schemaPath);
    const index = validateIndex(await readIndex(indexPath));
    const hash = compiled.hash;
    if (index.schema_hash !== hash)
      throw new SdkError(
        'SCHEMA_MISMATCH',
        'saved filesystem index does not match the supplied schema',
        {
          indexHash: index.schema_hash,
          schemaHash: hash,
        },
      );
    const semantic = snapshotFromBuildResult({ index, schema: compiled.ir });
    const dependencies = await discoverSchemaDependencies(schemaPath);
    const scanOptions = filesystemSourceOptions(
      { ...options, ignorePath },
      root,
      schemaPath,
      indexPath,
      dependencies,
    );
    const stamps = [...(await filesystemSnapshot(scanOptions)), await fileStamp(indexPath)].sort(
      (a, b) => compareStrings(a.path, b.path),
    );
    const entities = Object.values(semantic.entities).map((entity) => ({
      ...entity,
      ...(index.artifacts[entity.id]?.body === undefined
        ? {}
        : { narrative: index.artifacts[entity.id]!.body }),
    }));
    const stateKey = digest({ hash, stamps });
    const state = buildState('filesystem', hash, stateKey);
    const source: ReadSource = {
      root,
      authority: 'filesystem',
      schema: compiled.ir,
      schemaIdentity: schemaIdentity(compiled.ir, hash),
      entities,
      entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
      relationsByEntity: indexEntityRelations(semantic.relations),
      relations: semantic.relations,
      index,
      state,
      maxPageSize: options.maxPageSize ?? SDK_LIMITS.maxPageSize,
      maxScanBudget: options.maxScanBudget ?? SDK_LIMITS.maxScanBudget,
      maxNarrativeBytes: options.maxNarrativeBytes ?? SDK_LIMITS.maxNarrativeBytes,
      revalidate: async () => {
        const current = [
          ...(await filesystemSnapshot(scanOptions)),
          await fileStamp(indexPath),
        ].sort((a, b) => compareStrings(a.path, b.path));
        if (!sameStamps(stamps, current))
          throw new SdkError(
            'STALE_STATE',
            'filesystem saved/indexed inputs changed during this read session',
            {
              workspace: root,
            },
          );
      },
    };
    return source;
  } catch (error) {
    if (error instanceof SdkError) throw error;
    throw new SdkError(
      'SETUP_FAILED',
      `could not open filesystem workspace: ${error instanceof Error ? error.message : String(error)}`,
      {},
      { cause: error },
    );
  }
}
function matchesType(
  schema: RuntimeSchemaIR,
  entity: SourceEntity,
  selected: RuntimeClass | undefined,
): boolean {
  return selected === undefined
    ? Boolean(
        schema.classes[entity.kind] &&
        !schema.classes[entity.kind]!.abstract &&
        !schema.classes[entity.kind]!.mixin,
      )
    : isSubclass(schema, entity.kind, selected.name);
}
function scalarValid(value: ScalarValue, slot: RuntimeSlot, schema: RuntimeSchemaIR): boolean {
  if (slot.mode === 'reference') return typeof value === 'string';
  const enumDefinition = schema.enums[slot.range];
  if (enumDefinition && (typeof value !== 'string' || !enumDefinition.values.includes(value)))
    return false;
  const type = schema.types[slot.range];
  const range = (type?.base ?? slot.range).toLowerCase();
  if (
    ['string', 'str', 'uri', 'uriorcurie', 'ncname', 'date', 'datetime', 'time'].includes(range) &&
    typeof value !== 'string'
  )
    return false;
  if (
    (range === 'integer' || range === 'int') &&
    (typeof value !== 'number' || !Number.isInteger(value))
  )
    return false;
  if (['float', 'double', 'decimal'].includes(range) && typeof value !== 'number') return false;
  if ((range === 'boolean' || range === 'bool') && typeof value !== 'boolean') return false;
  if (typeof value === 'number') {
    if (slot.minimumValue !== undefined && value < Number(slot.minimumValue)) return false;
    if (slot.maximumValue !== undefined && value > Number(slot.maximumValue)) return false;
  }
  if (
    slot.patterns.length &&
    (typeof value !== 'string' || slot.patterns.some((pattern) => !new RegExp(pattern).test(value)))
  )
    return false;
  return true;
}
function valuesFor(value: unknown, multivalued: boolean): ScalarValue[] {
  if (multivalued) return Array.isArray(value) ? value.filter(isScalar) : [];
  return isScalar(value) ? [value] : [];
}
function referenceTargets(source: ReadSource, entityId: string, slot: string): string[] {
  return (source.relationsByEntity.get(entityId) ?? [])
    .filter(
      (relation) => !relation.inferred && relation.from === entityId && relation.relation === slot,
    )
    .map((relation) => relation.to);
}
function filterMatches(source: ReadSource, entity: SourceEntity, where: QueryWhere): boolean {
  const runtimeClass = source.schema.classes[entity.kind];
  if (!runtimeClass) return false;
  return Object.entries(where).every(([name, filter]) => {
    const slot = runtimeClass.slots[name];
    if (!slot) return false;
    const projectedReferences =
      slot.mode === 'reference' && entity.properties[name] !== undefined
        ? valuesFor(entity.properties[name], slot.multivalued).filter(
            (v): v is string => typeof v === 'string',
          )
        : undefined;
    if ('present' in filter) {
      const present =
        slot.mode === 'reference'
          ? (projectedReferences ?? referenceTargets(source, entity.id, name)).length > 0
          : entity.properties[name] !== undefined && entity.properties[name] !== null;
      return present === filter.present;
    }
    if (slot.mode === 'reference') {
      const targets = projectedReferences ?? referenceTargets(source, entity.id, name);
      if ('eq' in filter) return typeof filter.eq === 'string' && targets.includes(filter.eq);
      if ('in' in filter)
        return filter.in.some((value) => typeof value === 'string' && targets.includes(value));
      return false;
    }
    const values = valuesFor(entity.properties[name], slot.multivalued);
    if ('eq' in filter) return values.some((value) => value === filter.eq);
    if ('in' in filter) return values.some((value) => filter.in.includes(value));
    return false;
  });
}
function validateWhere(
  source: ReadSource,
  selected: RuntimeClass | undefined,
  where: QueryWhere,
): void {
  for (const [name, filter] of Object.entries(where)) {
    const classes = selected
      ? [selected]
      : Object.values(source.schema.classes).filter(
          (runtimeClass) => !runtimeClass.abstract && !runtimeClass.mixin,
        );
    const slots = classes
      .map((runtimeClass) => runtimeClass.slots[name])
      .filter((slot): slot is RuntimeSlot => Boolean(slot));
    if (!slots.length)
      throw new SdkError(
        'UNKNOWN_FIELD',
        `query field ${JSON.stringify(name)} is not declared for the selected type`,
      );
    if (!('present' in filter) && !('eq' in filter) && !('in' in filter))
      throw new SdkError(
        'UNSUPPORTED_FILTER',
        `unsupported filter for field ${JSON.stringify(name)}`,
      );
    if ('present' in filter && typeof filter.present !== 'boolean')
      throw new SdkError('UNSUPPORTED_FILTER', `presence filter for ${name} must be boolean`);
    const values = 'eq' in filter ? [filter.eq] : 'in' in filter ? [...filter.in] : [];
    if ('in' in filter && (!filter.in.length || filter.in.some((value) => !isScalar(value))))
      throw new SdkError(
        'UNSUPPORTED_FILTER',
        `membership filter for ${name} must contain scalar values`,
      );
    if (
      values.length &&
      !slots.some((slot) => values.every((value) => scalarValid(value, slot, source.schema)))
    )
      throw new SdkError(
        'UNSUPPORTED_FILTER',
        `filter values for ${name} are incompatible with the supplied schema`,
      );
  }
}
function selectFields(
  source: ReadSource,
  type: string,
  select: readonly string[] | undefined,
): Set<string> {
  const runtimeClass = source.schema.classes[type];
  const selected = new Set(select ?? Object.keys(runtimeClass?.slots ?? {}));
  for (const field of selected)
    if (field !== 'id' && !runtimeClass?.slots[field])
      throw new SdkError(
        'UNKNOWN_FIELD',
        `field ${JSON.stringify(field)} is not declared for type ${JSON.stringify(type)}`,
      );
  selected.delete('id');
  return selected;
}
function entityResult(
  source: ReadSource,
  entity: SourceEntity,
  fields: Set<string>,
  include: ReadonlySet<EntityFacet>,
  narrativeMaxBytes: number,
): Entity {
  const properties: Record<string, unknown> = {};
  for (const field of [...fields].sort(compareStrings)) {
    const slot = source.schema.classes[entity.kind]?.slots[field];
    if (slot?.mode === 'reference') {
      if (entity.properties[field] !== undefined) {
        properties[field] = clone(entity.properties[field]);
        continue;
      }
      const targets = [...new Set(referenceTargets(source, entity.id, field))];
      if (targets.length) properties[field] = slot.multivalued ? targets : targets[0];
      else {
        const authored = (source.storage?.artifact(entity.id) ?? source.index.artifacts[entity.id])
          ?.data[field];
        if (slot.multivalued && Array.isArray(authored) && authored.length === 0)
          properties[field] = [];
      }
    } else if (entity.properties[field] !== undefined) {
      properties[field] = clone(entity.properties[field]);
    }
  }
  const relationSlots = new Set(
    referencePaths(source.schema, entity.kind)
      .filter(({ path }) => fields.has(path.split('.')[0]!))
      .map(({ path }) => path),
  );
  const semanticRelations = (source.relationsByEntity.get(entity.id) ?? []).filter(
    (relation) =>
      relationSlots.has(relation.relation) ||
      (relation.from === entity.id &&
        fields.has(relation.relation.split('.')[0]!) &&
        !!referenceSlot(source.schema, entity.kind, relation.relation)),
  );
  const relations: Relation[] = semanticRelations.map((relation) => ({
    from: relation.from,
    relation: relation.relation,
    to: relation.to,
    direction: relation.from === entity.id ? 'out' : 'in',
    inferred: relation.inferred,
    ...(relation.provenance
      ? { provenance: provenance(source.authority, relation.provenance) }
      : {}),
  }));
  const result: Entity = {
    id: entity.id,
    type: entity.kind,
    typeId: entity.typeId,
    properties,
    relations: include.has('relations') || include.size === 0 ? relations : [],
    ...(include.has('narrative') && entity.narrative !== undefined
      ? { narrative: entity.narrative }
      : {}),
    ...(include.has('provenance') || include.size === 0
      ? { provenance: entityProvenance(source.authority, entity) }
      : {}),
  };
  if (
    include.has('narrative') &&
    result.narrative !== undefined &&
    Buffer.byteLength(result.narrative, 'utf8') > narrativeMaxBytes
  )
    throw new SdkError(
      'NARRATIVE_LIMIT',
      `narrative for ${entity.id} exceeds the supported bound`,
      { maxBytes: narrativeMaxBytes },
    );
  return result;
}

export type CanonicalGraphEdge = {
  key: string;
  from: string;
  relation: string;
  to: string;
  inferred: boolean;
  provenance?: SourceProvenance;
  presentations: GraphRelationPresentation[];
};
export type GraphArc = {
  edge: CanonicalGraphEdge;
  from: string;
  to: string;
  relation: string;
  mode: 'in' | 'out';
};
export type GraphView = {
  edges: Iterable<CanonicalGraphEdge> & { length: number };
  byId: Pick<ReadonlyMap<string, SourceEntity>, 'get' | 'size'>;
  relationNames: Set<string>;
  arcsByCurrent: Pick<ReadonlyMap<string, GraphArc[]>, 'get'>;
  arcsByEdge: Pick<ReadonlyMap<string, GraphArc[]>, 'get'>;
  arcs?: (current: string, options: NormalizedGraphOptions) => Iterable<GraphArc>;
  candidates?: (ids: Set<string>) => Iterable<CanonicalGraphEdge>;
};
export type NormalizedGraphOptions = {
  direction: GraphDirection;
  relations: Set<string> | undefined;
  nodeTypes: RuntimeClass[] | undefined;
  maxNodes: number;
  maxEdges: number;
};
type GraphScope = {
  ids: Set<string>;
  distances: Map<string, number>;
  traces: Map<string, GraphTraceStep[]>;
  nodesComplete: boolean;
  visibleSeeds: boolean;
};

const graphEdgeKey = (from: string, relation: string, to: string): string =>
  JSON.stringify([from, relation, to]);
const graphPresentationKey = (presentation: GraphRelationPresentation): string =>
  graphEdgeKey(presentation.from, presentation.relation, presentation.to);
const graphRelationOrder = (left: GraphRelationPresentation, right: GraphRelationPresentation) =>
  compareStrings(left.from, right.from) ||
  compareStrings(left.relation, right.relation) ||
  compareStrings(left.to, right.to) ||
  Number(left.inferred) - Number(right.inferred);

function graphRelationSlot(source: ReadSource, relation: string): RuntimeSlot | undefined {
  for (const c of Object.values(source.schema.classes)) {
    const slot = referenceSlot(source.schema, c.name, relation);
    if (slot) return slot;
  }
  return undefined;
}

function graphPresentation(
  source: ReadSource,
  relation: SemanticRelation,
): GraphRelationPresentation {
  return {
    from: relation.from,
    relation: relation.relation,
    to: relation.to,
    inferred: relation.inferred,
    ...(relation.provenance
      ? { provenance: provenance(source.authority, relation.provenance) }
      : {}),
  };
}

export function canonicalGraphView(source: ReadSource): GraphView {
  const edges = new Map<string, CanonicalGraphEdge>();
  const explicitInferred = new Set<string>();
  const semanticRelations = source.relations
    .filter((relation) => !relation.generic)
    .sort(
      (left, right) =>
        compareStrings(left.from, right.from) ||
        compareStrings(left.relation, right.relation) ||
        compareStrings(left.to, right.to) ||
        Number(left.inferred) - Number(right.inferred),
    );

  for (const relation of semanticRelations.filter((candidate) => !candidate.inferred)) {
    const presentation = graphPresentation(source, relation);
    const key = graphEdgeKey(relation.from, relation.relation, relation.to);
    edges.set(key, {
      key,
      from: relation.from,
      relation: relation.relation,
      to: relation.to,
      inferred: false,
      ...(presentation.provenance ? { provenance: presentation.provenance } : {}),
      presentations: [presentation],
    });
  }

  for (const relation of semanticRelations.filter((candidate) => candidate.inferred)) {
    const presentation = graphPresentation(source, relation);
    explicitInferred.add(graphPresentationKey(presentation));
    const inverse = graphRelationSlot(source, relation.relation)?.inverse;
    const assertedKey =
      inverse === undefined ? undefined : graphEdgeKey(relation.to, inverse, relation.from);
    const asserted = assertedKey === undefined ? undefined : edges.get(assertedKey);
    if (asserted) {
      asserted.presentations.push(presentation);
      continue;
    }
    const key = graphPresentationKey(presentation);
    edges.set(key, {
      key,
      from: relation.from,
      relation: relation.relation,
      to: relation.to,
      inferred: true,
      ...(presentation.provenance ? { provenance: presentation.provenance } : {}),
      presentations: [presentation],
    });
  }

  for (const edge of edges.values()) {
    if (edge.inferred) continue;
    const inverse = graphRelationSlot(source, edge.relation)?.inverse;
    if (inverse === undefined) continue;
    const presentation: GraphRelationPresentation = {
      from: edge.to,
      relation: inverse,
      to: edge.from,
      inferred: true,
    };
    if (!explicitInferred.has(graphPresentationKey(presentation)))
      edge.presentations.push(presentation);
  }

  for (const edge of edges.values()) edge.presentations.sort(graphRelationOrder);
  const sortedEdges = [...edges.values()].sort(
    (left, right) =>
      compareStrings(left.from, right.from) ||
      compareStrings(left.relation, right.relation) ||
      compareStrings(left.to, right.to) ||
      Number(left.inferred) - Number(right.inferred),
  );
  const relationNames = new Set<string>();
  for (const runtimeClass of Object.values(source.schema.classes))
    for (const { path } of referencePaths(source.schema, runtimeClass.name))
      relationNames.add(path);
  const arcsByCurrent = new Map<string, GraphArc[]>();
  const arcsByEdge = new Map<string, GraphArc[]>();
  const addArc = (arc: GraphArc): void => {
    const current = arcsByCurrent.get(arc.from) ?? [];
    current.push(arc);
    arcsByCurrent.set(arc.from, current);
    const edge = arcsByEdge.get(arc.edge.key) ?? [];
    edge.push(arc);
    arcsByEdge.set(arc.edge.key, edge);
  };
  for (const edge of sortedEdges) {
    const seen = new Set<string>();
    for (const presentation of edge.presentations) {
      const outKey = `${edge.key}\u0000${presentation.from}\u0000${presentation.relation}\u0000${presentation.to}\u0000out`;
      if (!seen.has(outKey)) {
        seen.add(outKey);
        addArc({
          edge,
          from: presentation.from,
          to: presentation.to,
          relation: presentation.relation,
          mode: 'out',
        });
      }
      const inKey = `${edge.key}\u0000${presentation.to}\u0000${presentation.relation}\u0000${presentation.from}\u0000in`;
      if (!seen.has(inKey)) {
        seen.add(inKey);
        addArc({
          edge,
          from: presentation.to,
          to: presentation.from,
          relation: presentation.relation,
          mode: 'in',
        });
      }
    }
  }
  const arcOrder = (left: GraphArc, right: GraphArc): number =>
    compareStrings(left.to, right.to) ||
    compareStrings(left.edge.relation, right.edge.relation) ||
    compareStrings(left.relation, right.relation) ||
    compareStrings(left.edge.from, right.edge.from) ||
    compareStrings(left.edge.to, right.edge.to) ||
    compareStrings(left.mode, right.mode);
  for (const arcs of arcsByCurrent.values()) arcs.sort(arcOrder);
  for (const arcs of arcsByEdge.values()) arcs.sort(arcOrder);
  return {
    edges: sortedEdges,
    byId: new Map(source.entities.map((entity) => [entity.id, entity])),
    relationNames,
    arcsByCurrent,
    arcsByEdge,
  };
}

function normalizeGraphOptions(
  source: ReadSource,
  view: GraphView,
  options: GraphOptions,
  complete = false,
): NormalizedGraphOptions {
  const direction = options.direction ?? 'both';
  if (direction !== 'in' && direction !== 'out' && direction !== 'both')
    throw new SdkError('INVALID_ARGUMENT', 'graph direction must be in, out, or both');
  const relations = options.relations === undefined ? undefined : new Set(options.relations);
  if (relations?.size === 0 || relations?.has(''))
    throw new SdkError('INVALID_ARGUMENT', 'graph relations must contain non-empty selectors');
  if (
    relations &&
    [...relations].some(
      (relation) =>
        !view.relationNames.has(relation) &&
        !Object.values(source.schema.classes).some((c) =>
          referenceSlot(source.schema, c.name, relation),
        ),
    )
  )
    throw new SdkError(
      'INVALID_ARGUMENT',
      'graph relation selector is not a declared reference slot',
    );
  const nodeTypes =
    options.nodeTypes === undefined
      ? undefined
      : [...new Set(options.nodeTypes)].map((type) => {
          const runtimeClass = resolveClass(source.schema, type);
          if (!runtimeClass)
            throw new SdkError('UNKNOWN_TYPE', `unknown graph node type ${JSON.stringify(type)}`);
          return runtimeClass;
        });
  if (nodeTypes?.length === 0)
    throw new SdkError('INVALID_ARGUMENT', 'graph nodeTypes must contain one or more types');
  const maxNodes = complete
    ? Math.max(1, view.byId.size)
    : (options.maxNodes ?? SDK_LIMITS.defaultGraphNodes);
  const maxEdges = complete
    ? Math.max(1, view.edges.length)
    : (options.maxEdges ?? SDK_LIMITS.defaultGraphEdges);
  if (
    !complete &&
    (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > SDK_LIMITS.maxGraphNodes)
  )
    throw new SdkError('INVALID_LIMIT', 'maxNodes must be a positive finite graph limit');
  if (
    !complete &&
    (!Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > SDK_LIMITS.maxGraphEdges)
  )
    throw new SdkError('INVALID_LIMIT', 'maxEdges must be a positive finite graph limit');
  return { direction, relations, nodeTypes, maxNodes, maxEdges };
}

function graphSeeds(
  source: ReadSource,
  ids: readonly string[],
  maxNodes: number,
  allowEmpty = false,
): string[] {
  if (
    !Array.isArray(ids) ||
    (!allowEmpty && ids.length === 0) ||
    ids.some((id) => typeof id !== 'string' || !id)
  )
    throw new SdkError('INVALID_ARGUMENT', 'graph operations require one or more non-empty IDs');
  const seeds = [...new Set(ids)].sort(compareStrings);
  for (const id of seeds)
    if (!source.entitiesById.has(id))
      throw new SdkError('MISSING_ENTITY', `entity ${JSON.stringify(id)} was not found`);
  if (seeds.length > maxNodes)
    throw new SdkError('INVALID_LIMIT', 'maxNodes cannot be smaller than the logical seed set');
  return seeds;
}

function graphArcs(
  view: GraphView,
  current: string,
  options: NormalizedGraphOptions,
): Iterable<GraphArc> {
  if (view.arcs) return view.arcs(current, options);
  const arcs = new Map<string, GraphArc>();
  for (const arc of view.arcsByCurrent.get(current) ?? []) {
    if (options.relations && !options.relations.has(arc.relation)) continue;
    if (options.direction !== 'both' && options.direction !== arc.mode) continue;
    const key = `${arc.edge.key}\u0000${arc.from}\u0000${arc.to}`;
    if (!arcs.has(key)) arcs.set(key, arc);
  }
  return [...arcs.values()].sort(
    (left, right) =>
      compareStrings(left.to, right.to) ||
      compareStrings(left.edge.relation, right.edge.relation) ||
      compareStrings(left.edge.from, right.edge.from) ||
      compareStrings(left.edge.to, right.edge.to),
  );
}

function graphTraceStep(edge: CanonicalGraphEdge): GraphTraceStep {
  return {
    from: edge.from,
    relation: edge.relation,
    to: edge.to,
    inferred: edge.inferred,
  };
}

function discoverGraphScope(
  view: GraphView,
  seeds: readonly string[],
  options: NormalizedGraphOptions,
  depth: number,
): GraphScope {
  const ids = new Set(seeds);
  const distances = new Map(seeds.map((id) => [id, 0]));
  const traces = new Map(seeds.map((id) => [id, [] as GraphTraceStep[]]));
  const queue = [...seeds];
  let nodesComplete = true;
  while (queue.length) {
    const current = queue.shift()!;
    const distance = distances.get(current)!;
    if (distance >= depth) continue;
    for (const arc of graphArcs(view, current, options)) {
      if (ids.has(arc.to)) continue;
      if (ids.size >= options.maxNodes) {
        nodesComplete = false;
        queue.length = 0;
        break;
      }
      ids.add(arc.to);
      distances.set(arc.to, distance + 1);
      traces.set(arc.to, [graphTraceStep(arc.edge), ...(traces.get(current) ?? [])]);
      queue.push(arc.to);
    }
  }
  return { ids, distances, traces, nodesComplete, visibleSeeds: true };
}

function discoverBoundaryScope(
  view: GraphView,
  seeds: readonly string[],
  options: NormalizedGraphOptions,
): GraphScope {
  const ids = new Set(seeds);
  const distances = new Map(seeds.map((id) => [id, 0]));
  const traces = new Map(seeds.map((id) => [id, [] as GraphTraceStep[]]));
  const candidates = new Map<string, GraphArc>();
  for (const seed of seeds)
    for (const arc of graphArcs(view, seed, options))
      if (!ids.has(arc.to)) candidates.set(arc.to, arc);
  const ordered = [...candidates.values()].sort(
    (left, right) =>
      compareStrings(left.to, right.to) || compareStrings(left.edge.key, right.edge.key),
  );
  let nodesComplete = true;
  for (const arc of ordered) {
    if (ids.size >= options.maxNodes) {
      nodesComplete = false;
      break;
    }
    ids.add(arc.to);
    distances.set(arc.to, 1);
    traces.set(arc.to, [graphTraceStep(arc.edge)]);
  }
  return { ids, distances, traces, nodesComplete, visibleSeeds: true };
}

function graphTypeVisible(
  entity: SourceEntity,
  schema: RuntimeSchemaIR,
  nodeTypes: RuntimeClass[] | undefined,
): boolean {
  return (
    nodeTypes === undefined ||
    nodeTypes.some((runtimeClass) => isSubclass(schema, entity.kind, runtimeClass.name))
  );
}

function graphCandidateEdges(
  view: GraphView,
  options: NormalizedGraphOptions,
  predicate: (arc: GraphArc) => boolean,
  ids: Set<string>,
): { candidates: CanonicalGraphEdge[]; examined: number; complete: boolean } {
  const candidates: CanonicalGraphEdge[] = [];
  let examined = 0;
  let complete = true;
  for (const edge of view.candidates?.(ids) ?? view.edges) {
    if (!graphArcsForEdge(view, edge, options).some(predicate)) continue;
    if (examined >= options.maxEdges) {
      complete = false;
      break;
    }
    examined += 1;
    candidates.push(edge);
  }
  return { candidates, examined, complete };
}

function graphArcsForEdge(
  view: GraphView,
  edge: CanonicalGraphEdge,
  options: NormalizedGraphOptions,
): GraphArc[] {
  return (view.arcsByEdge.get(edge.key) ?? [])
    .filter((arc) => !options.relations || options.relations.has(arc.relation))
    .filter((arc) => options.direction === 'both' || options.direction === arc.mode)
    .filter(
      (arc, index, arcs) =>
        arcs.findIndex((candidate) => candidate.from === arc.from && candidate.to === arc.to) ===
        index,
    );
}

function graphResult(
  source: ReadSource,
  view: GraphView,
  seeds: readonly string[],
  scope: GraphScope,
  options: NormalizedGraphOptions,
  operation: 'neighbors' | 'neighborhood' | 'subgraph' | 'boundary',
): GraphResult {
  const seedSet = new Set(seeds);
  const edgeScan = graphCandidateEdges(
    view,
    options,
    (arc) => {
      if (operation === 'subgraph') return scope.ids.has(arc.from) && scope.ids.has(arc.to);
      if (operation === 'boundary')
        return (
          seedSet.has(arc.from) !== seedSet.has(arc.to) &&
          scope.ids.has(arc.from) &&
          scope.ids.has(arc.to)
        );
      if (operation === 'neighbors')
        return (
          (arc.from === arc.to && seedSet.has(arc.from)) ||
          (seedSet.has(arc.from) && scope.ids.has(arc.to) && !seedSet.has(arc.to)) ||
          (seedSet.has(arc.to) && scope.ids.has(arc.from) && !seedSet.has(arc.from))
        );
      return scope.ids.has(arc.from) && scope.ids.has(arc.to);
    },
    scope.ids,
  );
  const {
    candidates: returnedCandidates,
    examined: edgesExamined,
    complete: edgesComplete,
  } = edgeScan;
  const visibleIds = new Set(
    [...scope.ids].filter((id) => {
      const entity = view.byId.get(id);
      return (
        entity !== undefined &&
        graphTypeVisible(entity, source.schema, options.nodeTypes) &&
        (operation !== 'neighbors' || !seedSet.has(id)) &&
        (operation !== 'boundary' || !seedSet.has(id))
      );
    }),
  );
  const nodes = [...scope.ids]
    .filter((id) => visibleIds.has(id))
    .sort(
      (left, right) =>
        scope.distances.get(left)! - scope.distances.get(right)! || compareStrings(left, right),
    )
    .map((id) => {
      const entity = view.byId.get(id)!;
      return {
        id,
        type: entity.kind,
        typeId: entity.typeId,
        distance: scope.distances.get(id)!,
        trace: clone(scope.traces.get(id) ?? []),
        provenance: entityProvenance(source.authority, entity),
      } satisfies GraphNode;
    });
  const edges = returnedCandidates.map(
    (edge) =>
      ({
        from: edge.from,
        relation: edge.relation,
        to: edge.to,
        inferred: edge.inferred,
        ...(edge.provenance ? { provenance: edge.provenance } : {}),
        fromVisible: visibleIds.has(edge.from),
        toVisible: visibleIds.has(edge.to),
        presentations: clone(edge.presentations),
      }) satisfies GraphEdge,
  );
  const nodesReason: GraphCoverageReason = !scope.nodesComplete
    ? 'node-limit'
    : nodes.length === 0 && operation === 'neighbors'
      ? 'empty'
      : 'complete';
  const edgesReason: GraphCoverageReason = !edgesComplete
    ? 'edge-limit'
    : edges.length === 0 && edgeScan.examined === 0
      ? 'empty'
      : 'complete';
  return {
    seedIds: [...seeds],
    nodes,
    edges,
    coverage: {
      nodes: {
        complete: scope.nodesComplete,
        examined: scope.ids.size,
        returned: nodes.length,
        remaining: scope.nodesComplete ? 0 : undefined,
        reason: nodesReason,
      },
      edges: {
        complete: edgesComplete,
        examined: edgesExamined,
        returned: edges.length,
        remaining: edgesComplete ? 0 : undefined,
        reason: edgesReason,
      },
      next: scope.nodesComplete && edgesComplete ? 'none' : 'new-request',
    },
    snapshot: source.state,
  };
}

function graphOperation(
  source: ReadSource,
  view: GraphView,
  operation: 'neighbors' | 'neighborhood' | 'subgraph' | 'boundary',
  ids: readonly string[],
  options: GraphOptions | NeighborhoodOptions = {},
  complete = false,
): GraphResult {
  const normalized = normalizeGraphOptions(source, view, options, complete);
  const seeds = graphSeeds(source, ids, normalized.maxNodes, complete);
  if (operation === 'neighborhood') {
    const depth = (options as NeighborhoodOptions).depth;
    if (!Number.isInteger(depth) || depth < 0 || depth > 32)
      throw new SdkError(
        'INVALID_ARGUMENT',
        'graph neighborhood depth must be an integer between 0 and 32',
      );
    return graphResult(
      source,
      view,
      seeds,
      discoverGraphScope(view, seeds, normalized, depth),
      normalized,
      operation,
    );
  }
  if (operation === 'neighbors')
    return graphResult(
      source,
      view,
      seeds,
      discoverGraphScope(view, seeds, normalized, 1),
      normalized,
      operation,
    );
  if (operation === 'subgraph') {
    return graphResult(
      source,
      view,
      seeds,
      {
        ids: new Set(seeds),
        distances: new Map(seeds.map((id) => [id, 0])),
        traces: new Map(seeds.map((id) => [id, [] as GraphTraceStep[]])),
        nodesComplete: true,
        visibleSeeds: true,
      },
      normalized,
      operation,
    );
  }
  return graphResult(
    source,
    view,
    seeds,
    discoverBoundaryScope(view, seeds, normalized),
    normalized,
    operation,
  );
}

function graphInputIds(input: GraphInput): string[] {
  const items = isRecord(input) ? input.items : input;
  if (!Array.isArray(items))
    throw new SdkError('INVALID_ARGUMENT', 'graph input must be an ID array or entity collection');
  return items.map((item: unknown) => {
    if (typeof item === 'string') return item;
    if (isRecord(item) && typeof item.id === 'string') return item.id;
    throw new SdkError(
      'INVALID_ARGUMENT',
      'graph selections must contain IDs or entities with an id',
    );
  });
}

const graphViews = new WeakMap<IndexV2, GraphView>();

class GraphReaderImpl implements GraphReader {
  private get view(): GraphView {
    if (this.source.graphView) return this.source.graphView();
    let view = graphViews.get(this.source.index);
    if (!view) {
      view = canonicalGraphView(this.source);
      graphViews.set(this.source.index, view);
    }
    return view;
  }
  constructor(
    private readonly source: ReadSource,
    private readonly complete = false,
  ) {}
  async neighbors(input: GraphInput, options: GraphOptions = {}): Promise<GraphResult> {
    await this.source.revalidate();
    return graphOperation(
      this.source,
      this.view,
      'neighbors',
      graphInputIds(input),
      options,
      this.complete,
    );
  }
  async neighborhood(input: GraphInput, options: NeighborhoodOptions): Promise<GraphResult> {
    await this.source.revalidate();
    return graphOperation(
      this.source,
      this.view,
      'neighborhood',
      graphInputIds(input),
      options,
      this.complete,
    );
  }
  async subgraph(input: GraphInput, options: GraphOptions = {}): Promise<GraphResult> {
    await this.source.revalidate();
    return graphOperation(
      this.source,
      this.view,
      'subgraph',
      graphInputIds(input),
      options,
      this.complete,
    );
  }
  async boundary(input: GraphInput, options: GraphOptions = {}): Promise<GraphResult> {
    await this.source.revalidate();
    return graphOperation(
      this.source,
      this.view,
      'boundary',
      graphInputIds(input),
      options,
      this.complete,
    );
  }
}

export class ReadSnapshotImpl implements ReadSnapshot {
  readonly snapshot: SnapshotInfo;
  readonly schema: SchemaReader;
  readonly entities: EntityReader;
  readonly graph: GraphReader;
  readonly hierarchy: HierarchyReader;
  constructor(
    private readonly source: ReadSource,
    private readonly completeReads = false,
    scopedHierarchy = false,
  ) {
    this.snapshot = source.state;
    this.schema = new SchemaReaderImpl(source, this.completeReads);
    this.entities = new EntityReaderImpl(source);
    this.graph = new GraphReaderImpl(source, this.completeReads);
    this.hierarchy = new HierarchyReaderImpl(source, scopedHierarchy);
  }
  dispose(): void {
    (this.hierarchy as HierarchyReaderImpl).dispose();
  }
  async describe(): Promise<WorkspaceDescription> {
    await this.source.revalidate();
    return describeSource(this.source);
  }
  async query(options: QueryOptions): Promise<QueryResult> {
    await this.source.revalidate();
    return querySource(this.source, options, this.completeReads);
  }
  async search(options: SearchOptions): Promise<SearchResult> {
    await this.source.revalidate();
    return searchSource(this.source, options, this.completeReads);
  }
  async explore(options: ExploreOptions): Promise<ExploreResult> {
    await this.source.revalidate();
    return exploreSource(this.source, options);
  }
}

class SchemaReaderImpl implements SchemaReader {
  constructor(
    private readonly source: ReadSource,
    private readonly completeReads = false,
  ) {}
  async listTypes(options: TypeCatalogOptions = {}): Promise<TypeCatalogPage> {
    await this.source.revalidate();
    const limit = this.completeReads
      ? Math.max(1, Object.keys(this.source.schema.classes).length)
      : validateLimit(options.limit, this.source.maxPageSize);
    const all = Object.values(this.source.schema.classes).sort((left, right) =>
      compareStrings(left.name, right.name),
    );
    const text = options.text?.toLocaleLowerCase();
    const filtered =
      text === undefined
        ? all
        : all.filter((runtimeClass) =>
            [runtimeClass.name, runtimeClass.title, runtimeClass.description]
              .filter((value): value is string => Boolean(value))
              .some((value) => value.toLocaleLowerCase().includes(text)),
          );
    const fp = fingerprint({ text: options.text ?? null });
    const expected = {
      version: 1 as const,
      kind: 'types' as const,
      workspace: this.source.schemaIdentity.hash,
      state: this.source.state.id,
      fingerprint: fp,
    };
    const position =
      !this.completeReads && options.continuation ? decodeToken(options.continuation, expected) : 0;
    const items = filtered.slice(position, position + limit).map(typeSummary);
    const remaining = Math.max(0, filtered.length - position - items.length);
    return {
      items,
      ...(remaining
        ? { continuation: encodeToken({ ...expected, position: position + items.length }) }
        : {}),
      coverage: coverage(
        filtered.length,
        items.length,
        remaining,
        remaining ? 'page-limit' : items.length ? 'complete' : 'empty',
      ),
      snapshot: this.source.state,
    };
  }
  async describeType(type: string): Promise<TypeDescription> {
    await this.source.revalidate();
    const runtimeClass = resolveClass(this.source.schema, type);
    if (!runtimeClass) throw new SdkError('UNKNOWN_TYPE', `unknown type ${JSON.stringify(type)}`);
    return typeDescription(this.source, runtimeClass);
  }
}

class EntityReaderImpl implements EntityReader {
  constructor(private readonly source: ReadSource) {}
  async get(id: string, options: GetOptions = {}): Promise<EntityReadResult> {
    await this.source.revalidate();
    const entity = this.source.entitiesById.get(id);
    if (!entity) throw new SdkError('MISSING_ENTITY', `entity ${JSON.stringify(id)} was not found`);
    const include = new Set<EntityFacet>(
      options.include ?? ['properties', 'provenance', 'relations'],
    );
    const fields = selectFields(this.source, entity.kind, options.select);
    return {
      item: entityResult(
        this.source,
        entity,
        fields,
        include,
        options.narrativeMaxBytes ?? this.source.maxNarrativeBytes,
      ),
      snapshot: this.source.state,
      coverage: coverage(1, 1, 0, 'complete'),
    };
  }
  async getMany(ids: readonly string[], options: GetOptions = {}): Promise<EntityManyReadResult> {
    await this.source.revalidate();
    if (ids.some((id) => typeof id !== 'string' || !id))
      throw new SdkError('INVALID_ARGUMENT', 'getMany IDs must be non-empty strings');
    const requested = [...new Set(ids)].sort(compareStrings);
    const include = new Set<EntityFacet>(
      options.include ?? ['properties', 'provenance', 'relations'],
    );
    const items: Entity[] = [];
    const missingIds: string[] = [];
    for (const id of requested) {
      const entity = this.source.entitiesById.get(id);
      if (!entity) {
        missingIds.push(id);
        continue;
      }
      const fields = selectFields(this.source, entity.kind, options.select);
      items.push(
        entityResult(
          this.source,
          entity,
          fields,
          include,
          options.narrativeMaxBytes ?? this.source.maxNarrativeBytes,
        ),
      );
    }
    return {
      items,
      missingIds,
      snapshot: this.source.state,
      coverage: coverage(
        requested.length,
        items.length,
        missingIds.length,
        missingIds.length ? 'missing-selection' : items.length ? 'complete' : 'empty',
      ),
    };
  }
}

function sourceScan<T>(
  source: ReadSource,
  position: number,
  limit: number,
  budget: number,
  match: (entity: SourceEntity) => T | undefined,
): BoundedScan<T> {
  if (!source.storage) return boundedScan(source.entities, position, limit, budget, match);
  const scan = boundedScan(source.storage.scan(position, budget), 0, limit, budget, match);
  scan.position += position;
  scan.complete = scan.position >= source.storage.count;
  scan.reason = scan.complete
    ? 'complete'
    : scan.items.length >= limit
      ? 'page-limit'
      : 'scan-budget';
  return scan;
}

function querySource(source: ReadSource, options: QueryOptions, complete = false): QueryResult {
  const limit = complete
    ? Math.max(1, source.storage?.count ?? source.entities.length)
    : validateLimit(options.limit, source.maxPageSize);
  const scanBudget = complete
    ? Math.max(1, source.storage?.count ?? source.entities.length)
    : validateScanBudget(options.scanBudget, source.maxScanBudget);
  const selected =
    options.type === undefined ? undefined : resolveClass(source.schema, options.type);
  if (options.type !== undefined && !selected)
    throw new SdkError('UNKNOWN_TYPE', `unknown type ${JSON.stringify(options.type)}`);
  const where = options.where ?? {};
  validateWhere(source, selected, where);
  const fp = fingerprint({
    type: selected?.name ?? null,
    where: stableValue(where),
    select: options.select ?? null,
    limit,
    scanBudget,
  });
  const expected = {
    version: 1 as const,
    kind: 'query' as const,
    workspace: source.schemaIdentity.hash,
    state: source.state.id,
    fingerprint: fp,
  };
  const position =
    !complete && options.continuation ? decodeToken(options.continuation, expected) : 0;
  const scan = sourceScan(source, position, limit, scanBudget, (entity) =>
    matchesType(source.schema, entity, selected) && filterMatches(source, entity, where)
      ? entity
      : undefined,
  );
  const items = scan.items.map((entity) =>
    entityResult(
      source,
      entity,
      selectFields(source, entity.kind, options.select),
      new Set(['properties', 'relations']),
      source.maxNarrativeBytes,
    ),
  );
  return {
    items,
    ...(!scan.complete
      ? { continuation: encodeToken({ ...expected, position: scan.position }) }
      : {}),
    coverage: coverage(
      scan.examined,
      items.length,
      scan.complete ? 0 : undefined,
      scan.complete && items.length === 0 ? 'empty' : scan.reason,
    ),
    snapshot: source.state,
  };
}
function searchSource(source: ReadSource, options: SearchOptions, complete = false): SearchResult {
  if (typeof options.text !== 'string')
    throw new SdkError('INVALID_ARGUMENT', 'search text must be a string');
  const limit = complete
    ? Math.max(1, source.storage?.count ?? source.entities.length)
    : validateLimit(options.limit, source.maxPageSize);
  const scanBudget = complete
    ? Math.max(1, source.storage?.count ?? source.entities.length)
    : validateScanBudget(options.scanBudget, source.maxScanBudget);
  const selectedTypes = options.types?.map((type) => resolveClass(source.schema, type));
  if (selectedTypes?.some((runtimeClass) => runtimeClass === undefined))
    throw new SdkError('UNKNOWN_TYPE', 'search contains an unknown type');
  const classes = selectedTypes as RuntimeClass[] | undefined;
  const needle = options.text.toLocaleLowerCase();
  const fp = fingerprint({ text: options.text, types: options.types ?? null, limit, scanBudget });
  const expected = {
    version: 1 as const,
    kind: 'search' as const,
    workspace: source.schemaIdentity.hash,
    state: source.state.id,
    fingerprint: fp,
  };
  const position =
    !complete && options.continuation ? decodeToken(options.continuation, expected) : 0;
  const scan = sourceScan(source, position, limit, scanBudget, (entity) => {
    if (
      classes &&
      !classes.some((runtimeClass) => isSubclass(source.schema, entity.kind, runtimeClass.name))
    )
      return undefined;
    const values: Array<{
      field: string;
      representation: MatchExplanation['representation'];
      value: string;
    }> = [
      { field: 'id', representation: 'id', value: entity.id },
      { field: 'type', representation: 'type', value: entity.kind },
      { field: 'typeId', representation: 'type-id', value: entity.typeId },
    ];
    for (const [field, value] of Object.entries(entity.properties))
      if (isScalar(value)) values.push({ field, representation: 'property', value: String(value) });
    const found = values
      .filter((value) => value.value.toLocaleLowerCase().includes(needle))
      .sort(
        (left, right) =>
          compareStrings(left.field, right.field) || compareStrings(left.value, right.value),
      );
    return found.length ? { entity, found } : undefined;
  });
  const items = scan.items.map(({ entity, found }) => ({
    item: entityResult(
      source,
      entity,
      new Set<string>(),
      new Set<EntityFacet>(['properties']),
      source.maxNarrativeBytes,
    ),
    matches: found.map((match) => ({
      field: match.field,
      representation: match.representation,
      snippet: match.value.length > 120 ? `${match.value.slice(0, 117)}...` : match.value,
    })),
  }));
  return {
    items,
    searchableFields: ['id', 'type', 'typeId', 'properties.<scalar>'],
    ...(!scan.complete
      ? { continuation: encodeToken({ ...expected, position: scan.position }) }
      : {}),
    coverage: coverage(
      scan.examined,
      items.length,
      scan.complete ? 0 : undefined,
      scan.complete && items.length === 0 ? 'empty' : scan.reason,
    ),
    snapshot: source.state,
  };
}
function exploreSource(source: ReadSource, options: ExploreOptions): ExploreResult {
  const views = sourceViews(source.schema);
  if (!views.includes(options.view))
    throw new SdkError(
      'UNSUPPORTED_VIEW',
      `explore view ${JSON.stringify(options.view)} is not configured`,
    );
  if (options.view !== 'overview' && !options.root)
    throw new SdkError('INVALID_ARGUMENT', `${options.view} explore requires a root entity ID`);
  if (options.root && !source.entitiesById.has(options.root))
    throw new SdkError('MISSING_ENTITY', `entity ${JSON.stringify(options.root)} was not found`);
  const depth = options.depth ?? 1;
  if (!Number.isInteger(depth) || depth < 0 || depth > 32)
    throw new SdkError('INVALID_ARGUMENT', 'explore depth must be an integer between 0 and 32');
  try {
    const report = coreExplore(
      source.storage?.fullIndex() ?? source.index,
      options.view,
      options.root,
      depth,
      source.schema,
      {
        schemaHash: source.schemaIdentity.hash,
      },
    );
    return {
      view: options.view,
      report,
      coverage: coverage(source.storage?.count ?? source.entities.length, 1, 0, 'complete'),
      snapshot: source.state,
    };
  } catch (error) {
    throw new SdkError(
      'UNSUPPORTED_VIEW',
      error instanceof Error ? error.message : String(error),
      {},
      { cause: error },
    );
  }
}
function describeSource(source: ReadSource): WorkspaceDescription {
  return {
    authority: source.authority,
    schema: source.schemaIdentity,
    capabilities: workspaceCapabilities(),
    types: Object.values(source.schema.classes)
      .sort((left, right) => compareStrings(left.name, right.name))
      .map(typeSummary),
    views: sourceViews(source.schema),
    snapshot: source.state,
  };
}

function outputLimit(limit: number, name: string): number {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new SdkError('INVALID_LIMIT', `${name} must be a non-negative integer`);
  return limit;
}

function outputCoverage<C extends Coverage | GraphCoverageDimension>(
  original: C,
  before: number,
  after: number,
): C {
  if (after === before) return original;
  return {
    ...original,
    complete: false,
    returned: after,
    remaining: original.remaining === undefined ? undefined : original.remaining + before - after,
    reason: 'output-limit',
  };
}

function limitItems<T>(result: Collection<T>, limit = 20): Collection<T> {
  const items = result.items.slice(0, outputLimit(limit, 'items'));
  return {
    items,
    snapshot: result.snapshot,
    coverage: outputCoverage(result.coverage, result.items.length, items.length),
  };
}

function limitGraph(
  result: GraphPreview,
  limits: { nodes?: number; edges?: number } = {},
): GraphPreview {
  const nodes = result.nodes
    .slice(0, outputLimit(limits.nodes ?? 20, 'nodes'))
    .map(({ id, type, distance }) => ({ id, type, distance }));
  const edgeLimit = outputLimit(limits.edges ?? 40, 'edges');
  const visible = new Set(nodes.map(({ id }) => id));
  // Do not keep edges whose previously visible endpoints were removed from the preview.
  const edges = result.edges
    .filter(
      (edge) =>
        (!edge.fromVisible || visible.has(edge.from)) && (!edge.toVisible || visible.has(edge.to)),
    )
    .slice(0, edgeLimit)
    .map(({ from, relation, to, inferred, fromVisible, toVisible }) => ({
      from,
      relation,
      to,
      inferred,
      fromVisible,
      toVisible,
    }));
  const nodeCoverage = outputCoverage(result.coverage.nodes, result.nodes.length, nodes.length);
  const edgeCoverage = outputCoverage(result.coverage.edges, result.edges.length, edges.length);
  return {
    nodes,
    edges,
    snapshot: result.snapshot,
    coverage: {
      nodes: nodeCoverage,
      edges: edgeCoverage,
      next: nodeCoverage.complete && edgeCoverage.complete ? 'none' : 'new-request',
    },
  };
}

function tracedRead(read: ReadSnapshot, session: PtcSession): PtcRead {
  return {
    hierarchy: {
      propose: (options) =>
        session.run({ method: 'hierarchy.propose' }, () => read.hierarchy.propose(options)),
      read: (options) =>
        session.run({ method: 'hierarchy.read' }, () => read.hierarchy.read(options)),
    },
    snapshot: read.snapshot,
    limitItems,
    limitGraph,
    retain: (value, options) => session.retain(value, options),
    results: {
      get: (reference, options) =>
        session.run({ method: 'results.get' }, () => session.results.get(reference, options)),
      describe: (reference) =>
        session.run({ method: 'results.describe' }, () => session.results.describe(reference)),
      release: (reference) =>
        session.run({ method: 'results.release' }, () => session.results.release(reference)),
    },
    describe: () => session.run({ method: 'describe' }, () => read.describe()),
    query: (options = {}) => session.run({ method: 'query' }, () => read.query(options)),
    search: (options) => session.run({ method: 'search' }, () => read.search(options)),
    explore: (options) => session.run({ method: 'explore' }, () => read.explore(options)),
    schema: {
      listTypes: (options) =>
        session.run({ method: 'schema.listTypes' }, () => read.schema.listTypes(options)),
      describeType: (type) =>
        session.run({ method: 'schema.describeType' }, () => read.schema.describeType(type)),
    },
    entities: {
      get: (id, options) =>
        session.run({ method: 'entities.get' }, () => read.entities.get(id, options)),
      getMany: (ids, options) =>
        session.run({ method: 'entities.getMany' }, () => read.entities.getMany(ids, options)),
    },
    graph: {
      neighbors: (ids, options) =>
        session.run({ method: 'graph.neighbors' }, () => read.graph.neighbors(ids, options)),
      neighborhood: (ids, options) =>
        session.run({ method: 'graph.neighborhood' }, () => read.graph.neighborhood(ids, options)),
      subgraph: (ids, options) =>
        session.run({ method: 'graph.subgraph' }, () => read.graph.subgraph(ids, options)),
      boundary: (ids, options) =>
        session.run({ method: 'graph.boundary' }, () => read.graph.boundary(ids, options)),
    },
  };
}

class WorkspaceImpl implements Workspace {
  readonly authority: WorkspaceAuthority;
  readonly schema: SchemaReader;
  readonly entities: EntityReader;
  readonly graph: GraphReader;
  readonly hierarchy: HierarchyReader;
  private scope: PtcScope | undefined;
  constructor(
    private readonly source: ReadSource,
    private readonly ptcOptions?: PtcRuntimeOptions,
  ) {
    this.authority = source.authority;
    this.schema = new SchemaReaderImpl(source);
    this.entities = new EntityReaderImpl(source);
    this.graph = new GraphReaderImpl(source);
    this.hierarchy = new HierarchyReaderImpl(source);
  }
  private get ptcScope(): PtcScope {
    this.scope ??= createPtcRuntime(this.ptcOptions).createScope();
    return this.scope;
  }
  get results(): ResultStore {
    return this.ptcScope.results;
  }
  get trace(): TraceStore {
    return this.ptcScope.trace;
  }
  async describe(): Promise<WorkspaceDescription> {
    return this.readSnapshot((read) => read.describe());
  }
  async query(options: QueryOptions): Promise<QueryResult> {
    return this.readSnapshot((read) => read.query(options));
  }
  async search(options: SearchOptions): Promise<SearchResult> {
    return this.readSnapshot((read) => read.search(options));
  }
  async explore(options: ExploreOptions): Promise<ExploreResult> {
    return this.readSnapshot((read) => read.explore(options));
  }
  async readSnapshot<T>(callback: (read: ReadSnapshot) => Promise<T> | T): Promise<T> {
    const read = new ReadSnapshotImpl(this.source, false, true);
    try {
      return await callback(read);
    } finally {
      read.dispose();
    }
  }
  async call<T>(callback: (read: PtcRead) => Promise<T> | T): Promise<PtcResponse<T>> {
    return this.ptcScope.execute(async (session) => {
      await this.source.revalidate();
      // All operations read the same in-memory source; check files at call boundaries.
      const source = { ...this.source, revalidate: async () => {} };
      const read = new ReadSnapshotImpl(source, true, true);
      try {
        const result = await callback(tracedRead(read, session));
        await this.source.revalidate();
        return result;
      } finally {
        read.dispose();
      }
    });
  }
}

export async function openFilesystemWorkspace(
  options: FilesystemWorkspaceOptions,
): Promise<Workspace> {
  const source = await openFilesystemSource(options);
  return new WorkspaceImpl(source, options.ptc);
}
export * from './ptc.js';

export function projectionSource(index: IndexV2, schema: RuntimeSchemaIR): ReadSource {
  const semantic = snapshotFromBuildResult({ index, schema });
  const entities = Object.values(semantic.entities).map((entity) => ({
    ...entity,
    ...(index.artifacts[entity.id]?.body === undefined
      ? {}
      : { narrative: index.artifacts[entity.id]!.body }),
  }));
  return {
    authority: 'filesystem',
    schema,
    schemaIdentity: schemaIdentity(schema, index.schema_hash),
    entities,
    entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
    relations: semantic.relations,
    relationsByEntity: indexEntityRelations(semantic.relations),
    index,
    state: buildState('filesystem', index.schema_hash, ''),
    maxPageSize: SDK_LIMITS.maxPageSize,
    maxScanBudget: SDK_LIMITS.maxScanBudget,
    maxNarrativeBytes: SDK_LIMITS.maxNarrativeBytes,
    revalidate: () => {},
  };
}
