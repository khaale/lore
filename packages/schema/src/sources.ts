import type { RuntimeSchemaIR, RuntimeSlot, SlotExpr } from './index.js';

export const SOURCES_ANNOTATION = 'lore:sources';
export type SourcePath = Array<string | number>;
export type SourceSelection = {
  from: string;
  path: SourcePath;
  each: 'entries' | 'items';
  as: string;
  keys?: Array<string | number>;
};
export type SourceKey =
  { literal: string | number } | { get: { from: string; path: SourcePath } } | { key: string };
export type SourceExpression =
  | SourceKey
  | { literal: unknown }
  | { object: Record<string, SourceExpression> }
  | { collect: { select: SourceSelection[]; value: SourceExpression } }
  | { ref: { rule: string; key: SourceKey[] } }
  | {
      pointer_refs: {
        select: SourceSelection[];
        from: string;
        path: SourcePath;
        member: string;
        rule: string;
        descend: SourcePath[];
      };
    };
export type SourceEntityRule = {
  name: string;
  class: string;
  identifier: string;
  designator?: string;
  select: SourceSelection[];
  at: string;
  key: SourceKey[];
  fields: Record<string, SourceExpression>;
};
export type SourcePlan = {
  name: string;
  files: string[];
  namespace?: string;
  entities: SourceEntityRule[];
};

export class SourceDeclarationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}
const fail = (path: string, message: string): never => {
  throw new SourceDeclarationError(path, message);
};
const mapping = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(path, 'expected a mapping');
  return value as Record<string, unknown>;
};
const text = (value: unknown, path: string): string =>
  typeof value === 'string' && value.trim() ? value : fail(path, 'expected a nonblank string');
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown declaration key');
}
function list(value: unknown, path: string, nonempty = false): unknown[] {
  if (!Array.isArray(value) || (nonempty && !value.length))
    return fail(path, 'expected an array' + (nonempty ? ' with at least one item' : ''));
  return value;
}
function pathValue(value: unknown, path: string): SourcePath {
  return list(value === undefined ? [] : value, path).map((part, index) => {
    if (
      typeof part === 'string' ||
      (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
    )
      return part;
    return fail(`${path}[${index}]`, 'expected a property name or nonnegative integer index');
  });
}
function selector(value: unknown, path: string): string {
  const pattern = text(value, path);
  if (
    pattern.startsWith('/') ||
    pattern.includes('\\') ||
    pattern.split('/').some((part) => part === '..' || part === '.' || !part) ||
    ['[', ']', '{', '}', '!', ':', '\0'].some((character) => pattern.includes(character))
  )
    fail(path, 'expected a root-relative path or *, **, ? glob');
  return pattern;
}
function binding(value: unknown, scope: Set<string>, path: string) {
  const name = text(value, path);
  if (!scope.has(name)) fail(path, `unknown binding ${name}`);
  return name;
}
function selections(
  value: unknown,
  parent: Set<string>,
  path: string,
): { steps: SourceSelection[]; scope: Set<string> } {
  const scope = new Set(parent);
  const values = list(value === undefined ? [] : value, path);
  if (values.length > 128) fail(path, 'selection nesting exceeds 128');
  const steps = values.map((raw, index): SourceSelection => {
    const at = `${path}[${index}]`,
      step = mapping(raw, at);
    keys(step, ['from', 'path', 'each', 'as', 'keys'], at);
    const from = binding(step.from, scope, `${at}.from`),
      as = text(step.as, `${at}.as`);
    if (scope.has(as)) fail(`${at}.as`, `binding ${as} shadows an existing binding`);
    if (step.each !== 'entries' && step.each !== 'items')
      fail(`${at}.each`, 'expected entries or items');
    scope.add(as);
    const result: SourceSelection = {
      from,
      path: pathValue(step.path, `${at}.path`),
      each: step.each as SourceSelection['each'],
      as,
    };
    if (step.keys !== undefined)
      result.keys = list(step.keys, `${at}.keys`).map((key) => {
        if (
          typeof key === 'string' ||
          (typeof key === 'number' && Number.isSafeInteger(key) && key >= 0)
        )
          return key;
        return fail(`${at}.keys`, 'expected string keys or nonnegative integer indexes');
      });
    return result;
  });
  return { steps, scope };
}

export function compileSources(value: unknown, ir: RuntimeSchemaIR): SourcePlan[] {
  if (value === undefined) return [];
  const sources = mapping(value, SOURCES_ANNOTATION);
  return Object.entries(sources).map(([name, raw]): SourcePlan => {
    text(name, SOURCES_ANNOTATION);
    const sourcePath = `${SOURCES_ANNOTATION}.${name}`,
      source = mapping(raw, sourcePath);
    keys(source, ['files', 'namespace', 'entities'], sourcePath);
    const files = list(source.files, `${sourcePath}.files`, true).map((item) =>
      selector(item, `${sourcePath}.files`),
    );
    const rawRules = list(source.entities, `${sourcePath}.entities`, true).map((item, index) =>
      mapping(item, `${sourcePath}.entities[${index}]`),
    );
    const targets = new Map<string, { class: string; keyCount: number }>();
    for (const rule of rawRules) {
      const ruleName = text(rule.name, sourcePath),
        className = text(rule.class, sourcePath);
      if (targets.has(ruleName)) fail(sourcePath, `duplicate entity rule ${ruleName}`);
      if (!Object.hasOwn(ir.classes, className)) fail(sourcePath, `unknown class ${className}`);
      targets.set(ruleName, {
        class: className,
        keyCount: list(rule.key, `${sourcePath}.${ruleName}.key`, true).length,
      });
    }
    const subclass = (child: string, parent: string): boolean =>
      child === parent ||
      [ir.classes[child]?.parent, ...(ir.classes[child]?.mixins ?? [])].some(
        (ancestor) => !!ancestor && subclass(ancestor, parent),
      );
    const classRanges = (expr: SlotExpr): string[] => [
      ...(expr.range && Object.hasOwn(ir.classes, expr.range) ? [expr.range] : []),
      ...[expr.anyOf, expr.allOf, expr.exactlyOneOf].flatMap((group) =>
        (group ?? []).flatMap(classRanges),
      ),
    ];
    function literalType(value: unknown, slot: RuntimeSlot, path: string) {
      if (value === null || value === undefined) return;
      if (slot.multivalued) {
        if (!Array.isArray(value)) fail(path, 'expected an array for a multivalued field');
        for (const item of value as unknown[])
          literalType(item, { ...slot, multivalued: false }, path);
        return;
      }
      // Boolean range expressions may allow additional literal branches. Their
      // data-dependent compatibility belongs to ordinary record validation.
      if ([slot.anyOf, slot.allOf, slot.noneOf, slot.exactlyOneOf].some((group) => group?.length))
        return;
      const base = (ir.types[slot.range]?.base ?? slot.range).toLowerCase();
      if (ir.classes[slot.range]) {
        if (
          slot.mode === 'reference'
            ? typeof value !== 'string'
            : !value || typeof value !== 'object' || Array.isArray(value)
        )
          fail(path, 'literal is incompatible with the class-valued field');
      } else if (ir.enums[slot.range]) {
        if (
          (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
          !ir.enums[slot.range]!.values.includes(String(value))
        )
          fail(path, 'literal is not an enum value');
      } else if (['boolean', 'bool'].includes(base)) {
        if (typeof value !== 'boolean') fail(path, 'expected a boolean literal');
      } else if (['integer', 'int', 'float', 'double', 'decimal'].includes(base)) {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (['integer', 'int'].includes(base) && !Number.isInteger(value))
        )
          fail(path, 'expected a compatible numeric literal');
      } else if (typeof value !== 'string') fail(path, 'expected a string literal');
    }
    function expression(
      raw: unknown,
      scope: Set<string>,
      path: string,
      expected?: RuntimeSlot,
      identity = false,
      depth = 0,
    ): SourceExpression {
      if (depth > 128) return fail(path, 'expression nesting exceeds 128');
      const expr = mapping(raw, path),
        ops = Object.keys(expr);
      if (ops.length !== 1) fail(path, 'expected exactly one expression operator');
      const op = ops[0]!;
      if (identity && !['literal', 'get', 'key'].includes(op))
        fail(path, 'identity expressions support only literal, get and key');
      if (op === 'literal') {
        if (
          identity &&
          !(
            (typeof expr.literal === 'string' && expr.literal.length) ||
            (typeof expr.literal === 'number' && Number.isFinite(expr.literal))
          )
        )
          fail(path, 'identity literal must be a nonempty string or finite number');
        if (expected) literalType(expr.literal, expected, path);
        // JSON-safe constants only, with no aliases/cycles or executable values.
        let literal: unknown;
        try {
          literal = JSON.parse(
            JSON.stringify(expr.literal, (_key, value: unknown) => {
              if (typeof value === 'number' && !Number.isFinite(value))
                throw new Error('nonfinite number');
              if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value))
                throw new Error('non-JSON value');
              return value;
            }),
          );
        } catch {
          return fail(path, 'literal must be JSON data');
        }
        return { literal };
      }
      if (op === 'key') {
        const key = binding(expr.key, scope, `${path}.key`);
        if (key === 'root') fail(path, 'root has no collection key');
        return { key };
      }
      if (op === 'get') {
        const get = mapping(expr.get, `${path}.get`);
        keys(get, ['from', 'path'], `${path}.get`);
        return { get: { from: binding(get.from, scope, path), path: pathValue(get.path, path) } };
      }
      if (op === 'object') {
        if (expected && (expected.multivalued || expected.mode !== 'inline-object'))
          fail(path, 'object requires a single inline-object field');
        const fields = mapping(expr.object, `${path}.object`);
        const candidates = expected ? classRanges(expected).map((name) => ir.classes[name]!) : [];
        const cls = candidates.find((candidate) =>
          Object.keys(fields).every((field) => Object.hasOwn(candidate.slots, field)),
        );
        if (expected && !cls)
          fail(path, 'constructed fields are not declared by a compatible inline class');
        return {
          object: Object.fromEntries(
            Object.entries(fields).map(([field, value]) => {
              const slot = cls?.slots[field];
              if (cls && !slot) fail(`${path}.${field}`, 'field is not declared');
              return [field, expression(value, scope, `${path}.${field}`, slot, false, depth + 1)];
            }),
          ),
        };
      }
      if (op === 'collect') {
        if (expected && !expected.multivalued) fail(path, 'collect requires a multivalued field');
        const collect = mapping(expr.collect, `${path}.collect`);
        keys(collect, ['select', 'value'], `${path}.collect`);
        const selected = selections(collect.select, scope, `${path}.collect.select`);
        return {
          collect: {
            select: selected.steps,
            value: expression(
              collect.value,
              selected.scope,
              `${path}.collect.value`,
              expected ? { ...expected, multivalued: false } : undefined,
              false,
              depth + 1,
            ),
          },
        };
      }
      if (op === 'ref' || op === 'pointer_refs') {
        const ref = mapping(expr[op], `${path}.${op}`);
        keys(
          ref,
          op === 'ref' ? ['rule', 'key'] : ['select', 'from', 'path', 'member', 'rule', 'descend'],
          path,
        );
        const rule = text(ref.rule, `${path}.rule`),
          target = targets.get(rule);
        if (!target) fail(path, `unknown target rule ${rule}`);
        if (
          expected &&
          (expected.mode !== 'reference' ||
            expected.multivalued !== (op === 'pointer_refs') ||
            (expected.explicitRange && Object.hasOwn(ir.classes, expected.range)
              ? !subclass(target!.class, expected.range)
              : !classRanges(expected).some((range) => subclass(target!.class, range))))
        )
          fail(path, 'reference is incompatible with the target field');
        if (op === 'ref') {
          const key = list(ref.key, `${path}.key`, true);
          if (key.length !== target!.keyCount) fail(path, 'target key component count differs');
          return {
            ref: {
              rule,
              key: key.map(
                (part, index) =>
                  expression(
                    part,
                    scope,
                    `${path}.key[${index}]`,
                    undefined,
                    true,
                    depth + 1,
                  ) as SourceKey,
              ),
            },
          };
        }
        const selected = selections(ref.select, scope, `${path}.select`);
        const descend = list(ref.descend ?? [], `${path}.descend`).map((item, index) => {
          const child = pathValue(item, `${path}.descend[${index}]`);
          if (!child.length) fail(path, 'recursive child paths must not be empty');
          return child;
        });
        return {
          pointer_refs: {
            select: selected.steps,
            from: binding(ref.from, selected.scope, path),
            path: pathValue(ref.path, path),
            member: text(ref.member, path),
            rule,
            descend,
          },
        };
      }
      return fail(path, `unknown expression operator ${op}`);
    }
    const entities = rawRules.map((rule, index): SourceEntityRule => {
      const path = `${sourcePath}.entities[${index}]`;
      keys(rule, ['name', 'class', 'select', 'at', 'key', 'fields'], path);
      const className = String(rule.class),
        cls = ir.classes[className]!;
      const identifiers = Object.values(cls.slots).filter((slot) => slot.identifier);
      const id = identifiers[0];
      if (
        identifiers.length !== 1 ||
        !id ||
        id.multivalued ||
        id.mode !== 'scalar' ||
        !['string', 'str', 'uri', 'uriorcurie', 'ncname'].includes(
          (ir.types[id.range]?.base ?? id.range).toLowerCase(),
        )
      )
        fail(path, 'class requires exactly one scalar string identifier');
      if (cls.designatorSlot === id!.name) fail(path, 'identifier cannot also designate the type');
      const selected = selections(rule.select, new Set(['root']), `${path}.select`);
      const fields = Object.fromEntries(
        Object.entries(mapping(rule.fields, `${path}.fields`)).map(([field, expr]) => {
          const slot = cls.slots[field];
          if (!slot) fail(`${path}.fields.${field}`, 'field is not declared');
          if (slot!.identifier || slot!.designatesType)
            fail(
              `${path}.fields.${field}`,
              'generated identifier and type designators cannot be overwritten',
            );
          return [field, expression(expr, selected.scope, `${path}.fields.${field}`, slot)];
        }),
      );
      return {
        name: String(rule.name),
        class: className,
        identifier: id!.name,
        ...(cls.designatorSlot ? { designator: cls.designatorSlot } : {}),
        select: selected.steps,
        at: binding(rule.at, selected.scope, path),
        key: (rule.key as unknown[]).map(
          (part, keyIndex) =>
            expression(
              part,
              selected.scope,
              `${path}.key[${keyIndex}]`,
              undefined,
              true,
            ) as SourceKey,
        ),
        fields,
      };
    });
    return {
      name,
      files,
      ...(source.namespace === undefined
        ? {}
        : { namespace: text(source.namespace, `${sourcePath}.namespace`) }),
      entities,
    };
  });
}
