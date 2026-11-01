export { isRuntimeSubclass } from './runtime.js';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import {
  compileSources,
  SourceDeclarationError,
  SOURCES_ANNOTATION,
  type SourcePlan,
} from './sources.js';
export type {
  SourcePlan,
  SourceEntityRule,
  SourceExpression,
  SourceSelection,
  SourcePath,
  SourceKey,
} from './sources.js';
import { isAbsolute, resolve, dirname, extname, relative } from 'node:path';
import { parseDocument } from 'yaml';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Annotations = Record<string, unknown>;
export type HeadingIdentityRule = {
  name: string;
  levels: number[];
  pattern: string;
};

export type SlotExpr = {
  range?: string | undefined;
  required?: boolean | undefined;
  valuePresence?: 'PRESENT' | 'ABSENT' | undefined;
  equalsString?: string | undefined;
  equalsStringIn?: string[] | undefined;
  pattern?: string | undefined;
  minimumCardinality?: number | undefined;
  maximumCardinality?: number | undefined;
  exactCardinality?: number | undefined;
  anyOf?: SlotExpr[] | undefined;
  allOf?: SlotExpr[] | undefined;
  noneOf?: SlotExpr[] | undefined;
  exactlyOneOf?: SlotExpr[] | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type ClassExpr = {
  isA?: string | undefined;
  slotConditions?: Record<string, SlotExpr> | undefined;
  anyOf?: ClassExpr[] | undefined;
  allOf?: ClassExpr[] | undefined;
  noneOf?: ClassExpr[] | undefined;
  exactlyOneOf?: ClassExpr[] | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type ClassRule = {
  preconditions?: ClassExpr | undefined;
  postconditions: ClassExpr;
  extra?: Record<string, unknown> | undefined;
};
export type SlotDef = {
  description?: string | undefined;
  slotUri?: string | undefined;
  isA?: string | undefined;
  mixins?: string[] | undefined;
  range?: string | undefined;
  required?: boolean | undefined;
  recommended?: boolean | undefined;
  multivalued?: boolean | undefined;
  listElementsUnique?: boolean | undefined;
  identifier?: boolean | undefined;
  key?: boolean | undefined;
  inlined?: boolean | undefined;
  inverse?: string | undefined;
  designatesType?: boolean | undefined;
  pattern?: string | undefined;
  minimumValue?: unknown | undefined;
  maximumValue?: unknown | undefined;
  minimumCardinality?: number | undefined;
  maximumCardinality?: number | undefined;
  exactCardinality?: number | undefined;
  anyOf?: SlotExpr[] | undefined;
  allOf?: SlotExpr[] | undefined;
  noneOf?: SlotExpr[] | undefined;
  exactlyOneOf?: SlotExpr[] | undefined;
  annotations?: Annotations | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type ClassDef = {
  description?: string | undefined;
  classUri?: string | undefined;
  fromSchema?: string | undefined;
  isA?: string | undefined;
  mixins?: string[] | undefined;
  abstract?: boolean | undefined;
  mixin?: boolean | undefined;
  slots?: string[] | undefined;
  attributes?: Record<string, SlotDef> | undefined;
  slotUsage?: Record<string, SlotDef> | undefined;
  classificationRules?: ClassExpr[] | undefined;
  recordConstraints?: ClassExpr[] | undefined;
  rules?: ClassRule[] | undefined;
  uniqueKeys?: Record<string, UniqueKey> | undefined;
  extraSlots?: ExtraSlots | undefined;
  annotations?: Annotations | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type UniqueKey = { uniqueKeySlots: string[]; extra?: Record<string, unknown> | undefined };
export type ExtraSlots = {
  allowed?: boolean | undefined;
  rangeExpression?: Record<string, unknown> | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type TypeDef = {
  typeof?: string | undefined;
  base?: string | undefined;
  pattern?: string | undefined;
  minimumValue?: unknown | undefined;
  maximumValue?: unknown | undefined;
  extra?: Record<string, unknown> | undefined;
};
export type EnumDef = {
  permissibleValues: Record<string, unknown>;
  extra?: Record<string, unknown> | undefined;
};
export type AssertedSchema = {
  id?: string | undefined;
  name?: string | undefined;
  defaultRange?: string | undefined;
  imports?: string[] | undefined;
  prefixes?: Record<string, string> | undefined;
  defaultPrefix?: string | undefined;
  classes: Record<string, ClassDef>;
  slots: Record<string, SlotDef>;
  types: Record<string, TypeDef>;
  enums: Record<string, EnumDef>;
  annotations?: Annotations | undefined;
  extra?: Record<string, unknown> | undefined;
  sourceFiles?: string[] | undefined;
};

export const VALUE_MODE = {
  SCALAR: 'scalar',
  INLINE_OBJECT: 'inline-object',
  REFERENCE: 'reference',
} as const;
export type ValueMode = (typeof VALUE_MODE)[keyof typeof VALUE_MODE];
export type RuntimeType = {
  name: string;
  base: string;
  patterns: string[];
  minimumValue?: unknown | undefined;
  maximumValue?: unknown | undefined;
};
export type RuntimeEnum = { name: string; values: string[] };
export type RuntimeSlot = {
  name: string;
  description?: string | undefined;
  slotUri?: string | undefined;
  range: string;
  required: boolean;
  recommended: boolean;
  multivalued: boolean;
  listElementsUnique?: boolean;
  explicitRange?: boolean;
  identifier: boolean;
  key: boolean;
  mode: ValueMode;
  inverse?: string | undefined;
  designatesType: boolean;
  patterns: string[];
  minimumValue?: unknown | undefined;
  maximumValue?: unknown | undefined;
  minimumCardinality?: number | undefined;
  maximumCardinality?: number | undefined;
  exactCardinality?: number | undefined;
  anyOf: SlotExpr[];
  allOf: SlotExpr[];
  noneOf: SlotExpr[];
  exactlyOneOf: SlotExpr[];
  annotations: Annotations;
};
export type RuntimeUniqueKey = { name: string; slots: string[] };
export type RuntimeClass = {
  name: string;
  typeId: string;
  title?: string | undefined;
  classUri?: string | undefined;
  fromSchema?: string | undefined;
  description?: string | undefined;
  parent?: string | undefined;
  mixins: string[];
  abstract: boolean;
  mixin: boolean;
  slots: Record<string, RuntimeSlot>;
  classificationRules: ClassExpr[];
  recordConstraints?: ClassExpr[];
  rules?: ClassRule[];
  uniqueKeys: Record<string, RuntimeUniqueKey>;
  designatorSlot?: string | undefined;
  allowExtra: boolean;
  depth: number;
  annotations: Annotations;
};
export type RuntimeSchemaIR = {
  name: string;
  schemaId?: string | undefined;
  classes: Record<string, RuntimeClass>;
  types: Record<string, RuntimeType>;
  enums: Record<string, RuntimeEnum>;
  designators: Record<string, Record<string, string>>;
  headingIdentity?: HeadingIdentityRule[];
  sources?: SourcePlan[];
};
const explicitInlineSlots = new WeakSet<RuntimeSlot>();
const generatedClassOrigins = new WeakSet<ClassDef>();
export type CompilerDiagnostic = {
  category: DiagnosticCategory;
  code: string;
  message: string;
  source?: string;
  path?: string;
};
export type DiagnosticCategory =
  'parse' | 'composition' | 'unsupported-profile' | 'invalid-schema' | 'normalization';
export type CompiledSchema = {
  schema: AssertedSchema;
  ir: RuntimeSchemaIR;
  dependencies: string[];
  hash: string;
};
export type CompileSchemaOptions = {
  /** Absolute root that local imports must remain within. */
  allowedRoot?: string;
};
export type CompileResult =
  { ok: true; value: CompiledSchema } | { ok: false; diagnostics: CompilerDiagnostic[] };

const SUPPORTED_LORE_ANNOTATIONS = [
  'lore:explore_roles',
  'lore:explore_relation',
  'lore:explore_label',
  'lore:explore_order',
  'lore:explore_views',
  'lore:markdown_selectors',
  'lore:markdown_reference_column',
  'lore:heading_identity',
  'lore:sources',
] as const;
const primitives = new Set([
  'string',
  'str',
  'integer',
  'int',
  'float',
  'double',
  'decimal',
  'boolean',
  'bool',
  'date',
  'datetime',
  'time',
  'uri',
  'uriorcurie',
  'ncname',
]);
const common = new Set([
  'description',
  'annotations',
  'extensions',
  'title',
  'alt_descriptions',
  'aliases',
  'comments',
  'notes',
  'todos',
  'examples',
  'in_subset',
  'from_schema',
  'rank',
  'deprecated',
  'deprecated_element_has_exact_replacement',
  'deprecated_element_has_possible_replacement',
  'mappings',
  'exact_mappings',
  'narrow_mappings',
  'broad_mappings',
  'related_mappings',
  'close_mappings',
  'see_also',
  'source',
  'status',
  'categories',
  'keywords',
  'created_by',
  'modified_by',
  'created_on',
  'last_updated_on',
  'contributors',
  'definition_uri',
  'local_names',
  'structured_aliases',
  'in_language',
  'conforms_to',
  'implements',
  'instantiates',
  'imported_from',
]);
const knownSlot = new Set([
  'description',
  'is_a',
  'mixins',
  'range',
  'required',
  'recommended',
  'multivalued',
  'list_elements_unique',
  'identifier',
  'key',
  'inlined',
  'inverse',
  'designates_type',
  'pattern',
  'minimum_value',
  'maximum_value',
  'minimum_cardinality',
  'maximum_cardinality',
  'exact_cardinality',
  'any_of',
  'all_of',
  'none_of',
  'exactly_one_of',
  'annotations',
  'slot_uri',
]);

const obj = (v: unknown): Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) ? v : undefined;
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
function extras(
  v: Record<string, any>,
  accepted: Set<string>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!accepted.has(k)) out[k] = x;
  return Object.keys(out).length ? out : undefined;
}
function annotations(v: unknown): Annotations | undefined {
  const x = obj(v);
  return Object.keys(x).length ? x : undefined;
}
function expression(v: unknown): SlotExpr {
  const x = obj(v),
    out: SlotExpr = {};
  for (const [from, to] of [
    ['range', 'range'],
    ['required', 'required'],
    ['value_presence', 'valuePresence'],
    ['equals_string', 'equalsString'],
    ['pattern', 'pattern'],
    ['minimum_cardinality', 'minimumCardinality'],
    ['maximum_cardinality', 'maximumCardinality'],
    ['exact_cardinality', 'exactCardinality'],
  ] as const) {
    const value = x[from];
    if (
      to === 'required'
        ? typeof value === 'boolean'
        : to.endsWith('Cardinality')
          ? typeof value === 'number'
          : typeof value === 'string'
    )
      (out as any)[to] = value;
  }
  const eq = strings(x.equals_string_in);
  if (eq) out.equalsStringIn = eq;
  for (const [from, to] of [
    ['any_of', 'anyOf'],
    ['all_of', 'allOf'],
    ['none_of', 'noneOf'],
    ['exactly_one_of', 'exactlyOneOf'],
  ] as const)
    if (Array.isArray(x[from])) (out as any)[to] = x[from].map(expression);
  out.extra = extras(
    x,
    new Set([
      'range',
      'required',
      'value_presence',
      'equals_string',
      'equals_string_in',
      'pattern',
      'minimum_cardinality',
      'maximum_cardinality',
      'exact_cardinality',
      'any_of',
      'all_of',
      'none_of',
      'exactly_one_of',
    ]),
  );
  return out;
}
function slot(v: unknown): SlotDef {
  const x = obj(v),
    out: SlotDef = {};
  const map: [string, keyof SlotDef][] = [
    ['description', 'description'],
    ['slot_uri', 'slotUri'],
    ['is_a', 'isA'],
    ['range', 'range'],
    ['inverse', 'inverse'],
    ['pattern', 'pattern'],
  ];
  for (const [a, b] of map) {
    const value = str(x[a]);
    if (value !== undefined) (out as any)[b] = value;
  }
  for (const [a, b] of [
    ['required', 'required'],
    ['recommended', 'recommended'],
    ['multivalued', 'multivalued'],
    ['list_elements_unique', 'listElementsUnique'],
    ['identifier', 'identifier'],
    ['key', 'key'],
    ['inlined', 'inlined'],
    ['designates_type', 'designatesType'],
  ] as const) {
    const value = bool(x[a]);
    if (value !== undefined) (out as any)[b] = value;
  }
  for (const [a, b] of [
    ['minimum_value', 'minimumValue'],
    ['maximum_value', 'maximumValue'],
  ] as const)
    if (x[a] !== undefined) (out as any)[b] = x[a];
  for (const [a, b] of [
    ['minimum_cardinality', 'minimumCardinality'],
    ['maximum_cardinality', 'maximumCardinality'],
    ['exact_cardinality', 'exactCardinality'],
  ] as const) {
    const value = num(x[a]);
    if (value !== undefined) (out as any)[b] = value;
  }
  const mx = strings(x.mixins);
  if (mx) out.mixins = mx;
  for (const [a, b] of [
    ['any_of', 'anyOf'],
    ['all_of', 'allOf'],
    ['none_of', 'noneOf'],
    ['exactly_one_of', 'exactlyOneOf'],
  ] as const)
    if (Array.isArray(x[a])) (out as any)[b] = x[a].map(expression);
  const ann = annotations(x.annotations);
  if (ann) out.annotations = ann;
  out.extra = extras(x, knownSlot);
  return out;
}
function classExpr(v: unknown): ClassExpr {
  const x = obj(v),
    out: ClassExpr = {};
  const ia = str(x.is_a);
  if (ia) out.isA = ia;
  const sc = obj(x.slot_conditions);
  if (Object.keys(sc).length)
    out.slotConditions = Object.fromEntries(Object.entries(sc).map(([k, y]) => [k, expression(y)]));
  for (const [a, b] of [
    ['any_of', 'anyOf'],
    ['all_of', 'allOf'],
    ['none_of', 'noneOf'],
    ['exactly_one_of', 'exactlyOneOf'],
  ] as const)
    if (Array.isArray(x[a])) (out as any)[b] = x[a].map(classExpr);
  out.extra = extras(
    x,
    new Set(['is_a', 'slot_conditions', 'any_of', 'all_of', 'none_of', 'exactly_one_of']),
  );
  return out;
}
function decode(raw: unknown, source?: string): AssertedSchema {
  const x = obj(raw),
    schema: AssertedSchema = { classes: {}, slots: {}, types: {}, enums: {} };
  schema.defaultRange = 'string';
  for (const [a, b] of [
    ['id', 'id'],
    ['name', 'name'],
    ['default_range', 'defaultRange'],
    ['default_prefix', 'defaultPrefix'],
  ] as const) {
    const v = str(x[a]);
    if (v) (schema as any)[b] = v;
  }
  const imports = strings(x.imports);
  if (imports) schema.imports = imports;
  const prefixes = obj(x.prefixes);
  if (Object.values(prefixes).every((v) => typeof v === 'string'))
    schema.prefixes = prefixes as Record<string, string>;
  const ann = annotations(x.annotations);
  if (ann) schema.annotations = ann;
  for (const [name, value] of Object.entries(obj(x.slots))) schema.slots[name] = slot(value);
  for (const [name, value] of Object.entries(obj(x.classes))) {
    const c = obj(value),
      out: ClassDef = {};
    for (const [a, b] of [
      ['description', 'description'],
      ['class_uri', 'classUri'],
      ['from_schema', 'fromSchema'],
      ['is_a', 'isA'],
    ] as const) {
      const v = str(c[a]);
      if (v) (out as any)[b] = v;
    }
    for (const [a, b] of [
      ['abstract', 'abstract'],
      ['mixin', 'mixin'],
    ] as const) {
      const v = bool(c[a]);
      if (v !== undefined) (out as any)[b] = v;
    }
    const sl = strings(c.slots);
    if (sl) out.slots = sl;
    const mx = strings(c.mixins);
    if (mx) out.mixins = mx;
    const attrs = obj(c.attributes);
    if (Object.keys(attrs).length)
      out.attributes = Object.fromEntries(Object.entries(attrs).map(([k, y]) => [k, slot(y)]));
    const usage = obj(c.slot_usage);
    if (Object.keys(usage).length)
      out.slotUsage = Object.fromEntries(Object.entries(usage).map(([k, y]) => [k, slot(y)]));
    if (Array.isArray(c.classification_rules))
      out.classificationRules = c.classification_rules.map(classExpr);
    const record = Object.fromEntries(
      ['any_of', 'all_of', 'none_of', 'exactly_one_of']
        .filter((key) => c[key] !== undefined)
        .map((key) => [key, c[key]]),
    );
    if (Object.keys(record).length) out.recordConstraints = [classExpr(record)];
    if (Array.isArray(c.rules))
      out.rules = c.rules.map((rule: unknown) => {
        const r = obj(rule);
        return {
          ...(r.preconditions === undefined ? {} : { preconditions: classExpr(r.preconditions) }),
          postconditions: classExpr(r.postconditions),
          extra: extras(r, new Set(['preconditions', 'postconditions'])),
        };
      });
    const keys = obj(c.unique_keys);
    if (Object.keys(keys).length)
      out.uniqueKeys = Object.fromEntries(
        Object.entries(keys).map(([k, y]) => [
          k,
          {
            uniqueKeySlots: strings(obj(y).unique_key_slots) ?? [],
            extra: extras(obj(y), new Set(['unique_key_slots'])),
          },
        ]),
      );
    if (c.extra_slots !== undefined)
      out.extraSlots = {
        allowed: bool(obj(c.extra_slots).allowed),
        rangeExpression: obj(obj(c.extra_slots).range_expression),
        extra: extras(obj(c.extra_slots), new Set(['allowed', 'range_expression'])),
      };
    const ca = annotations(c.annotations);
    if (ca) out.annotations = ca;
    out.extra = extras(
      c,
      new Set([
        'description',
        'class_uri',
        'from_schema',
        'is_a',
        'mixins',
        'abstract',
        'mixin',
        'slots',
        'attributes',
        'slot_usage',
        'classification_rules',
        'any_of',
        'all_of',
        'none_of',
        'exactly_one_of',
        'rules',
        'unique_keys',
        'extra_slots',
        'annotations',
      ]),
    );
    schema.classes[name] = out;
  }
  for (const [name, value] of Object.entries(obj(x.types))) {
    const t = obj(value),
      out: TypeDef = {
        typeof: str(t.typeof),
        base: str(t.base),
        pattern: str(t.pattern),
        minimumValue: t.minimum_value,
        maximumValue: t.maximum_value,
        extra: extras(
          t,
          new Set(['description', 'typeof', 'base', 'pattern', 'minimum_value', 'maximum_value']),
        ),
      };
    schema.types[name] = out;
  }
  for (const [name, value] of Object.entries(obj(x.enums))) {
    const e = obj(value);
    schema.enums[name] = {
      permissibleValues: obj(e.permissible_values),
      extra: extras(e, new Set(['description', 'permissible_values'])),
    };
  }
  schema.extra = extras(
    x,
    new Set([
      'id',
      'name',
      'description',
      'default_range',
      'imports',
      'prefixes',
      'default_prefix',
      'classes',
      'slots',
      'types',
      'enums',
      'annotations',
    ]),
  );
  if (source) schema.sourceFiles = [source];
  return schema;
}

function diagnostic(
  category: DiagnosticCategory,
  code: string,
  message: string,
  source?: string,
  path?: string,
): CompilerDiagnostic {
  const d: CompilerDiagnostic = { category, code, message };
  if (source) d.source = source;
  if (path) d.path = path;
  return d;
}

function headingIdentityRules(value: unknown): HeadingIdentityRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const x = obj(item);
    const name = str(x.name);
    const levels = Array.isArray(x.levels)
      ? x.levels.filter(
          (level): level is number => typeof level === 'number' && Number.isInteger(level),
        )
      : [];
    const pattern = str(x.pattern);
    return name && pattern ? [{ name, levels, pattern }] : [];
  });
}

function checkHeadingIdentityAnnotation(
  scope: string,
  value: unknown,
  ds: CompilerDiagnostic[],
): void {
  const path = `${scope}.lore:heading_identity`;
  if (!Array.isArray(value) || value.length === 0) {
    ds.push(
      diagnostic(
        'invalid-schema',
        'INVALID_HEADING_IDENTITY',
        `${path} must be a non-empty list`,
        undefined,
        path,
      ),
    );
    return;
  }
  const names = new Set<string>();
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      ds.push(
        diagnostic(
          'invalid-schema',
          'INVALID_HEADING_IDENTITY',
          `${itemPath} must be a mapping`,
          undefined,
          itemPath,
        ),
      );
      continue;
    }
    const x = item as Record<string, unknown>;
    if (typeof x.name !== 'string' || !x.name.trim())
      ds.push(
        diagnostic(
          'invalid-schema',
          'INVALID_HEADING_IDENTITY_NAME',
          `${itemPath}.name must be non-empty`,
          undefined,
          `${itemPath}.name`,
        ),
      );
    else if (names.has(x.name))
      ds.push(
        diagnostic(
          'invalid-schema',
          'DUPLICATE_HEADING_IDENTITY_NAME',
          `duplicate heading identity rule name ${x.name}`,
          undefined,
          `${itemPath}.name`,
        ),
      );
    else names.add(x.name);
    if (
      !Array.isArray(x.levels) ||
      x.levels.length === 0 ||
      !x.levels.every(
        (level) => typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6,
      )
    )
      ds.push(
        diagnostic(
          'invalid-schema',
          'INVALID_HEADING_IDENTITY_LEVELS',
          `${itemPath}.levels must contain integers from 1 through 6`,
          undefined,
          `${itemPath}.levels`,
        ),
      );
    if (typeof x.pattern !== 'string' || !x.pattern)
      ds.push(
        diagnostic(
          'invalid-schema',
          'INVALID_HEADING_IDENTITY_PATTERN',
          `${itemPath}.pattern must be a string`,
          undefined,
          `${itemPath}.pattern`,
        ),
      );
    else {
      if (!x.pattern.startsWith('^') || !x.pattern.endsWith('$'))
        ds.push(
          diagnostic(
            'invalid-schema',
            'HEADING_IDENTITY_ANCHORS',
            `${itemPath}.pattern must be fully anchored with ^ and $`,
            undefined,
            `${itemPath}.pattern`,
          ),
        );
      if (!/\(\?<id>/.test(x.pattern) || !/\(\?<title>/.test(x.pattern))
        ds.push(
          diagnostic(
            'invalid-schema',
            'HEADING_IDENTITY_GROUPS',
            `${itemPath}.pattern must expose named id and title groups`,
            undefined,
            `${itemPath}.pattern`,
          ),
        );
      try {
        // Compilation validates ECMAScript syntax and duplicate named groups.
        new RegExp(x.pattern);
      } catch (error) {
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_HEADING_IDENTITY_REGEX',
            `${itemPath}.pattern is not a valid ECMAScript regular expression: ${String(error)}`,
            undefined,
            `${itemPath}.pattern`,
          ),
        );
      }
    }
  }
}
function shapeDiagnostics(raw: unknown, source: string): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  const root = obj(raw);
  const isMapping = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const validKind = (value: unknown, kind: string): boolean => {
    if (kind === 'boolean') return typeof value === 'boolean';
    if (kind === 'string') return typeof value === 'string';
    if (kind === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (kind === 'sequence') return Array.isArray(value);
    if (kind === 'scalar')
      return value === null || (typeof value !== 'object' && !Array.isArray(value));
    return isMapping(value);
  };
  const checkFields = (
    scope: string,
    item: Record<string, unknown>,
    fields: Record<string, string>,
  ): void => {
    for (const [field, kind] of Object.entries(fields)) {
      const current = item[field];
      if (current !== undefined && !validKind(current, kind))
        result.push(
          diagnostic(
            'parse',
            'INVALID_FIELD_SHAPE',
            `${scope}.${field} has invalid ${kind} shape`,
            source,
            `${scope}.${field}`,
          ),
        );
    }
  };
  const slotFields: Record<string, string> = {
    description: 'string',
    is_a: 'string',
    range: 'string',
    inverse: 'string',
    pattern: 'string',
    required: 'boolean',
    recommended: 'boolean',
    multivalued: 'boolean',
    list_elements_unique: 'boolean',
    identifier: 'boolean',
    key: 'boolean',
    inlined: 'boolean',
    designates_type: 'boolean',
    mixins: 'sequence',
    minimum_value: 'scalar',
    maximum_value: 'scalar',
    minimum_cardinality: 'integer',
    maximum_cardinality: 'integer',
    exact_cardinality: 'integer',
    any_of: 'sequence',
    all_of: 'sequence',
    none_of: 'sequence',
    exactly_one_of: 'sequence',
    annotations: 'mapping',
  };
  const expressionFields: Record<string, string> = {
    range: 'string',
    required: 'boolean',
    value_presence: 'string',
    equals_string: 'string',
    equals_string_in: 'sequence',
    pattern: 'string',
    minimum_cardinality: 'integer',
    maximum_cardinality: 'integer',
    exact_cardinality: 'integer',
    any_of: 'sequence',
    all_of: 'sequence',
    none_of: 'sequence',
    exactly_one_of: 'sequence',
  };
  const checkExpression = (scope: string, value: unknown): void => {
    if (!isMapping(value)) {
      result.push(
        diagnostic('parse', 'INVALID_MAPPING', `${scope} must be a mapping`, source, scope),
      );
      return;
    }
    checkFields(scope, value, expressionFields);
    for (const name of ['any_of', 'all_of', 'none_of', 'exactly_one_of']) {
      const children = value[name];
      if (!Array.isArray(children)) continue;
      for (const [index, child] of children.entries())
        checkExpression(`${scope}.${name}[${index}]`, child);
    }
  };
  const checkClassExpression = (scope: string, value: unknown): void => {
    if (!isMapping(value)) {
      result.push(
        diagnostic('parse', 'INVALID_MAPPING', `${scope} must be a mapping`, source, scope),
      );
      return;
    }
    checkFields(scope, value, {
      is_a: 'string',
      slot_conditions: 'mapping',
      any_of: 'sequence',
      all_of: 'sequence',
      none_of: 'sequence',
      exactly_one_of: 'sequence',
    });
    if (value.slot_conditions !== undefined && isMapping(value.slot_conditions))
      for (const [name, condition] of Object.entries(value.slot_conditions))
        checkExpression(`${scope}.slot_conditions.${name}`, condition);
    for (const name of ['any_of', 'all_of', 'none_of', 'exactly_one_of']) {
      const children = value[name];
      if (!Array.isArray(children)) continue;
      for (const [index, child] of children.entries())
        checkClassExpression(`${scope}.${name}[${index}]`, child);
    }
  };
  const checkSlotMap = (scope: string, value: unknown): void => {
    if (value === undefined) return;
    if (!isMapping(value)) {
      result.push(
        diagnostic('parse', 'INVALID_MAPPING', `${scope} must be a mapping`, source, scope),
      );
      return;
    }
    for (const [name, itemValue] of Object.entries(value)) {
      const itemScope = `${scope}.${name}`;
      if (!isMapping(itemValue)) {
        result.push(
          diagnostic(
            'parse',
            'INVALID_MAPPING',
            `${itemScope} must be a mapping`,
            source,
            itemScope,
          ),
        );
        continue;
      }
      checkFields(itemScope, itemValue, slotFields);
      if (
        Array.isArray(itemValue.mixins) &&
        !itemValue.mixins.every((x: unknown) => typeof x === 'string')
      )
        result.push(
          diagnostic(
            'parse',
            'INVALID_FIELD_SHAPE',
            `${itemScope}.mixins entries must be strings`,
            source,
            `${itemScope}.mixins`,
          ),
        );
      for (const expressionName of ['any_of', 'all_of', 'none_of', 'exactly_one_of']) {
        const expressions = itemValue[expressionName];
        if (!Array.isArray(expressions)) continue;
        for (const [index, expressionValue] of expressions.entries())
          checkExpression(`${itemScope}.${expressionName}[${index}]`, expressionValue);
      }
    }
  };
  for (const section of ['classes', 'slots', 'types', 'enums'] as const)
    if (
      root[section] !== undefined &&
      (root[section] === null || typeof root[section] !== 'object' || Array.isArray(root[section]))
    )
      result.push(
        diagnostic('parse', 'INVALID_MAPPING', `${section} must be a mapping`, source, section),
      );
  const checkMap = (section: string, fields: Record<string, string>) => {
    const map = obj(root[section]);
    for (const [name, value] of Object.entries(map)) {
      const item = obj(value);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        result.push(
          diagnostic(
            'parse',
            'INVALID_MAPPING',
            `${section}.${name} must be a mapping`,
            source,
            `${section}.${name}`,
          ),
        );
        continue;
      }
      checkFields(`${section}.${name}`, item, fields);
      for (const field of ['mixins', 'slots'])
        if (Array.isArray(item[field]) && !item[field].every((x: unknown) => typeof x === 'string'))
          result.push(
            diagnostic(
              'parse',
              'INVALID_FIELD_SHAPE',
              `${section}.${name}.${field} entries must be strings`,
              source,
              `${section}.${name}.${field}`,
            ),
          );
      if (section === 'classes') {
        checkSlotMap(`${section}.${name}.attributes`, item.attributes);
        checkSlotMap(`${section}.${name}.slot_usage`, item.slot_usage);
        if (item.unique_keys !== undefined) {
          if (!isMapping(item.unique_keys))
            result.push(
              diagnostic(
                'parse',
                'INVALID_MAPPING',
                `${section}.${name}.unique_keys must be a mapping`,
                source,
                `${section}.${name}.unique_keys`,
              ),
            );
          else
            for (const [keyName, keyValue] of Object.entries(item.unique_keys)) {
              const keyScope = `${section}.${name}.unique_keys.${keyName}`;
              if (!isMapping(keyValue))
                result.push(
                  diagnostic(
                    'parse',
                    'INVALID_MAPPING',
                    `${keyScope} must be a mapping`,
                    source,
                    keyScope,
                  ),
                );
              else {
                checkFields(keyScope, keyValue, { unique_key_slots: 'sequence' });
                if (
                  Array.isArray(keyValue.unique_key_slots) &&
                  !keyValue.unique_key_slots.every((x: unknown) => typeof x === 'string')
                )
                  result.push(
                    diagnostic(
                      'parse',
                      'INVALID_FIELD_SHAPE',
                      `${keyScope}.unique_key_slots entries must be strings`,
                      source,
                      `${keyScope}.unique_key_slots`,
                    ),
                  );
              }
            }
        }
        if (item.extra_slots !== undefined) {
          const extraScope = `${section}.${name}.extra_slots`;
          if (!isMapping(item.extra_slots))
            result.push(
              diagnostic(
                'parse',
                'INVALID_MAPPING',
                `${extraScope} must be a mapping`,
                source,
                extraScope,
              ),
            );
          else {
            checkFields(extraScope, item.extra_slots, {
              allowed: 'boolean',
              range_expression: 'mapping',
            });
          }
        }
        for (const key of ['any_of', 'all_of', 'none_of', 'exactly_one_of'])
          if (Array.isArray(item[key]))
            for (const [i, value] of item[key].entries())
              checkClassExpression(`${section}.${name}.${key}[${i}]`, value);
        if (Array.isArray(item.rules))
          for (const [i, rule] of item.rules.entries()) {
            const scope = `${section}.${name}.rules[${i}]`;
            if (!isMapping(rule)) {
              result.push(
                diagnostic('parse', 'INVALID_MAPPING', `${scope} must be a mapping`, source, scope),
              );
              continue;
            }
            checkFields(scope, rule, { preconditions: 'mapping', postconditions: 'mapping' });
            if (rule.postconditions === undefined)
              result.push(
                diagnostic(
                  'parse',
                  'INVALID_FIELD_SHAPE',
                  `${scope}.postconditions is required`,
                  source,
                  `${scope}.postconditions`,
                ),
              );
            for (const key of ['preconditions', 'postconditions'])
              if (rule[key] !== undefined) checkClassExpression(`${scope}.${key}`, rule[key]);
          }
        if (Array.isArray(item.classification_rules))
          for (const [index, expressionValue] of item.classification_rules.entries())
            checkClassExpression(
              `${section}.${name}.classification_rules[${index}]`,
              expressionValue,
            );
      }
    }
  };
  checkMap('slots', slotFields);
  checkMap('classes', {
    is_a: 'string',
    mixins: 'sequence',
    slots: 'sequence',
    attributes: 'mapping',
    slot_usage: 'mapping',
    classification_rules: 'sequence',
    any_of: 'sequence',
    all_of: 'sequence',
    none_of: 'sequence',
    exactly_one_of: 'sequence',
    rules: 'sequence',
  });
  checkMap('types', {
    typeof: 'string',
    base: 'string',
    pattern: 'string',
    minimum_value: 'scalar',
    maximum_value: 'scalar',
  });
  checkMap('enums', { permissible_values: 'mapping' });
  if (root.imports !== undefined && !Array.isArray(root.imports))
    result.push(
      diagnostic(
        'parse',
        'INVALID_FIELD_SHAPE',
        'imports has invalid sequence shape',
        source,
        'imports',
      ),
    );
  else if (
    Array.isArray(root.imports) &&
    !root.imports.every((x: unknown) => typeof x === 'string')
  )
    result.push(
      diagnostic(
        'parse',
        'INVALID_FIELD_SHAPE',
        'imports entries must be strings',
        source,
        'imports',
      ),
    );
  for (const field of ['id', 'name', 'default_range', 'default_prefix'])
    if (root[field] !== undefined && typeof root[field] !== 'string')
      result.push(
        diagnostic(
          'parse',
          'INVALID_FIELD_SHAPE',
          `${field} has invalid string shape`,
          source,
          field,
        ),
      );
  if (root.annotations !== undefined && !isMapping(root.annotations))
    result.push(
      diagnostic(
        'parse',
        'INVALID_MAPPING',
        'annotations must be a mapping',
        source,
        'annotations',
      ),
    );
  if (root.prefixes !== undefined) {
    if (!isMapping(root.prefixes))
      result.push(
        diagnostic('parse', 'INVALID_MAPPING', 'prefixes must be a mapping', source, 'prefixes'),
      );
    else if (!Object.values(root.prefixes).every((x) => typeof x === 'string'))
      result.push(
        diagnostic(
          'parse',
          'INVALID_FIELD_SHAPE',
          'prefixes entries must be strings',
          source,
          'prefixes',
        ),
      );
  }
  const typeMap = obj(root.types);
  for (const [name, value] of Object.entries(typeMap))
    if (isMapping(value))
      checkFields(`types.${name}`, value, {
        typeof: 'string',
        base: 'string',
        pattern: 'string',
        minimum_value: 'scalar',
        maximum_value: 'scalar',
      });
  const enumMap = obj(root.enums);
  for (const [name, value] of Object.entries(enumMap)) {
    const scope = `enums.${name}`;
    if (!isMapping(value)) continue;
    if (value.permissible_values !== undefined && !isMapping(value.permissible_values))
      result.push(
        diagnostic(
          'parse',
          'INVALID_MAPPING',
          `${scope}.permissible_values must be a mapping`,
          source,
          `${scope}.permissible_values`,
        ),
      );
  }
  return result;
}
function isBuiltinImport(value: string): boolean {
  return value === 'linkml:types' || value.startsWith('https://w3id.org/linkml/types');
}
type ImportResolution = { path?: string; outside?: string };
function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return Boolean(
    relativePath &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(relativePath),
  );
}
async function importPath(
  dir: string,
  value: string,
  allowedRoot?: string,
): Promise<ImportResolution> {
  if (
    isAbsolute(value) ||
    isBuiltinImport(value) ||
    value.includes('://') ||
    (value.includes(':') && !value.startsWith('./') && !value.startsWith('../'))
  )
    return {};
  const candidates = [resolve(dir, value)];
  if (!['.yaml', '.yml'].includes(extname(value).toLowerCase()))
    candidates.push(resolve(dir, `${value}.yaml`), resolve(dir, `${value}.yml`));
  for (const candidate of candidates) {
    if (allowedRoot && !isWithinRoot(allowedRoot, candidate)) return { outside: candidate };
    try {
      await access(candidate);
      return { path: candidate };
    } catch {
      /* continue */
    }
  }
  return {};
}
async function resolveClosure(
  root: string,
  options: CompileSchemaOptions = {},
): Promise<{ schema: AssertedSchema; dependencies: string[]; diagnostics: CompilerDiagnostic[] }> {
  const loaded = new Map<string, AssertedSchema>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const diagnostics: CompilerDiagnostic[] = [];
  async function visit(path: string): Promise<void> {
    const abs = resolve(path);
    if (loaded.has(abs)) return;
    if (visiting.has(abs)) {
      diagnostics.push(
        diagnostic('composition', 'IMPORT_CYCLE', `LinkML import cycle at ${abs}`, abs),
      );
      return;
    }
    visiting.add(abs);
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch (e) {
      diagnostics.push(
        diagnostic('composition', 'IMPORT_READ', `Cannot read schema ${abs}: ${String(e)}`, abs),
      );
      visiting.delete(abs);
      return;
    }
    let parsed: unknown;
    try {
      const doc = parseDocument(text);
      if (doc.errors.length) throw new Error(String(doc.errors[0]));
      parsed = doc.toJS();
    } catch (e) {
      diagnostics.push(diagnostic('parse', 'YAML_PARSE', String(e), abs));
      visiting.delete(abs);
      return;
    }
    diagnostics.push(...shapeDiagnostics(parsed, abs));
    const current = decode(parsed, abs);
    const origin = current.id ?? `file://${abs}`;
    for (const definition of Object.values(current.classes))
      if (!definition.fromSchema) {
        definition.fromSchema = origin;
        generatedClassOrigins.add(definition);
      }
    for (const imp of current.imports ?? []) {
      if (isBuiltinImport(imp)) continue;
      const child = await importPath(dirname(abs), imp, options.allowedRoot);
      if (child.outside) {
        diagnostics.push(
          diagnostic(
            'composition',
            'IMPORT_OUTSIDE_ALLOWED_ROOT',
            `Local LinkML import ${imp} escapes allowed root ${options.allowedRoot}`,
            abs,
            'imports',
          ),
        );
        continue;
      }
      if (!child.path) {
        diagnostics.push(
          diagnostic(
            'composition',
            'NON_LOCAL_IMPORT',
            `Unsupported/non-local LinkML import ${imp}`,
            abs,
            'imports',
          ),
        );
        continue;
      }
      await visit(child.path);
    }
    visiting.delete(abs);
    loaded.set(abs, current);
    order.push(abs);
  }
  const normalizedRoot = resolve(root);
  if (options.allowedRoot && !isWithinRoot(options.allowedRoot, normalizedRoot)) {
    diagnostics.push(
      diagnostic(
        'composition',
        'IMPORT_OUTSIDE_ALLOWED_ROOT',
        `Schema entrypoint escapes allowed root ${options.allowedRoot}`,
        normalizedRoot,
      ),
    );
  } else {
    await visit(normalizedRoot);
  }
  const merged: AssertedSchema = {
    ...loaded.get(normalizedRoot),
    classes: {},
    slots: {},
    types: {},
    enums: {},
    prefixes: {},
    sourceFiles: order,
  };
  const composedSources: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const abs of order) {
    const current = loaded.get(abs);
    if (!current) continue;
    const sourceDeclarations = current.annotations?.[SOURCES_ANNOTATION];
    if (sourceDeclarations !== undefined) {
      if (
        !sourceDeclarations ||
        typeof sourceDeclarations !== 'object' ||
        Array.isArray(sourceDeclarations)
      ) {
        diagnostics.push(
          diagnostic(
            'invalid-schema',
            'INVALID_SOURCES',
            'lore:sources must be a mapping',
            abs,
            SOURCES_ANNOTATION,
          ),
        );
      } else {
        merged.annotations = { ...merged.annotations, [SOURCES_ANNOTATION]: composedSources };
        const target = composedSources;
        for (const [name, declaration] of Object.entries(sourceDeclarations)) {
          if (Object.hasOwn(target, name))
            diagnostics.push(
              diagnostic(
                'composition',
                'DUPLICATE_SOURCE',
                `Duplicate source ${name}`,
                abs,
                `${SOURCES_ANNOTATION}.${name}`,
              ),
            );
          else
            Object.defineProperty(target, name, {
              value: declaration,
              enumerable: true,
              configurable: true,
              writable: true,
            });
        }
      }
    }
    for (const [k, v] of Object.entries(current.prefixes ?? {})) {
      if (merged.prefixes?.[k] && merged.prefixes[k] !== v)
        diagnostics.push(
          diagnostic(
            'composition',
            'PREFIX_CONFLICT',
            `combine import closure: prefix "${k}" maps to both "${v}" and "${merged.prefixes[k]}" across imports`,
            abs,
            `prefixes.${k}`,
          ),
        );
      else merged.prefixes![k] = v;
    }
    const sections: Array<[string, Record<string, unknown>]> = [
      ['classes', merged.classes],
      ['slots', merged.slots],
      ['types', merged.types],
      ['enums', merged.enums],
    ];
    for (const [kind, target] of sections)
      for (const [name, value] of Object.entries(
        (current as any)[kind] as Record<string, unknown>,
      )) {
        if (target[name])
          diagnostics.push(
            diagnostic(
              'composition',
              'DUPLICATE_DEFINITION',
              `Duplicate ${kind.substring(0, kind.length - 1)} ${name}`,
              abs,
              `${kind}.${name}`,
            ),
          );
        else (target as any)[name] = value;
      }
  }
  if (Object.keys(merged.prefixes!).length === 0) delete merged.prefixes;
  return { schema: merged, dependencies: [...order].sort(), diagnostics };
}

function checkProfile(s: AssertedSchema): CompilerDiagnostic[] {
  const ds: CompilerDiagnostic[] = [];
  const allowedSchema = new Set([
    ...common,
    'description',
    'version',
    'license',
    'prefixes',
    'default_prefix',
    'default_curi_maps',
    'settings',
    'source_file',
    'emit_prefixes',
  ]);
  const allowedClass = new Set([...common, 'class_uri']);
  const allowedType = new Set([...common, 'uri', 'type_uri', 'repr']);
  const allowedEnum = new Set([...common, 'enum_uri']);
  const checkExtra = (
    scope: string,
    extra: Record<string, unknown> | undefined,
    allowed: Set<string>,
  ) => {
    for (const k of Object.keys(extra ?? {}))
      if (!allowed.has(k))
        ds.push(
          diagnostic(
            'unsupported-profile',
            'UNSUPPORTED_METASLOT',
            `${scope} uses unsupported semantic metaslot ${k}`,
            undefined,
            `${scope}.${k}`,
          ),
        );
  };
  const checkAnn = (scope: string, ann: Annotations | undefined) => {
    for (const [k, v] of Object.entries(ann ?? {})) {
      if (!k.startsWith('lore:')) continue;
      if (!SUPPORTED_LORE_ANNOTATIONS.includes(k as any))
        ds.push(
          diagnostic(
            'unsupported-profile',
            'UNSUPPORTED_LORE_ANNOTATION',
            `${scope} uses unsupported Lore annotation ${k}`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if ((k === 'lore:heading_identity' || k === SOURCES_ANNOTATION) && scope !== 'schema') {
        ds.push(
          diagnostic(
            'invalid-schema',
            k === SOURCES_ANNOTATION ? 'SOURCES_SCOPE' : 'HEADING_IDENTITY_SCOPE',
            `${scope} uses schema-level-only Lore annotation ${k}`,
            undefined,
            `${scope}.${k}`,
          ),
        );
        continue;
      }
      if (
        k === 'lore:explore_roles' &&
        !(
          (typeof v === 'string' || Array.isArray(v)) &&
          (Array.isArray(v) ? v : [v]).every((x) =>
            ['identity', 'title', 'summary', 'card', 'hidden'].includes(String(x)),
          )
        )
      )
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_ANNOTATION_VALUE',
            `${scope} has invalid explore roles`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (
        k === 'lore:explore_views' &&
        !(
          (typeof v === 'string' || Array.isArray(v)) &&
          (Array.isArray(v) ? v : [v]).every((x) =>
            ['overview', 'card', 'tree', 'neighborhood', 'impact'].includes(String(x)),
          )
        )
      )
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_ANNOTATION_VALUE',
            `${scope} has invalid explore views`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (
        k === 'lore:explore_relation' &&
        !['hierarchy', 'dependency', 'reference', 'context'].includes(String(v))
      )
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_ANNOTATION_VALUE',
            `${scope} has invalid explore relation`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (k === 'lore:explore_label' && (typeof v !== 'string' || !v.trim()))
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_ANNOTATION_VALUE',
            `${scope} has invalid explore label`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (k === 'lore:explore_order' && (typeof v !== 'number' || !Number.isInteger(v)))
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_ANNOTATION_VALUE',
            `${scope} has invalid explore order`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (
        k === 'lore:markdown_selectors' &&
        (!Array.isArray(v) ||
          !v.every((x) => typeof x === 'string' && /^#{1,6}\s*\S/.test(x.trim())))
      )
        ds.push(
          diagnostic(
            'invalid-schema',
            'INVALID_MARKDOWN_SELECTOR',
            `${scope} has invalid Markdown selectors`,
            undefined,
            `${scope}.${k}`,
          ),
        );
      if (k === 'lore:markdown_reference_column') {
        const spec =
          v && typeof v === 'object' && !Array.isArray(v)
            ? (v as Record<string, unknown>)
            : undefined;
        if (
          !spec ||
          Object.keys(spec).length !== 2 ||
          typeof spec.heading !== 'string' ||
          !/^#{1,6}\s*\S/.test(spec.heading.trim()) ||
          typeof spec.column !== 'string' ||
          !spec.column.trim()
        )
          ds.push(
            diagnostic(
              'invalid-schema',
              'INVALID_MARKDOWN_REFERENCE_COLUMN',
              `${scope} requires exactly heading and column strings`,
              undefined,
              `${scope}.${k}`,
            ),
          );
      }
      if (k === 'lore:heading_identity') checkHeadingIdentityAnnotation(scope, v, ds);
    }
  };
  const checkSlot = (scope: string, x: SlotDef | undefined) => {
    if (!x) return;
    checkExtra(scope, x.extra, new Set([...common, 'slot_uri']));
    checkAnn(scope, x.annotations);
    for (const expr of [
      ...(x.anyOf ?? []),
      ...(x.allOf ?? []),
      ...(x.noneOf ?? []),
      ...(x.exactlyOneOf ?? []),
    ])
      checkExpr(`${scope}.expression`, expr);
  };
  const checkExpr = (scope: string, x: SlotExpr) => {
    checkExtra(scope, x.extra, new Set());
    if (x.valuePresence !== undefined && !['PRESENT', 'ABSENT'].includes(x.valuePresence))
      ds.push(
        diagnostic(
          'invalid-schema',
          'INVALID_PRESENCE',
          `${scope} value_presence must be PRESENT or ABSENT`,
          undefined,
          scope,
        ),
      );
    for (const e of [
      ...(x.anyOf ?? []),
      ...(x.allOf ?? []),
      ...(x.noneOf ?? []),
      ...(x.exactlyOneOf ?? []),
    ])
      checkExpr(`${scope}.expression`, e);
  };
  const checkRecord = (scope: string, expression: ClassExpr) => {
    checkExtra(scope, expression.extra, new Set());
    if (expression.isA !== undefined)
      ds.push(
        diagnostic(
          'unsupported-profile',
          'UNSUPPORTED_METASLOT',
          `${scope}.is_a is outside record validation`,
          undefined,
          `${scope}.is_a`,
        ),
      );
    for (const [name, condition] of Object.entries(expression.slotConditions ?? {}))
      checkExpr(`${scope}.slot_conditions.${name}`, condition);
    for (const group of ['anyOf', 'allOf', 'noneOf', 'exactlyOneOf'] as const)
      if (expression[group]?.length === 0)
        ds.push(
          diagnostic(
            'invalid-schema',
            'EMPTY_RECORD_GROUP',
            `${scope}.${group} must contain an expression`,
            undefined,
            `${scope}.${group}`,
          ),
        );
    for (const group of ['anyOf', 'allOf', 'noneOf', 'exactlyOneOf'] as const)
      for (const [i, child] of (expression[group] ?? []).entries())
        checkRecord(`${scope}.${group}[${i}]`, child);
  };
  checkExtra('schema', s.extra, allowedSchema);
  checkAnn('schema', s.annotations);
  for (const [kind, definitions] of [
    ['type', s.types],
    ['enum', s.enums],
  ] as const)
    for (const [name, definition] of Object.entries(definitions))
      if (Object.hasOwn(annotations(definition.extra?.annotations) ?? {}, SOURCES_ANNOTATION))
        ds.push(
          diagnostic(
            'invalid-schema',
            'SOURCES_SCOPE',
            `${kind}.${name} uses schema-level-only Lore annotation ${SOURCES_ANNOTATION}`,
            undefined,
            `${kind}.${name}.annotations.${SOURCES_ANNOTATION}`,
          ),
        );
  for (const [name, c] of Object.entries(s.classes)) {
    checkExtra(`class.${name}`, c.extra, allowedClass);
    checkAnn(`class.${name}`, c.annotations);
    if (c.extraSlots?.rangeExpression && Object.keys(c.extraSlots.rangeExpression).length)
      ds.push(
        diagnostic(
          'unsupported-profile',
          'UNSUPPORTED_OPERATIONAL',
          'extra_slots.range_expression is outside Profile v1',
          undefined,
          `class.${name}.extra_slots.range_expression`,
        ),
      );
    for (const [sn, a] of Object.entries(c.attributes ?? {}))
      checkSlot(`class.${name}.attribute.${sn}`, a);
    for (const [sn, a] of Object.entries(c.slotUsage ?? {}))
      checkSlot(`class.${name}.slot_usage.${sn}`, a);
    for (const [i, r] of (c.recordConstraints ?? []).entries())
      checkRecord(`class.${name}.constraints[${i}]`, r);
    for (const [i, r] of (c.rules ?? []).entries()) {
      const scope = `class.${name}.rules[${i}]`;
      checkExtra(scope, r.extra, common);
      if (r.preconditions) checkRecord(`${scope}.preconditions`, r.preconditions);
      checkRecord(`${scope}.postconditions`, r.postconditions);
    }
    for (const [i, r] of (c.classificationRules ?? []).entries())
      checkClassExpr(`class.${name}.classification_rules.${i}`, r);
  }
  for (const [name, x] of Object.entries(s.slots)) checkSlot(`slot.${name}`, x);
  for (const [name, t] of Object.entries(s.types)) checkExtra(`type.${name}`, t.extra, allowedType);
  for (const [name, e] of Object.entries(s.enums)) checkExtra(`enum.${name}`, e.extra, allowedEnum);
  return ds;
}
function checkClassExpr(scope: string, x: ClassExpr): CompilerDiagnostic[] {
  const ds: CompilerDiagnostic[] = [];
  if (x.isA)
    ds.push(
      diagnostic(
        'unsupported-profile',
        'UNSUPPORTED_CLASS_RULE',
        'classification is_a is unsupported',
        undefined,
        scope,
      ),
    );
  for (const k of Object.keys(x.extra ?? {}))
    ds.push(
      diagnostic(
        'unsupported-profile',
        'UNSUPPORTED_METASLOT',
        `classification uses unsupported metaslot ${k}`,
        undefined,
        `${scope}.${k}`,
      ),
    );
  for (const [name, e] of Object.entries(x.slotConditions ?? {})) {
    if (
      e.range ||
      e.minimumCardinality !== undefined ||
      e.maximumCardinality !== undefined ||
      e.exactCardinality !== undefined
    )
      ds.push(
        diagnostic(
          'unsupported-profile',
          'UNSUPPORTED_CLASSIFICATION_CONSTRAINT',
          'classification range/cardinality is unsupported',
          undefined,
          `${scope}.slot_conditions.${name}`,
        ),
      );
  }
  for (const list of [x.anyOf, x.allOf, x.noneOf, x.exactlyOneOf])
    for (const y of list ?? []) ds.push(...checkClassExpr(`${scope}.expression`, y));
  return ds;
}

function expand(value: string, prefixes: Record<string, string> | undefined): string {
  if (value.includes('://') || value.startsWith('urn:')) return value;
  const i = value.indexOf(':');
  if (i > 0 && prefixes?.[value.slice(0, i)])
    return prefixes[value.slice(0, i)] + value.slice(i + 1);
  return value;
}
function isSubclass(
  s: AssertedSchema,
  child: string,
  parent: string,
  seen = new Set<string>(),
): boolean {
  if (child === parent) return true;
  if (seen.has(child)) return false;
  seen.add(child);
  const c = s.classes[child];
  return !!c && [...(c.mixins ?? []), c.isA ?? ''].some((p) => p && isSubclass(s, p, parent, seen));
}
function typeSubtype(
  s: AssertedSchema,
  child: string,
  parent: string,
  seen = new Set<string>(),
): boolean {
  if (child.toLowerCase() === parent.toLowerCase()) return true;
  if (primitives.has(child.toLowerCase()) && primitives.has(parent.toLowerCase()))
    return child.toLowerCase() === parent.toLowerCase();
  if (seen.has(child)) return false;
  seen.add(child);
  const t = s.types[child];
  const p = t?.typeof ?? t?.base;
  return !!p && (p.toLowerCase() === parent.toLowerCase() || typeSubtype(s, p, parent, seen));
}
function mergeRange(s: AssertedSchema, high: string, low: string): string {
  if (!high) return low;
  if (!low || high === low) return high;
  if (isSubclass(s, high, low) || typeSubtype(s, high, low)) return high;
  if (isSubclass(s, low, high) || typeSubtype(s, low, high)) return low;
  throw new Error(`incompatible range refinements ${high} and ${low}`);
}
function validateRawReferences(s: AssertedSchema): void {
  const classReachable = (
    className: string,
    slotName: string,
    seen = new Set<string>(),
  ): boolean => {
    if (!className || seen.has(className)) return false;
    seen.add(className);
    const c = s.classes[className];
    if (!c) return false;
    if ((c.slots ?? []).includes(slotName) || c.attributes?.[slotName]) return true;
    return [...(c.mixins ?? []), c.isA ?? ''].some((p) => classReachable(p, slotName, seen));
  };
  for (const [name, c] of Object.entries(s.classes)) {
    if (c.isA && !s.classes[c.isA]) throw new Error(`class ${name} is_a unknown class ${c.isA}`);
    for (const mixin of c.mixins ?? [])
      if (!s.classes[mixin]) throw new Error(`class ${name} mixin unknown class ${mixin}`);
    for (const slotName of c.slots ?? [])
      if (!s.slots[slotName])
        throw new Error(`class ${name} references unknown top-level slot ${slotName}`);
    for (const slotName of Object.keys(c.slotUsage ?? {}))
      if (!classReachable(name, slotName))
        throw new Error(
          `class ${name} slot_usage ${slotName} does not refine an applicable declaration`,
        );
  }
  const walkSlots = (name: string, visiting = new Set<string>()): void => {
    if (visiting.has(name)) throw new Error(`slot inheritance cycle at ${name}`);
    const x = s.slots[name];
    if (!x) throw new Error(`unknown slot ${name}`);
    visiting.add(name);
    for (const parent of [...(x.mixins ?? []), x.isA ?? ''])
      if (parent) walkSlots(parent, visiting);
    visiting.delete(name);
  };
  for (const [name, x] of Object.entries(s.slots)) {
    for (const parent of [...(x.mixins ?? []), x.isA ?? ''])
      if (parent && !s.slots[parent]) throw new Error(`slot ${name} parent unknown slot ${parent}`);
    walkSlots(name);
  }
}
function normalize(s: AssertedSchema): RuntimeSchemaIR {
  validateRawReferences(s);
  const ir: RuntimeSchemaIR = {
    name: s.name ?? '',
    schemaId: s.id,
    classes: {},
    types: {},
    enums: {},
    designators: {},
    headingIdentity: headingIdentityRules(s.annotations?.['lore:heading_identity']) ?? [],
  };
  const typeVisiting = new Set<string>();
  const buildType = (name: string): RuntimeType => {
    if (ir.types[name]) return ir.types[name];
    if (typeVisiting.has(name)) throw new Error(`type inheritance cycle at ${name}`);
    const raw = s.types[name];
    if (!raw) throw new Error(`unknown type ${name}`);
    typeVisiting.add(name);
    const parent =
      raw.typeof && !primitives.has(raw.typeof.toLowerCase()) ? buildType(raw.typeof) : undefined;
    const out: RuntimeType = {
      name,
      base:
        raw.base ??
        (raw.typeof && primitives.has(raw.typeof.toLowerCase())
          ? raw.typeof
          : (parent?.base ?? 'string')),
      patterns: [...(parent?.patterns ?? [])],
    };
    if (raw.pattern && !out.patterns.includes(raw.pattern)) out.patterns.push(raw.pattern);
    if (parent?.minimumValue !== undefined) out.minimumValue = parent.minimumValue;
    if (
      raw.minimumValue !== undefined &&
      (out.minimumValue === undefined || Number(raw.minimumValue) > Number(out.minimumValue))
    )
      out.minimumValue = raw.minimumValue;
    if (parent?.maximumValue !== undefined) out.maximumValue = parent.maximumValue;
    if (
      raw.maximumValue !== undefined &&
      (out.maximumValue === undefined || Number(raw.maximumValue) < Number(out.maximumValue))
    )
      out.maximumValue = raw.maximumValue;
    typeVisiting.delete(name);
    ir.types[name] = out;
    return out;
  };
  for (const name of Object.keys(s.types).sort()) buildType(name);
  for (const [name, e] of Object.entries(s.enums))
    ir.enums[name] = { name, values: Object.keys(e.permissibleValues).sort() };
  const ancestors = (name: string, out: string[] = [], visiting = new Set<string>()): string[] => {
    if (!name) return out;
    if (visiting.has(name)) throw new Error(`class inheritance cycle at ${name}`);
    if (out.includes(name)) return out;
    const c = s.classes[name];
    if (!c) throw new Error(`unknown class ${name}`);
    visiting.add(name);
    out.push(name);
    for (const m of c.mixins ?? []) ancestors(m, out, visiting);
    if (c.isA) ancestors(c.isA, out, visiting);
    visiting.delete(name);
    return out;
  };
  const induce = (slotName: string, ancs: string[]): RuntimeSlot => {
    const out: RuntimeSlot = {
      name: slotName,
      range: '',
      required: false,
      recommended: false,
      multivalued: false,
      identifier: false,
      key: false,
      mode: VALUE_MODE.SCALAR,
      designatesType: false,
      patterns: [],
      anyOf: [],
      allOf: [],
      noneOf: [],
      exactlyOneOf: [],
      annotations: {},
    };
    const apply = (x: SlotDef | undefined, inherited: boolean) => {
      if (!x) return;
      if (!out.description && x.description) out.description = x.description;
      if (!out.slotUri && x.slotUri) out.slotUri = x.slotUri;
      if (x.range) {
        out.range = mergeRange(s, out.range, x.range);
        out.explicitRange = true;
      }
      out.required ||= x.required === true;
      out.recommended ||= x.recommended === true;
      out.multivalued ||= x.multivalued === true;
      if (x.listElementsUnique) out.listElementsUnique = true;
      out.identifier ||= x.identifier === true;
      out.key ||= x.key === true;
      out.designatesType ||= x.designatesType === true;
      if (x.inlined) {
        out.mode = VALUE_MODE.INLINE_OBJECT;
        explicitInlineSlots.add(out);
      }
      if (x.pattern && !out.patterns.includes(x.pattern)) out.patterns.push(x.pattern);
      if (
        x.minimumValue !== undefined &&
        (out.minimumValue === undefined || Number(x.minimumValue) > Number(out.minimumValue))
      )
        out.minimumValue = x.minimumValue;
      if (
        x.maximumValue !== undefined &&
        (out.maximumValue === undefined || Number(x.maximumValue) < Number(out.maximumValue))
      )
        out.maximumValue = x.maximumValue;
      if (!inherited) {
        if (out.inverse === undefined && x.inverse) out.inverse = x.inverse;
        if (out.minimumCardinality === undefined) out.minimumCardinality = x.minimumCardinality;
        if (out.maximumCardinality === undefined) out.maximumCardinality = x.maximumCardinality;
        if (out.exactCardinality === undefined) out.exactCardinality = x.exactCardinality;
        out.anyOf.push(...(x.anyOf ?? []));
        out.allOf.push(...(x.allOf ?? []));
        out.noneOf.push(...(x.noneOf ?? []));
        out.exactlyOneOf.push(...(x.exactlyOneOf ?? []));
      } else {
        if (out.minimumCardinality === undefined) out.minimumCardinality = x.minimumCardinality;
        if (out.maximumCardinality === undefined) out.maximumCardinality = x.maximumCardinality;
        if (out.exactCardinality === undefined) out.exactCardinality = x.exactCardinality;
      }
      for (const [k, v] of Object.entries(x.annotations ?? {}))
        if (!(k in out.annotations)) out.annotations[k] = v;
    };
    for (const cn of ancs) {
      apply(s.classes[cn]?.slotUsage?.[slotName], false);
      apply(s.classes[cn]?.attributes?.[slotName], false);
    }
    const top = s.slots[slotName];
    if (top) {
      apply(top, false);
      const seen = new Set<string>();
      const slotAnc = (n: string) => {
        if (!n || seen.has(n)) return;
        const x = s.slots[n];
        if (!x) throw new Error(`unknown slot ${n}`);
        seen.add(n);
        for (const m of x.mixins ?? []) slotAnc(m);
        if (x.isA) slotAnc(x.isA);
      };
      slotAnc(slotName);
      for (const n of [...seen].slice(1)) apply(s.slots[n], true);
    }
    if (!out.range) out.range = s.defaultRange ?? 'string';
    return out;
  };
  for (const name of Object.keys(s.classes).sort()) {
    const raw = s.classes[name]!;
    const ancs = ancestors(name);
    const applicable: string[] = [];
    for (const cn of ancs) {
      for (const x of s.classes[cn]?.slots ?? []) if (!applicable.includes(x)) applicable.push(x);
      for (const x of Object.keys(s.classes[cn]?.attributes ?? {}).sort())
        if (!applicable.includes(x)) applicable.push(x);
    }
    const slots: Record<string, RuntimeSlot> = {};
    for (const sn of applicable) slots[sn] = induce(sn, ancs);
    for (const x of Object.values(slots)) if (x.identifier || x.key) x.required = true;
    const classOut: RuntimeClass = {
      name,
      typeId: expand(
        raw.classUri ??
          `${raw.fromSchema ?? s.id ?? s.name ?? ''}${(raw.fromSchema ?? s.id ?? s.name) ? '#' : ''}${name}`,
        s.prefixes,
      ),
      title: typeof raw.extra?.title === 'string' ? raw.extra.title : undefined,
      classUri: raw.classUri,
      fromSchema: raw.fromSchema,
      description: raw.description,
      parent: raw.isA,
      mixins: [...(raw.mixins ?? [])],
      abstract: raw.abstract === true,
      mixin: raw.mixin === true,
      slots,
      classificationRules: [...(raw.classificationRules ?? [])],
      recordConstraints: ancs.flatMap((cn) => s.classes[cn]?.recordConstraints ?? []),
      rules: ancs.flatMap((cn) => s.classes[cn]?.rules ?? []),
      uniqueKeys: {},
      allowExtra: raw.extraSlots?.allowed === true,
      depth: Math.max(
        0,
        ...ancs.map((x) => {
          const p = s.classes[x]?.isA;
          return p ? 1 : 0;
        }),
      ),
      annotations: {},
    };
    for (const cn of ancs)
      for (const [k, v] of Object.entries(s.classes[cn]?.annotations ?? {}))
        if (!(k in classOut.annotations)) classOut.annotations[k] = v;
    for (const [kn, key] of Object.entries(
      Object.fromEntries(
        ancs.flatMap((cn) => Object.entries(s.classes[cn]?.uniqueKeys ?? {})).reverse(),
      ),
    ))
      classOut.uniqueKeys[kn] = { name: kn, slots: [...key.uniqueKeySlots] };
    for (const x of Object.values(slots)) {
      if (s.classes[x.range])
        x.mode =
          x.mode === VALUE_MODE.INLINE_OBJECT
            ? x.mode
            : Object.values(ir.classes).find((c) => c.name === x.range)?.slots &&
                Object.values(ir.classes[x.range]?.slots ?? {}).some((z) => z.identifier)
              ? VALUE_MODE.REFERENCE
              : VALUE_MODE.INLINE_OBJECT;
    }
    ir.classes[name] = classOut;
    for (const [sn, x] of Object.entries(slots))
      if (x.designatesType) {
        if (classOut.designatorSlot && classOut.designatorSlot !== sn)
          throw new Error(`class ${name} has multiple type-designator slots`);
        if (!ir.designators[sn]) ir.designators[sn] = {};
        ir.designators[sn][name] = name;
        classOut.designatorSlot = sn;
      }
  }
  for (const c of Object.values(ir.classes))
    for (const x of Object.values(c.slots))
      if (ir.classes[x.range] && !explicitInlineSlots.has(x)) {
        const targetClass = ir.classes[x.range]!;
        x.mode = Object.values(targetClass.slots).some((z) => z.identifier)
          ? VALUE_MODE.REFERENCE
          : VALUE_MODE.INLINE_OBJECT;
      }
  for (const c of Object.values(ir.classes))
    for (const slot of Object.values(c.slots)) {
      if (!slot.explicitRange) {
        const classes = valueClasses(ir, slot);
        if (classes.length)
          slot.mode =
            explicitInlineSlots.has(slot) ||
            classes.every((c) => !Object.values(c.slots).some((s) => s.identifier))
              ? VALUE_MODE.INLINE_OBJECT
              : VALUE_MODE.REFERENCE;
      }
    }
  const inverse = new Map<string, string>();
  for (const c of Object.values(ir.classes))
    for (const [name, x] of Object.entries(c.slots))
      if (x.inverse) {
        const prior = inverse.get(name);
        if (prior && prior !== x.inverse)
          throw new Error(`conflicting inverse declarations for ${name}`);
        inverse.set(name, x.inverse);
      }
  for (const [a, b] of inverse) {
    if (!Object.values(ir.classes).some((c) => c.slots[b]))
      throw new Error(`inverse ${b} is unknown`);
    const reverse = inverse.get(b);
    if (reverse && reverse !== a) throw new Error(`inverse conflict ${a} -> ${b}`);
    inverse.set(b, a);
  }
  for (const c of Object.values(ir.classes))
    for (const [name, x] of Object.entries(c.slots))
      if (!x.inverse && inverse.has(name)) x.inverse = inverse.get(name);
  for (const c of Object.values(ir.classes)) {
    for (const slot of Object.values(c.slots))
      if (slot.listElementsUnique && !slot.multivalued)
        throw new Error(`${c.name}.${slot.name} list_elements_unique requires multivalued`);
    const checkConditions = (e: ClassExpr) => {
      for (const name of Object.keys(e.slotConditions ?? {}))
        if (!c.slots[name])
          throw new Error(`${c.name} record condition names unknown slot ${name}`);
      for (const group of [e.anyOf, e.allOf, e.noneOf, e.exactlyOneOf])
        for (const child of group ?? []) checkConditions(child);
    };
    for (const e of c.recordConstraints ?? []) checkConditions(e);
    for (const r of c.rules ?? []) {
      if (r.preconditions) checkConditions(r.preconditions);
      checkConditions(r.postconditions);
    }
  }
  for (const c of Object.values(ir.classes))
    for (const { path, slot } of referencePaths(ir, c.name)) {
      if (!path.includes('.') || !slot.inverse) continue;
      const targets = valueClasses(ir, slot).map((c) => c.name);
      for (const target of targets) {
        const reverse = ir.classes[target]!.slots[slot.inverse];
        if (!reverse || !s.classes[reverse.range] || !isSubclass(s, c.name, reverse.range))
          throw new Error(`incompatible nested inverse ${c.name}.${path} -> ${slot.inverse}`);
      }
    }
  return ir;
}

function finalizeIR(ir: RuntimeSchemaIR): RuntimeSchemaIR {
  const depth = (name: string, seen = new Set<string>()): number => {
    if (seen.has(name)) return 0;
    seen.add(name);
    const c = ir.classes[name];
    if (!c) return 0;
    return Math.max(
      1,
      ...[c.parent, ...c.mixins]
        .filter((x): x is string => !!x)
        .map((x) => 1 + depth(x, new Set(seen))),
    );
  };
  for (const c of Object.values(ir.classes)) {
    if (c.typeId.startsWith('#')) c.typeId = c.name;
    else c.typeId = c.typeId.replace(/##/g, '#').replace(/\/#/g, '/');
    c.depth = depth(c.name);
  }
  return ir;
}
async function loadSchema(
  path: string,
  options: CompileSchemaOptions = {},
): Promise<{ schema: AssertedSchema; dependencies: string[]; diagnostics: CompilerDiagnostic[] }> {
  const allowedRoot = options.allowedRoot;
  if (allowedRoot !== undefined && !isAbsolute(allowedRoot))
    return {
      schema: { classes: {}, slots: {}, types: {}, enums: {} },
      dependencies: [],
      diagnostics: [
        diagnostic(
          'composition',
          'INVALID_ALLOWED_ROOT',
          `allowedRoot must be an absolute path: ${allowedRoot}`,
        ),
      ],
    };
  return resolveClosure(isAbsolute(path) ? path : resolve(process.cwd(), path), {
    ...options,
    ...(allowedRoot ? { allowedRoot: resolve(allowedRoot) } : {}),
  });
}
export async function compileSchema(
  path: string,
  options: CompileSchemaOptions = {},
): Promise<CompileResult> {
  const loaded = await loadSchema(path, options);
  if (loaded.diagnostics.length) return { ok: false, diagnostics: loaded.diagnostics };
  const profile = checkProfile(loaded.schema);
  if (profile.length) return { ok: false, diagnostics: profile };
  try {
    const ir = compileIR(loaded.schema);
    const hash = schemaHash(loaded.schema);
    return {
      ok: true,
      value: { schema: loaded.schema, ir, dependencies: loaded.dependencies, hash },
    };
  } catch (e) {
    return {
      ok: false,
      diagnostics: [
        e instanceof SourceDeclarationError
          ? diagnostic('invalid-schema', 'INVALID_SOURCES', e.message, path, e.path)
          : diagnostic('normalization', 'NORMALIZATION_FAILED', String(e)),
      ],
    };
  }
}
export async function compileSchemaOrThrow(
  path: string,
  options: CompileSchemaOptions = {},
): Promise<CompiledSchema> {
  const result = await compileSchema(path, options);
  if (!result.ok)
    throw new Error(result.diagnostics.map((x) => `${x.code}: ${x.message}`).join('\n'));
  return result.value;
}
export function normalizeSchema(schema: AssertedSchema): RuntimeSchemaIR {
  const ds = checkProfile(schema);
  if (ds.length) throw new Error(ds.map((x) => x.message).join('\n'));
  return compileIR(schema);
}
function compileIR(schema: AssertedSchema): RuntimeSchemaIR {
  const ir = finalizeIR(normalize(schema));
  for (const cls of Object.values(ir.classes))
    for (const slot of Object.values(cls.slots))
      if (
        slot.annotations['lore:markdown_reference_column'] !== undefined &&
        (slot.mode !== 'reference' ||
          !slot.multivalued ||
          slot.annotations['lore:markdown_selectors'] !== undefined)
      )
        throw new Error(
          `${cls.name}.${slot.name}: lore:markdown_reference_column requires a multivalued reference slot without lore:markdown_selectors`,
        );
  const sources = compileSources(schema.annotations?.[SOURCES_ANNOTATION], ir);
  if (sources.length) ir.sources = sources;
  return ir;
}
/** Hash authored schema content; generated file locations are not schema semantics. */
export function schemaHash(schema: AssertedSchema): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key, item]) =>
              item !== undefined &&
              !(value === schema && key === 'sourceFiles') &&
              !(
                key === 'fromSchema' &&
                typeof item === 'string' &&
                item.startsWith('file://') &&
                generatedClassOrigins.has(value as ClassDef)
              ),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, canonical(item)]),
      );
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(schema)))
    .digest('hex');
}

function valueClasses(ir: RuntimeSchemaIR, slot: RuntimeSlot): RuntimeClass[] {
  const names = new Set<string>();
  if (ir.classes[slot.range]) names.add(slot.range);
  const visit = (e: SlotExpr) => {
    if (e.range && ir.classes[e.range]) names.add(e.range);
    for (const group of [e.anyOf, e.allOf, e.exactlyOneOf])
      for (const child of group ?? []) visit(child);
  };
  for (const group of [slot.anyOf, slot.allOf, slot.exactlyOneOf]) for (const e of group) visit(e);
  return [...names].map((n) => ir.classes[n]!);
}
/** Declared positive inline alternatives; references stop traversal at their owning slot. */
export function inlineClasses(ir: RuntimeSchemaIR, slot: RuntimeSlot): RuntimeClass[] {
  return slot.mode === VALUE_MODE.INLINE_OBJECT ? valueClasses(ir, slot) : [];
}
export type ReferencePath = { path: string; slot: RuntimeSlot };
export function referencePaths(ir: RuntimeSchemaIR, className: string): ReferencePath[] {
  const found = new Map<string, { parts: string[]; slot: RuntimeSlot }>();
  const paths = new Map<string, string>();
  const walk = (name: string, parts: string[], seen: Set<string>) => {
    if (seen.has(name)) return;
    const next = new Set(seen).add(name);
    for (const slot of Object.values(ir.classes[name]?.slots ?? {})) {
      const keys = [...parts, slot.name],
        path = keys.join('.'),
        origin = JSON.stringify(keys);
      if (paths.has(path) && paths.get(path) !== origin)
        throw new Error(`ambiguous field path ${className}.${path}`);
      paths.set(path, origin);
      if (slot.mode === VALUE_MODE.REFERENCE) {
        const previous = found.get(path);
        if (previous && JSON.stringify(previous.slot) !== JSON.stringify(slot))
          throw new Error(`incompatible reference alternatives at ${className}.${path}`);
        found.set(path, { parts: keys, slot });
      } else for (const target of inlineClasses(ir, slot)) walk(target.name, keys, next);
    }
  };
  walk(className, [], new Set());
  return [...found].map(([path, value]) => ({ path, slot: value.slot }));
}
export function referenceSlot(
  ir: RuntimeSchemaIR,
  className: string,
  path: string,
): RuntimeSlot | undefined {
  const direct = ir.classes[className]?.slots[path];
  if (direct) return direct.mode === VALUE_MODE.REFERENCE ? direct : undefined;
  const [head, ...tail] = path.split('.');
  const slot = ir.classes[className]?.slots[head!];
  if (!slot || !tail.length) return undefined;
  for (const cls of inlineClasses(ir, slot)) {
    const found = referenceSlot(ir, cls.name, tail.join('.'));
    if (found) return found;
  }
  return undefined;
}
