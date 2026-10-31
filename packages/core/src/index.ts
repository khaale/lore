import { inlineClasses } from '@khaale/lore-schema';
import { relative, resolve, dirname, basename, extname, isAbsolute } from 'node:path';
import type {
  RuntimeSchemaIR,
  AssertedSchema,
  RuntimeClass,
  RuntimeSlot,
  SlotExpr,
  ClassExpr,
  CompiledSchema,
} from '@khaale/lore-schema';
/** Source location in an input surface. Kept in core so semantic consumers do not
 * depend on the filesystem adapter. */
export type SourceSpan = { line: number; column: number; end_line?: number; end_column?: number };
export type SourceRepresentation =
  'frontmatter' | 'markdown' | 'markdown-table' | 'manifest' | 'narrative';
export type SourceDescriptor = {
  source: string;
  physicalPath: string;
  representation: SourceRepresentation;
  span?: SourceSpan;
};
export type SurfaceLink = {
  syntax: 'wiki' | 'markdown';
  target: string;
  label?: string;
  span?: SourceSpan;
};
export type MarkdownSection = {
  heading: string;
  level: number;
  anchor?: string;
  blocks: string[];
  lists: string[][];
  links: SurfaceLink[];
  span?: SourceSpan;
  contentSpan?: SourceSpan;
  headingIdentityMatches?: HeadingIdentityMatch[];
};
export type HeadingIdentityMatch = {
  rule: string;
  id: string;
  title: string;
  span?: SourceSpan;
};
export type ManifestBinding = {
  document: string;
  anchor?: string;
  headingId?: string;
  id: string;
  properties: Record<string, unknown>;
  source: string;
  span?: SourceSpan;
  propertySpans?: Record<string, SourceSpan>;
};
export type TableDeclaration = {
  name: string;
  scope: string;
  class: string;
  idColumn: string;
  columns: Record<string, string>;
  source: string;
  span?: SourceSpan;
  document?: string;
  physicalPath?: string;
  /** The adapter found declaration-shape errors; do not expand partial rows. */
  valid?: boolean;
};
export type MarkdownTableCell = { value: string; span: SourceSpan };
export type MarkdownTableRow = { cells: MarkdownTableCell[]; span: SourceSpan };
export type MarkdownTable = {
  headers: MarkdownTableCell[];
  rows: MarkdownTableRow[];
  span: SourceSpan;
  headerSpan: SourceSpan;
  valid: boolean;
  diagnostic?: string;
};
export type Candidate = {
  source: string;
  physicalPath: string;
  data: Record<string, unknown>;
  spans: Record<string, SourceSpan>;
  body?: string;
  /** One-based line at which `body` starts in the physical document. */
  bodyStartLine?: number;
  observedTitle?: string;
  observedDescription?: string;
  frontmatterTitle?: string;
  headingTitle?: string;
  frontmatterDescription?: string;
  bodyDescription?: string;
  links: SurfaceLink[];
  sections: MarkdownSection[];
  sectionDeclarations?: Record<string, unknown>;
  tableDeclarations?: TableDeclaration[];
  tables?: MarkdownTable[];
  declaredClass?: string;
  propertySources?: Record<string, SourceDescriptor>;
  narrativeSource?: SourceDescriptor;
  manifest?: { version: number; bindings: ManifestBinding[]; tables?: TableDeclaration[] };
  parseDiagnostics?: Diagnostic[];
  enriched?: boolean;
};
export type ArtifactProvenance = {
  source: string;
  physicalPath: string;
  span?: SourceSpan;
  narrative?: SourceDescriptor;
  properties?: Record<string, SourceDescriptor>;
  enriched?: boolean;
};
export type Artifact = {
  id: string;
  identifier?: string;
  kind: string;
  type_id: string;
  source: string;
  physical_path: string;
  data: Record<string, unknown>;
  body?: string;
  links?: SurfaceLink[];
  provenance?: ArtifactProvenance;
};
export type Edge = {
  from: string;
  relation: string;
  to: string;
  inferred?: boolean;
  generic?: boolean;
  surface?: string;
  value_path?: Array<string | number>;
  provenance?: SourceDescriptor;
};
export type Diagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  source?: string;
  artifact?: string;
  slot?: string;
  span?: SourceSpan;
  related_spans?: SourceSpan[];
};
export type IndexV2 = {
  version: 2;
  schema_hash: string;
  artifacts: Record<string, Artifact>;
  edges: Edge[] | null;
  diagnostics: Diagnostic[] | null;
};
export type CheckReport = {
  summary: {
    artifacts: number;
    edges: number;
    diagnostics: number;
    errors: number;
    warnings: number;
  };
  classes: Array<{ class: string; type_id?: string; count: number }>;
  diagnostics: Diagnostic[];
};
export type ExploreNode = { id: string; kind?: string; label?: string; source?: string };
export type ExploreReport = {
  version: 1;
  view: string;
  query: Record<string, unknown>;
  root?: ExploreNode;
  meta: Record<string, unknown>;
  data: unknown;
};
export type BuildOptions = { root: string; compiled: CompiledSchema; strict?: boolean };
export type BuildResult = { index: IndexV2; schema: RuntimeSchemaIR };

export * from './state.js';
export * from './semantic-read.js';

const span = (c: Candidate, key: string): SourceSpan | undefined => spanLookup(c.spans, key);
const spanLookup = (spans: Record<string, SourceSpan>, path: string): SourceSpan | undefined => {
  let candidate = path;
  for (;;) {
    const found = spans[candidate];
    if (found && found.line > 0 && found.column > 0) return found;
    if (!candidate) return undefined;
    const list = candidate.match(/^(.*)\[\d+\]$/);
    if (list) candidate = list[1]!;
    else {
      const dot = candidate.lastIndexOf('.');
      candidate = dot < 0 ? '' : candidate.slice(0, dot);
    }
  }
};
const diag = (
  severity: 'error' | 'warning',
  code: string,
  message: string,
  c: Candidate,
  slot?: string,
): Diagnostic => {
  const location = slot === undefined ? undefined : span(c, slot);
  return {
    severity,
    code,
    message,
    source: c.source,
    ...(slot === undefined ? {} : { slot }),
    ...(location === undefined ? {} : { span: location }),
  };
};
const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);
const resolvedBase = (range: string, ir: RuntimeSchemaIR, seen = new Set<string>()): string => {
  if (seen.has(range)) return range.toLowerCase();
  const type = ir.types[range];
  if (!type) return range.toLowerCase();
  return resolvedBase(type.base, ir, new Set(seen).add(range));
};
const validDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
};
function scalarOk(
  v: unknown,
  range: string,
  ir: RuntimeSchemaIR,
  seen = new Set<string>(),
): boolean {
  if (ir.enums[range]) return typeof v === 'string' && ir.enums[range].values.includes(v);
  const t = ir.types[range];
  if (t && seen.has(range)) return false;
  if (t) {
    const next = new Set(seen).add(range);
    if (!scalarOk(v, t.base, ir, next)) return false;
    if (t.patterns.some((pattern) => typeof v !== 'string' || !new RegExp(pattern).test(v)))
      return false;
    if (typeof v === 'number' && t.minimumValue !== undefined && v < Number(t.minimumValue))
      return false;
    if (typeof v === 'number' && t.maximumValue !== undefined && v > Number(t.maximumValue))
      return false;
    return true;
  }
  const base = resolvedBase(range, ir);
  if (['string', 'str', 'uri', 'uriorcurie', 'ncname', 'time'].includes(base))
    return typeof v === 'string';
  if (base === 'date') return typeof v === 'string' && validDate(v);
  if (base === 'datetime')
    return (
      typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
      !Number.isNaN(Date.parse(v))
    );
  if (base === 'integer' || base === 'int') return typeof v === 'number' && Number.isInteger(v);
  if (['float', 'double', 'decimal'].includes(base))
    return typeof v === 'number' && Number.isFinite(v);
  if (base === 'boolean' || base === 'bool') return typeof v === 'boolean';
  return false;
}
function exprOk(
  v: unknown,
  e: SlotExpr,
  ir: RuntimeSchemaIR,
  rangeCheck: (value: unknown, range: string) => boolean = (value, range) =>
    ir.classes[range]
      ? !!value && typeof value === 'object' && !Array.isArray(value)
      : scalarOk(value, range, ir),
): boolean {
  if (e.range && !rangeCheck(v, e.range)) return false;
  if (e.required && isEmpty(v)) return false;
  if (e.valuePresence === 'PRESENT' && isEmpty(v)) return false;
  if (e.valuePresence === 'ABSENT' && !isEmpty(v)) return false;
  if (e.equalsString !== undefined && v !== e.equalsString) return false;
  if (e.equalsStringIn && !e.equalsStringIn.includes(String(v))) return false;
  if (e.pattern && (typeof v !== 'string' || !new RegExp(e.pattern).test(v))) return false;
  const n = Array.isArray(v) ? v.length : v === undefined ? 0 : 1;
  if (e.minimumCardinality !== undefined && n < e.minimumCardinality) return false;
  if (e.maximumCardinality !== undefined && n > e.maximumCardinality) return false;
  if (e.exactCardinality !== undefined && n !== e.exactCardinality) return false;
  if (e.anyOf?.length && !e.anyOf.some((x) => exprOk(v, x, ir, rangeCheck))) return false;
  if (e.allOf?.length && !e.allOf.every((x) => exprOk(v, x, ir, rangeCheck))) return false;
  if (e.noneOf?.length && e.noneOf.some((x) => exprOk(v, x, ir, rangeCheck))) return false;
  if (
    e.exactlyOneOf?.length &&
    e.exactlyOneOf.filter((x) => exprOk(v, x, ir, rangeCheck)).length !== 1
  )
    return false;
  return true;
}

/** Distinguish a declared base range from normalization's default range. */
function hasDeclaredRange(schema: AssertedSchema, className: string, slotName: string): boolean {
  const classes = new Set<string>();
  const visitClass = (name: string): boolean => {
    if (!name || classes.has(name)) return false;
    classes.add(name);
    const cls = schema.classes[name];
    if (!cls) return false;
    if (cls.slotUsage?.[slotName]?.range || cls.attributes?.[slotName]?.range) return true;
    return [cls.isA, ...(cls.mixins ?? [])].some((parent) => (parent ? visitClass(parent) : false));
  };
  const slots = new Set<string>();
  const visitSlot = (name: string): boolean => {
    if (!name || slots.has(name)) return false;
    slots.add(name);
    const slot = schema.slots[name];
    if (!slot) return false;
    return (
      !!slot.range ||
      [slot.isA, ...(slot.mixins ?? [])].some((parent) => (parent ? visitSlot(parent) : false))
    );
  };
  return visitClass(className) || visitSlot(slotName);
}

function classify(c: Candidate, ir: RuntimeSchemaIR): RuntimeClass | undefined {
  for (const cls of Object.values(ir.classes).sort((a, b) => a.name.localeCompare(b.name))) {
    const d = cls.designatorSlot;
    if (d && c.data[d] !== undefined) {
      if (typeof c.data[d] === 'string' && (c.data[d] === cls.name || c.data[d] === cls.typeId))
        return cls;
    }
  }
  for (const cls of Object.values(ir.classes).sort((a, b) => a.name.localeCompare(b.name))) {
    const rules = cls.classificationRules;
    if (
      rules.length &&
      rules.some((r) =>
        Object.entries(r.slotConditions ?? {}).every(([k, e]) => exprOk(c.data[k], e, ir)),
      )
    )
      return cls;
  }
  return undefined;
}
function identity(
  c: Candidate,
  cls: RuntimeClass,
  root: string,
): { id: string; identifier?: string } {
  const idSlot = Object.values(cls.slots).find((x) => x.identifier);
  if (idSlot && c.data[idSlot.name] !== undefined)
    return { id: String(c.data[idSlot.name]), identifier: String(c.data[idSlot.name]) };
  const source = relative(root, c.source).split('\\').join('/');
  const suffix = c.source.startsWith(c.physicalPath) ? c.source.slice(c.physicalPath.length) : '';
  return { id: `@${source}${suffix}` };
}
function validate(
  c: Candidate,
  cls: RuntimeClass,
  id: string,
  strict: boolean,
  ir: RuntimeSchemaIR,
  schema: AssertedSchema,
  references?: {
    owner: Artifact;
    artifacts: Record<string, Artifact>;
    emit: (
      slot: RuntimeSlot,
      raw: string,
      target: string,
      path: string,
      parts: Array<string | number>,
    ) => void;
  },
): Diagnostic[] {
  const result: Diagnostic[] = [];
  const resolvedReferences = new Map<string, string | undefined>();
  const resolveReference = (raw: string): string | undefined => {
    if (!references) return undefined;
    if (!resolvedReferences.has(raw))
      resolvedReferences.set(raw, resolveTarget(raw, references.owner, references.artifacts));
    return resolvedReferences.get(raw);
  };
  const add = (
    severity: 'error' | 'warning',
    code: string,
    message: string,
    slotPath: string,
    spanPath = slotPath,
  ): void => {
    const descriptor =
      references?.owner.provenance?.properties?.[slotPath] ??
      references?.owner.provenance?.properties?.[slotPath.split(/\.|\[/)[0]!];
    const location = spanLookup(c.spans, spanPath) ?? descriptor?.span;
    result.push({
      severity,
      code,
      message,
      source: descriptor?.source ?? c.source,
      artifact: id,
      slot: slotPath,
      ...(location === undefined ? {} : { span: location }),
    });
  };
  const compare = (left: unknown, right: unknown): number | undefined => {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string')
      return left < right ? -1 : left > right ? 1 : 0;
    return undefined;
  };
  let probing = 0;
  const expressionPasses = (value: unknown, expression: SlotExpr): boolean =>
    exprOk(value, expression, ir, (candidate, range) => {
      const target = ir.classes[range];
      if (!target) return scalarOk(candidate, range, ir);
      if (
        typeof candidate === 'string' &&
        Object.values(target.slots).some((slot) => slot.identifier)
      ) {
        if (!references) return candidate.length > 0;
        const id = resolveReference(candidate);
        return !!id && runtimeSubclass(ir, references.artifacts[id]!.kind, range);
      }
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const start = result.length;
      probing++;
      visit(candidate as Record<string, unknown>, target);
      probing--;
      const valid = !result.slice(start).some((diagnostic) => diagnostic.severity === 'error');
      result.splice(start);
      return valid;
    });
  const referenceExpressionPasses = (value: unknown, expression: SlotExpr): boolean =>
    exprOk(value, expression, ir, (item, range) => {
      if (!references || typeof item !== 'string' || !ir.classes[range]) return false;
      const target = resolveReference(item);
      return !!target && runtimeSubclass(ir, references.artifacts[target]!.kind, range);
    });
  const hasScalarAlternative = (e: SlotExpr): boolean =>
    !!(e.range && !ir.classes[e.range]) ||
    [e.anyOf, e.allOf, e.exactlyOneOf].some((group) => group?.some(hasScalarAlternative));
  const literalReference = (slot: RuntimeSlot, value: unknown): boolean =>
    typeof value === 'string' &&
    !value.trim().startsWith('[[') &&
    !/^\[[^\]]*\]\(/.test(value.trim()) &&
    slot.anyOf.some(
      (e) =>
        hasScalarAlternative(e) &&
        exprOk(value, e, ir, (value, range) => !ir.classes[range] && scalarOk(value, range, ir)),
    );
  const chooseInline = (slot: RuntimeSlot, value: unknown): RuntimeClass | undefined => {
    const candidates = inlineClasses(ir, slot);
    return candidates.find((c) => expressionPasses(value, { range: c.name })) ?? candidates[0];
  };
  const normalized = (value: unknown, slot?: RuntimeSlot): unknown => {
    if (Array.isArray(value)) return ['list', value.map((item) => normalized(item, slot))];
    if (slot?.mode === 'reference' && typeof value === 'string')
      return literalReference(slot, value)
        ? ['literal', value]
        : ['reference', references ? (resolveReference(value) ?? value) : value];
    if (value && typeof value === 'object') {
      const cls = slot ? chooseInline(slot, value) : undefined;
      return [
        'object',
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalized(item, cls?.slots[key])]),
      ];
    }
    return ['scalar', value];
  };
  const recordPasses = (data: Record<string, unknown>, expression: ClassExpr): boolean => {
    if (
      !Object.entries(expression.slotConditions ?? {}).every(([name, e]) =>
        expressionPasses(data[name], e),
      )
    )
      return false;
    return (
      (!expression.anyOf?.length || expression.anyOf.some((e) => recordPasses(data, e))) &&
      (!expression.allOf?.length || expression.allOf.every((e) => recordPasses(data, e))) &&
      (!expression.noneOf?.length || !expression.noneOf.some((e) => recordPasses(data, e))) &&
      (!expression.exactlyOneOf?.length ||
        expression.exactlyOneOf.filter((e) => recordPasses(data, e)).length === 1)
    );
  };
  const visit = (
    data: Record<string, unknown>,
    runtimeClass: RuntimeClass,
    prefix = '',
    parts: Array<string | number> = [],
  ): void => {
    if (strict && !runtimeClass.allowExtra)
      for (const name of Object.keys(data))
        if (!runtimeClass.slots[name]) {
          const full = prefix ? `${prefix}.${name}` : name;
          add(
            'error',
            'UNKNOWN_SLOT',
            `slot ${full} is not allowed for kind ${runtimeClass.name}`,
            full,
          );
        }
    for (const slotDefinition of Object.values(runtimeClass.slots)) {
      const name = slotDefinition.name;
      const full = prefix ? `${prefix}.${name}` : name;
      const value = data[name];
      if (isEmpty(value)) {
        if (slotDefinition.required)
          add('error', 'REQUIRED', `required slot ${full} is missing`, full);
        else if (slotDefinition.recommended)
          add('warning', 'RECOMMENDED', `recommended slot ${full} is missing`, full);
        continue;
      }
      let values = [value];
      if (slotDefinition.multivalued) {
        if (!Array.isArray(value)) {
          add('error', 'MULTIVALUED', `slot ${full} must be a list`, full);
          continue;
        }
        values = value;
      } else if (Array.isArray(value)) {
        add('error', 'SINGLE_VALUED', `slot ${full} must be single-valued`, full);
        continue;
      }
      if (
        slotDefinition.minimumCardinality !== undefined &&
        values.length < slotDefinition.minimumCardinality
      )
        add(
          'error',
          'MIN_CARDINALITY',
          `slot ${full} needs at least ${slotDefinition.minimumCardinality} values`,
          full,
        );
      if (
        slotDefinition.maximumCardinality !== undefined &&
        values.length > slotDefinition.maximumCardinality
      )
        add(
          'error',
          'MAX_CARDINALITY',
          `slot ${full} allows at most ${slotDefinition.maximumCardinality} values`,
          full,
        );
      if (
        slotDefinition.exactCardinality !== undefined &&
        values.length !== slotDefinition.exactCardinality
      )
        add(
          'error',
          'EXACT_CARDINALITY',
          `slot ${full} requires exactly ${slotDefinition.exactCardinality} values`,
          full,
        );
      values.forEach((item, index) => {
        const valuePath = slotDefinition.multivalued ? `${full}[${index}]` : full;
        const valueParts = [...parts, name, ...(slotDefinition.multivalued ? [index] : [])];
        if (slotDefinition.mode === 'reference' && references) {
          if (literalReference(slotDefinition, item)) return;
          if (typeof item !== 'string') {
            add(
              'error',
              'REFERENCE_SYNTAX',
              `reference slot ${full} must contain string identifiers/links`,
              full,
              valuePath,
            );
            return;
          }
          const target = resolveReference(item);
          if (!target) {
            add(
              'error',
              'BROKEN_REFERENCE',
              `cannot resolve reference ${JSON.stringify(item)}`,
              prefix ? valuePath : full,
              valuePath,
            );
            return;
          }
          const compatible =
            (!ir.classes[slotDefinition.range] ||
              runtimeSubclass(ir, references.artifacts[target]!.kind, slotDefinition.range)) &&
            (!slotDefinition.anyOf.length ||
              slotDefinition.anyOf.some((e) => referenceExpressionPasses(item, e))) &&
            slotDefinition.allOf.every((e) => referenceExpressionPasses(item, e)) &&
            !slotDefinition.noneOf.some((e) => referenceExpressionPasses(item, e)) &&
            (!slotDefinition.exactlyOneOf.length ||
              slotDefinition.exactlyOneOf.filter((e) => referenceExpressionPasses(item, e))
                .length === 1);
          if (!compatible) {
            add(
              'error',
              'REFERENCE_TYPE',
              `${full} target ${target} violates its effective reference constraints`,
              prefix ? valuePath : full,
              valuePath,
            );
            return;
          }
          if (!probing) references.emit(slotDefinition, item, target, valuePath, valueParts);
          return;
        }

        // A range-free union may accept an inline record; the default string range is not an explicit restriction.
        if (
          !hasDeclaredRange(schema, runtimeClass.name, name) &&
          slotDefinition.mode === 'inline-object' &&
          item &&
          typeof item === 'object' &&
          !Array.isArray(item)
        ) {
          const match = chooseInline(slotDefinition, item);
          if (match) {
            visit(item as Record<string, unknown>, match, valuePath, valueParts);
            return;
          }
        }
        const target = ir.classes[slotDefinition.range];
        if (target) {
          if (slotDefinition.mode === 'reference') {
            if (typeof item !== 'string')
              add(
                'error',
                'REFERENCE_SYNTAX',
                `reference slot ${full} must contain string identifiers/links`,
                full,
                valuePath,
              );
          } else if (slotDefinition.mode === 'inline-object') {
            if (!item || typeof item !== 'object' || Array.isArray(item))
              add(
                'error',
                'INLINE_OBJECT',
                `slot ${full} expects inline ${slotDefinition.range} object`,
                full,
                valuePath,
              );
            else visit(item as Record<string, unknown>, target, valuePath, valueParts);
          } else
            add(
              'error',
              'SCHEMA_MODE',
              `class-valued slot ${full} has scalar mode`,
              full,
              valuePath,
            );
          return;
        }
        const enumDefinition = ir.enums[slotDefinition.range];
        if (enumDefinition) {
          if (!enumDefinition.values.includes(String(item)))
            add(
              'error',
              'ENUM',
              `${JSON.stringify(String(item))} is not permitted by enum ${slotDefinition.range}`,
              full,
              valuePath,
            );
          return;
        }
        if (!scalarOk(item, slotDefinition.range, ir)) {
          add('error', 'RANGE', `slot ${full} expects ${slotDefinition.range}`, full, valuePath);
          return;
        }
        const type = ir.types[slotDefinition.range];
        const patterns = [
          ...new Set([...slotDefinition.patterns, ...(type?.patterns ?? [])]),
        ].filter(Boolean);
        for (const pattern of patterns)
          if (typeof item === 'string' && !new RegExp(pattern).test(item))
            add('error', 'PATTERN', `slot ${full} does not match ${pattern}`, full, valuePath);
        const minimum =
          type?.minimumValue !== undefined &&
          (slotDefinition.minimumValue === undefined ||
            (compare(slotDefinition.minimumValue, type.minimumValue) ?? 0) < 0)
            ? type.minimumValue
            : slotDefinition.minimumValue;
        const maximum =
          type?.maximumValue !== undefined &&
          (slotDefinition.maximumValue === undefined ||
            (compare(slotDefinition.maximumValue, type.maximumValue) ?? 0) > 0)
            ? type.maximumValue
            : slotDefinition.maximumValue;
        if (minimum !== undefined && (compare(item, minimum) ?? 0) < 0)
          add('error', 'MIN_VALUE', `slot ${full} is below minimum`, full, valuePath);
        if (maximum !== undefined && (compare(item, maximum) ?? 0) > 0)
          add('error', 'MAX_VALUE', `slot ${full} is above maximum`, full, valuePath);
      });
      if (slotDefinition.listElementsUnique) {
        const seen = new Set<string>();
        values.forEach((item, index) => {
          const key = JSON.stringify(normalized(item, slotDefinition));
          if (seen.has(key))
            add(
              'error',
              'LIST_ELEMENTS_UNIQUE',
              `slot ${full} contains a duplicate element`,
              full,
              `${full}[${index}]`,
            );
          seen.add(key);
        });
      }
      const groups: Array<[string, SlotExpr[], (values: boolean[]) => boolean]> = [
        ['any_of', slotDefinition.anyOf, (items) => items.some(Boolean)],
        ['all_of', slotDefinition.allOf, (items) => items.every(Boolean)],
        ['none_of', slotDefinition.noneOf, (items) => items.every((item) => !item)],
        [
          'exactly_one_of',
          slotDefinition.exactlyOneOf,
          (items) => items.filter(Boolean).length === 1,
        ],
      ];
      const containsRange = (e: SlotExpr): boolean =>
        !!e.range ||
        [e.anyOf, e.allOf, e.noneOf, e.exactlyOneOf].some((group) => group?.some(containsRange));
      for (const [constraint, expressions, passes] of groups) {
        const items =
          slotDefinition.multivalued && expressions.some(containsRange) ? values : [value];
        if (
          expressions.length &&
          items.some(
            (item) => !passes(expressions.map((expression) => expressionPasses(item, expression))),
          )
        )
          add('error', 'BOOLEAN_CONSTRAINT', `slot ${full} violates ${constraint}`, full);
      }
    }
    for (const constraint of runtimeClass.recordConstraints ?? [])
      if (!recordPasses(data, constraint))
        add(
          'error',
          'RECORD_CONSTRAINT',
          `record ${prefix || runtimeClass.name} violates a class constraint`,
          prefix,
        );
    for (const rule of runtimeClass.rules ?? [])
      if (
        (!rule.preconditions || recordPasses(data, rule.preconditions)) &&
        !recordPasses(data, rule.postconditions)
      )
        add(
          'error',
          'CLASS_RULE',
          `record ${prefix || runtimeClass.name} violates a class rule`,
          prefix,
        );
  };
  visit(c.data, cls);
  return result;
}
const annotationStrings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
const markdownSelector = (selector: string): { level: number; heading: string } | undefined => {
  const normalized = selector.trim();
  const match = /^(#{1,6})\s*(.+)$/.exec(normalized);
  if (!match) return undefined;
  return { level: match[1]!.length, heading: match[2]!.trim().replace(/\s+/g, ' ') };
};

const sectionEndLine = (sections: MarkdownSection[], index: number): number => {
  const section = sections[index];
  if (!section?.span) return Number.POSITIVE_INFINITY;
  return (
    sections.slice(index + 1).find((next) => next.span && next.level <= section.level)?.span
      ?.line ?? Number.POSITIVE_INFINITY
  );
};

const sectionRegionBody = (candidate: Candidate, section: MarkdownSection): string | undefined => {
  if (candidate.body === undefined || section.span?.line === undefined) return undefined;
  const startLine = candidate.bodyStartLine ?? 1;
  const start = Math.max(0, section.span.line - startLine);
  const sectionIndex = candidate.sections.indexOf(section);
  const endLine =
    sectionIndex < 0 ? Number.POSITIVE_INFINITY : sectionEndLine(candidate.sections, sectionIndex);
  const lines = candidate.body.split(/\r?\n/);
  const end = Number.isFinite(endLine) ? Math.max(start, endLine - startLine) : lines.length;
  return lines.slice(start, end).join('\n');
};

/** Annotate parsed headings with the profile's opt-in identity captures. The
 * parser remains schema-agnostic; this shared candidate representation is the
 * only place where heading text is interpreted by a runtime profile. */
const headingIdentityCandidate = (candidate: Candidate, ir: RuntimeSchemaIR): Candidate => {
  const rules = ir.headingIdentity ?? [];
  if (!rules.length || !candidate.sections.length) return candidate;
  return {
    ...candidate,
    sections: candidate.sections.map((section) => {
      const matches: HeadingIdentityMatch[] = [];
      for (const rule of rules) {
        if (!rule.levels.includes(section.level)) continue;
        let found: RegExpExecArray | null;
        try {
          found = new RegExp(rule.pattern).exec(section.heading);
        } catch {
          continue;
        }
        const id = found?.groups?.id?.trim();
        const title = found?.groups?.title?.trim();
        if (found && id && title)
          matches.push({
            rule: rule.name,
            id,
            title,
            ...(section.span ? { span: section.span } : {}),
          });
      }
      return matches.length ? { ...section, headingIdentityMatches: matches } : section;
    }),
  };
};
const locatorSegment = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');

const narrativeRegionBody = (
  candidate: Candidate,
  semanticSections: MarkdownSection[],
): string | undefined => {
  if (candidate.body === undefined) return undefined;
  if (!semanticSections.length) return candidate.body;
  const startLine = candidate.bodyStartLine ?? 1;
  const lines = candidate.body.split(/\r?\n/);
  const intervals = semanticSections
    .filter((section) => section.span?.line !== undefined)
    .map((section) => {
      const index = candidate.sections.indexOf(section);
      return {
        start: Math.max(0, section.span!.line - startLine),
        end: Math.max(
          0,
          (index < 0 ? section.span!.line + 1 : sectionEndLine(candidate.sections, index)) -
            startLine,
        ),
      };
    })
    .sort((left, right) => left.start - right.start);
  const output: string[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    output.push(...lines.slice(cursor, Math.min(interval.start, lines.length)));
    cursor = Math.max(cursor, Math.min(interval.end, lines.length));
  }
  output.push(...lines.slice(cursor));
  return output.join('\n');
};
const parsedReferenceId = (value: unknown): string | undefined => {
  const text = String(value).trim();
  if (!text.startsWith('[[') || !text.endsWith(']]')) return text || undefined;
  return text.slice(2, -2).split('|', 1)[0]!.split('#', 1)[0]!.trim() || undefined;
};
const markdownValuesEqual = (slot: RuntimeSlot, left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => markdownValuesEqual(slot, value, right[index]))
    );
  if (slot.mode === 'reference') {
    const leftId = parsedReferenceId(left);
    const rightId = parsedReferenceId(right);
    if (leftId && rightId) return leftId === rightId;
  }
  return String(left).trim() === String(right).trim();
};
const sameSurfaceLink = (left: SurfaceLink, right: SurfaceLink): boolean =>
  left.syntax === right.syntax &&
  left.target === right.target &&
  left.label === right.label &&
  (left.span && right.span
    ? left.span.line === right.span.line && left.span.column === right.span.column
    : true);
function materializeMarkdown(
  candidate: Candidate,
  runtimeClass: RuntimeClass,
): { candidate: Candidate; diagnostics: Diagnostic[] } {
  const data = { ...candidate.data };
  const spans = { ...candidate.spans };
  const propertySources = { ...(candidate.propertySources ?? {}) };
  const diagnostics: Diagnostic[] = [];
  const claimed: SurfaceLink[] = [];
  const selectorOwners = new Map<string, string>();
  const ambiguousSelectors = new Set<string>();
  const semanticSections: MarkdownSection[] = [];
  const selectedRegions: Array<{ section: MarkdownSection; slot: string }> = [];
  for (const [name, slot] of Object.entries(runtimeClass.slots)) {
    const rawAnnotation = slot.annotations['lore:markdown_selectors'];
    if (
      rawAnnotation !== undefined &&
      typeof rawAnnotation !== 'string' &&
      !Array.isArray(rawAnnotation)
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_MARKDOWN_SELECTOR',
        message: `slot ${name} has an invalid lore:markdown_selectors annotation`,
        source: candidate.source,
        slot: name,
      });
    }
    if (Array.isArray(rawAnnotation) && rawAnnotation.some((item) => typeof item !== 'string'))
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_MARKDOWN_SELECTOR',
        message: `slot ${name} has a non-string Markdown selector`,
        source: candidate.source,
        slot: name,
      });
    const rawSelectors = annotationStrings(rawAnnotation);
    const selectors: Array<{ level: number; heading: string }> = [];
    for (const rawSelector of rawSelectors) {
      const parsed = markdownSelector(rawSelector);
      if (!parsed) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_MARKDOWN_SELECTOR',
          message: `slot ${name} has invalid Markdown selector ${JSON.stringify(rawSelector)}`,
          source: candidate.source,
          slot: name,
        });
        continue;
      }
      const key = `${parsed.level}:${parsed.heading}`;
      const prior = selectorOwners.get(key);
      if (prior && prior !== name) {
        ambiguousSelectors.add(prior);
        ambiguousSelectors.add(name);
        diagnostics.push({
          severity: 'error',
          code: 'AMBIGUOUS_MARKDOWN_SELECTOR',
          message: `Markdown selector ${JSON.stringify(rawSelector)} is declared by slots ${prior} and ${name}`,
          source: candidate.source,
          slot: name,
        });
      } else selectorOwners.set(key, name);
      selectors.push(parsed);
    }
    if (ambiguousSelectors.has(name)) continue;
    if (!selectors.length) continue;
    const seen = new Set<number>();
    const sections: MarkdownSection[] = [];
    for (const selector of selectors)
      candidate.sections.forEach((section, index) => {
        if (
          section.level === selector.level &&
          section.heading.trim().replace(/\s+/g, ' ') === selector.heading &&
          !seen.has(index)
        ) {
          seen.add(index);
          sections.push(section);
        }
      });
    if (!sections.length) continue;
    if (sections.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_MARKDOWN_SECTION',
        message: `slot ${name} matches more than one Markdown section`,
        source: candidate.source,
        slot: name,
        ...(sections[0]!.span === undefined ? {} : { span: sections[0]!.span }),
        related_spans: sections
          .slice(1)
          .map((section) => section.span)
          .filter((value): value is SourceSpan => value !== undefined),
      });
      continue;
    }
    const section = sections[0]!;
    const sectionIndex = candidate.sections.indexOf(section);
    const sectionEnd = sectionEndLine(candidate.sections, sectionIndex);
    const overlapping = semanticSections.find((selected) => {
      const selectedIndex = candidate.sections.indexOf(selected);
      const selectedEnd = sectionEndLine(candidate.sections, selectedIndex);
      return (
        section.span?.line !== undefined &&
        selected.span?.line !== undefined &&
        section.span.line < selectedEnd &&
        selected.span.line < sectionEnd
      );
    });
    if (candidate.enriched && overlapping) {
      diagnostics.push({
        severity: 'error',
        code: 'OWNERSHIP_CONFLICT',
        message: `slot ${name} selected Markdown region overlaps slot ${selectedRegions.find((item) => item.section === overlapping)?.slot ?? 'unknown'}`,
        source: candidate.source,
        slot: name,
        ...(section.span === undefined ? {} : { span: section.span }),
        ...(overlapping.span === undefined ? {} : { related_spans: [overlapping.span] }),
      });
      continue;
    }
    semanticSections.push(section);
    selectedRegions.push({ section, slot: name });
    let value: unknown;
    let shape = '';
    if (slot.mode === 'reference') {
      const wiki = section.links.filter(
        (link) => link.syntax === 'wiki' && link.target.trim() !== '',
      );
      claimed.push(...wiki);
      const values = wiki.map((link) => `[[${link.target}${link.label ? `|${link.label}` : ''}]]`);
      if (!wiki.length) {
        if (section.blocks.length || section.lists.length)
          shape = 'a relation section must contain WikiLinks';
      } else if (slot.multivalued) value = values;
      else if (values.length !== 1)
        shape = 'a single-valued relation section must contain exactly one WikiLink';
      else value = values[0];
    } else if (slot.multivalued) {
      if (section.blocks.length || section.lists.length !== 1)
        shape = 'a multivalued slot section must contain exactly one Markdown list';
      else value = section.lists[0];
    } else if (section.blocks.length !== 1 || section.lists.length)
      shape = 'a scalar slot section must contain exactly one paragraph';
    else value = section.blocks[0];
    if (shape) {
      diagnostics.push({
        severity: 'error',
        code: 'MARKDOWN_SLOT_SHAPE',
        message: `slot ${name}: ${shape}`,
        source: candidate.source,
        slot: name,
        ...(section.span === undefined ? {} : { span: section.span }),
      });
      continue;
    }
    const existing = data[name];
    const declared = Object.prototype.hasOwnProperty.call(data, name);
    const existingOwner = propertySources[name];
    const markdownOwner = section.span
      ? {
          source: candidate.source,
          physicalPath: candidate.physicalPath,
          representation: 'markdown' as const,
          span: section.span,
        }
      : undefined;
    if (candidate.enriched && declared && existingOwner) {
      const primary = spanLookup(candidate.spans, name) ?? section.span;
      diagnostics.push({
        severity: 'error',
        code: 'OWNERSHIP_CONFLICT',
        message: `slot ${name} has competing owners`,
        source: candidate.source,
        slot: name,
        ...(primary === undefined ? {} : { span: primary }),
        ...(section.span &&
        (!primary || section.span.line !== primary.line || section.span.column !== primary.column)
          ? { related_spans: [section.span] }
          : {}),
      });
      continue;
    }
    if (value === undefined || isEmpty(value)) {
      if (markdownOwner && !existingOwner) propertySources[name] = markdownOwner;
      continue;
    }
    if (existing !== undefined && (!isEmpty(existing) || (candidate.enriched && declared))) {
      if (markdownValuesEqual(slot, existing, value) && !candidate.enriched) continue;
      const primary = spanLookup(candidate.spans, name) ?? section.span;
      diagnostics.push({
        severity: 'error',
        code: candidate.enriched ? 'OWNERSHIP_CONFLICT' : 'MARKDOWN_FRONTMATTER_CONFLICT',
        message: `slot ${name} has different frontmatter and Markdown values`,
        source: candidate.source,
        slot: name,
        ...(primary === undefined ? {} : { span: primary }),
        ...(section.span &&
        (!primary || section.span.line !== primary.line || section.span.column !== primary.column)
          ? { related_spans: [section.span] }
          : {}),
      });
      continue;
    }
    data[name] = value;
    if (section.span) spans[name] = section.span;
    propertySources[name] = {
      source: candidate.source,
      physicalPath: candidate.physicalPath,
      representation: 'markdown',
      ...(section.span ? { span: section.span } : {}),
    };
  }
  if (
    runtimeClass.designatorSlot &&
    runtimeClass.slots[runtimeClass.designatorSlot]?.designatesType &&
    data[runtimeClass.designatorSlot] === undefined
  )
    data[runtimeClass.designatorSlot] = runtimeClass.name;
  if (data.title === undefined && runtimeClass.slots.title && candidate.observedTitle)
    data.title = candidate.observedTitle;
  if (
    data.description === undefined &&
    runtimeClass.slots.description &&
    candidate.observedDescription
  )
    data.description = candidate.observedDescription;
  const narrativeBody =
    candidate.source.includes('#anchor=') || candidate.source.includes('#heading-id=')
      ? narrativeRegionBody(candidate, semanticSections)
      : undefined;
  return {
    candidate: {
      ...candidate,
      data,
      spans,
      propertySources,
      ...(narrativeBody === undefined ? {} : { body: narrativeBody }),
      links: candidate.links.filter(
        (link) => !claimed.some((semantic) => sameSurfaceLink(link, semantic)),
      ),
    },
    diagnostics,
  };
}
function resolveTarget(
  raw: string,
  from: Artifact,
  arts: Record<string, Artifact>,
): string | undefined {
  if (arts[raw]) return raw;
  const trimmed = raw.trim();
  const markdown = /^\[[^\]]*\]\(([^)#\s]+)(?:#[^\s)]*)?(?:\s+"[^"]*")?\)$/.exec(trimmed);
  const wiki = /^\[\[([^\]|#]+)(?:\|[^\]]+|#[^\]]+)?\]\]$/.exec(trimmed);
  const target = markdown?.[1]?.trim() ?? wiki?.[1]?.trim();
  // Bare typed references are logical IDs only. Filename-stem fallback is a
  // WikiLink affordance and must never make a malformed bare reference valid.
  if (!target) return undefined;
  if (markdown) {
    const physical = resolve(dirname(from.physical_path), target);
    const byPath = Object.values(arts).filter((a) => resolve(a.physical_path) === physical);
    if (byPath.length === 1) return byPath[0]!.id;
  }
  const found = Object.values(arts).filter(
    (a) => basename(a.physical_path, extname(a.physical_path)) === target || a.id === target,
  );
  return found.length === 1 ? found[0]!.id : undefined;
}

type TableRecord = { declaration: TableDeclaration; owner: Candidate; target: Candidate };
type TableExpansion = { rows: Candidate[]; diagnostics: Diagnostic[] };

function tableDiagnostic(
  declaration: TableDeclaration,
  code: string,
  message: string,
  span?: SourceSpan,
  slot?: string,
  artifact?: string,
  source = declaration.source,
): Diagnostic {
  return {
    severity: 'error',
    code,
    message,
    source,
    ...(artifact === undefined ? {} : { artifact }),
    ...(slot === undefined ? {} : { slot }),
    ...(span === undefined ? {} : { span }),
  };
}

function tableDocumentDiagnostic(
  declaration: TableDeclaration,
  document: Candidate,
  code: string,
  message: string,
  span?: SourceSpan,
  slot?: string,
  artifact?: string,
): Diagnostic {
  return tableDiagnostic(declaration, code, message, span, slot, artifact, document.source);
}

const tableWikiLink = /^\[\[([^\]|#]+)(?:\|[^\]]+|#[^\]]+)?\]\]$/;
const tableReferenceValue = (value: string): { value?: string; error?: string } => {
  const text = value.trim();
  if (!text) return {};
  if (!text.startsWith('[[')) return { value: text };
  const match = tableWikiLink.exec(text);
  return match
    ? { value: match[1]!.trim() }
    : { error: 'reference values must be exact IDs or complete WikiLinks' };
};

function tableScalar(value: string, slot: RuntimeSlot, ir: RuntimeSchemaIR): unknown {
  const text = value.trim();
  const base = resolvedBase(slot.range, ir);
  if (base === 'boolean' || base === 'bool') {
    if (!/^(?:true|false)$/i.test(text))
      throw new Error(`boolean ${JSON.stringify(text)} is invalid`);
    return text.toLowerCase() === 'true';
  }
  if (base === 'integer' || base === 'int') {
    if (!/^-?\d+$/.test(text)) throw new Error(`integer ${JSON.stringify(text)} is invalid`);
    return Number(text);
  }
  if (['float', 'double', 'decimal'].includes(base)) {
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))
      throw new Error(`number ${JSON.stringify(text)} is invalid`);
    const number = Number(text);
    if (!Number.isFinite(number)) throw new Error(`number ${JSON.stringify(text)} is invalid`);
    return number;
  }
  return text;
}

function tableValue(
  cell: MarkdownTableCell,
  slot: RuntimeSlot,
  ir: RuntimeSchemaIR,
): { value?: unknown; error?: string } {
  const text = cell.value.trim();
  if (!text) return { value: slot.multivalued ? [] : undefined };
  if (slot.multivalued) {
    let values: unknown;
    try {
      values = JSON.parse(text);
    } catch {
      return { error: 'multivalued cells must contain a JSON array' };
    }
    if (
      !Array.isArray(values) ||
      values.some((item) => item === null || Array.isArray(item) || typeof item === 'object')
    )
      return { error: 'multivalued cells must contain a flat JSON array' };
    const converted: unknown[] = [];
    for (const item of values) {
      if (typeof item !== 'string' && slot.mode === 'reference')
        return { error: 'reference arrays must contain strings' };
      try {
        if (slot.mode === 'reference') {
          const reference = tableReferenceValue(String(item));
          if (reference.error) return { error: reference.error };
          converted.push(reference.value ?? '');
        } else converted.push(tableScalar(String(item), slot, ir));
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { value: converted };
  }
  if (slot.mode === 'reference') {
    const reference = tableReferenceValue(text);
    if (reference.error) return { error: reference.error };
    return { value: reference.value };
  }
  try {
    return { value: tableScalar(text, slot, ir) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function expandTables(candidates: Candidate[], ir: RuntimeSchemaIR, root: string): TableExpansion {
  const diagnostics: Diagnostic[] = [];
  const rows: Candidate[] = [];
  const originals = candidates.filter((candidate) => !candidate.manifest);
  const records: TableRecord[] = [];
  for (const owner of candidates) {
    if (owner.manifest && owner.manifest.version !== 1) continue;
    const declarations = owner.tableDeclarations ?? owner.manifest?.tables ?? [];
    for (const declaration of declarations) {
      const rootPath = resolve(root);
      const declaredTargetPath = declaration.document
        ? resolve(dirname(owner.physicalPath), declaration.document)
        : resolve(owner.physicalPath);
      if (
        declaration.document &&
        (isAbsolute(declaration.document) || !declaredTargetPath.startsWith(`${rootPath}/`))
      ) {
        diagnostics.push(
          tableDiagnostic(
            declaration,
            'TABLE_PATH',
            `table declaration document ${declaration.document} is outside the workspace`,
            declaration.span,
          ),
        );
        continue;
      }
      const target = declaration.document
        ? originals.find((candidate) => resolve(candidate.physicalPath) === declaredTargetPath)
        : owner;
      if (!target) {
        diagnostics.push(
          tableDiagnostic(
            declaration,
            'TABLE_DOCUMENT_MISSING',
            `table declaration document ${declaration.document ?? ''} was not found`,
            declaration.span,
          ),
        );
        continue;
      }
      if (
        declaration.document &&
        (isAbsolute(declaration.document) ||
          !resolve(target.physicalPath).startsWith(`${rootPath}/`))
      ) {
        diagnostics.push(
          tableDiagnostic(
            declaration,
            'TABLE_PATH',
            `table declaration document ${declaration.document} is outside the workspace-relative manifest`,
            declaration.span,
          ),
        );
        continue;
      }
      records.push({ declaration, owner, target });
    }
  }
  const names = new Map<string, TableRecord>();
  const duplicateNames = new Set<string>();
  for (const record of records) {
    const key = `${resolve(record.target.physicalPath)}\0${record.declaration.name}`;
    const prior = names.get(key);
    if (prior) {
      duplicateNames.add(key);
      diagnostics.push(
        tableDiagnostic(
          record.declaration,
          'TABLE_DUPLICATE_NAME',
          `table declaration name ${record.declaration.name} is duplicated for one document`,
          record.declaration.span,
        ),
      );
      continue;
    }
    names.set(key, record);
  }
  const selected = new Map<string, { record: TableRecord; table: MarkdownTable }>();
  for (const record of records) {
    const { declaration, target } = record;
    const declarationKey = `${resolve(target.physicalPath)}\0${declaration.name}`;
    if (declaration.valid === false || duplicateNames.has(declarationKey)) continue;
    const selector = markdownSelector(declaration.scope);
    if (!selector) {
      diagnostics.push(
        tableDiagnostic(
          declaration,
          'TABLE_SCOPE',
          `invalid table scope ${declaration.scope}`,
          declaration.span,
        ),
      );
      continue;
    }
    const headingMatches = target.sections.filter(
      (section) =>
        section.level === selector.level &&
        section.heading.trim().replace(/\s+/g, ' ') === selector.heading,
    );
    if (!headingMatches.length) {
      diagnostics.push(
        tableDiagnostic(
          declaration,
          'TABLE_SCOPE_MISSING',
          `table scope ${declaration.scope} was not found`,
          declaration.span,
        ),
      );
      continue;
    }
    if (headingMatches.length > 1) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_SCOPE_AMBIGUOUS',
          `table scope ${declaration.scope} is ambiguous`,
          headingMatches[0]?.span,
        ),
      );
      continue;
    }
    const heading = headingMatches[0]!;
    const headingIndex = target.sections.indexOf(heading);
    const endLine = sectionEndLine(target.sections, headingIndex);
    const tables = (target.tables ?? []).filter(
      (table) => table.span.line > (heading.span?.line ?? 0) && table.span.line < endLine,
    );
    if (!tables.length) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_MISSING',
          `no pipe table was found in ${declaration.scope}`,
          heading.span,
        ),
      );
      continue;
    }
    if (tables.length !== 1) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_AMBIGUOUS',
          `more than one pipe table was found in ${declaration.scope}`,
          tables[0]?.span,
        ),
      );
      continue;
    }
    const table = tables[0]!;
    if (!table.valid) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_SYNTAX',
          table.diagnostic ?? 'selected table syntax is unsupported',
          table.span,
        ),
      );
      continue;
    }
    const runtimeClass = Object.values(ir.classes).find(
      (candidate) => candidate.name === declaration.class || candidate.typeId === declaration.class,
    );
    if (!runtimeClass) {
      diagnostics.push(
        tableDiagnostic(
          declaration,
          'TABLE_CLASS',
          `unknown runtime class ${declaration.class}`,
          declaration.span,
        ),
      );
      continue;
    }
    const identifierSlots = Object.values(runtimeClass.slots).filter((slot) => slot.identifier);
    if (identifierSlots.length !== 1) {
      diagnostics.push(
        tableDiagnostic(
          declaration,
          'TABLE_IDENTITY',
          `class ${runtimeClass.name} must have exactly one identifier slot`,
          declaration.span,
        ),
      );
      continue;
    }
    const headers = table.headers.map((header) => header.value);
    const mappedHeaders = new Set([
      declaration.idColumn.trim(),
      ...Object.keys(declaration.columns).map((header) => header.trim()),
    ]);
    const duplicateHeader = headers.find(
      (header, index) => headers.indexOf(header) !== index && mappedHeaders.has(header),
    );
    if (duplicateHeader !== undefined) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_HEADER_DUPLICATE',
          `header ${duplicateHeader} occurs more than once`,
          table.headerSpan,
        ),
      );
      continue;
    }
    const idIndex = headers.indexOf(declaration.idColumn.trim());
    if (idIndex < 0) {
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_ID_COLUMN',
          `id column ${declaration.idColumn} was not found`,
          table.headerSpan,
        ),
      );
      continue;
    }
    const usedSlots = new Set<string>();
    let validMapping = true;
    for (const [header, slotName] of Object.entries(declaration.columns)) {
      const index = headers.indexOf(header.trim());
      const slot = runtimeClass.slots[slotName];
      if (index < 0) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_HEADER_MISSING',
            `mapped header ${header} was not found`,
            table.headerSpan,
            slotName,
          ),
        );
        validMapping = false;
      } else if (index === idIndex) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_ID_MAPPING',
            `id column ${header} cannot be mapped to a property slot`,
            table.headers[index]?.span,
            slotName,
          ),
        );
        validMapping = false;
      } else if (!slot) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_SLOT',
            `slot ${slotName} is not applicable to ${runtimeClass.name}`,
            table.headers[index]?.span,
            slotName,
          ),
        );
        validMapping = false;
      } else if (slot.identifier || slot.designatesType || usedSlots.has(slotName)) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_SLOT_OWNER',
            `slot ${slotName} has a conflicting table owner`,
            table.headers[index]?.span,
            slotName,
          ),
        );
        validMapping = false;
      } else usedSlots.add(slotName);
    }
    if (!validMapping) continue;
    const physicalKey = `${resolve(target.physicalPath)}\0${table.span.line}\0${table.span.end_line ?? table.span.line}`;
    const overlap = [...selected.values()].find(
      (entry) =>
        `${resolve(entry.record.target.physicalPath)}\0${entry.table.span.line}\0${entry.table.span.end_line ?? entry.table.span.line}` ===
        physicalKey,
    );
    if (overlap) {
      const priorPrefix = `${overlap.record.target.source}#table=${locatorSegment(overlap.record.declaration.name)}#row=`;
      for (let index = rows.length - 1; index >= 0; index--)
        if (rows[index]!.source.startsWith(priorPrefix)) rows.splice(index, 1);
      diagnostics.push(
        tableDocumentDiagnostic(
          declaration,
          target,
          'TABLE_OVERLAP',
          `table declaration ${declaration.name} overlaps ${overlap.record.declaration.name}`,
          table.span,
        ),
      );
      continue;
    }
    selected.set(`${resolve(target.physicalPath)}\0${declaration.name}`, { record, table });
    const declarationDiagnosticStart = diagnostics.length;
    const generatedRows: Candidate[] = [];
    const rowIds = new Set<string>();
    for (const row of table.rows) {
      const idCell = row.cells[idIndex];
      if (!idCell || !idCell.value) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_ROW_ID',
            'table row has an empty ID cell',
            row.span,
          ),
        );
        continue;
      }
      if (rowIds.has(idCell.value)) {
        diagnostics.push(
          tableDocumentDiagnostic(
            declaration,
            target,
            'TABLE_ROW_ID_DUPLICATE',
            `duplicate table row ID ${idCell.value}`,
            idCell.span,
            undefined,
            idCell.value,
          ),
        );
        continue;
      }
      rowIds.add(idCell.value);
      const rowSource = `${target.source}#table=${locatorSegment(declaration.name)}#row=${locatorSegment(idCell.value)}`;
      const data: Record<string, unknown> = { [identifierSlots[0]!.name]: idCell.value };
      const spans: Record<string, SourceSpan> = { [identifierSlots[0]!.name]: idCell.span };
      const propertySources: Record<string, SourceDescriptor> = {
        [identifierSlots[0]!.name]: {
          source: `${rowSource}#column=${locatorSegment(headers[idIndex]!)}`,
          physicalPath: target.physicalPath,
          representation: 'markdown-table',
          span: idCell.span,
        },
      };
      let rowValid = true;
      if (runtimeClass.designatorSlot) {
        data[runtimeClass.designatorSlot] = runtimeClass.name;
        propertySources[runtimeClass.designatorSlot] = {
          source: declaration.source,
          physicalPath: declaration.physicalPath ?? target.physicalPath,
          representation: 'markdown-table',
          ...(declaration.span ? { span: declaration.span } : {}),
        };
      }
      for (const [header, slotName] of Object.entries(declaration.columns)) {
        const columnIndex = headers.indexOf(header.trim());
        const cell = row.cells[columnIndex];
        const slot = runtimeClass.slots[slotName]!;
        if (!cell) {
          rowValid = false;
          continue;
        }
        const converted = tableValue(cell, slot, ir);
        if (converted.error) {
          diagnostics.push(
            tableDocumentDiagnostic(
              declaration,
              target,
              'TABLE_VALUE',
              `${idCell.value}.${slotName}: ${converted.error}`,
              cell.span,
              slotName,
              idCell.value,
            ),
          );
          rowValid = false;
          continue;
        }
        if (converted.value !== undefined) data[slotName] = converted.value;
        spans[slotName] = cell.span;
        propertySources[slotName] = {
          source: `${rowSource}#column=${locatorSegment(headers[columnIndex]!)}`,
          physicalPath: target.physicalPath,
          representation: 'markdown-table',
          span: cell.span,
        };
      }
      generatedRows.push({
        source: rowSource,
        physicalPath: target.physicalPath,
        data,
        spans,
        links: [],
        sections: [],
        declaredClass: runtimeClass.name,
        enriched: true,
        propertySources,
        narrativeSource: {
          source: rowSource,
          physicalPath: target.physicalPath,
          representation: 'markdown-table',
          span: row.span,
        },
        ...(rowValid ? {} : { parseDiagnostics: [] }),
      });
    }
    const declarationHasStructuralError = diagnostics
      .slice(declarationDiagnosticStart)
      .some((diagnostic) => diagnostic.code !== 'TABLE_VALUE');
    if (!declarationHasStructuralError) rows.push(...generatedRows);
  }
  return { rows, diagnostics };
}

function expandEnrichedCandidates(
  candidates: Candidate[],
  ir: RuntimeSchemaIR,
): { documents: Candidate[]; manifests: Candidate[] } {
  const documents: Candidate[] = [];
  const manifests: Candidate[] = [];
  for (const candidate of candidates) {
    if (candidate.manifest) {
      manifests.push(candidate);
      continue;
    }
    const declarations = candidate.sectionDeclarations;
    if (!declarations) {
      documents.push(candidate);
      continue;
    }
    type SectionTarget = {
      key: string;
      section: MarkdownSection;
      mode: 'anchor' | 'heading';
      headingMatch?: HeadingIdentityMatch;
    };
    const targets: SectionTarget[] = [];
    const unresolved: Array<{
      key: string;
      code: 'BINDING_MISSING' | 'BINDING_AMBIGUOUS' | 'BINDING_ANCHOR';
      message: string;
      span?: SourceSpan;
      related_spans?: SourceSpan[];
    }> = [];
    for (const key of Object.keys(declarations)) {
      const anchorMatches = candidate.sections.filter((section) => section.anchor === key);
      const headingMatches = candidate.sections.filter((section) =>
        (section.headingIdentityMatches ?? []).some((match) => match.id === key),
      );
      const overlappingHeading = headingMatches.find(
        (section) => (section.headingIdentityMatches ?? []).length > 1,
      );
      if (
        anchorMatches.length > 1 ||
        headingMatches.length > 1 ||
        overlappingHeading ||
        (anchorMatches.length && headingMatches.length && anchorMatches[0] !== headingMatches[0])
      ) {
        unresolved.push({
          key,
          code: 'BINDING_AMBIGUOUS',
          message: `section declaration ${key} matches multiple identity representations`,
          ...(overlappingHeading?.span
            ? { span: overlappingHeading.span }
            : anchorMatches[0]?.span
              ? { span: anchorMatches[0].span }
              : headingMatches[0]?.span
                ? { span: headingMatches[0].span }
                : {}),
          related_spans: [...anchorMatches.slice(1), ...headingMatches]
            .map((section) => section.span)
            .filter((value): value is SourceSpan => Boolean(value)),
        });
        continue;
      }
      const section = anchorMatches[0] ?? headingMatches[0];
      if (!section) {
        const declarationSpan = spanLookup(candidate.spans, `lore.sections.${key}`);
        unresolved.push({
          key,
          code:
            !(ir.headingIdentity ?? []).length && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
              ? 'BINDING_ANCHOR'
              : 'BINDING_MISSING',
          message:
            !(ir.headingIdentity ?? []).length && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)
              ? `section declaration anchor ${key} must match [A-Za-z][A-Za-z0-9_-]*`
              : `section declaration ${key} has no matching heading`,
          ...(declarationSpan ? { span: declarationSpan } : {}),
        });
        continue;
      }
      const matches = (section.headingIdentityMatches ?? []).filter((match) => match.id === key);
      if (matches.length > 1) {
        unresolved.push({
          key,
          code: 'BINDING_AMBIGUOUS',
          message: `section declaration ${key} matches multiple heading identity rules`,
          ...(section.span ? { span: section.span } : {}),
        });
        continue;
      }
      targets.push({
        key,
        section,
        mode: anchorMatches.length ? 'anchor' : 'heading',
        ...(matches[0] ? { headingMatch: matches[0] } : {}),
      });
    }
    const excludedIndexes = new Set<number>();
    for (const [index, section] of candidate.sections.entries()) {
      if (!targets.some((target) => target.section === section)) continue;
      excludedIndexes.add(index);
      for (let next = index + 1; next < candidate.sections.length; next++) {
        const following = candidate.sections[next]!;
        if (following.level <= section.level) break;
        excludedIndexes.add(next);
      }
    }
    documents.push({
      ...candidate,
      enriched: true,
      sections: candidate.sections.filter((_, index) => !excludedIndexes.has(index)),
      links: candidate.links.filter((link) => {
        const line = link.span?.line;
        if (line === undefined) return true;
        return !candidate.sections.some((section, index) => {
          if (
            !targets.some((target) => target.section === section) ||
            section.span?.line === undefined
          )
            return false;
          const end = sectionEndLine(candidate.sections, index);
          return section.span.line <= line && line < end;
        });
      }),
    });
    for (const unresolvedTarget of unresolved) {
      documents.push({
        ...candidate,
        source: `${candidate.source}#heading-id=${locatorSegment(unresolvedTarget.key)}`,
        data: {},
        spans: candidate.spans,
        sections: [],
        links: [],
        parseDiagnostics: [
          {
            severity: 'error',
            code: unresolvedTarget.code,
            message: unresolvedTarget.message,
            source: candidate.source,
            ...(unresolvedTarget.span ? { span: unresolvedTarget.span } : {}),
            ...(unresolvedTarget.related_spans
              ? { related_spans: unresolvedTarget.related_spans }
              : {}),
          },
        ],
      });
    }
    for (const target of targets) {
      const { key: anchor, section, mode, headingMatch } = target;
      const raw = declarations[anchor];
      if (!section) {
        documents.push({
          ...candidate,
          source: `${candidate.source}#anchor=${anchor}`,
          data: {},
          spans: candidate.spans,
          sections: [],
          links: [],
          parseDiagnostics: [
            {
              severity: 'error',
              code: 'BINDING_MISSING',
              message: `section ${anchor} is missing`,
              source: candidate.source,
            },
          ],
        });
        continue;
      }
      const sectionIndex = candidate.sections.indexOf(section);
      const endLine = sectionEndLine(candidate.sections, sectionIndex);
      const nestedDeclared = candidate.sections.filter((child, childIndex) => {
        if (childIndex === sectionIndex || !targets.some((target) => target.section === child))
          return false;
        return (
          child.span?.line !== undefined &&
          section.span?.line !== undefined &&
          child.span.line > section.span.line &&
          child.span.line < endLine
        );
      });
      const data =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      // Document parse diagnostics belong to the document candidate. Expanded
      // sections retain only diagnostics created for their own declaration.
      const sectionDiagnostics: Diagnostic[] = [];
      const matchingClass = classify({ ...candidate, data }, ir);
      const identifierSlot = matchingClass
        ? Object.values(matchingClass.slots).find((slot) => slot.identifier)
        : undefined;
      if (mode === 'heading' && headingMatch) {
        if (identifierSlot && Object.prototype.hasOwnProperty.call(data, identifierSlot.name))
          sectionDiagnostics.push({
            severity: 'error',
            code: 'OWNERSHIP_CONFLICT',
            message: `heading-owned identity ${identifierSlot.name} cannot be redeclared in section ${anchor}`,
            source: candidate.source,
            artifact: anchor,
            slot: identifierSlot.name,
            ...(section.span ? { span: section.span } : {}),
          });
        if (matchingClass?.slots.title && Object.prototype.hasOwnProperty.call(data, 'title'))
          sectionDiagnostics.push({
            severity: 'error',
            code: 'OWNERSHIP_CONFLICT',
            message: `heading-owned title cannot be redeclared in section ${anchor}`,
            source: candidate.source,
            artifact: anchor,
            slot: 'title',
            ...(section.span ? { span: section.span } : {}),
          });
        if (identifierSlot) data[identifierSlot.name] = headingMatch.id;
        if (matchingClass?.slots.title) data.title = headingMatch.title;
      }
      if (nestedDeclared.length)
        sectionDiagnostics.push({
          severity: 'error',
          code: 'BINDING_OVERLAP',
          message: `section ${anchor} contains nested declared entity region ${nestedDeclared[0]!.anchor}`,
          source: candidate.source,
          artifact: anchor,
          ...(nestedDeclared[0]!.span ? { span: nestedDeclared[0]!.span } : {}),
        });
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        sectionDiagnostics.push({
          severity: 'error',
          code: 'BINDING_SHAPE',
          message: `section declaration ${anchor} must be a mapping`,
          source: candidate.source,
          ...(section.span ? { span: section.span } : {}),
        });
      const declaredDesignator = Object.values(ir.classes)
        .map((runtimeClass) => runtimeClass.designatorSlot)
        .filter((name): name is string => Boolean(name))
        .find((name) => data[name] !== undefined);
      const declaredClass =
        declaredDesignator === undefined ? undefined : String(data[declaredDesignator]);
      const validDeclaredClass =
        declaredDesignator === undefined ||
        Object.values(ir.classes).some(
          (runtimeClass) =>
            runtimeClass.designatorSlot === declaredDesignator &&
            (runtimeClass.name === declaredClass || runtimeClass.typeId === declaredClass),
        );
      if (declaredClass !== undefined && !validDeclaredClass)
        sectionDiagnostics.push({
          severity: 'error',
          code: 'INVALID_CLASS',
          message: `section ${anchor} declares unknown runtime class ${declaredClass}`,
          source: candidate.source,
          artifact: anchor,
          ...(section.span ? { span: section.span } : {}),
        });
      if (matchingClass?.designatorSlot && data[matchingClass.designatorSlot] === undefined)
        data[matchingClass.designatorSlot] = matchingClass.name;
      if (
        mode === 'anchor' &&
        identifierSlot &&
        (typeof data[identifierSlot.name] !== 'string' || !data[identifierSlot.name])
      )
        sectionDiagnostics.push({
          severity: 'error',
          code: 'SECTION_ID_REQUIRED',
          message: `section ${anchor} requires an explicit stable ${identifierSlot.name}`,
          source: candidate.source,
          artifact: anchor,
          ...(section.span ? { span: section.span } : {}),
        });
      const propertySources: Record<string, SourceDescriptor> = {};
      const frontmatterOwner = `${candidate.source}#frontmatter=lore.sections.${locatorSegment(anchor)}`;
      for (const name of Object.keys(data)) {
        const declarationName = name === identifierSlot?.name && name !== 'id' ? 'id' : name;
        const propertySpan =
          candidate.spans[`lore.sections.${anchor}.${name}`] ??
          candidate.spans[`lore.sections.${anchor}.${declarationName}`] ??
          candidate.spans[`lore.sections.${anchor}`];
        propertySources[name] = {
          source: frontmatterOwner,
          physicalPath: candidate.physicalPath,
          representation: 'frontmatter',
          ...(propertySpan ? { span: propertySpan } : {}),
        };
      }
      if (mode === 'heading' && headingMatch) {
        if (identifierSlot)
          propertySources[identifierSlot.name] = {
            source: `${candidate.source}#heading-id=${locatorSegment(headingMatch.id)}`,
            physicalPath: candidate.physicalPath,
            representation: 'markdown',
            ...(section.span ? { span: section.span } : {}),
          };
        if (matchingClass?.slots.title)
          propertySources.title = {
            source: `${candidate.source}#heading-id=${locatorSegment(headingMatch.id)}`,
            physicalPath: candidate.physicalPath,
            representation: 'markdown',
            ...(section.span ? { span: section.span } : {}),
          };
      }
      const sectionSpans: Record<string, SourceSpan> = {};
      for (const name of Object.keys(data)) {
        const declarationName = name === identifierSlot?.name && name !== 'id' ? 'id' : name;
        const propertySpan =
          candidate.spans[`lore.sections.${anchor}.${name}`] ??
          candidate.spans[`lore.sections.${anchor}.${declarationName}`] ??
          candidate.spans[`lore.sections.${anchor}`];
        if (propertySpan) sectionSpans[name] = propertySpan;
      }
      const regionSections = candidate.sections.filter((child, childIndex) => {
        if (childIndex === sectionIndex) return false;
        if (child.span?.line === undefined || section.span?.line === undefined) return false;
        if (child.span.line <= section.span.line || child.span.line >= endLine) return false;
        return !candidate.sections.some((nested, nestedIndex) => {
          if (
            nestedIndex === sectionIndex ||
            !targets.some((target) => target.section === nested) ||
            nested.span?.line === undefined
          )
            return false;
          const nestedEnd = sectionEndLine(candidate.sections, nestedIndex);
          return nested.span.line <= child.span!.line && child.span!.line < nestedEnd;
        });
      });
      const regionBody = sectionRegionBody(candidate, section);
      documents.push({
        ...candidate,
        enriched: true,
        source:
          mode === 'heading'
            ? `${candidate.source}#heading-id=${locatorSegment(headingMatch!.id)}`
            : `${candidate.source}#anchor=${anchor}`,
        data,
        spans: sectionSpans,
        sections: regionSections,
        links: section.links,
        propertySources,
        observedTitle: section.heading,
        ...(section.blocks[0] ? { observedDescription: section.blocks[0] } : {}),
        ...(regionBody === undefined
          ? {}
          : {
              body: regionBody,
              ...(section.span ? { bodyStartLine: section.span.line } : {}),
            }),
        narrativeSource: {
          source:
            mode === 'heading'
              ? `${candidate.source}#heading-id=${locatorSegment(headingMatch!.id)}`
              : `${candidate.source}#anchor=${anchor}`,
          physicalPath: candidate.physicalPath,
          representation: 'narrative',
          ...(section.span ? { span: section.span } : {}),
        },
        parseDiagnostics: sectionDiagnostics,
      });
    }
    for (const section of candidate.sections)
      if (section.anchor && !Object.prototype.hasOwnProperty.call(declarations, section.anchor))
        continue;
  }
  return { documents, manifests };
}
function runtimeSubclass(
  ir: RuntimeSchemaIR,
  child: string,
  parent: string,
  seen = new Set<string>(),
): boolean {
  if (child === parent) return true;
  if (seen.has(child)) return false;
  seen.add(child);
  const c = ir.classes[child];
  return Boolean(
    c &&
    [c.parent, ...c.mixins]
      .filter((x): x is string => Boolean(x))
      .some((x) => runtimeSubclass(ir, x, parent, seen)),
  );
}
export function buildGraph(candidates: Candidate[], options: BuildOptions): BuildResult {
  const { compiled, root } = options;
  const ir = compiled.ir;
  const index: IndexV2 = {
    version: 2,
    schema_hash: compiled.hash,
    artifacts: {},
    edges: [],
    diagnostics: [],
  };
  const expanded = expandEnrichedCandidates(
    candidates.map((candidate) => headingIdentityCandidate(candidate, ir)),
    ir,
  );
  const tableExpansion = expandTables(candidates, ir, root);
  expanded.documents.push(...tableExpansion.rows);
  index.diagnostics!.push(...tableExpansion.diagnostics);
  const manifestDocumentPaths = new Set(
    expanded.manifests.flatMap((manifest) =>
      (manifest.manifest?.bindings ?? [])
        .filter((binding) => binding.anchor === undefined)
        .map((binding) => resolve(dirname(manifest.physicalPath), binding.document)),
    ),
  );
  const candidateById = new Map<string, { candidate: Candidate; cls: RuntimeClass }>();
  for (const original of [...expanded.documents].sort((a, b) => a.source.localeCompare(b.source))) {
    if (original.parseDiagnostics?.length) index.diagnostics!.push(...original.parseDiagnostics);
    const materializationCandidate =
      manifestDocumentPaths.has(resolve(original.physicalPath)) && !original.enriched
        ? { ...original, enriched: true }
        : original;
    const cls = original.declaredClass
      ? Object.values(ir.classes).find(
          (runtimeClass) =>
            runtimeClass.name === original.declaredClass ||
            runtimeClass.typeId === original.declaredClass,
        )
      : classify(materializationCandidate, ir);
    if (!cls) continue;
    const materialized = materializeMarkdown(materializationCandidate, cls);
    const c = materialized.candidate;
    const id = identity(c, cls, root);
    const a: Artifact = {
      id: id.id,
      kind: cls.name,
      type_id: cls.typeId,
      source: c.source,
      physical_path: c.physicalPath,
      data: { ...c.data },
      links: c.links,
      ...(id.identifier === undefined ? {} : { identifier: id.identifier }),
      ...(c.body === undefined || c.body === '' ? {} : { body: c.body }),
    };
    index.diagnostics!.push(...materialized.diagnostics);
    a.provenance = {
      source: c.source,
      physicalPath: c.physicalPath,
      ...(c.enriched ? { enriched: true } : {}),
      ...(original.narrativeSource?.span
        ? { span: original.narrativeSource.span }
        : c.sections.find((section) => section.span)?.span
          ? { span: c.sections.find((section) => section.span)!.span }
          : {}),
      ...(c.narrativeSource ? { narrative: c.narrativeSource } : {}),
      ...(c.propertySources ? { properties: c.propertySources } : {}),
    };
    if (index.artifacts[a.id]) {
      const first = index.artifacts[a.id]!;
      const duplicateSpan = span(c, 'id');
      index.diagnostics!.push({
        ...diag('error', 'DUPLICATE_ID', `duplicate id ${a.id}; first seen at ${first.source}`, c),
        artifact: a.id,
        ...(duplicateSpan === undefined ? {} : { span: duplicateSpan }),
      });
      continue;
    }
    index.artifacts[a.id] = a;
    candidateById.set(a.id, { candidate: c, cls });
  }
  // A manifest only enriches an already materialized document/section. It never
  // participates in classification or creates an artifact of its own.
  for (const manifest of expanded.manifests) {
    index.diagnostics!.push(...(manifest.parseDiagnostics ?? []));
    for (const binding of manifest.manifest?.bindings ?? []) {
      const targetPath = resolve(dirname(manifest.physicalPath), binding.document);
      if (isAbsolute(binding.document) || !targetPath.startsWith(`${resolve(root)}/`)) {
        index.diagnostics!.push({
          severity: 'error',
          code: 'BINDING_PATH',
          message: `manifest document ${binding.document} is outside workspace`,
          source: binding.source,
          ...(binding.span ? { span: binding.span } : {}),
        });
        continue;
      }
      const matches = [...candidateById.entries()].filter(([, value]) => {
        if (resolve(value.candidate.physicalPath) !== targetPath) return false;
        if (binding.headingId !== undefined)
          return (
            value.candidate.source ===
            `${targetPath}#heading-id=${locatorSegment(binding.headingId)}`
          );
        return binding.anchor === undefined
          ? value.candidate.source === targetPath
          : value.candidate.source === `${targetPath}#anchor=${binding.anchor}`;
      });
      if (matches.length === 0) {
        index.diagnostics!.push({
          severity: 'error',
          code: 'BINDING_MISSING',
          message: `manifest binding target ${binding.document}${binding.headingId ? `#heading-id=${binding.headingId}` : binding.anchor ? `#${binding.anchor}` : ''} was not found`,
          source: binding.source,
          ...(binding.span ? { span: binding.span } : {}),
        });
        continue;
      }
      if (matches.length !== 1) {
        index.diagnostics!.push({
          severity: 'error',
          code: 'BINDING_AMBIGUOUS',
          message: `manifest binding target ${binding.document}${binding.headingId ? `#heading-id=${binding.headingId}` : binding.anchor ? `#${binding.anchor}` : ''} is ambiguous`,
          source: binding.source,
          ...(binding.span ? { span: binding.span } : {}),
        });
        continue;
      }
      const [id, entry] = matches[0]!;
      if (id !== binding.id) {
        index.diagnostics!.push({
          severity: 'error',
          code: 'IDENTITY_BINDING',
          message: `manifest expected ${binding.id} but resolved ${id}`,
          source: binding.source,
          artifact: id,
          ...(binding.span ? { span: binding.span } : {}),
        });
        continue;
      }
      const artifact = index.artifacts[id]!;
      for (const [name, value] of Object.entries(binding.properties)) {
        const slot = entry.cls.slots[name];
        const sourceSpan = binding.propertySpans?.[name] ?? binding.span;
        if (!slot) {
          index.diagnostics!.push({
            severity: 'error',
            code: 'UNKNOWN_SLOT',
            message: `manifest slot ${name} is not allowed for kind ${entry.cls.name}`,
            source: binding.source,
            artifact: id,
            slot: name,
            ...(sourceSpan ? { span: sourceSpan } : {}),
          });
          continue;
        }
        if (slot.identifier || slot.designatesType) {
          index.diagnostics!.push({
            severity: 'error',
            code: 'OWNERSHIP_CONFLICT',
            message: `manifest cannot own identity or classification slot ${name}`,
            source: binding.source,
            artifact: id,
            slot: name,
            ...(sourceSpan ? { span: sourceSpan } : {}),
          });
          continue;
        }
        const existing = artifact.provenance?.properties?.[name];
        if (existing) {
          if (
            !artifact.provenance?.enriched &&
            markdownValuesEqual(slot, artifact.data[name], value)
          )
            continue;
          index.diagnostics!.push({
            severity: 'error',
            code: 'OWNERSHIP_CONFLICT',
            message: `slot ${name} has competing owners`,
            source: binding.source,
            artifact: id,
            slot: name,
            ...(sourceSpan ? { span: sourceSpan } : {}),
            ...(existing.span ? { related_spans: [existing.span] } : {}),
          });
          continue;
        }
        artifact.data[name] = value;
        artifact.provenance ??= { source: artifact.source, physicalPath: artifact.physical_path };
        artifact.provenance.properties ??= {};
        artifact.provenance.properties[name] = {
          source: `${binding.source}#binding=${binding.document}${binding.headingId ? `#heading-id=${locatorSegment(binding.headingId)}` : binding.anchor ? `#anchor=${binding.anchor}` : ''}#property=${name}`,
          physicalPath: manifest.physicalPath,
          representation: 'manifest',
          ...(sourceSpan ? { span: sourceSpan } : {}),
        };
      }
    }
  }
  for (const [id, entry] of candidateById) {
    const artifact = index.artifacts[id];
    if (!artifact) continue;
    index.diagnostics!.push(
      ...validate(
        { ...entry.candidate, data: artifact.data },
        entry.cls,
        id,
        options.strict !== false,
        ir,
        compiled.schema,
        {
          owner: artifact,
          artifacts: index.artifacts,
          emit(slot, raw, target, valuePath, parts) {
            const relation = parts.filter((p): p is string => typeof p === 'string').join('.');
            const nested = parts.filter((p) => typeof p === 'string').length > 1;
            const descriptor =
              artifact.provenance?.properties?.[relation] ??
              artifact.provenance?.properties?.[parts[0] as string];
            const sourceSpan = spanLookup(entry.candidate.spans, valuePath) ?? descriptor?.span;
            const provenance = descriptor
              ? { ...descriptor, ...(sourceSpan ? { span: sourceSpan } : {}) }
              : nested
                ? {
                    source: entry.candidate.source,
                    physicalPath: entry.candidate.physicalPath,
                    representation: 'frontmatter' as const,
                    ...(sourceSpan ? { span: sourceSpan } : {}),
                  }
                : undefined;
            index.edges!.push({
              from: id,
              relation,
              to: target,
              surface: raw,
              ...(nested ? { value_path: parts } : {}),
              ...((artifact.provenance?.enriched || nested) && provenance ? { provenance } : {}),
            });
            if (slot.inverse)
              index.edges!.push({ from: target, relation: slot.inverse, to: id, inferred: true });
          },
        },
      ),
    );
  }
  for (const a of Object.values(index.artifacts))
    for (const l of a.links ?? []) {
      let t = resolveTarget(l.target, a, index.artifacts);
      if (!t && l.syntax === 'markdown') {
        const expected = resolve(dirname(a.physical_path), l.target.split('#', 1)[0]!);
        const matches = Object.values(index.artifacts).filter(
          (candidate) => resolve(candidate.physical_path) === expected,
        );
        if (matches.length === 1) t = matches[0]!.id;
      }
      if (t)
        index.edges!.push({
          from: a.id,
          relation: 'references',
          to: t,
          generic: true,
          surface: l.target,
        });
      else if (l.syntax === 'wiki')
        index.diagnostics!.push({
          severity: 'warning',
          code: 'UNRESOLVED_WIKILINK',
          message: `cannot resolve wiki-link [[${l.target}]]`,
          source: a.source,
          artifact: a.id,
          ...(l.span === undefined ? {} : { span: l.span }),
        });
    }
  // Unique keys are class-level constraints and apply to every subclass. The
  // runtime IR already carries inherited keys, so validate the complete set.
  for (const cls of Object.values(ir.classes))
    for (const key of Object.values(cls.uniqueKeys)) {
      const seen = new Map<string, string>();
      for (const artifact of Object.values(index.artifacts)) {
        if (!runtimeSubclass(ir, artifact.kind, cls.name)) continue;
        const values = key.slots.map((slotName) => artifact.data[slotName]);
        if (values.some((value) => value === undefined)) continue;
        const composite = values.map((value) => String(value)).join('\x1f');
        const prior = seen.get(composite);
        if (prior)
          index.diagnostics!.push({
            severity: 'error',
            code: 'UNIQUE_KEY',
            message: `unique key ${key.name} conflicts with ${prior}`,
            source: artifact.source,
            artifact: artifact.id,
            slot: key.slots.join(','),
          });
        else seen.set(composite, artifact.id);
      }
    }
  index.diagnostics = [
    ...new Map(
      index.diagnostics!.map(
        (diagnostic) =>
          [
            JSON.stringify([
              diagnostic.severity,
              diagnostic.code,
              diagnostic.message,
              diagnostic.source,
              diagnostic.artifact,
              diagnostic.slot,
              diagnostic.span,
              diagnostic.related_spans,
            ]),
            diagnostic,
          ] as const,
      ),
    ).values(),
  ];
  index.diagnostics.sort(
    (a, b) =>
      (a.source ?? '').localeCompare(b.source ?? '') ||
      (a.artifact ?? '').localeCompare(b.artifact ?? '') ||
      a.code.localeCompare(b.code) ||
      (a.slot ?? '').localeCompare(b.slot ?? '') ||
      (a.span === undefined ? (b.span === undefined ? 0 : 1) : b.span === undefined ? -1 : 0) ||
      (a.span?.line ?? 0) - (b.span?.line ?? 0) ||
      (a.span?.column ?? 0) - (b.span?.column ?? 0),
  );
  const compareText = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  index.edges!.sort(
    (a, b) =>
      compareText(a.from, b.from) || compareText(a.relation, b.relation) || compareText(a.to, b.to),
  );
  return { index, schema: ir };
}
export function checkReport(index: IndexV2): CheckReport {
  const classes = new Map<string, { class: string; type_id?: string; count: number }>();
  for (const a of Object.values(index.artifacts)) {
    const x = classes.get(a.kind) ?? { class: a.kind, type_id: a.type_id, count: 0 };
    x.count++;
    classes.set(a.kind, x);
  }
  const errors = (index.diagnostics ?? []).filter((x) => x.severity === 'error').length;
  return {
    summary: {
      artifacts: Object.keys(index.artifacts).length,
      edges: (index.edges ?? []).length,
      diagnostics: (index.diagnostics ?? []).length,
      errors,
      warnings: (index.diagnostics ?? []).length - errors,
    },
    classes: [...classes.values()].sort(
      (a, b) => b.count - a.count || a.class.localeCompare(b.class),
    ),
    diagnostics: index.diagnostics ?? [],
  };
}
export type ExploreMetadata = {
  schemaPath?: string;
  indexPath?: string;
  schemaHash?: string;
  raw?: boolean;
  human?: boolean;
};
type ExploreField = {
  name: string;
  roles: string[];
  views: string[];
  order: number;
  hidden: boolean;
};
type ExploreRelation = {
  slot: string;
  inverseSlot: string;
  role: string;
  label: string;
  views: string[];
};
type LogicalEdge = { edge: Edge; relation: ExploreRelation; inverseInferred: boolean };
type EdgeView = {
  from: ExploreNode;
  to: ExploreNode;
  slot: string;
  label: string;
  role: string;
  inverse_slot: string;
  direction: string;
  inferred: boolean;
  inverse_inferred: boolean;
  distance: number;
};
const profileFor = (
  ir: RuntimeSchemaIR,
  className: string,
): { fields: ExploreField[]; relations: Record<string, ExploreRelation> } => {
  const runtimeClass = ir.classes[className];
  const fields: ExploreField[] = [];
  const relations: Record<string, ExploreRelation> = {};
  if (!runtimeClass) return { fields, relations };
  for (const [name, slot] of Object.entries(runtimeClass.slots)) {
    const roles = annotationStrings(slot.annotations['lore:explore_roles']);
    if ((slot.identifier || slot.key) && !roles.includes('identity')) roles.push('identity');
    if (roles.length)
      fields.push({
        name,
        roles,
        views: annotationStrings(slot.annotations['lore:explore_views']),
        order:
          typeof slot.annotations['lore:explore_order'] === 'number'
            ? slot.annotations['lore:explore_order']
            : 0,
        hidden: roles.includes('hidden'),
      });
    const role = slot.annotations['lore:explore_relation'];
    if (typeof role === 'string' && ir.classes[slot.range])
      relations[name] = {
        slot: name,
        inverseSlot: slot.inverse ?? '',
        role,
        label:
          typeof slot.annotations['lore:explore_label'] === 'string'
            ? slot.annotations['lore:explore_label']
            : name,
        views: annotationStrings(slot.annotations['lore:explore_views']),
      };
  }
  fields.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  return { fields, relations };
};
const exploreNode = (ir: RuntimeSchemaIR, artifact: Artifact | undefined): ExploreNode => {
  if (!artifact) return { id: '' };
  let label = artifact.id;
  for (const field of profileFor(ir, artifact.kind).fields)
    if (field.roles.includes('title') && artifact.data[field.name] !== undefined) {
      const encoded = JSON.stringify(artifact.data[field.name]);
      label =
        encoded === undefined ? String(artifact.data[field.name]) : encoded.replace(/^"|"$/g, '');
      break;
    }
  return { id: artifact.id, kind: artifact.kind, label, source: artifact.source };
};
const relationFor = (
  ir: RuntimeSchemaIR,
  artifact: Artifact | undefined,
  slot: string,
  view: string,
): ExploreRelation | undefined => {
  if (!artifact) return undefined;
  const profile = profileFor(ir, artifact.kind);
  let relation = profile.relations[slot];
  if (!relation)
    for (const name of Object.keys(ir.classes[artifact.kind]?.slots ?? {}).sort()) {
      const candidate = ir.classes[artifact.kind]!.slots[name]!;
      if (candidate.inverse === slot && profile.relations[name]) {
        relation = profile.relations[name];
        break;
      }
    }
  if (!relation || (view && relation.views.length && !relation.views.includes(view)))
    return undefined;
  return relation;
};
const edgeKey = (from: string, to: string, relation: string): string =>
  `${from}\0${to}\0${relation}`;
const logicalEdges = (
  index: IndexV2,
  ir: RuntimeSchemaIR,
  view: string,
): { edges: LogicalEdge[]; inferred: number; excluded: number } => {
  const direct = new Set(
    (index.edges ?? [])
      .filter((edge) => !edge.generic && !edge.inferred)
      .map((edge) => edgeKey(edge.from, edge.to, edge.relation)),
  );
  const edges: LogicalEdge[] = [];
  let inferred = 0;
  let excluded = 0;
  for (const edge of index.edges ?? []) {
    if (edge.generic) {
      excluded++;
      continue;
    }
    if (!index.artifacts[edge.from] || !index.artifacts[edge.to]) continue;
    const relation = relationFor(ir, index.artifacts[edge.from], edge.relation, view);
    if (!relation) continue;
    if (edge.inferred) {
      const canonical = relation.inverseSlot || relation.slot;
      if (direct.has(edgeKey(edge.to, edge.from, canonical))) {
        inferred++;
        continue;
      }
    }
    const inverseInferred =
      !edge.inferred &&
      Boolean(relation.inverseSlot) &&
      (index.edges ?? []).some(
        (candidate) =>
          candidate.from === edge.to &&
          candidate.to === edge.from &&
          candidate.relation === relation.inverseSlot &&
          candidate.inferred === true &&
          !candidate.generic,
      );
    edges.push({ edge, relation, inverseInferred });
  }
  edges.sort(
    (left, right) =>
      left.edge.from.localeCompare(right.edge.from) ||
      left.edge.to.localeCompare(right.edge.to) ||
      left.edge.relation.localeCompare(right.edge.relation),
  );
  return { edges, inferred, excluded };
};
const edgeView = (ir: RuntimeSchemaIR, index: IndexV2, item: LogicalEdge): EdgeView => ({
  from: exploreNode(ir, index.artifacts[item.edge.from]),
  to: exploreNode(ir, index.artifacts[item.edge.to]),
  slot: item.edge.relation,
  label: item.relation.label,
  role: item.relation.role,
  inverse_slot: item.relation.inverseSlot,
  direction: 'outgoing',
  inferred: Boolean(item.edge.inferred),
  inverse_inferred: item.inverseInferred,
  distance: 0,
});
const sortEdgeViews = (values: EdgeView[]): EdgeView[] =>
  values.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.from.id.localeCompare(right.from.id) ||
      left.to.id.localeCompare(right.to.id) ||
      left.slot.localeCompare(right.slot),
  );
const hasCycles = (ids: string[], edges: LogicalEdge[]): boolean => {
  const allowed = new Set(ids);
  const adjacency = new Map<string, string[]>();
  for (const { edge } of edges)
    if (allowed.has(edge.from) && allowed.has(edge.to))
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    if ((adjacency.get(id) ?? []).some(visit)) return true;
    state.set(id, 2);
    return false;
  };
  return ids.some(visit);
};
const componentIds = (ids: string[], edges: LogicalEdge[], start: string): string[] => {
  const allowed = new Set(ids);
  const found = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const { edge } of edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
      if (next && allowed.has(next) && !found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return [...found].sort();
};
export function explore(
  index: IndexV2,
  requestedView: string,
  id?: string,
  depth = 1,
  ir?: RuntimeSchemaIR,
  metadata: ExploreMetadata = {},
): ExploreReport {
  if (!ir) throw new Error('explore requires both an index and a schema');
  if (depth < 0 || depth > 32) throw new Error('depth must be between 0 and 32');
  const view = requestedView || (id ? 'card' : 'overview');
  if (!['overview', 'card', 'tree', 'neighborhood', 'impact'].includes(view))
    throw new Error(`unknown explore view ${JSON.stringify(view)}`);
  if (view !== 'overview' && !id) throw new Error('explore view requires an artifact id');
  if (id && !index.artifacts[id]) throw new Error(`artifact ${id} not found`);
  const logical = logicalEdges(index, ir, view);
  const allIds = Object.keys(index.artifacts).sort();
  const makeReport = (
    query: Record<string, unknown>,
    root: ExploreNode | undefined,
    data: unknown,
  ): ExploreReport => ({
    version: 1,
    view,
    query,
    ...(root === undefined ? {} : { root }),
    meta: {
      ...(metadata.schemaPath ? { schema_path: metadata.schemaPath } : {}),
      ...(metadata.indexPath ? { index_path: metadata.indexPath } : {}),
      schema_hash: metadata.schemaHash ?? index.schema_hash,
      index_schema_hash: index.schema_hash,
      edge_filter: 'annotated-non-generic-logical',
      logical_edges: logical.edges.length,
      inferred_representations: logical.inferred,
      excluded_generic_edges: logical.excluded,
      has_cycles: hasCycles(allIds, logical.edges),
    },
    data,
  });
  if (view === 'overview') {
    const ids = id ? componentIds(allIds, logical.edges, id) : allIds;
    const allowed = new Set(ids);
    const edges = logical.edges.filter(
      ({ edge }) => allowed.has(edge.from) && allowed.has(edge.to),
    );
    const counts = new Map<string, number>();
    const degree = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const nodeId of ids) {
      const kind = index.artifacts[nodeId]!.kind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    for (const { edge } of edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }
    const entry = ids
      .filter((nodeId) => !incoming.get(nodeId))
      .map((nodeId) => exploreNode(ir, index.artifacts[nodeId]));
    const orphans = ids
      .filter((nodeId) => !degree.get(nodeId))
      .map((nodeId) => exploreNode(ir, index.artifacts[nodeId]));
    const most = ids
      .filter((nodeId) => (degree.get(nodeId) ?? 0) > 1)
      .map((nodeId) => ({
        node: exploreNode(ir, index.artifacts[nodeId]),
        degree: degree.get(nodeId)!,
      }))
      .sort(
        (left, right) => right.degree - left.degree || left.node.id.localeCompare(right.node.id),
      )
      .slice(0, 10);
    const remaining = new Set(ids);
    const components: Array<{ artifacts: ExploreNode[]; edges: EdgeView[] }> = [];
    while (remaining.size) {
      const start = [...remaining].sort()[0]!;
      const members = componentIds(ids, edges, start);
      members.forEach((member) => remaining.delete(member));
      components.push({
        artifacts: members.map((member) => exploreNode(ir, index.artifacts[member])),
        edges: sortEdgeViews(
          edges
            .filter(({ edge }) => members.includes(edge.from) && members.includes(edge.to))
            .map((edge) => edgeView(ir, index, edge)),
        ),
      });
    }
    components.sort((left, right) => left.artifacts[0]!.id.localeCompare(right.artifacts[0]!.id));
    return makeReport(
      { ...(id ? { root: id } : {}), ...(depth ? { depth } : {}) },
      id ? exploreNode(ir, index.artifacts[id]) : undefined,
      {
        artifacts: ids.length,
        logical_edges: edges.length,
        inferred_representations: logical.inferred,
        cycles: hasCycles(ids, edges),
        classes: [...counts]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([className, count]) => ({ class: className, count })),
        connected_components: components,
        entry_points: entry,
        ...(entry.length ? {} : { entry_point_reason: 'every node has an incoming logical edge' }),
        orphans,
        ...(orphans.length ? {} : { orphan_reason: 'every node participates in a logical edge' }),
        most_connected: most,
      },
    );
  }
  const rootArtifact = index.artifacts[id!]!;
  const rootRef = exploreNode(ir, rootArtifact);
  if (view === 'card') {
    const profile = profileFor(ir, rootArtifact.kind);
    const fields = profile.fields
      .filter((field) => !field.hidden && (!field.views.length || field.views.includes('card')))
      .filter((field) => rootArtifact.data[field.name] !== undefined)
      .map((field) => ({
        name: field.name,
        roles: field.roles,
        value: rootArtifact.data[field.name],
      }));
    const edges = sortEdgeViews(
      logical.edges
        .filter(({ edge }) => edge.from === id || edge.to === id)
        .map((item) => ({
          ...edgeView(ir, index, item),
          direction: item.edge.from === id ? 'outgoing' : 'incoming',
        })),
    );
    const body = rootArtifact.body?.trim() ?? '';
    const summary = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    return makeReport({ root: id, ...(depth ? { depth } : {}) }, rootRef, {
      fields,
      edges,
      ...((metadata.human || metadata.raw) && summary ? { body_summary: summary } : {}),
      ...(metadata.raw ? { raw_data: { ...rootArtifact.data } } : {}),
    });
  }
  if (view === 'tree') {
    const hierarchy = logical.edges.filter((edge) => edge.relation.role === 'hierarchy');
    const visited = new Set<string>();
    const path = new Set<string>();
    const buildTreeNode = (
      nodeId: string,
      relation: string,
      role: string,
      inferred: boolean,
      inverseInferred: boolean,
      remainingDepth: number,
    ): Record<string, unknown> => {
      const reference = exploreNode(ir, index.artifacts[nodeId]);
      const result: Record<string, unknown> = {
        id: reference.id,
        ...(reference.kind ? { kind: reference.kind } : {}),
        ...(reference.label ? { label: reference.label } : {}),
        ...(relation ? { relation } : {}),
        ...(role ? { role } : {}),
        ...(inferred ? { inferred: true } : {}),
        ...(inverseInferred ? { inverse_inferred: true } : {}),
      };
      if (path.has(nodeId)) return { ...result, cycle: true, children: [] };
      if (visited.has(nodeId)) return { ...result, revisit: true, children: [] };
      if (remainingDepth === 0) return { ...result, children: [] };
      path.add(nodeId);
      visited.add(nodeId);
      const children = hierarchy
        .filter(({ edge }) => edge.from === nodeId)
        .map((item) =>
          buildTreeNode(
            item.edge.to,
            item.relation.label,
            item.relation.role,
            Boolean(item.edge.inferred),
            item.inverseInferred,
            remainingDepth - 1,
          ),
        )
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      path.delete(nodeId);
      return { ...result, children };
    };
    const treeRoot = buildTreeNode(id!, '', '', false, false, depth);
    const reason =
      hierarchy.length === 0
        ? 'no hierarchy relations declared; use neighborhood or impact for dependency relations'
        : (treeRoot.children as unknown[]).length === 0
          ? 'no hierarchy relations reachable from the selected artifact'
          : '';
    return makeReport({ root: id, ...(depth ? { depth } : {}), role: 'hierarchy' }, rootRef, {
      root: treeRoot,
      ...(reason ? { reason } : {}),
    });
  }
  if (view === 'neighborhood') {
    type State = { id: string; distance: number; branch: string };
    const queue: State[] = [{ id: id!, distance: 0, branch: '' }];
    const seen = new Set([id!]);
    const seenEdges = new Set<string>();
    const incoming: EdgeView[] = [];
    const outgoing: EdgeView[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      if (current.distance >= depth) continue;
      for (const item of logical.edges) {
        let next = '';
        let direction = '';
        if (item.edge.from === current.id) [next, direction] = [item.edge.to, 'outgoing'];
        if (item.edge.to === current.id) [next, direction] = [item.edge.from, 'incoming'];
        if (!next || next === id) continue;
        if (current.branch) direction = current.branch;
        const key = edgeKey(item.edge.from, item.edge.to, item.edge.relation);
        if (!seenEdges.has(key)) {
          const rendered = {
            ...edgeView(ir, index, item),
            direction,
            distance: current.distance + 1,
          };
          seenEdges.add(key);
          (direction === 'incoming' ? incoming : outgoing).push(rendered);
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({
            id: next,
            distance: current.distance + 1,
            branch: current.branch || direction,
          });
        }
      }
    }
    sortEdgeViews(incoming);
    sortEdgeViews(outgoing);
    return makeReport({ root: id, ...(depth ? { depth } : {}) }, rootRef, {
      incoming,
      outgoing,
      ...(!incoming.length && !outgoing.length
        ? { reason: 'no logical relations within the requested depth' }
        : {}),
    });
  }
  type ImpactState = { id: string; distance: number; path: ExploreNode[]; edges: EdgeView[] };
  const dependencyEdges = logical.edges.filter((edge) => edge.relation.role === 'dependency');
  const queue: ImpactState[] = [{ id: id!, distance: 0, path: [rootRef], edges: [] }];
  const seen = new Set([id!]);
  const direct: Array<Record<string, unknown>> = [];
  const indirect: Array<Record<string, unknown>> = [];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.distance >= depth) continue;
    for (const item of dependencyEdges) {
      if (item.edge.to !== current.id) continue;
      const next = item.edge.from;
      if (next === id || seen.has(next)) continue;
      const rendered = {
        ...edgeView(ir, index, item),
        direction: 'incoming',
        distance: current.distance + 1,
      };
      const path = [...current.path, exploreNode(ir, index.artifacts[next])];
      const pathEdges = [...current.edges, rendered];
      const impact = {
        node: exploreNode(ir, index.artifacts[next]),
        distance: current.distance + 1,
        path,
        edges: pathEdges,
      };
      (current.distance + 1 === 1 ? direct : indirect).push(impact);
      seen.add(next);
      queue.push({ id: next, distance: current.distance + 1, path, edges: pathEdges });
    }
  }
  const sortImpact = (items: Array<Record<string, unknown>>): void => {
    items.sort(
      (left, right) =>
        Number(left.distance) - Number(right.distance) ||
        (left.node as ExploreNode).id.localeCompare((right.node as ExploreNode).id),
    );
  };
  sortImpact(direct);
  sortImpact(indirect);
  return makeReport(
    { root: id, ...(depth ? { depth } : {}), direction: 'incoming', role: 'dependency' },
    rootRef,
    {
      direction: 'incoming',
      depth,
      direct,
      indirect,
      count: direct.length + indirect.length,
      ...(!direct.length && !indirect.length
        ? { reason: `no incoming dependency relations within depth ${depth}` }
        : {}),
    },
  );
}

const displayNode = (node: ExploreNode): string => {
  let result = node.id;
  if (node.label && node.label !== node.id) result += ` — ${node.label}`;
  if (node.kind) result += ` [${node.kind}]`;
  return result;
};
const edgeLabel = (edge: EdgeView): string =>
  `${edge.label || edge.slot}${edge.role ? `, ${edge.role}` : ''}`;
const textEdge = (edge: EdgeView): string =>
  `${displayNode(edge.from)} -[${edgeLabel(edge)}]-> ${displayNode(edge.to)}${edge.inferred ? ' (inferred)' : ''}${edge.inverse_inferred ? ` (inverse: ${edge.inverse_slot})` : ''}${edge.distance > 0 ? ` [d=${edge.distance}]` : ''}`;
const formatValue = (value: unknown): string => JSON.stringify(value) ?? String(value);
const textValue = (value: unknown): string =>
  typeof value === 'string' ? value : formatValue(value);
const fieldDisplayName = (field: { name: string; roles?: string[] }): string =>
  field.roles?.find((role) => role === 'title' || role === 'summary') ?? field.name;
export function renderExplore(report: ExploreReport): string {
  const lines: string[] = [`${report.view}${report.root ? ` ${report.root.id}` : ''}`];
  const data = report.data as Record<string, unknown>;
  if (report.view === 'overview') {
    lines.push(`artifacts: ${formatValue(data.artifacts)}`);
    lines.push(`logical edges: ${formatValue(data.logical_edges)}`);
    lines.push(`inferred representations: ${formatValue(data.inferred_representations)}`);
    lines.push(`cycles: ${data.cycles ? 'yes' : 'no'}`);
    lines.push(`connected components: ${(data.connected_components as unknown[]).length}`);
    for (const item of data.classes as Array<{ class: string; count: number }>)
      lines.push(`class ${item.class}: ${item.count}`);
    for (const [label, key, reasonKey] of [
      ['entry points', 'entry_points', 'entry_point_reason'],
      ['orphans', 'orphans', 'orphan_reason'],
    ] as const) {
      const nodes = data[key] as ExploreNode[];
      if (!nodes.length) {
        lines.push(`${label}: none`);
        if (data[reasonKey]) lines.push(`  reason: ${textValue(data[reasonKey])}`);
      } else {
        lines.push(`${label}: `);
        nodes.forEach((node) => lines.push(`  ${displayNode(node)}`));
      }
    }
    const most = data.most_connected as Array<{ node: ExploreNode; degree: number }>;
    if (most.length) {
      lines.push('most connected');
      most.forEach((item) => lines.push(`  ${displayNode(item.node)} degree=${item.degree}`));
    }
    (data.connected_components as Array<{ artifacts: ExploreNode[]; edges: EdgeView[] }>).forEach(
      (component, index) => {
        lines.push(`component ${index + 1}`);
        component.artifacts.forEach((node) => lines.push(`  ${displayNode(node)}`));
        component.edges.forEach((edge) => lines.push(`  ${textEdge(edge)}`));
      },
    );
  } else if (report.view === 'card') {
    if (report.root) lines.push(displayNode(report.root));
    if (report.root?.source) lines.push(`source: ${report.root.source}`);
    const fields = data.fields as Array<{ name: string; roles?: string[]; value: unknown }>;
    if (fields.length) {
      lines.push('fields');
      fields.forEach((field) =>
        lines.push(`  ${fieldDisplayName(field).padEnd(12)} ${formatValue(field.value)}`),
      );
    }
    writeGroupedEdges(lines, data.edges as EdgeView[]);
    if (data.body_summary) lines.push('body', textValue(data.body_summary));
    if (data.raw_data) lines.push(`raw data: ${formatValue(data.raw_data)}`);
  } else if (report.view === 'tree') {
    if (data.reason) lines.push(`reason: ${textValue(data.reason)}`);
    const walk = (node: Record<string, unknown>, level: number): void => {
      const reference: ExploreNode = {
        id: String(node.id),
        kind: node.kind as string,
        label: node.label as string,
      };
      let value = displayNode(reference);
      if (node.relation) value += ` via ${textValue(node.relation)}`;
      if (node.cycle) value += ' (cycle)';
      if (node.revisit) value += ' (revisit)';
      lines.push(`${'  '.repeat(level)}${value}`);
      (node.children as Array<Record<string, unknown>>).forEach((child) => walk(child, level + 1));
    };
    walk(data.root as Record<string, unknown>, 0);
  } else if (report.view === 'neighborhood') {
    writeGroupedEdges(lines, [...(data.incoming as EdgeView[]), ...(data.outgoing as EdgeView[])]);
    if (data.reason) lines.push(`reason: ${textValue(data.reason)}`);
  } else {
    lines.push(`direction: ${textValue(data.direction)}`, `depth: ${textValue(data.depth)}`);
    for (const key of ['direct', 'indirect'] as const) {
      const items = data[key] as Array<{ node: ExploreNode; distance: number; edges: EdgeView[] }>;
      lines.push(key);
      if (!items.length) lines.push('  none');
      for (const item of items) {
        lines.push(`  ${displayNode(item.node)} [d=${item.distance}]`);
        item.edges.forEach((edge) => lines.push(`    ${textEdge(edge)}`));
      }
    }
    lines.push(`summary: ${textValue(data.count)} affected artifacts`);
    if (data.reason) lines.push(`reason: ${textValue(data.reason)}`);
  }
  return `${lines.join('\n')}\n`;
}
function writeGroupedEdges(lines: string[], edges: EdgeView[]): void {
  for (const direction of ['outgoing', 'incoming', '']) {
    const group = sortEdgeViews(edges.filter((edge) => edge.direction === direction));
    if (!group.length) continue;
    if (direction) lines.push(direction);
    group.forEach((edge) => lines.push(`  ${textEdge(edge)}`));
  }
}
