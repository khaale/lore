---
name: lore-usage
description: Read, validate and explore Lore knowledge bases with the CLI or SDK/PTC. Use for consuming knowledge through the project's model rather than authoring that model or implementing Lore.
---

# Use Lore knowledge

Use the supplied root, model and index paths. Otherwise Lore discovers `.lore.yaml`
or `model.yaml`. Domain types, fields and relation meanings belong to that model.
Lore reads authored files. The JSON SDK requires a matching saved index; the
SQLite SDK supports explicit indexed or refresh-on-read policies.

For scripts, [PTC API](references/scripts.md) contains setup, result shapes and
independent operation examples. For CLI commands, use [CLI reference](references/cli.md).
Choose the reference for the interface being used; the scripting contract is
self-contained for ordinary read tasks.

Choose operations from the question:

| Need                                      | Available operation                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Unknown vocabulary or field shape         | Supplied model, type catalog, description of relevant types, search        |
| Records matching known conditions         | Query with model-derived conditions and fields                             |
| Values within nested objects or arrays    | Read those values and compute in JavaScript                                |
| Membership or reachability across records | Reference filters or a graph traversal with the model's relation semantics |
| Global inventory or statistics            | Complete collection and local computation                                  |
| Prose or source locations                 | Entity reads with narrative or provenance                                  |

PTC reads complete selected results. Return the requested findings or an explicit
preview; preserve coverage. Item counts alone do not bound nested values or text.
Reuse a supplied installation/index, rebuilding only when inputs require it.

For a shared SQLite projection, use `lore index --format sqlite ROOT` and the
ordinary `openSqliteWorkspace` API from `@khaale/lore`; see
[SDK policies](../../docs/sdk.md#persistent-sqlite-workspace). Choose freshness
explicitly, group reads with `readSnapshot`, and call `close()`. SQLite PTC is not
available. `indexed` reads can be stale; `refresh-on-read` propagates failed checks.
