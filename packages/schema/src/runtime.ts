import type { RuntimeSchemaIR } from './index.js';

/** Effective class ancestry, including mixins; shared by build and read paths. */
export function isRuntimeSubclass(
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
    [runtimeClass.parent, ...runtimeClass.mixins].some(
      (ancestor) => ancestor !== undefined && isRuntimeSubclass(schema, ancestor, parent, seen),
    ),
  );
}
