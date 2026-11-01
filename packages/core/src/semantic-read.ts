import { isRuntimeSubclass } from '@khaale/lore-schema';
import type { RuntimeClass, RuntimeSchemaIR, RuntimeSlot, SlotExpr } from '@khaale/lore-schema';
import {
  canonicalSemanticValue,
  normalizeSnapshot,
  type SemanticEntity,
  type SemanticRelation,
  type SemanticSnapshot,
} from './state.js';

const SEMANTIC_READ_VERSION = 1 as const;
export type SemanticReadOperation = 'get' | 'search' | 'query' | 'links' | 'graph' | 'impact';
export type ReadDirection = 'in' | 'out' | 'both';
export type SemanticQueryFilter = { slot: string; value: string | number | boolean };
export type SemanticReadMatch = { path: string; value: string | number | boolean };
export type SemanticRelationReport = SemanticRelation;
export type SemanticGraphNode = { id: string; distance: number };
export type SemanticImpactEntry = {
  id: string;
  distance: number;
  path: SemanticRelationReport[];
};

type ReadMetadata = {
  version: 1;
  operation: SemanticReadOperation;
  schemaHash: string;
  query: Record<string, unknown>;
};
export type SemanticGetReport = ReadMetadata & {
  operation: 'get';
  query: { id: string };
  entity: SemanticEntity;
};
export type SemanticSearchReport = ReadMetadata & {
  operation: 'search';
  query: { text: string };
  matches: Array<{ entity: SemanticEntity; matches: SemanticReadMatch[] }>;
};
export type SemanticQueryReport = ReadMetadata & {
  operation: 'query';
  query: { kind?: string; where: SemanticQueryFilter[] };
  entities: SemanticEntity[];
};
export type SemanticLinksReport = ReadMetadata & {
  operation: 'links';
  query: { id: string; direction: ReadDirection; relation?: string };
  links: SemanticRelationReport[];
};
export type SemanticGraphReport = ReadMetadata & {
  operation: 'graph';
  query: { id: string; depth: number };
  root: string;
  nodes: SemanticGraphNode[];
  links: SemanticRelationReport[];
};
export type SemanticImpactReport = ReadMetadata & {
  operation: 'impact';
  query: { id: string; depth: number };
  root: string;
  impacts: SemanticImpactEntry[];
};
export type SemanticReadReport =
  | SemanticGetReport
  | SemanticSearchReport
  | SemanticQueryReport
  | SemanticLinksReport
  | SemanticGraphReport
  | SemanticImpactReport;

export class SemanticReadError extends Error {
  readonly code:
    | 'STATE_UNAVAILABLE'
    | 'SCHEMA_MISMATCH'
    | 'MISSING_ID'
    | 'INVALID_FILTER'
    | 'INVALID_DEPTH'
    | 'INVALID_INPUT';

  constructor(code: SemanticReadError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SemanticReadError';
    this.code = code;
  }
}

type SessionOptions = {
  snapshot: SemanticSnapshot;
  schema: RuntimeSchemaIR;
  schemaHash: string;
};

const isScalar = (value: unknown): value is string | number | boolean =>
  (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') &&
  !(typeof value === 'number' && !Number.isFinite(value));
const compareEntity = (left: SemanticEntity, right: SemanticEntity): number =>
  left.id.localeCompare(right.id);
const compareRelation = (left: SemanticRelation, right: SemanticRelation): number =>
  left.from.localeCompare(right.from) ||
  left.relation.localeCompare(right.relation) ||
  left.to.localeCompare(right.to);
const equalValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalSemanticValue(left)) === JSON.stringify(canonicalSemanticValue(right));
const clone = <T>(value: T): T => canonicalSemanticValue(value) as T;

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}

function resolveClass(ir: RuntimeSchemaIR, identity: string): RuntimeClass | undefined {
  return Object.values(ir.classes).find(
    (runtimeClass) => runtimeClass.name === identity || runtimeClass.typeId === identity,
  );
}

function scalarMatches(
  value: unknown,
  expected: string | number | boolean,
  slot: RuntimeSlot,
  ir: RuntimeSchemaIR,
): boolean {
  const values = slot.multivalued ? (Array.isArray(value) ? value : []) : [value];
  return (
    values.some((candidate) => equalValue(candidate, expected)) &&
    values.every((candidate) => slotValueValid(candidate, slot, ir))
  );
}

function scalarValueValid(
  value: unknown,
  range: string,
  ir: RuntimeSchemaIR,
  seen = new Set<string>(),
): boolean {
  if (!isScalar(value)) return false;
  const enumDef = ir.enums[range];
  if (enumDef) return typeof value === 'string' && enumDef.values.includes(value);
  const type = ir.types[range];
  if (type) {
    if (seen.has(range) || !scalarValueValid(value, type.base, ir, new Set(seen).add(range)))
      return false;
    if (typeof value === 'number') {
      if (type.minimumValue !== undefined && value < Number(type.minimumValue)) return false;
      if (type.maximumValue !== undefined && value > Number(type.maximumValue)) return false;
    }
    return (
      !type.patterns.length ||
      (typeof value === 'string' &&
        type.patterns.every((pattern) => new RegExp(pattern).test(value)))
    );
  }
  const base = range.toLowerCase();
  if (['string', 'str', 'uri', 'uriorcurie', 'ncname'].includes(base))
    return typeof value === 'string';
  if (base === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }
  if (base === 'datetime')
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    );
  if (base === 'time')
    return (
      typeof value === 'string' && /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
    );
  if (['integer', 'int'].includes(base))
    return typeof value === 'number' && Number.isInteger(value);
  if (['float', 'double', 'decimal'].includes(base)) return typeof value === 'number';
  if (['boolean', 'bool'].includes(base)) return typeof value === 'boolean';
  return false;
}

function slotValueValid(value: unknown, slot: RuntimeSlot, ir: RuntimeSchemaIR): boolean {
  if (!scalarValueValid(value, slot.range, ir)) return false;
  if (
    typeof value === 'string' &&
    slot.patterns.some((pattern) => !new RegExp(pattern).test(value))
  )
    return false;
  if (typeof value === 'number') {
    if (slot.minimumValue !== undefined && value < Number(slot.minimumValue)) return false;
    if (slot.maximumValue !== undefined && value > Number(slot.maximumValue)) return false;
  }
  return (
    (!slot.anyOf.length ||
      slot.anyOf.some((expression) => expressionValueValid(value, expression, ir))) &&
    (!slot.allOf.length ||
      slot.allOf.every((expression) => expressionValueValid(value, expression, ir))) &&
    (!slot.noneOf.length ||
      slot.noneOf.every((expression) => !expressionValueValid(value, expression, ir))) &&
    (!slot.exactlyOneOf.length ||
      slot.exactlyOneOf.filter((expression) => expressionValueValid(value, expression, ir))
        .length === 1)
  );
}

function expressionValueValid(value: unknown, expression: SlotExpr, ir: RuntimeSchemaIR): boolean {
  const cardinality = Array.isArray(value) ? value.length : value === undefined ? 0 : 1;
  if (expression.minimumCardinality !== undefined && cardinality < expression.minimumCardinality)
    return false;
  if (expression.maximumCardinality !== undefined && cardinality > expression.maximumCardinality)
    return false;
  if (expression.exactCardinality !== undefined && cardinality !== expression.exactCardinality)
    return false;
  if (expression.range !== undefined && !scalarValueValid(value, expression.range, ir))
    return false;
  if (expression.equalsString !== undefined && value !== expression.equalsString) return false;
  if (
    expression.equalsStringIn !== undefined &&
    (!isScalar(value) || !expression.equalsStringIn.includes(String(value)))
  )
    return false;
  if (
    expression.pattern !== undefined &&
    (typeof value !== 'string' || !new RegExp(expression.pattern).test(value))
  )
    return false;
  if (
    expression.anyOf?.length &&
    !expression.anyOf.some((child) => expressionValueValid(value, child, ir))
  )
    return false;
  if (
    expression.allOf?.length &&
    !expression.allOf.every((child) => expressionValueValid(value, child, ir))
  )
    return false;
  if (
    expression.noneOf?.length &&
    expression.noneOf.some((child) => expressionValueValid(value, child, ir))
  )
    return false;
  return (
    !expression.exactlyOneOf?.length ||
    expression.exactlyOneOf.filter((child) => expressionValueValid(value, child, ir)).length === 1
  );
}

function walkScalarValues(value: unknown, path: string, output: SemanticReadMatch[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkScalarValues(item, `${path}[${index}]`, output));
    return;
  }
  if (value && typeof value === 'object') {
    Object.keys(value)
      .sort()
      .forEach((key) =>
        walkScalarValues(
          (value as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
          output,
        ),
      );
    return;
  }
  if (isScalar(value)) output.push({ path, value });
}

function validateDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0 || depth > 32)
    throw new SemanticReadError('INVALID_DEPTH', 'depth must be an integer between 0 and 32');
}

export class SemanticReadSession {
  readonly schemaHash: string;
  private readonly snapshot: SemanticSnapshot;
  private readonly schema: RuntimeSchemaIR;
  private readonly entities: SemanticEntity[];
  private readonly relations: SemanticRelation[];
  private readonly byId: Map<string, SemanticEntity>;

  constructor(options: SessionOptions) {
    if (!options.schema || !options.schemaHash)
      throw new SemanticReadError(
        'INVALID_INPUT',
        'semantic read session requires a runtime schema hash',
      );
    if (options.snapshot.schemaHash !== options.schemaHash)
      throw new SemanticReadError(
        'SCHEMA_MISMATCH',
        `semantic state schema identity ${options.snapshot.schemaHash} does not match runtime schema ${options.schemaHash}`,
      );
    try {
      this.snapshot = freeze(normalizeSnapshot(options.snapshot));
    } catch (error) {
      throw new SemanticReadError(
        'STATE_UNAVAILABLE',
        `cannot read semantic state: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    this.schema = options.schema;
    this.schemaHash = options.schemaHash;
    this.entities = Object.values(this.snapshot.entities).sort(compareEntity);
    this.relations = this.snapshot.relations
      .filter((relation) => !relation.generic && !relation.inferred)
      .sort(compareRelation);
    this.byId = new Map(this.entities.map((entity) => [entity.id, entity]));
  }

  private entity(id: string): SemanticEntity {
    const entity = this.byId.get(id);
    if (!entity)
      throw new SemanticReadError(
        'MISSING_ID',
        `entity ${JSON.stringify(id)} was not found in the Effective Model`,
      );
    return entity;
  }

  get(id: string): SemanticGetReport {
    if (!id) throw new SemanticReadError('INVALID_INPUT', 'get requires a logical entity ID');
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'get',
      schemaHash: this.schemaHash,
      query: { id },
      entity: clone(this.entity(id)),
    });
  }

  search(text: string): SemanticSearchReport {
    if (typeof text !== 'string')
      throw new SemanticReadError('INVALID_INPUT', 'search requires literal text');
    const needle = text.toLocaleLowerCase();
    const matches = this.entities.flatMap((entity) => {
      const fields: SemanticReadMatch[] = [
        { path: 'id', value: entity.id },
        { path: 'kind', value: entity.kind },
        { path: 'type_id', value: entity.typeId },
      ];
      walkScalarValues(entity.properties, '', fields);
      const found = fields
        .filter((field) => String(field.value).toLocaleLowerCase().includes(needle))
        .sort(
          (a, b) => a.path.localeCompare(b.path) || String(a.value).localeCompare(String(b.value)),
        );
      return found.length ? [{ entity: clone(entity), matches: found }] : [];
    });
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'search',
      schemaHash: this.schemaHash,
      query: { text },
      matches,
    });
  }

  query(kind?: string, where: SemanticQueryFilter[] = []): SemanticQueryReport {
    const selectedClass = kind === undefined ? undefined : resolveClass(this.schema, kind);
    if (kind !== undefined && !selectedClass)
      throw new SemanticReadError(
        'INVALID_FILTER',
        `unknown class or type identity ${JSON.stringify(kind)}`,
      );
    if (!Array.isArray(where))
      throw new SemanticReadError('INVALID_FILTER', 'query filters must be an array');
    const knownClasses = Object.values(this.schema.classes).filter(
      (runtimeClass) => !runtimeClass.abstract && !runtimeClass.mixin,
    );
    for (const filter of where) {
      if (!filter || typeof filter.slot !== 'string' || !isScalar(filter.value))
        throw new SemanticReadError(
          'INVALID_FILTER',
          'query filters require a slot and one scalar value',
        );
      const classes = selectedClass ? [selectedClass] : knownClasses;
      const definitions = classes
        .map((runtimeClass) => runtimeClass.slots[filter.slot])
        .filter((slot): slot is RuntimeSlot => Boolean(slot));
      if (!definitions.length)
        throw new SemanticReadError(
          'INVALID_FILTER',
          `unknown or inapplicable query slot ${JSON.stringify(filter.slot)}`,
        );
      const compatible = definitions.some((slot) =>
        slot.mode === 'scalar'
          ? slotValueValid(filter.value, slot, this.schema)
          : slot.mode === 'reference' && typeof filter.value === 'string',
      );
      if (!compatible)
        throw new SemanticReadError(
          'INVALID_FILTER',
          `value for query slot ${filter.slot} is incompatible with every applicable schema definition`,
        );
    }
    const entities = this.entities
      .filter((entity) => {
        if (selectedClass && !isRuntimeSubclass(this.schema, entity.kind, selectedClass.name))
          return false;
        const runtimeClass = this.schema.classes[entity.kind];
        if (!runtimeClass) return false;
        return where.every((filter) => {
          const slot = runtimeClass.slots[filter.slot];
          if (!slot) return false;
          if (slot.mode === 'reference') if (typeof filter.value !== 'string') return false;
          if (slot.mode === 'reference')
            return this.relations.some(
              (relation) =>
                relation.from === entity.id &&
                relation.relation === filter.slot &&
                relation.to === filter.value,
            );
          return scalarMatches(entity.properties[filter.slot], filter.value, slot, this.schema);
        });
      })
      .map(clone);
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'query',
      schemaHash: this.schemaHash,
      query: { ...(kind === undefined ? {} : { kind }), where: clone(where) },
      entities,
    });
  }

  links(id: string, direction: ReadDirection = 'both', relation?: string): SemanticLinksReport {
    this.entity(id);
    if (!['in', 'out', 'both'].includes(direction))
      throw new SemanticReadError(
        'INVALID_INPUT',
        `invalid relation direction ${JSON.stringify(direction)}`,
      );
    const links = this.relations
      .filter((edge) => {
        const matchesDirection =
          direction === 'both'
            ? edge.from === id || edge.to === id
            : direction === 'out'
              ? edge.from === id
              : edge.to === id;
        return matchesDirection && (relation === undefined || edge.relation === relation);
      })
      .map(clone);
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'links',
      schemaHash: this.schemaHash,
      query: { id, direction, ...(relation === undefined ? {} : { relation }) },
      links,
    });
  }

  graph(id: string, depth = 1): SemanticGraphReport {
    this.entity(id);
    validateDepth(depth);
    const distances = new Map<string, number>([[id, 0]]);
    const queue = [id];
    const adjacent = (current: string): string[] =>
      this.relations
        .flatMap((edge) =>
          edge.from === current ? [edge.to] : edge.to === current ? [edge.from] : [],
        )
        .sort();
    while (queue.length) {
      const current = queue.shift()!;
      const distance = distances.get(current)!;
      if (distance >= depth) continue;
      for (const next of adjacent(current))
        if (!distances.has(next)) {
          distances.set(next, distance + 1);
          queue.push(next);
        }
    }
    const nodes = [...distances.entries()]
      .sort(
        ([leftId, leftDistance], [rightId, rightDistance]) =>
          leftDistance - rightDistance || leftId.localeCompare(rightId),
      )
      .map(([nodeId, distance]) => ({ id: nodeId, distance }));
    const ids = new Set(nodes.map((node) => node.id));
    const links = this.relations
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map(clone);
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'graph',
      schemaHash: this.schemaHash,
      query: { id, depth },
      root: id,
      nodes,
      links,
    });
  }

  impact(id: string, depth = 1): SemanticImpactReport {
    this.entity(id);
    validateDepth(depth);
    const distances = new Map<string, number>([[id, 0]]);
    const paths = new Map<string, SemanticRelation[]>([[id, []]]);
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      const distance = distances.get(current)!;
      if (distance >= depth) continue;
      for (const edge of this.relations
        .filter((candidate) => candidate.to === current)
        .sort(compareRelation)) {
        if (distances.has(edge.from)) continue;
        distances.set(edge.from, distance + 1);
        paths.set(edge.from, [edge, ...paths.get(current)!]);
        queue.push(edge.from);
      }
    }
    const impacts = [...distances.keys()]
      .filter((nodeId) => nodeId !== id)
      .sort(
        (left, right) => distances.get(left)! - distances.get(right)! || left.localeCompare(right),
      )
      .map((nodeId) => ({
        id: nodeId,
        distance: distances.get(nodeId)!,
        path: clone(paths.get(nodeId)!),
      }));
    return freeze({
      version: SEMANTIC_READ_VERSION,
      operation: 'impact',
      schemaHash: this.schemaHash,
      query: { id, depth },
      root: id,
      impacts,
    });
  }
}

export function createSemanticReadSession(options: SessionOptions): SemanticReadSession {
  return new SemanticReadSession(options);
}
