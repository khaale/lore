import { describe, expect, it } from 'vitest';
import {
  createPtcRuntime,
  PTC_ERROR_CODE,
  PTC_OUTCOME,
  PTC_TRACE_STATUS,
  MIN_TRACE_DETAIL_BYTES,
  MIN_TRACE_QUOTA_BYTES,
  type SnapshotInfo,
} from './index.js';

const snapshot: SnapshotInfo = {
  id: 'snapshot-1',
  authority: 'filesystem',
  schemaHash: 'schema-1',
  freshness: 'saved-indexed',
};

const page = {
  items: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
  coverage: {
    complete: false,
    examined: 3,
    returned: 3,
    reason: 'page-limit' as const,
  },
  snapshot,
};

describe('execution feedback', () => {
  it('returns structured query, empty, partial, error, and failed read outcomes', async () => {
    const runtime = createPtcRuntime({ maxTraceEvents: 10 });
    const scope = runtime.createScope();
    try {
      const first = await scope.execute(async (execution) => {
        const selected = await execution.run(
          { method: 'query', label: 'accepted decisions' },
          () => page,
        );
        const reference = await execution.retain(selected);
        const boundary = await execution.run(
          { method: 'graph.boundary', label: 'external dependencies' },
          () => ({
            nodes: [],
            edges: [],
            coverage: {
              nodes: { complete: true, examined: 0, returned: 0, reason: 'empty' },
              edges: { complete: true, examined: 0, returned: 0, reason: 'empty' },
              next: 'none',
            },
            snapshot,
          }),
        );
        return { selected: selected.items.length, boundary, reference };
      });
      expect(first.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'query',
            outcome: PTC_OUTCOME.PARTIAL,
            count: 3,
            resultReference: expect.objectContaining({ kind: 'query' }),
          }),
          expect.objectContaining({ method: 'graph.boundary', outcome: PTC_OUTCOME.EMPTY }),
        ]),
      );
      expect(first.trace).toContain('ref=result-');
      expect(first.trace).not.toContain('one');

      const failed = await scope.execute(async (execution) => {
        await execution.run({ method: 'query' }, async () =>
          Promise.reject(new Error('connection lost during read')),
        );
        return 'unreachable';
      });
      expect(failed.error?.message).toBe('connection lost during read');
      expect(failed.events.at(-1)).toMatchObject({
        method: 'query',
        outcome: PTC_OUTCOME.ERROR,
        error: { message: 'connection lost during read' },
      });
      expect(failed.trace).toContain('error');
    } finally {
      scope.close();
      runtime.close();
    }
  });

  it('keeps bounded trace details and supports execution and operation lookup', async () => {
    const runtime = createPtcRuntime({ maxTraceEvents: 1 });
    const scope = runtime.createScope();
    try {
      const response = await scope.execute(async (execution) => {
        await execution.run({ method: 'first' }, () => ({ value: 1 }));
        await execution.run({ method: 'second' }, () => ({ value: 2 }));
        return { selected: true };
      });
      const firstOperation = response.events[0];
      if (!firstOperation) throw new Error('expected first operation');
      expect(response.traceStatus).toBe(PTC_TRACE_STATUS.OMITTED);
      expect(response.omittedEvents).toBe(1);
      const all = await scope.trace.get(response.executionId);
      expect(all.status).toBe(PTC_TRACE_STATUS.OMITTED);
      expect(all.omittedEvents).toBe(1);
      expect(all.summary).toEqual(expect.objectContaining({ outcome: PTC_OUTCOME.SUCCESS }));
      const operation = await scope.trace.get(response.executionId, {
        operationId: firstOperation.operationId,
      });
      expect(operation.events).toHaveLength(1);
      const omitted = await scope.trace.get(response.executionId, {
        operationId: response.events[1]!.operationId,
      });
      expect(omitted.status).toBe(PTC_TRACE_STATUS.OMITTED);
      expect(omitted.events).toHaveLength(0);
      expect(omitted.outcomeSummaries).toEqual([]);
    } finally {
      runtime.close();
    }
  });

  it('deep-clones retained payload and metadata at describe/get boundaries', async () => {
    const runtime = createPtcRuntime({ maxRetainedBytes: 2_000 });
    const scope = runtime.createScope();
    const source = {
      items: [{ id: 'one', nested: { value: 'historical' } }],
      coverage: {
        complete: false,
        examined: 2,
        returned: 1,
        remaining: undefined,
        reason: 'page-limit' as const,
      },
      snapshot: { ...snapshot },
    };
    try {
      const response = await scope.execute(async (execution) => {
        const result = await execution.run({ method: 'query' }, () => source);
        return execution.retain(result);
      });
      if (!response.result) throw new Error('expected retained reference');
      source.items[0]!.nested.value = 'mutated-source';
      source.coverage.examined = 999;
      source.snapshot.id = 'mutated-source';

      const description = await scope.results.describe(response.result);
      (description.coverage as { examined: number }).examined = 777;
      description.snapshot!.id = 'mutated-description';
      const retained = await scope.results.get<{
        items: { nested: { value: string } }[];
        coverage: { examined: number };
      }>(response.result);
      retained.value.items[0]!.nested.value = 'mutated-view';
      (retained.coverage as { examined: number }).examined = 666;

      const again = await scope.results.get<{
        items: { nested: { value: string } }[];
        coverage: { examined: number };
      }>(response.result);
      expect(again.value.items[0]!.nested.value).toBe('historical');
      expect((again.coverage as { examined: number }).examined).toBe(2);
      expect(again.snapshot?.id).toBe('snapshot-1');
      expect(description.sizeBytes).toBeGreaterThan(0);
    } finally {
      scope.close();
      runtime.close();
    }
  });

  it('reports error summaries omitted by the trace quota', async () => {
    const runtime = createPtcRuntime({
      maxTraceEvents: 1,
      maxTraceBytes: MIN_TRACE_DETAIL_BYTES,
      maxStoredTraceBytes: MIN_TRACE_QUOTA_BYTES,
    });
    const scope = runtime.createScope();
    try {
      const response = await scope.execute(async (execution) => {
        try {
          await execution.run({ method: 'query' }, () => {
            throw new Error('connection lost');
          });
        } catch {
          return { selected: true };
        }
        return { selected: false };
      });
      expect(response.result?.selected).toBe(true);
      expect(response.trace).toContain('error');
      expect(response.traceBytes).toBeLessThanOrEqual(MIN_TRACE_DETAIL_BYTES);
      const details = await scope.trace.get(response.executionId);
      expect(details.traceBytes).toBeLessThanOrEqual(MIN_TRACE_QUOTA_BYTES);
      expect(details.errorReport).toEqual({
        total: 1,
        retained: 0,
        omitted: 1,
      });
      expect(details.outcomeSummaries).toEqual([]);
    } finally {
      scope.close();
      runtime.close();
    }
  });

  it('rejects trace budgets below their documented minimums', () => {
    const assertInvalid = (options: Parameters<typeof createPtcRuntime>[0]) => {
      let error: unknown;
      try {
        createPtcRuntime(options);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: PTC_ERROR_CODE.INVALID_OPERATION });
    };
    assertInvalid({ maxTraceBytes: MIN_TRACE_DETAIL_BYTES - 1 });
    assertInvalid({ maxStoredTraceBytes: MIN_TRACE_QUOTA_BYTES - 1 });
  });

  it('bounds caller-controlled error fields in the immediate trace', async () => {
    const runtime = createPtcRuntime({
      maxTraceEvents: 1,
      maxTraceBytes: MIN_TRACE_DETAIL_BYTES,
      maxStoredTraceBytes: MIN_TRACE_QUOTA_BYTES,
    });
    const scope = runtime.createScope();
    const hugeErrorCode = `ERR-${'x'.repeat(10_000)}`;
    try {
      const response = await scope.execute(async (execution) => {
        try {
          await execution.run({ method: 'query' }, () => {
            const error = new Error('connection lost during read');
            Object.assign(error, { code: hugeErrorCode });
            throw error;
          });
        } catch {
          return { selected: true };
        }
        return { selected: false };
      });
      expect(response.trace).toContain('error');
      expect(response.trace).not.toContain(hugeErrorCode);
      expect(response.traceBytes).toBeLessThanOrEqual(MIN_TRACE_DETAIL_BYTES);
      const details = await scope.trace.get(response.executionId);
      expect(details.errorReport.total).toBe(1);
      expect(details.traceBytes).toBeLessThanOrEqual(MIN_TRACE_QUOTA_BYTES);

      const hugeMessage = `failure-${'z'.repeat(10_000)}`;
      const failed = await scope.execute(async (execution) => {
        await execution.run({ method: 'uncaught.failure' }, () => {
          throw new Error(hugeMessage);
        });
        return 'unreachable';
      });
      expect(failed.error?.message).toBe(hugeMessage);
      expect(failed.traceBytes).toBeLessThanOrEqual(MIN_TRACE_DETAIL_BYTES);
      const failedDetails = await scope.trace.get(failed.executionId);
      expect(failedDetails.status).not.toBe(PTC_TRACE_STATUS.UNAVAILABLE);
      expect(failedDetails.traceBytes).toBeLessThanOrEqual(MIN_TRACE_QUOTA_BYTES);
      expect(failedDetails.error?.message).not.toBe(hugeMessage);
      expect(failedDetails.errorReport.total).toBe(1);
    } finally {
      scope.close();
      runtime.close();
    }
  });

  it('retains a historical bounded view with identity, quota, lifetime, and scope isolation', async () => {
    let now = 100;
    const runtime = createPtcRuntime({
      now: () => now,
      ttlMs: 10,
      maxRetainedBytes: 1_200,
      maxTombstones: 20,
    });
    const scope = runtime.createScope();
    const otherScope = runtime.createScope();
    try {
      let referenceId = '';
      await scope.execute(async (execution) => {
        const result = await execution.run({ method: 'query' }, () => page);
        const reference = await execution.retain(result);
        referenceId = reference.id;
        return reference;
      });
      const historical = await scope.results.get<{ items: { id: string }[] }>(referenceId, {
        limit: 2,
      });
      expect(historical.value.items.map((item) => item.id)).toEqual(['one', 'two']);
      expect(historical.coverage).toEqual(page.coverage);
      expect(historical.snapshot).toEqual(snapshot);
      expect(historical.viewCoverage).toMatchObject({
        complete: false,
        returned: 2,
        reason: 'view-limit',
      });

      await expect(otherScope.results.describe(referenceId)).rejects.toMatchObject({
        code: PTC_ERROR_CODE.RESULT_ACCESS_DENIED,
      });
      await scope.results.release(referenceId);
      await expect(scope.results.get(referenceId)).rejects.toMatchObject({
        code: PTC_ERROR_CODE.RESULT_RELEASED,
      });

      const expiredResponse = await scope.execute(async (execution) =>
        execution.retain({ retained: true }),
      );
      const expired = expiredResponse.result;
      if (!expired) throw new Error('expected retained reference');
      now = 300;
      await expect(scope.results.describe(expired.id)).rejects.toMatchObject({
        code: PTC_ERROR_CODE.RESULT_EXPIRED,
      });
    } finally {
      otherScope.close();
      scope.close();
      runtime.close();
    }
  });

  it('retains large values within one budget and preserves handles on oversized writes', async () => {
    const large = 'x'.repeat(512 * 1024);
    const runtime = createPtcRuntime();
    const scope = runtime.createScope();
    try {
      const saved = await scope.execute((execution) => execution.retain(large));
      expect(saved.status).toBe('completed');
      expect((await scope.results.get(saved.result!)).value).toBe(large);
    } finally {
      runtime.close();
    }
    const bounded = createPtcRuntime({ maxRetainedBytes: 16 });
    const boundedScope = bounded.createScope();
    try {
      const saved = await boundedScope.execute((execution) => execution.retain('kept'));
      const oversized = await boundedScope.execute((execution) => execution.retain('x'.repeat(17)));
      expect(oversized.error?.code).toBe(PTC_ERROR_CODE.RETENTION_QUOTA_EXCEEDED);
      expect((await boundedScope.results.get(saved.result!)).value).toBe('kept');
    } finally {
      bounded.close();
    }
  });

  it('rejects non-serializable and sensitive values without publishing references', async () => {
    const runtime = createPtcRuntime();
    const scope = runtime.createScope();
    try {
      await scope.execute(async (execution) => {
        await expect(execution.retain(() => 'not serializable')).rejects.toMatchObject({
          code: PTC_ERROR_CODE.SERIALIZATION_FAILED,
        });
        await expect(
          execution.retain({ secret: 'value' }, { sensitive: true }),
        ).rejects.toMatchObject({
          code: PTC_ERROR_CODE.SENSITIVE_VALUE,
        });
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        await expect(execution.retain(cyclic)).rejects.toMatchObject({
          code: PTC_ERROR_CODE.SERIALIZATION_FAILED,
        });
        return { retained: false };
      });
    } finally {
      scope.close();
      runtime.close();
    }
  });

  it('reports oldest-entry eviction and expired trace details without replay', async () => {
    let now = 1;
    const runtime = createPtcRuntime({
      now: () => now,
      ttlMs: 10,
      maxRetainedBytes: 10,
      maxTraceEvents: 10,
    });
    const scope = runtime.createScope();
    try {
      const first = await scope.execute(async (execution) => execution.retain('first'));
      const second = await scope.execute(async (execution) => execution.retain('second'));
      if (!first.result || !second.result) throw new Error('expected retained references');
      await expect(scope.results.describe(first.result)).rejects.toMatchObject({
        code: PTC_ERROR_CODE.RESULT_EVICTED,
      });
      await scope.results.describe(second.result);

      const traceResponse = await scope.execute(async (execution) => {
        await execution.run({ method: 'kept-operation' }, () => ({ ok: true }));
        return { ok: true };
      });
      now = 20;
      const trace = await scope.trace.get(traceResponse.executionId);
      expect(trace.status).toBe(PTC_TRACE_STATUS.UNAVAILABLE);
      expect(trace.unavailableReason).toBe('expired');
    } finally {
      scope.close();
      runtime.close();
    }
  });
});
