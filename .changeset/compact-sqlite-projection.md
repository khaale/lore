---
'@khaale/lore': minor
---

Replace the private SQLite index with compact format 2: shared types/paths/predicates,
single entity content with lossless raw differences, and integer graph tables
derived in SQL. Public reads retain their results, ordering and lifecycle semantics.
Older SQLite databases require explicit removal/rebuild, without automatic migration.
