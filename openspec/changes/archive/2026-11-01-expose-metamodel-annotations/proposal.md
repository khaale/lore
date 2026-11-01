## Why

Consumers such as BB need model-owned metadata to organize types and relations into
groups and roles. Lore already compiles user annotations, but public discovery
drops them, forcing consumers to hardcode domain vocabulary.

## What Changes

- Expose effective annotations in existing type, field and reference-path descriptions.
- Preserve custom namespaced values as detached data, including inherited metadata.
- Document consumer-defined grouping/roles without defining BB semantics in Lore.
- Keep summary catalogs, graph edges and entity results unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `interfaces/sdk`: expose effective type/slot annotations through detailed discovery.

## Impact

Additive root SDK declaration changes and shared discovery projection for JSON,
SQLite and PTC. No new methods, dependencies, storage format or authored-source
writes. Update SDK documentation, modeling guidance and the root changeset.
