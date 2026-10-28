import { randomUUID } from 'node:crypto';

import type { Coverage, GraphCoverage, SnapshotInfo } from './index.js';

export const PTC_OUTCOME = {
  SUCCESS: 'success',
  EMPTY: 'empty',
  PARTIAL: 'partial',
  ERROR: 'error',
} as const;
export type PtcOutcome = (typeof PTC_OUTCOME)[keyof typeof PTC_OUTCOME];

export const PTC_RESULT_KIND = {
  QUERY: 'query',
  SEARCH: 'search',
  GRAPH: 'graph',
  ENTITY: 'entity',
  CUSTOM: 'custom',
} as const;
export type PtcResultKind = (typeof PTC_RESULT_KIND)[keyof typeof PTC_RESULT_KIND] | (string & {});

export const PTC_TRACE_STATUS = {
  AVAILABLE: 'available',
  OMITTED: 'omitted',
  UNAVAILABLE: 'unavailable',
} as const;
export type PtcTraceStatus = (typeof PTC_TRACE_STATUS)[keyof typeof PTC_TRACE_STATUS];

export const PTC_STATUS = {
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type PtcStatus = (typeof PTC_STATUS)[keyof typeof PTC_STATUS];

export const PTC_TRACE_UNAVAILABLE_REASON = {
  EXPIRED: 'expired',
  EVICTED: 'evicted',
  NOT_FOUND: 'not-found',
  ACCESS_DENIED: 'access-denied',
} as const;
export type PtcTraceUnavailableReason =
  (typeof PTC_TRACE_UNAVAILABLE_REASON)[keyof typeof PTC_TRACE_UNAVAILABLE_REASON];

export const PTC_ERROR_CODE = {
  RUNTIME_CLOSED: 'RUNTIME_CLOSED',
  SCOPE_CLOSED: 'SCOPE_CLOSED',
  INVALID_OPERATION: 'INVALID_OPERATION',
  INVALID_VIEW_LIMIT: 'INVALID_VIEW_LIMIT',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  SENSITIVE_VALUE: 'SENSITIVE_VALUE',
  RETENTION_QUOTA_EXCEEDED: 'RETENTION_QUOTA_EXCEEDED',
  RESULT_EXPIRED: 'RESULT_EXPIRED',
  RESULT_EVICTED: 'RESULT_EVICTED',
  RESULT_RELEASED: 'RESULT_RELEASED',
  RESULT_NOT_FOUND: 'RESULT_NOT_FOUND',
  RESULT_ACCESS_DENIED: 'RESULT_ACCESS_DENIED',
  SNAPSHOT_IDENTITY_CONFLICT: 'SNAPSHOT_IDENTITY_CONFLICT',
} as const;
export type PtcErrorCode = (typeof PTC_ERROR_CODE)[keyof typeof PTC_ERROR_CODE];

export const MIN_TRACE_DETAIL_BYTES = 128;
export const MIN_TRACE_QUOTA_BYTES = 256;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PtcCoverage = Coverage | GraphCoverage | JsonValue;
export type PtcCounts = {
  items?: number;
  nodes?: number;
  edges?: number;
};
export type PtcSummary = {
  kind?: PtcResultKind;
  count?: number;
  counts?: PtcCounts;
  coverage?: PtcCoverage;
  snapshot?: SnapshotInfo;
  outcome?: PtcOutcome;
};

// Preserve the retained value's TypeScript type without adding data to the handle.
declare const retainedValueType: unique symbol;
export type ResultReference<T = unknown> = {
  id: string;
  kind: PtcResultKind;
  readonly [retainedValueType]?: T;
};

export type PtcOperationOptions = {
  method: string;
  label?: string;
  summary?: PtcSummary;
};

export type PtcErrorInfo = {
  code: string;
  message: string;
};

export type PtcOperationEvent = {
  executionId: string;
  operationId: string;
  method: string;
  label?: string;
  outcome: PtcOutcome;
  kind?: PtcResultKind;
  count?: number;
  counts?: PtcCounts;
  coverage?: PtcCoverage;
  snapshot?: SnapshotInfo;
  resultReference?: ResultReference;
  error?: PtcErrorInfo;
};

export const PTC_COVERAGE_MARKER = {
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  EMPTY: 'empty',
} as const;
export type PtcCoverageMarker = (typeof PTC_COVERAGE_MARKER)[keyof typeof PTC_COVERAGE_MARKER];

export type PtcOutcomeSummary = {
  method: string;
  operationId: string;
  outcome: PtcOutcome;
  errorCode?: string;
  count?: number;
  coverage?: PtcCoverageMarker;
};

export type PtcErrorReport = {
  total: number;
  retained: number;
  omitted: number;
};

export type PtcResponse<T> = {
  executionId: string;
  events: readonly PtcOperationEvent[];
  trace: string;
  traceBytes: number;
  traceStatus: PtcTraceStatus;
  omittedEvents: number;
  outcomeSummaries: readonly PtcOutcomeSummary[];
  errorReport: PtcErrorReport;
  summary?: PtcSummary;
} & (
  | { status: typeof PTC_STATUS.COMPLETED; result: T; error?: never }
  | { status: typeof PTC_STATUS.FAILED; error: PtcErrorInfo; result?: never }
);

export type RetainOptions = {
  label?: string;
  operationId?: string;
  kind?: PtcResultKind;
  snapshot?: SnapshotInfo;
  coverage?: PtcCoverage;
  sensitive?: boolean;
};

export type PtcRuntimeOptions = {
  ttlMs?: number;
  maxRetainedBytes?: number;
  maxTombstones?: number;
  maxTraceEvents?: number;
  maxTraceBytes?: number;
  maxStoredTraceBytes?: number;
  now?: () => number;
};

export type RetainedResultDescription = {
  reference: ResultReference;
  label?: string;
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
  snapshot?: SnapshotInfo;
  coverage?: PtcCoverage;
};

export type ResultGetOptions = {
  limit?: number;
};

export type ResultViewCoverage = {
  complete: boolean;
  examined: number;
  returned: number;
  remaining?: number;
  reason: 'complete' | 'view-limit';
};

export type RetainedResult<T = JsonValue> = {
  reference: ResultReference<T>;
  value: T;
  snapshot?: SnapshotInfo;
  coverage?: PtcCoverage;
  viewCoverage: ResultViewCoverage;
};

export interface ResultStore {
  describe(reference: ResultReference | string): Promise<RetainedResultDescription>;
  get<T = JsonValue>(
    reference: ResultReference<T> | string,
    options?: ResultGetOptions,
  ): Promise<RetainedResult<T>>;
  release(reference: ResultReference | string): Promise<void>;
}

export type TraceGetOptions = {
  operationId?: string;
  limit?: number;
};

export type TraceDetails = {
  status: PtcTraceStatus;
  executionId: string;
  operationId?: string;
  events: readonly PtcOperationEvent[];
  omittedEvents: number;
  detailBytes: number;
  summaryBytes: number;
  traceBytes: number;
  outcomeSummaries: readonly PtcOutcomeSummary[];
  errorReport: PtcErrorReport;
  summary?: PtcSummary;
  error?: PtcErrorInfo;
  unavailableReason?: PtcTraceUnavailableReason;
};

export interface TraceStore {
  get(executionId: string, options?: TraceGetOptions): Promise<TraceDetails>;
}

export class PtcError extends Error {
  readonly code: PtcErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: PtcErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PtcError';
    this.code = code;
    this.details = details;
  }
}

type TombstoneStatus = 'expired' | 'evicted' | 'released' | 'trace-expired' | 'trace-evicted';
type Tombstone = { id: string; scopeId: string; status: TombstoneStatus; at: number };
type StoredResult = {
  reference: ResultReference;
  scopeId: string;
  label?: string;
  value: JsonValue;
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
  snapshot?: SnapshotInfo;
  coverage?: PtcCoverage;
};
type StoredTrace = {
  executionId: string;
  scopeId: string;
  createdAt: number;
  expiresAt: number;
  events: PtcOperationEvent[];
  omittedEvents: number;
  outcomeSummaries: PtcOutcomeSummary[];
  errorReport: PtcErrorReport;
  summary?: PtcSummary;
  error?: PtcErrorInfo;
  detailBytes: number;
  summaryBytes: number;
  traceBytes: number;
};
type TraceSelection = {
  detailEvents: PtcOperationEvent[];
  detailLines: string[];
  outcomeSummaries: PtcOutcomeSummary[];
  errorReport: PtcErrorReport;
  omittedEvents: number;
  detailBytes: number;
  summaryBytes: number;
  traceBytes: number;
  text: string;
  textBytes: number;
  summary?: PtcSummary;
  error?: PtcErrorInfo;
};

const MAX_TRACE_SUMMARY_METHOD_BYTES = 96;
const MAX_TRACE_SUMMARY_ID_BYTES = 96;
const MAX_TRACE_LABEL_BYTES = 96;
const MAX_TRACE_KIND_BYTES = 64;
const MAX_TRACE_SUMMARY_ERROR_CODE_BYTES = 64;
const MAX_TRACE_ERROR_MESSAGE_BYTES = 128;
const MAX_AGGREGATE_KIND_BYTES = 24;
const MAX_AGGREGATE_ERROR_CODE_BYTES = 16;
const MAX_AGGREGATE_ERROR_MESSAGE_BYTES = 48;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isObject(value) && !Array.isArray(value) ? value : undefined;

type CloneSerializableOptions = { omitUndefinedObjectProperties?: boolean };

const cloneSerializable = (value: unknown, options: CloneSerializableOptions = {}): JsonValue => {
  const seen = new Set<object>();
  const visit = (current: unknown): JsonValue => {
    if (current === null) return null;
    if (typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new PtcError(
          PTC_ERROR_CODE.SERIALIZATION_FAILED,
          'retained values must contain only finite numbers',
        );
      return current;
    }
    if (typeof current !== 'object')
      throw new PtcError(
        PTC_ERROR_CODE.SERIALIZATION_FAILED,
        `retained values cannot contain ${typeof current}`,
      );
    if (seen.has(current))
      throw new PtcError(
        PTC_ERROR_CODE.SERIALIZATION_FAILED,
        'retained values cannot contain cycles',
      );
    seen.add(current);
    let result: JsonValue;
    if (Array.isArray(current)) {
      result = current.map(visit);
    } else {
      const object: { [key: string]: JsonValue } = {};
      const record = current as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (options.omitUndefinedObjectProperties && record[key] === undefined) continue;
        object[key] = visit(record[key]);
      }
      result = object;
    }
    seen.delete(current);
    return result;
  };
  return visit(value);
};

const cloneMetadata = <T>(value: T): T => {
  if (!isObject(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneMetadata(item)) as T;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(value)) clone[key] = cloneMetadata(value[key]);
  return clone as T;
};

const isSdkResult = (value: unknown): boolean =>
  isObject(value) &&
  (Array.isArray(value.items) || (Array.isArray(value.nodes) && Array.isArray(value.edges)));

const isErrorOutcome = (outcome: PtcOutcome): boolean => outcome === PTC_OUTCOME.ERROR;

const boundedText = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    const candidate = `${result}${character}`;
    if (Buffer.byteLength(`${candidate}…`, 'utf8') > maxBytes) break;
    result = candidate;
  }
  return `${result}…`;
};

const coverageMarker = (coverage: PtcCoverage | undefined): PtcCoverageMarker | undefined => {
  const record = asRecord(coverage);
  if (!record) return undefined;
  const nodes = asRecord(record.nodes);
  const edges = asRecord(record.edges);
  if (record.complete === false || nodes?.complete === false || edges?.complete === false)
    return PTC_COVERAGE_MARKER.PARTIAL;
  if (record.reason === 'empty' || nodes?.reason === 'empty' || edges?.reason === 'empty')
    return PTC_COVERAGE_MARKER.EMPTY;
  if (record.complete === true || (nodes?.complete === true && edges?.complete === true))
    return PTC_COVERAGE_MARKER.COMPLETE;
  return undefined;
};

const compactOutcomeSummary = (event: PtcOperationEvent): PtcOutcomeSummary => {
  const marker = coverageMarker(event.coverage);
  return {
    method: boundedText(event.method, MAX_TRACE_SUMMARY_METHOD_BYTES),
    operationId: boundedText(event.operationId, MAX_TRACE_SUMMARY_ID_BYTES),
    outcome: event.outcome,
    ...(event.error?.code === undefined
      ? {}
      : { errorCode: boundedText(event.error.code, MAX_TRACE_SUMMARY_ERROR_CODE_BYTES) }),
    ...(event.count === undefined || !Number.isSafeInteger(event.count)
      ? {}
      : { count: event.count }),
    ...(marker === undefined ? {} : { coverage: marker }),
  };
};

const compactPtcSummary = (summary: PtcSummary | undefined): PtcSummary | undefined => {
  if (summary === undefined) return undefined;
  const marker = coverageMarker(summary.coverage);
  return {
    ...(summary.kind === undefined
      ? {}
      : { kind: boundedText(summary.kind, MAX_AGGREGATE_KIND_BYTES) }),
    ...(summary.count === undefined || !Number.isSafeInteger(summary.count)
      ? {}
      : { count: summary.count }),
    ...(marker === undefined ? {} : { coverage: { marker } }),
    outcome: summary.outcome ?? PTC_OUTCOME.SUCCESS,
  };
};

const compactFailure = (failure: PtcErrorInfo | undefined): PtcErrorInfo | undefined =>
  failure === undefined
    ? undefined
    : {
        code: boundedText(failure.code, MAX_AGGREGATE_ERROR_CODE_BYTES),
        message: boundedText(failure.message, MAX_AGGREGATE_ERROR_MESSAGE_BYTES),
      };

const emptyErrorReport = (): PtcErrorReport => ({
  total: 0,
  retained: 0,
  omitted: 0,
});

const normalizedTraceEvent = (event: PtcOperationEvent): PtcOperationEvent => {
  const marker = coverageMarker(event.coverage);
  const counts = event.counts
    ? {
        ...(event.counts.items === undefined || !Number.isSafeInteger(event.counts.items)
          ? {}
          : { items: event.counts.items }),
        ...(event.counts.nodes === undefined || !Number.isSafeInteger(event.counts.nodes)
          ? {}
          : { nodes: event.counts.nodes }),
        ...(event.counts.edges === undefined || !Number.isSafeInteger(event.counts.edges)
          ? {}
          : { edges: event.counts.edges }),
      }
    : undefined;
  return {
    executionId: boundedText(event.executionId, MAX_TRACE_SUMMARY_ID_BYTES),
    operationId: boundedText(event.operationId, MAX_TRACE_SUMMARY_ID_BYTES),
    method: boundedText(event.method, MAX_TRACE_SUMMARY_METHOD_BYTES),
    ...(event.label === undefined
      ? {}
      : { label: boundedText(event.label, MAX_TRACE_LABEL_BYTES) }),
    outcome: event.outcome,
    ...(event.kind === undefined ? {} : { kind: boundedText(event.kind, MAX_TRACE_KIND_BYTES) }),
    ...(event.count === undefined || !Number.isSafeInteger(event.count)
      ? {}
      : { count: event.count }),
    ...(counts === undefined ? {} : { counts }),
    ...(marker === undefined ? {} : { coverage: { marker } }),
    ...(event.resultReference === undefined
      ? {}
      : {
          resultReference: {
            id: boundedText(event.resultReference.id, MAX_TRACE_SUMMARY_ID_BYTES),
            kind: boundedText(event.resultReference.kind, MAX_TRACE_KIND_BYTES),
          },
        }),
    ...(event.error === undefined
      ? {}
      : {
          error: {
            code: boundedText(event.error.code, MAX_TRACE_SUMMARY_ERROR_CODE_BYTES),
            message: boundedText(event.error.message, MAX_TRACE_ERROR_MESSAGE_BYTES),
          },
        }),
  };
};

const renderTraceEvent = (event: PtcOperationEvent): string => {
  const counts = event.counts
    ? ` ${Object.entries(event.counts)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`
    : event.count === undefined
      ? ''
      : ` count=${event.count}`;
  const coverageRecord = asRecord(event.coverage);
  const coverage =
    typeof coverageRecord?.marker === 'string'
      ? ` coverage=${coverageRecord.marker}`
      : typeof coverageRecord?.reason !== 'string'
        ? ''
        : ` coverage=${boundedText(coverageRecord.reason, MAX_TRACE_KIND_BYTES)}`;
  const kind = event.kind === undefined ? '' : ` kind=${event.kind}`;
  const reference = event.resultReference ? ` ref=${event.resultReference.id}` : '';
  const error = event.error ? ` error=${event.error.code} message=${event.error.message}` : '';
  return `${event.operationId} ${event.method}${event.label ? ` [${event.label}]` : ''}${kind} -> ${event.outcome}${counts}${coverage}${reference}${error}`;
};

const serializedBytes = (value: JsonValue): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

const snapshotFrom = (value: unknown): SnapshotInfo | undefined => {
  if (!isObject(value) || !isObject(value.snapshot)) return undefined;
  const snapshot = value.snapshot;
  if (
    typeof snapshot.id !== 'string' ||
    snapshot.authority !== 'filesystem' ||
    typeof snapshot.schemaHash !== 'string' ||
    snapshot.freshness !== 'saved-indexed'
  )
    return undefined;
  return {
    id: snapshot.id,
    authority: snapshot.authority,
    schemaHash: snapshot.schemaHash,
    freshness: snapshot.freshness,
  };
};

const coverageFrom = (value: unknown): PtcCoverage | undefined => {
  if (!isObject(value) || value.coverage === undefined) return undefined;
  return value.coverage as PtcCoverage;
};

const sameSnapshot = (left: SnapshotInfo, right: SnapshotInfo): boolean =>
  left.id === right.id &&
  left.authority === right.authority &&
  left.schemaHash === right.schemaHash &&
  left.freshness === right.freshness;

const extractSummary = (value: unknown, explicit?: PtcSummary): PtcSummary => {
  if (explicit) return explicit;
  const object = isObject(value) ? value : undefined;
  const snapshot = snapshotFrom(value);
  const coverage = coverageFrom(value);
  if (object && Array.isArray(object.items)) {
    const count = object.items.length;
    const coverageRecord = asRecord(coverage);
    return {
      kind: PTC_RESULT_KIND.QUERY,
      count,
      ...(coverage === undefined ? {} : { coverage }),
      ...(snapshot === undefined ? {} : { snapshot }),
      outcome:
        coverageRecord?.complete === false
          ? PTC_OUTCOME.PARTIAL
          : count === 0
            ? PTC_OUTCOME.EMPTY
            : PTC_OUTCOME.SUCCESS,
    };
  }
  if (object && Array.isArray(object.nodes) && Array.isArray(object.edges)) {
    const nodes = object.nodes.length;
    const edges = object.edges.length;
    const graphCoverage = asRecord(coverage);
    const partial =
      asRecord(graphCoverage?.nodes)?.complete === false ||
      asRecord(graphCoverage?.edges)?.complete === false;
    return {
      kind: PTC_RESULT_KIND.GRAPH,
      count: nodes,
      counts: { nodes, edges },
      ...(coverage === undefined ? {} : { coverage }),
      ...(snapshot === undefined ? {} : { snapshot }),
      outcome: partial
        ? PTC_OUTCOME.PARTIAL
        : nodes === 0 && edges === 0
          ? PTC_OUTCOME.EMPTY
          : PTC_OUTCOME.SUCCESS,
    };
  }
  return { kind: PTC_RESULT_KIND.CUSTOM, outcome: PTC_OUTCOME.SUCCESS };
};

const errorInfo = (error: unknown): PtcErrorInfo =>
  error instanceof PtcError
    ? { code: error.code, message: error.message }
    : isObject(error) && typeof error.code === 'string' && typeof error.message === 'string'
      ? { code: error.code, message: error.message }
      : { code: 'ERROR', message: error instanceof Error ? error.message : String(error) };

const refId = (reference: ResultReference | string): string =>
  typeof reference === 'string' ? reference : reference.id;

const checkPositiveInteger = (value: number | undefined, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new PtcError(PTC_ERROR_CODE.INVALID_VIEW_LIMIT, `${name} must be a positive integer`);
  return value;
};

export class PtcRuntime {
  private readonly resultsById = new Map<string, StoredResult>();
  private readonly tracesById = new Map<string, StoredTrace>();
  private readonly tombstones: Tombstone[] = [];
  private readonly scopes = new Set<string>();
  private readonly closingScopes = new Set<string>();
  private readonly activeExecutions = new Map<string, number>();
  private readonly activeExecutionScopes = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly maxRetainedBytes: number;
  private readonly maxTombstones: number;
  private readonly maxTraceEvents: number;
  private readonly maxTraceBytes: number;
  private readonly maxStoredTraceBytes: number;
  private readonly now: () => number;
  private retainedBytes = 0;
  private traceBytes = 0;
  private closed = false;

  constructor(options: PtcRuntimeOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxRetainedBytes = options.maxRetainedBytes ?? 16 * 1024 * 1024;
    this.maxTombstones = options.maxTombstones ?? 128;
    this.maxTraceEvents = options.maxTraceEvents ?? 100;
    this.maxTraceBytes = options.maxTraceBytes ?? 64 * 1024;
    this.maxStoredTraceBytes = options.maxStoredTraceBytes ?? 512 * 1024;
    this.now = options.now ?? Date.now;
    for (const [name, value] of [
      ['ttlMs', this.ttlMs],
      ['maxRetainedBytes', this.maxRetainedBytes],
      ['maxTombstones', this.maxTombstones],
      ['maxTraceEvents', this.maxTraceEvents],
      ['maxTraceBytes', this.maxTraceBytes],
      ['maxStoredTraceBytes', this.maxStoredTraceBytes],
    ] as const) {
      const minimum =
        name === 'maxTraceBytes'
          ? MIN_TRACE_DETAIL_BYTES
          : name === 'maxStoredTraceBytes'
            ? MIN_TRACE_QUOTA_BYTES
            : 1;
      if (!Number.isSafeInteger(value) || value < minimum)
        throw new PtcError(
          PTC_ERROR_CODE.INVALID_OPERATION,
          `${name} must be at least ${minimum} bytes`,
        );
    }
  }

  createScope(): PtcScope {
    this.ensureOpen();
    const id = `scope-${randomUUID()}`;
    this.scopes.add(id);
    return new PtcScope(this, id);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resultsById.clear();
    this.tracesById.clear();
    this.scopes.clear();
    this.closingScopes.clear();
    this.activeExecutions.clear();
    this.activeExecutionScopes.clear();
    this.tombstones.length = 0;
    this.retainedBytes = 0;
    this.traceBytes = 0;
  }

  _ensureScope(scopeId: string, allowClosing = false): void {
    this.ensureOpen();
    if (!this.scopes.has(scopeId) || (!allowClosing && this.closingScopes.has(scopeId)))
      throw new PtcError(PTC_ERROR_CODE.SCOPE_CLOSED, 'execution scope is closed');
  }

  _dropScope(scopeId: string): void {
    if (!this.scopes.has(scopeId)) return;
    if ((this.activeExecutions.get(scopeId) ?? 0) > 0) {
      this.closingScopes.add(scopeId);
      return;
    }
    this.cleanupScope(scopeId);
  }

  _beginExecution(scopeId: string, executionId: string): void {
    this._ensureScope(scopeId);
    this.activeExecutions.set(scopeId, (this.activeExecutions.get(scopeId) ?? 0) + 1);
    this.activeExecutionScopes.set(executionId, scopeId);
  }

  _endExecution(scopeId: string, executionId: string): void {
    this.activeExecutionScopes.delete(executionId);
    const active = (this.activeExecutions.get(scopeId) ?? 1) - 1;
    if (active > 0) {
      this.activeExecutions.set(scopeId, active);
      return;
    }
    this.activeExecutions.delete(scopeId);
    if (this.closingScopes.has(scopeId)) this.cleanupScope(scopeId);
  }

  _ensureExecution(scopeId: string, executionId: string): void {
    this.ensureOpen();
    if (this.activeExecutionScopes.get(executionId) !== scopeId)
      throw new PtcError(PTC_ERROR_CODE.SCOPE_CLOSED, 'execution scope is closed');
  }

  private cleanupScope(scopeId: string): void {
    this.scopes.delete(scopeId);
    this.closingScopes.delete(scopeId);
    for (const [id, result] of this.resultsById) {
      if (result.scopeId === scopeId) this.removeResult(id, 'released');
    }
    for (const [id, trace] of this.tracesById) {
      if (trace.scopeId === scopeId) this.removeTrace(id, 'trace-evicted');
    }
  }

  _retain<T>(
    scopeId: string,
    value: T,
    options: RetainOptions,
    operationId?: string,
    executionId?: string,
  ): ResultReference<T> {
    if (executionId === undefined) this._ensureScope(scopeId);
    else this._ensureExecution(scopeId, executionId);
    if (options.sensitive)
      throw new PtcError(PTC_ERROR_CODE.SENSITIVE_VALUE, 'sensitive values must not be retained');
    const serialized = cloneSerializable(value, {
      omitUndefinedObjectProperties: isSdkResult(value),
    });
    const sizeBytes = serializedBytes(serialized);
    if (sizeBytes > this.maxRetainedBytes)
      throw new PtcError(
        PTC_ERROR_CODE.RETENTION_QUOTA_EXCEEDED,
        `retained value is ${sizeBytes} bytes, over the retained-result budget of ${this.maxRetainedBytes}`,
        { sizeBytes, maxRetainedBytes: this.maxRetainedBytes },
      );
    const extractedSnapshot = snapshotFrom(value);
    const extractedCoverage = coverageFrom(value);
    if (options.snapshot && extractedSnapshot && !sameSnapshot(options.snapshot, extractedSnapshot))
      throw new PtcError(
        PTC_ERROR_CODE.SNAPSHOT_IDENTITY_CONFLICT,
        'supplied snapshot identity conflicts with the SDK result snapshot',
      );
    this.expireResults();
    while (this.retainedBytes + sizeBytes > this.maxRetainedBytes) {
      const oldest = [...this.resultsById.values()].sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.reference.id.localeCompare(right.reference.id),
      )[0];
      if (!oldest) break;
      this.removeResult(oldest.reference.id, 'evicted');
    }
    if (this.retainedBytes + sizeBytes > this.maxRetainedBytes)
      throw new PtcError(
        PTC_ERROR_CODE.RETENTION_QUOTA_EXCEEDED,
        `retained value does not fit within the total quota of ${this.maxRetainedBytes}`,
        { sizeBytes, maxRetainedBytes: this.maxRetainedBytes },
      );
    const kind = options.kind ?? extractSummary(value).kind ?? PTC_RESULT_KIND.CUSTOM;
    const reference: ResultReference<T> = { id: `result-${randomUUID()}`, kind };
    const createdAt = this.now();
    const stored: StoredResult = {
      reference,
      scopeId,
      value: serialized,
      sizeBytes,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(extractedSnapshot === undefined && options.snapshot === undefined
        ? {}
        : { snapshot: cloneMetadata(extractedSnapshot ?? options.snapshot) }),
      ...(options.coverage === undefined && extractedCoverage === undefined
        ? {}
        : { coverage: cloneMetadata(extractedCoverage ?? options.coverage) }),
    };
    this.resultsById.set(reference.id, stored);
    this.retainedBytes += sizeBytes;
    if (operationId) this._attachReference(scopeId, operationId, reference);
    return reference;
  }

  _describe(
    scopeId: string,
    reference: ResultReference | string,
    executionId?: string,
  ): RetainedResultDescription {
    const result = this.findResult(scopeId, refId(reference), executionId);
    return {
      reference: cloneMetadata(result.reference),
      ...(result.label === undefined ? {} : { label: result.label }),
      sizeBytes: result.sizeBytes,
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      ...(result.snapshot === undefined ? {} : { snapshot: cloneMetadata(result.snapshot) }),
      ...(result.coverage === undefined ? {} : { coverage: cloneMetadata(result.coverage) }),
    };
  }

  _get<T = JsonValue>(
    scopeId: string,
    reference: ResultReference<T> | string,
    options: ResultGetOptions = {},
    executionId?: string,
  ): RetainedResult<T> {
    const result = this.findResult(scopeId, refId(reference), executionId);
    const limit = checkPositiveInteger(options.limit, 'result view limit');
    const source = cloneSerializable(result.value);
    const itemCount = Array.isArray(source)
      ? source.length
      : isObject(source) && Array.isArray(source.items)
        ? source.items.length
        : undefined;
    const selectedCount =
      limit === undefined || itemCount === undefined ? itemCount : Math.min(itemCount, limit);
    let value: JsonValue = source;
    if (limit !== undefined && itemCount !== undefined) {
      if (Array.isArray(source)) value = source.slice(0, limit);
      else if (isObject(source) && Array.isArray(source.items))
        value = { ...source, items: source.items.slice(0, limit) };
    }
    const complete = selectedCount === undefined || selectedCount === itemCount;
    return {
      reference: cloneMetadata(result.reference) as ResultReference<T>,
      value: value as T,
      ...(result.snapshot === undefined ? {} : { snapshot: cloneMetadata(result.snapshot) }),
      ...(result.coverage === undefined ? {} : { coverage: cloneMetadata(result.coverage) }),
      viewCoverage: {
        complete,
        examined: itemCount ?? 1,
        returned: selectedCount ?? 1,
        ...(itemCount === undefined || complete ? {} : { remaining: itemCount - selectedCount }),
        reason: complete ? 'complete' : 'view-limit',
      },
    };
  }

  _release(scopeId: string, reference: ResultReference | string, executionId?: string): void {
    const id = refId(reference);
    const result = this.findResult(scopeId, id, executionId);
    this.removeResult(result.reference.id, 'released');
  }

  _saveTrace(scopeId: string, response: PtcResponse<unknown>, selection: TraceSelection): void {
    this._ensureExecution(scopeId, response.executionId);
    this.expireTraces();
    const detailEvents = selection.detailEvents.map((event) => cloneMetadata(event));
    const outcomeSummaries = selection.outcomeSummaries.map((event) => cloneMetadata(event));
    const storedBytes = selection.traceBytes;
    while (this.traceBytes + storedBytes > this.maxStoredTraceBytes) {
      const oldest = [...this.tracesById.values()].sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.executionId.localeCompare(right.executionId),
      )[0];
      if (!oldest) break;
      this.removeTrace(oldest.executionId, 'trace-evicted');
    }
    if (storedBytes > this.maxStoredTraceBytes) return;
    const createdAt = this.now();
    const trace: StoredTrace = {
      executionId: response.executionId,
      scopeId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      events: detailEvents,
      omittedEvents: selection.omittedEvents,
      outcomeSummaries,
      errorReport: cloneMetadata(selection.errorReport),
      ...(selection.summary === undefined ? {} : { summary: cloneMetadata(selection.summary) }),
      ...(selection.error === undefined ? {} : { error: cloneMetadata(selection.error) }),
      detailBytes: selection.detailBytes,
      summaryBytes: selection.summaryBytes,
      traceBytes: storedBytes,
    };
    this.tracesById.set(trace.executionId, trace);
    this.traceBytes += storedBytes;
  }

  _trace(
    scopeId: string,
    executionId: string,
    options: TraceGetOptions = {},
    accessPtcId?: string,
  ): TraceDetails {
    if (accessPtcId === undefined) this._ensureScope(scopeId);
    else this._ensureExecution(scopeId, accessPtcId);
    const limit = checkPositiveInteger(options.limit, 'trace detail limit');
    this.expireTraces();
    const trace = this.tracesById.get(executionId);
    if (!trace) return this.unavailableTrace(scopeId, executionId);
    if (trace.scopeId !== scopeId)
      return {
        status: PTC_TRACE_STATUS.UNAVAILABLE,
        executionId,
        events: [],
        omittedEvents: 0,
        detailBytes: 0,
        summaryBytes: 0,
        traceBytes: 0,
        outcomeSummaries: [],
        errorReport: emptyErrorReport(),
        unavailableReason: PTC_TRACE_UNAVAILABLE_REASON.ACCESS_DENIED,
      };
    const events = options.operationId
      ? trace.events.filter((event) => event.operationId === options.operationId)
      : trace.events;
    const bounded = limit === undefined ? events : events.slice(0, limit);
    const outcomeSummaries = options.operationId
      ? trace.outcomeSummaries.filter((event) => event.operationId === options.operationId)
      : trace.outcomeSummaries;
    const operationWasOmitted =
      options.operationId !== undefined && bounded.length === 0 && trace.omittedEvents > 0;
    const omitted = options.operationId
      ? (operationWasOmitted ? 1 : 0) + Math.max(0, events.length - bounded.length)
      : trace.omittedEvents + Math.max(0, events.length - bounded.length);
    return {
      status:
        operationWasOmitted || omitted > 0 || trace.errorReport.omitted > 0
          ? PTC_TRACE_STATUS.OMITTED
          : PTC_TRACE_STATUS.AVAILABLE,
      executionId,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      events: bounded.map((event) => cloneMetadata(event)),
      omittedEvents: omitted,
      detailBytes: bounded.reduce(
        (total, event) => total + Buffer.byteLength(renderTraceEvent(event), 'utf8'),
        0,
      ),
      summaryBytes: trace.summaryBytes,
      traceBytes: trace.traceBytes,
      outcomeSummaries: outcomeSummaries.map((event) => cloneMetadata(event)),
      errorReport: cloneMetadata(trace.errorReport),
      ...(trace.summary === undefined ? {} : { summary: cloneMetadata(trace.summary) }),
      ...(trace.error === undefined ? {} : { error: cloneMetadata(trace.error) }),
    };
  }

  _traceSelection(
    executionId: string,
    events: readonly PtcOperationEvent[],
    summary: PtcSummary | undefined,
    failure: PtcErrorInfo | undefined,
  ): TraceSelection {
    const detailEvents: PtcOperationEvent[] = [];
    const detailLines: string[] = [];
    const outcomeSummaries: PtcOutcomeSummary[] = [];
    const errorSummaries = events
      .filter((event) => isErrorOutcome(event.outcome))
      .map((event) => compactOutcomeSummary(event));
    const lastError = errorSummaries.at(-1);
    const normalizedSummary = compactPtcSummary(summary);
    const normalizedFailure = compactFailure(failure);

    const buildSelection = (
      candidateDetails: readonly PtcOperationEvent[],
      candidateDetailLines: readonly string[],
      candidateOutcomes: readonly PtcOutcomeSummary[],
    ): TraceSelection => {
      const representedOperationIds = new Set(candidateOutcomes.map((item) => item.operationId));
      const retained = representedOperationIds.size;
      const errorReport: PtcErrorReport = {
        total: errorSummaries.length,
        retained,
        omitted: errorSummaries.length - retained,
      };
      const omittedEvents = events.length - candidateDetails.length;
      const lines = renderAggregateTraceLines(
        executionId,
        candidateDetailLines,
        candidateOutcomes,
        errorReport,
        omittedEvents,
        normalizedSummary,
        normalizedFailure,
      );
      const text = lines.join('\n');
      const storage = traceStorageMetrics(
        candidateDetails,
        candidateOutcomes,
        errorReport,
        omittedEvents,
        normalizedSummary,
        normalizedFailure,
      );
      return {
        detailEvents: [...candidateDetails],
        detailLines: [...candidateDetailLines],
        outcomeSummaries: [...candidateOutcomes],
        errorReport,
        omittedEvents,
        detailBytes: candidateDetailLines.reduce(
          (total, line) => total + Buffer.byteLength(line, 'utf8'),
          0,
        ),
        summaryBytes: storage.summaryBytes,
        traceBytes: storage.traceBytes,
        text,
        textBytes: Buffer.byteLength(text, 'utf8'),
        ...(normalizedSummary === undefined ? {} : { summary: normalizedSummary }),
        ...(normalizedFailure === undefined ? {} : { error: normalizedFailure }),
      };
    };

    const fits = (selection: TraceSelection): boolean =>
      selection.detailEvents.length + selection.outcomeSummaries.length <= this.maxTraceEvents &&
      selection.textBytes <= this.maxTraceBytes &&
      selection.traceBytes <= this.maxStoredTraceBytes;

    if (lastError) {
      const next = buildSelection(detailEvents, detailLines, [lastError]);
      if (fits(next)) outcomeSummaries.push(lastError);
    }

    for (const event of events.filter((item) => !isErrorOutcome(item.outcome))) {
      const normalized = normalizedTraceEvent(event);
      const line = renderTraceEvent(normalized);
      const next = buildSelection(
        [...detailEvents, normalized],
        [...detailLines, line],
        outcomeSummaries,
      );
      if (fits(next)) {
        detailEvents.push(normalized);
        detailLines.push(line);
      }
    }
    const selection = buildSelection(detailEvents, detailLines, outcomeSummaries);
    if (!fits(selection))
      throw new PtcError(
        PTC_ERROR_CODE.INVALID_OPERATION,
        'trace budgets cannot hold the minimum aggregate trace record',
      );
    return selection;
  }

  _attachReference(scopeId: string, operationId: string, reference: ResultReference): void {
    for (const trace of this.tracesById.values()) {
      if (trace.scopeId !== scopeId) continue;
      const event = trace.events.find((candidate) => candidate.operationId === operationId);
      if (event) event.resultReference = reference;
    }
  }

  private findResult(scopeId: string, id: string, executionId?: string): StoredResult {
    if (executionId === undefined) this._ensureScope(scopeId);
    else this._ensureExecution(scopeId, executionId);
    this.expireResults();
    const result = this.resultsById.get(id);
    if (!result) {
      const tombstone = this.findTombstone(id);
      if (tombstone && tombstone.scopeId !== scopeId)
        throw new PtcError(
          PTC_ERROR_CODE.RESULT_ACCESS_DENIED,
          'retained result is not available in this execution scope',
        );
      if (tombstone?.status === 'expired')
        throw new PtcError(PTC_ERROR_CODE.RESULT_EXPIRED, 'retained result has expired');
      if (tombstone?.status === 'evicted')
        throw new PtcError(PTC_ERROR_CODE.RESULT_EVICTED, 'retained result was evicted');
      if (tombstone?.status === 'released')
        throw new PtcError(PTC_ERROR_CODE.RESULT_RELEASED, 'retained result was released');
      throw new PtcError(PTC_ERROR_CODE.RESULT_NOT_FOUND, 'retained result was not found');
    }
    if (result.scopeId !== scopeId)
      throw new PtcError(
        PTC_ERROR_CODE.RESULT_ACCESS_DENIED,
        'retained result is not available in this execution scope',
      );
    return result;
  }

  private unavailableTrace(scopeId: string, executionId: string): TraceDetails {
    const tombstone = this.findTombstone(executionId);
    if (tombstone && tombstone.scopeId !== scopeId)
      return {
        status: PTC_TRACE_STATUS.UNAVAILABLE,
        executionId,
        events: [],
        omittedEvents: 0,
        detailBytes: 0,
        summaryBytes: 0,
        traceBytes: 0,
        outcomeSummaries: [],
        errorReport: emptyErrorReport(),
        unavailableReason: PTC_TRACE_UNAVAILABLE_REASON.ACCESS_DENIED,
      };
    if (tombstone?.status === 'trace-expired')
      return {
        status: PTC_TRACE_STATUS.UNAVAILABLE,
        executionId,
        events: [],
        omittedEvents: 0,
        detailBytes: 0,
        summaryBytes: 0,
        traceBytes: 0,
        outcomeSummaries: [],
        errorReport: emptyErrorReport(),
        unavailableReason: PTC_TRACE_UNAVAILABLE_REASON.EXPIRED,
      };
    if (tombstone?.status === 'trace-evicted')
      return {
        status: PTC_TRACE_STATUS.UNAVAILABLE,
        executionId,
        events: [],
        omittedEvents: 0,
        detailBytes: 0,
        summaryBytes: 0,
        traceBytes: 0,
        outcomeSummaries: [],
        errorReport: emptyErrorReport(),
        unavailableReason: PTC_TRACE_UNAVAILABLE_REASON.EVICTED,
      };
    return {
      status: PTC_TRACE_STATUS.UNAVAILABLE,
      executionId,
      events: [],
      omittedEvents: 0,
      detailBytes: 0,
      summaryBytes: 0,
      traceBytes: 0,
      outcomeSummaries: [],
      errorReport: emptyErrorReport(),
      unavailableReason: PTC_TRACE_UNAVAILABLE_REASON.NOT_FOUND,
    };
  }

  private removeResult(id: string, status: 'expired' | 'evicted' | 'released'): void {
    const result = this.resultsById.get(id);
    if (!result) return;
    this.resultsById.delete(id);
    this.retainedBytes -= result.sizeBytes;
    this.addTombstone({ id, scopeId: result.scopeId, status, at: this.now() });
  }

  private removeTrace(id: string, status: 'trace-expired' | 'trace-evicted'): void {
    const trace = this.tracesById.get(id);
    if (!trace) return;
    this.tracesById.delete(id);
    this.traceBytes -= trace.traceBytes;
    this.addTombstone({ id, scopeId: trace.scopeId, status, at: this.now() });
  }

  private addTombstone(tombstone: Tombstone): void {
    this.tombstones.push(tombstone);
    while (this.tombstones.length > this.maxTombstones) this.tombstones.shift();
  }

  private findTombstone(id: string): Tombstone | undefined {
    return [...this.tombstones].reverse().find((item) => item.id === id);
  }

  private expireResults(): void {
    const now = this.now();
    for (const [id, result] of this.resultsById) {
      if (result.expiresAt <= now) this.removeResult(id, 'expired');
    }
  }

  private expireTraces(): void {
    const now = this.now();
    for (const [id, trace] of this.tracesById) {
      if (trace.expiresAt <= now) this.removeTrace(id, 'trace-expired');
    }
  }

  private ensureOpen(): void {
    if (this.closed)
      throw new PtcError(PTC_ERROR_CODE.RUNTIME_CLOSED, 'execution runtime is closed');
  }
}

export class PtcScope {
  readonly results: ResultStore;
  readonly trace: TraceStore;

  constructor(
    private readonly runtime: PtcRuntime,
    private readonly scopeId: string,
  ) {
    this.results = {
      describe: (reference) =>
        Promise.resolve().then(() => this.runtime._describe(this.scopeId, reference)),
      get: (reference, options) =>
        Promise.resolve().then(() => this.runtime._get(this.scopeId, reference, options)),
      release: (reference) => {
        return Promise.resolve().then(() => this.runtime._release(this.scopeId, reference));
      },
    };
    this.trace = {
      get: (executionId: string, options: TraceGetOptions = {}) => {
        return Promise.resolve().then(() =>
          this.runtime._trace(this.scopeId, executionId, options),
        );
      },
    };
  }

  async execute<T>(callback: (session: PtcSession) => Promise<T> | T): Promise<PtcResponse<T>> {
    this.runtime._ensureScope(this.scopeId);
    const session = new PtcSession(this.runtime, this.scopeId);
    this.runtime._beginExecution(this.scopeId, session.executionId);
    try {
      return await session._execute(callback);
    } finally {
      this.runtime._endExecution(this.scopeId, session.executionId);
    }
  }

  close(): void {
    this.runtime._dropScope(this.scopeId);
  }
}

export class PtcSession {
  readonly executionId = `execution-${randomUUID()}`;
  readonly events: PtcOperationEvent[] = [];
  readonly results: ResultStore;
  readonly trace: TraceStore;
  private lastOperationId: string | undefined;

  constructor(
    private readonly runtime: PtcRuntime,
    private readonly scopeId: string,
  ) {
    this.runtime._ensureScope(scopeId);
    this.results = {
      describe: (reference) =>
        Promise.resolve().then(() =>
          this.runtime._describe(this.scopeId, reference, this.executionId),
        ),
      get: (reference, options) =>
        Promise.resolve().then(() =>
          this.runtime._get(this.scopeId, reference, options, this.executionId),
        ),
      release: (reference) =>
        Promise.resolve().then(() =>
          this.runtime._release(this.scopeId, reference, this.executionId),
        ),
    };
    this.trace = {
      get: (executionId: string, options: TraceGetOptions = {}) => {
        return Promise.resolve().then(() =>
          this.runtime._trace(this.scopeId, executionId, options, this.executionId),
        );
      },
    };
  }

  async run<T>(options: PtcOperationOptions, operation: () => Promise<T> | T): Promise<T> {
    this.runtime._ensureExecution(this.scopeId, this.executionId);
    if (!options.method.trim())
      throw new PtcError(PTC_ERROR_CODE.INVALID_OPERATION, 'operation method is required');
    const operationId = `operation-${randomUUID()}`;
    this.lastOperationId = operationId;
    try {
      const value = await operation();
      const summary = extractSummary(value, options.summary);
      if (summary.kind === PTC_RESULT_KIND.QUERY && options.method.toLowerCase().includes('search'))
        summary.kind = PTC_RESULT_KIND.SEARCH;
      const event: PtcOperationEvent = {
        executionId: this.executionId,
        operationId,
        method: options.method,
        ...(options.label === undefined ? {} : { label: options.label }),
        outcome: summary.outcome ?? PTC_OUTCOME.SUCCESS,
        ...(summary.kind === undefined ? {} : { kind: summary.kind }),
        ...(summary.count === undefined ? {} : { count: summary.count }),
        ...(summary.counts === undefined ? {} : { counts: summary.counts }),
        ...(summary.coverage === undefined ? {} : { coverage: summary.coverage }),
        ...(summary.snapshot === undefined ? {} : { snapshot: summary.snapshot }),
      };
      this.events.push(event);
      return value;
    } catch (error) {
      const event: PtcOperationEvent = {
        executionId: this.executionId,
        operationId,
        method: options.method,
        ...(options.label === undefined ? {} : { label: options.label }),
        outcome: PTC_OUTCOME.ERROR,
        error: errorInfo(error),
      };
      this.events.push(event);
      throw error;
    }
  }

  retain<T>(value: T, options: RetainOptions = {}): Promise<ResultReference<T>> {
    return Promise.resolve().then(() => {
      const operationId = options.operationId ?? this.lastOperationId;
      const reference = this.runtime._retain(
        this.scopeId,
        value,
        options,
        operationId,
        this.executionId,
      );
      if (operationId) {
        const event = this.events.find((candidate) => candidate.operationId === operationId);
        if (event) event.resultReference = reference;
      }
      return reference;
    });
  }

  async _execute<T>(callback: (session: PtcSession) => Promise<T> | T): Promise<PtcResponse<T>> {
    let result: T | undefined;
    let failure: PtcErrorInfo | undefined;
    let completed = false;
    try {
      result = await callback(this);
      completed = true;
    } catch (error) {
      failure = errorInfo(error);
      if (!this.events.some((event) => event.error?.message === failure?.message)) {
        this.events.push({
          executionId: this.executionId,
          operationId: `operation-${randomUUID()}`,
          method: 'execution.callback',
          outcome: PTC_OUTCOME.ERROR,
          error: failure,
        });
      }
    }
    const summary = completed ? extractSummary(result) : undefined;
    const traceSelection = this.runtime._traceSelection(
      this.executionId,
      this.events,
      summary,
      failure,
    );
    const traceWasOmitted =
      traceSelection.omittedEvents > 0 || traceSelection.errorReport.omitted > 0;
    const feedback = {
      executionId: this.executionId,
      events: this.events.map((event) => cloneMetadata(event)),
      trace: traceSelection.text,
      traceBytes: traceSelection.textBytes,
      traceStatus: traceWasOmitted ? PTC_TRACE_STATUS.OMITTED : PTC_TRACE_STATUS.AVAILABLE,
      omittedEvents: traceSelection.omittedEvents,
      outcomeSummaries: traceSelection.outcomeSummaries.map((item) => cloneMetadata(item)),
      errorReport: cloneMetadata(traceSelection.errorReport),
      ...(summary === undefined ? {} : { summary }),
    };
    const response: PtcResponse<T> = completed
      ? { ...feedback, status: PTC_STATUS.COMPLETED, result: result as T }
      : { ...feedback, status: PTC_STATUS.FAILED, error: failure! };
    this.runtime._saveTrace(this.scopeId, response, traceSelection);
    return response;
  }
}

const renderOutcomeSummary = (summary: PtcOutcomeSummary): string => {
  const errorCode = summary.errorCode === undefined ? '' : ` error=${summary.errorCode}`;
  const count = summary.count === undefined ? '' : ` count=${summary.count}`;
  const coverage = summary.coverage === undefined ? '' : ` coverage=${summary.coverage}`;
  return `outcome -> ${boundedText(summary.operationId, 16)} ${boundedText(summary.method, 24)}:${summary.outcome}${errorCode}${count}${coverage}`;
};

const renderAggregateTraceLines = (
  executionId: string,
  detailLines: readonly string[],
  outcomeSummaries: readonly PtcOutcomeSummary[],
  errorReport: PtcErrorReport,
  omittedEvents: number,
  summary: PtcSummary | undefined,
  failure: PtcErrorInfo | undefined,
): string[] => {
  const lines = [`exec=${boundedText(executionId, 8)}`];
  lines.push(...detailLines);
  lines.push(...outcomeSummaries.map(renderOutcomeSummary));
  if (summary) lines.push(`result -> ${summary.outcome ?? PTC_OUTCOME.SUCCESS}`);
  if (failure) lines.push(`failure -> ${boundedText(failure.code, 16)}`);
  if (errorReport.total > 0)
    lines.push(
      `errors total=${errorReport.total} kept=${errorReport.retained} omitted=${errorReport.omitted}`,
    );
  if (omittedEvents > 0) lines.push(`trace omitted=${omittedEvents}`);
  return lines;
};

const traceStorageMetrics = (
  detailEvents: readonly PtcOperationEvent[],
  outcomeSummaries: readonly PtcOutcomeSummary[],
  errorReport: PtcErrorReport,
  omittedEvents: number,
  summary: PtcSummary | undefined,
  failure: PtcErrorInfo | undefined,
): { summaryBytes: number; traceBytes: number } => {
  const summaryPayload = cloneSerializable([
    outcomeSummaries.map((item) => [
      item.operationId,
      item.method,
      item.outcome,
      item.errorCode ?? null,
      item.count ?? null,
      item.coverage ?? null,
    ]),
    [errorReport.total, errorReport.retained, errorReport.omitted],
    omittedEvents,
    summary ?? null,
    failure === undefined ? null : [failure.code, failure.message],
  ]);
  const detailPayload = cloneSerializable(detailEvents, {
    omitUndefinedObjectProperties: true,
  });
  return {
    summaryBytes: serializedBytes(summaryPayload),
    traceBytes: serializedBytes([detailPayload, summaryPayload]),
  };
};

export function createPtcRuntime(options?: PtcRuntimeOptions): PtcRuntime {
  return new PtcRuntime(options);
}
