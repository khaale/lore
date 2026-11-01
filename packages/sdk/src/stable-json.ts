import { createHash } from 'node:crypto';

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  return value;
}
export const stableJson = (value: unknown): string => JSON.stringify(stableValue(value));
export const digest = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');
