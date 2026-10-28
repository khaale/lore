---
'@khaale/lore': minor
---

Simplify PTC reads and retained results: remove per-entity capability metadata, return compact graph previews, use one 16 MiB retention budget, accept empty batch reads, and check source freshness at call boundaries instead of rescanning before every operation. The `maxValueBytes` option is removed; `maxRetainedBytes` bounds both individual values and the complete result store.

Skip ignored directory trees during file discovery, avoiding filesystem work in dependency and generated-site folders.
