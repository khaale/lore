import type { RuntimeClass, RuntimeSchemaIR, SlotExpr } from '@khaale/lore-schema';
import type { Artifact, BuildResult, Edge, SourceDescriptor, SourceSpan } from './index.js';

/** A stable location in the projection that owns a semantic entity. */
export type SemanticProvenance = {
  source: string;
  physicalPath: string;
  span?: SourceSpan;
  narrative?: SourceDescriptor;
  properties?: Record<string, SourceDescriptor>;
  enriched?: boolean;
};

/** A normalized semantic relation. Surface text is deliberately not retained. */
export type SemanticRelation = {
  from: string;
  relation: string;
  to: string;
  inferred: boolean;
  generic: boolean;
  provenance?: SourceDescriptor;
};

export type SemanticEntity = {
  id: string;
  kind: string;
  typeId: string;
  properties: Record<string, unknown>;
  provenance: SemanticProvenance;
};

/** Immutable semantic read snapshot materialized from authored files. */
export type SemanticSnapshot = {
  schemaHash: string;
  entities: Record<string, SemanticEntity>;
  relations: SemanticRelation[];
};

export class SemanticStateError extends Error {
  readonly code: 'INVALID_SNAPSHOT';

  constructor(code: SemanticStateError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SemanticStateError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sourceRepresentations = new Set<SourceDescriptor['representation']>([
  'frontmatter',
  'markdown',
  'markdown-table',
  'manifest',
  'narrative',
]);
const normalizeDescriptor = (value: unknown, context: string): SourceDescriptor => {
  if (
    !isRecord(value) ||
    typeof value.source !== 'string' ||
    typeof value.physicalPath !== 'string' ||
    typeof value.representation !== 'string' ||
    !sourceRepresentations.has(value.representation as SourceDescriptor['representation'])
  )
    throw new SemanticStateError('INVALID_SNAPSHOT', `${context} has invalid source descriptor`);
  if (value.span !== undefined) {
    const span = value.span;
    if (
      !isRecord(span) ||
      typeof span.line !== 'number' ||
      typeof span.column !== 'number' ||
      !Number.isInteger(span.line) ||
      !Number.isInteger(span.column) ||
      span.line < 1 ||
      span.column < 1
    )
      throw new SemanticStateError('INVALID_SNAPSHOT', `${context} has invalid source span`);
  }
  return cloneValue(value) as SourceDescriptor;
};

/** Canonical JSON-compatible values used by semantic reads. */
export function canonicalSemanticValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new SemanticStateError(
        'INVALID_SNAPSHOT',
        'semantic values must be finite JSON numbers',
      );
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalSemanticValue(item));
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => {
          const item = canonicalSemanticValue(value[key]);
          return item === undefined ? [] : [[key, item]];
        }),
    );
  throw new SemanticStateError(
    'INVALID_SNAPSHOT',
    `semantic value of type ${typeof value} is not JSON-compatible`,
  );
}

const cloneValue = <T>(value: T): T => canonicalSemanticValue(value) as T;

function normalizedInlineValue(
  value: unknown,
  runtimeClass: RuntimeClass | undefined,
  ir: RuntimeSchemaIR,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => normalizedInlineValue(item, runtimeClass, ir));
  if (!isRecord(value) || !runtimeClass) return canonicalSemanticValue(value);
  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const slot = runtimeClass.slots[name];
    const nestedClass = slot ? ir.classes[slot.range] : undefined;
    result[name] = normalizedInlineValue(item, nestedClass, ir);
  }
  return canonicalSemanticValue(result);
}

function semanticProperties(
  artifact: Artifact,
  ir: RuntimeSchemaIR,
  edges: Edge[],
): Record<string, unknown> {
  const hasScalarAlternative = (e: SlotExpr): boolean =>
    !!(e.range && !ir.classes[e.range]) ||
    [e.anyOf, e.allOf, e.exactlyOneOf].some((group) => group?.some(hasScalarAlternative));
  const runtimeClass = ir.classes[artifact.kind];
  const properties: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(artifact.data)) {
    if (value === undefined) continue;
    const slot = runtimeClass?.slots[name];
    if (slot?.mode === 'reference') {
      if (slot.anyOf.some(hasScalarAlternative)) {
        const project = (value: unknown) =>
          edges.find((edge) => edge.relation === name && edge.surface === value)?.to ??
          canonicalSemanticValue(value);
        properties[name] = Array.isArray(value) ? value.map(project) : project(value);
      }
      continue;
    }
    properties[name] = normalizedInlineValue(value, ir.classes[slot?.range ?? ''], ir);
  }
  for (const edge of edges) {
    if (edge.from !== artifact.id || edge.inferred || !edge.value_path) continue;
    let value: any = properties;
    const keys = edge.value_path;
    for (const key of keys.slice(0, -1)) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
        value = undefined;
        break;
      }
      value = value[key];
    }
    if (value !== null && typeof value === 'object') value[keys.at(-1)!] = edge.to;
  }
  return canonicalSemanticValue(properties) as Record<string, unknown>;
}

const edgeToRelation = (edge: Edge): SemanticRelation => ({
  from: edge.from,
  relation: edge.relation,
  to: edge.to,
  inferred: edge.inferred === true,
  generic: edge.generic === true,
  ...(edge.provenance ? { provenance: edge.provenance } : {}),
});

const relationKey = (relation: SemanticRelation): string =>
  JSON.stringify([
    relation.from,
    relation.relation,
    relation.to,
    relation.inferred,
    relation.generic,
  ]);

const compareRelation = (left: SemanticRelation, right: SemanticRelation): number =>
  left.from.localeCompare(right.from) ||
  left.relation.localeCompare(right.relation) ||
  left.to.localeCompare(right.to) ||
  Number(left.inferred) - Number(right.inferred) ||
  Number(left.generic) - Number(right.generic);

/** Convert a successful graph build into a defensive, schema-independent snapshot. */
export function snapshotFromBuildResult(result: BuildResult): SemanticSnapshot {
  const diagnostics = result.index.diagnostics ?? [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (result.index.version !== 2)
    throw new SemanticStateError(
      'INVALID_SNAPSHOT',
      'cannot snapshot an unsupported index version',
    );
  if (errors.length)
    throw new SemanticStateError(
      'INVALID_SNAPSHOT',
      `cannot snapshot a graph with ${errors.length} error diagnostic${errors.length === 1 ? '' : 's'}`,
    );
  const referencesByOwner = new Map<string, Edge[]>();
  for (const edge of result.index.edges ?? [])
    if (!edge.inferred && !edge.generic) {
      const edges = referencesByOwner.get(edge.from) ?? [];
      edges.push(edge);
      referencesByOwner.set(edge.from, edges);
    }
  const entities: Record<string, SemanticEntity> = {};
  for (const artifact of Object.values(result.index.artifacts).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    entities[artifact.id] = {
      id: artifact.id,
      kind: artifact.kind,
      typeId: artifact.type_id,
      properties: semanticProperties(
        artifact,
        result.schema,
        referencesByOwner.get(artifact.id) ?? [],
      ),
      provenance: {
        source: artifact.provenance?.source ?? artifact.source,
        physicalPath: artifact.provenance?.physicalPath ?? artifact.physical_path,
        ...(artifact.provenance?.span ? { span: artifact.provenance.span } : {}),
        ...(artifact.provenance?.narrative ? { narrative: artifact.provenance.narrative } : {}),
        ...(artifact.provenance?.properties ? { properties: artifact.provenance.properties } : {}),
        ...(artifact.provenance?.enriched ? { enriched: true } : {}),
      },
    };
  }
  const seen = new Set<string>();
  const relations = (result.index.edges ?? [])
    .map(edgeToRelation)
    .filter((relation) => {
      const key = relationKey(relation);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareRelation);
  return { schemaHash: result.index.schema_hash, entities, relations };
}

/** Validate and canonicalize a snapshot before starting a read session. */
export function normalizeSnapshot(snapshot: SemanticSnapshot): SemanticSnapshot {
  if (!snapshot || typeof snapshot.schemaHash !== 'string' || !snapshot.schemaHash)
    throw new SemanticStateError('INVALID_SNAPSHOT', 'snapshot requires a schema hash');
  if (!isRecord(snapshot.entities) || !Array.isArray(snapshot.relations))
    throw new SemanticStateError('INVALID_SNAPSHOT', 'snapshot requires entities and relations');
  const entities: Record<string, SemanticEntity> = {};
  for (const [id, entity] of Object.entries(snapshot.entities)) {
    if (
      !entity ||
      entity.id !== id ||
      typeof entity.kind !== 'string' ||
      typeof entity.typeId !== 'string'
    )
      throw new SemanticStateError('INVALID_SNAPSHOT', `invalid entity ${id}`);
    if (
      !entity.provenance ||
      typeof entity.provenance.source !== 'string' ||
      typeof entity.provenance.physicalPath !== 'string'
    )
      throw new SemanticStateError('INVALID_SNAPSHOT', `entity ${id} has invalid provenance`);
    entities[id] = {
      id,
      kind: entity.kind,
      typeId: entity.typeId,
      properties: canonicalSemanticValue(entity.properties) as Record<string, unknown>,
      provenance: {
        source: entity.provenance.source,
        physicalPath: entity.provenance.physicalPath,
        ...(entity.provenance.span === undefined
          ? {}
          : { span: cloneValue(entity.provenance.span) }),
        ...(entity.provenance.narrative === undefined
          ? {}
          : {
              narrative: normalizeDescriptor(entity.provenance.narrative, `entity ${id} narrative`),
            }),
        ...(entity.provenance.properties === undefined
          ? {}
          : {
              properties: Object.fromEntries(
                Object.entries(entity.provenance.properties).map(([name, descriptor]) => [
                  name,
                  normalizeDescriptor(descriptor, `entity ${id}.${name}`),
                ]),
              ),
            }),
        ...(entity.provenance.enriched ? { enriched: true } : {}),
      },
    };
  }
  const relations = snapshot.relations.map((relation) => {
    if (
      !relation ||
      typeof relation.from !== 'string' ||
      typeof relation.relation !== 'string' ||
      typeof relation.to !== 'string'
    )
      throw new SemanticStateError('INVALID_SNAPSHOT', 'invalid semantic relation');
    return {
      from: relation.from,
      relation: relation.relation,
      to: relation.to,
      inferred: relation.inferred === true,
      generic: relation.generic === true,
      ...(relation.provenance === undefined
        ? {}
        : {
            provenance: normalizeDescriptor(
              relation.provenance,
              `relation ${relation.from}.${relation.relation}`,
            ),
          }),
    };
  });
  const deduped = new Map(relations.map((relation) => [relationKey(relation), relation]));
  return {
    schemaHash: snapshot.schemaHash,
    entities,
    relations: [...deduped.values()].sort(compareRelation),
  };
}
