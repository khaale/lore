import type { Candidate } from '@khaale/lore-core';
import type {
  SourcePlan,
  SourceSelection,
  SourceExpression,
  SourcePath,
} from '@khaale/lore-schema';

export const SOURCE_LIMITS = { depth: 128, work: 1_000_000, entities: 100_000 } as const;
export class SourceExtractionError extends Error {
  constructor(
    readonly code: 'SOURCE_EXTRACTION' | 'SOURCE_LIMIT',
    readonly pointer: string,
    message: string,
  ) {
    super(message);
  }
}
type Binding = { value: unknown; pointer: string; key?: string | number };
type Context = Map<string, Binding>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const escapePointer = (part: string | number) =>
  String(part).replaceAll('~', '~0').replaceAll('/', '~1');
const address = (pointer: string, path: SourcePath) =>
  pointer + path.map((part) => `/${escapePointer(part)}`).join('');
const keyOf = (parts: unknown[]) => JSON.stringify(parts);

/** Execute compiled input mappings only. Format knowledge belongs to the model. */
export function extractSource(
  document: unknown,
  source: SourcePlan,
  namespace: string[],
  physicalPath: string,
): Candidate[] {
  let work = 0,
    currentRule = '<document>';
  const fail = (pointer: string, message: string, limit = false): never => {
    throw new SourceExtractionError(
      limit ? 'SOURCE_LIMIT' : 'SOURCE_EXTRACTION',
      pointer,
      `${source.name}/${currentRule} at #${pointer}: ${message}`,
    );
  };
  const step = (pointer: string, depth = 0) => {
    if (++work > SOURCE_LIMITS.work || depth > SOURCE_LIMITS.depth)
      fail(pointer, 'extraction work or depth limit exceeded', true);
  };
  // Validate all input values once, including unselected branches. YAML aliases
  // may share acyclic data, but object cycles must never reach copying/traversal.
  const active = new Set<object>();
  function copy(value: unknown, pointer: string, depth = 0, clone = true): unknown {
    step(pointer, depth);
    if (value === null || ['string', 'boolean', 'undefined'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') return fail(pointer, 'expected finite JSON data');
    if (active.has(value)) return fail(pointer, 'cyclic YAML alias structure');
    active.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (clone)
        result = value.map((item, index) => copy(item, address(pointer, [index]), depth + 1));
      else value.forEach((item, index) => copy(item, address(pointer, [index]), depth + 1, false));
    } else {
      if (clone)
        result = Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            copy(child, address(pointer, [key]), depth + 1),
          ]),
        );
      else
        for (const [key, child] of Object.entries(value))
          copy(child, address(pointer, [key]), depth + 1, false);
    }
    active.delete(value);
    return result;
  }
  if (!record(document)) fail('', 'expected a document mapping root');
  copy(document, '', 0, false);

  function locate(context: Context, from: string, path: SourcePath): Binding {
    const selected = context.get(from)!;
    let value = selected.value;
    for (const part of path) {
      step(selected.pointer);
      value =
        value !== null && typeof value === 'object' && Object.hasOwn(value, part)
          ? (value as Record<string | number, unknown>)[part]
          : undefined;
    }
    return { value, pointer: address(selected.pointer, path) };
  }
  function* select(steps: SourceSelection[], context: Context, index = 0): Generator<Context> {
    if (index === steps.length) {
      yield context;
      return;
    }
    const selection = steps[index]!;
    const binding = locate(context, selection.from, selection.path);
    step(binding.pointer);
    if (binding.value === undefined || binding.value === null) return;
    if (selection.each === 'items' ? !Array.isArray(binding.value) : !record(binding.value))
      fail(binding.pointer, `expected ${selection.each} collection`);
    for (const [rawKey, value] of Object.entries(binding.value)) {
      step(binding.pointer);
      const key = selection.each === 'items' ? Number(rawKey) : rawKey;
      if (selection.keys && !selection.keys.includes(key)) continue;
      const child = new Map(context);
      child.set(selection.as, { key, value, pointer: address(binding.pointer, [key]) });
      yield* select(steps, child, index + 1);
    }
  }
  function* children(
    value: unknown,
    pointer: string,
    path: SourcePath,
    index = 0,
  ): Generator<Binding> {
    step(pointer, index);
    if (index === path.length) {
      yield { value, pointer };
      return;
    }
    if (!value || typeof value !== 'object') return;
    const part = path[index]!;
    const entries =
      part === '*'
        ? Object.entries(value)
        : Object.hasOwn(value, part)
          ? [[part, (value as Record<string | number, unknown>)[part]] as const]
          : [];
    for (const [key, child] of entries)
      yield* children(child, address(pointer, [key]), path, index + 1);
  }
  function walk(
    binding: Binding,
    paths: SourcePath[],
    visit: (value: Record<string, unknown>, pointer: string) => void,
    depth = 0,
  ) {
    step(binding.pointer, depth);
    if (!record(binding.value)) return;
    visit(binding.value, binding.pointer);
    for (const path of paths)
      for (const child of children(binding.value, binding.pointer, path))
        walk(child, paths, visit, depth + path.length);
  }
  const keyTargets = new Map<string, string>(),
    pointerTargets = new Map<string, string>();
  function identity(parts: unknown[], pointer: string): Array<string | number> {
    if (
      !parts.length ||
      parts.some(
        (part) =>
          !(
            (typeof part === 'string' && part.length) ||
            (typeof part === 'number' && Number.isFinite(part))
          ),
      )
    )
      fail(pointer, 'identity components must be nonempty strings or finite numbers');
    return parts as Array<string | number>;
  }
  function evaluate(expression: SourceExpression, context: Context, depth = 0): unknown {
    const pointer = [...context.values()].at(-1)!.pointer;
    step(pointer, depth);
    if ('literal' in expression) return copy(expression.literal, '', depth);
    if ('get' in expression) {
      const b = locate(context, expression.get.from, expression.get.path);
      return copy(b.value, b.pointer, depth);
    }
    if ('key' in expression) return context.get(expression.key)!.key;
    if ('object' in expression)
      return Object.fromEntries(
        Object.entries(expression.object)
          .map(([key, expr]) => [key, evaluate(expr, context, depth + 1)])
          .filter(([, value]) => value !== undefined && value !== null),
      );
    if ('collect' in expression) {
      const items: unknown[] = [];
      for (const child of select(expression.collect.select, context))
        items.push(evaluate(expression.collect.value, child, depth + 1));
      return items;
    }
    if ('ref' in expression) {
      const parts = identity(
        expression.ref.key.map((expr) => evaluate(expr, context, depth + 1)),
        pointer,
      );
      const target = keyTargets.get(keyOf([expression.ref.rule, ...parts]));
      return (
        target ?? fail(pointer, `unresolved entity key ${expression.ref.rule} ${keyOf(parts)}`)
      );
    }
    const reference = expression.pointer_refs,
      targets = new Set<string>();
    for (const child of select(reference.select, context)) {
      const selected = locate(child, reference.from, reference.path);
      walk(selected, reference.descend, (value, pointer) => {
        if (!Object.hasOwn(value, reference.member)) return;
        const raw = value[reference.member];
        if (typeof raw !== 'string' || !raw.startsWith('#/'))
          fail(pointer, 'only local document pointer references are supported');
        let fragment: string;
        try {
          fragment = decodeURIComponent((raw as string).slice(1));
        } catch {
          return fail(pointer, 'invalid pointer URI encoding');
        }
        const target = pointerTargets.get(keyOf([reference.rule, fragment]));
        if (!target) fail(pointer, `unresolved entity pointer ${String(raw)}`);
        targets.add(target!);
      });
    }
    return [...targets];
  }
  const pending: Array<{
    rule: SourcePlan['entities'][number];
    context: Context;
    pointer: string;
    id: string;
  }> = [];
  const root = new Map<string, Binding>([['root', { value: document, pointer: '' }]]);
  for (const rule of source.entities) {
    currentRule = rule.name;
    for (const context of select(rule.select, root)) {
      const pointer = context.get(rule.at)!.pointer;
      if (pending.length >= SOURCE_LIMITS.entities)
        fail(pointer, 'emitted entity limit exceeded', true);
      const parts = identity(
        rule.key.map((part) => evaluate(part, context)),
        pointer,
      );
      const id = [...namespace, rule.name, ...parts]
        .map((part) => encodeURIComponent(part))
        .join('/');
      const key = keyOf([rule.name, ...parts]),
        pointerKey = keyOf([rule.name, pointer]);
      if (keyTargets.has(key) || pointerTargets.has(pointerKey))
        fail(pointer, 'duplicate entity key or pointer');
      keyTargets.set(key, id);
      pointerTargets.set(pointerKey, id);
      pending.push({ rule, context, pointer, id });
    }
  }
  return pending.map(({ rule, context, pointer, id }): Candidate => {
    currentRule = rule.name;
    const data = evaluate({ object: rule.fields }, context) as Record<string, unknown>;
    if (rule.designator)
      Object.defineProperty(data, rule.designator, {
        value: rule.class,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    Object.defineProperty(data, rule.identifier, {
      value: id,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return {
      source: `${physicalPath}#${pointer}`,
      physicalPath,
      declaredClass: rule.class,
      data,
      spans: {},
      links: [],
      sections: [],
    };
  });
}
