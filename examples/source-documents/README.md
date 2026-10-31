# Extract operations, DTOs and database tables

This model declares `lore:sources` for `api/*.yaml`, `api/*.json` and
`databases/*.json`. Run:

```sh
lore check examples/source-documents
lore index --format sqlite examples/source-documents
```

Expected: 1 API, 2 operations, 2 named DTOs, 1 database and 2 database objects.
Operations link to request/response schemas; recursive DTO links remain
references. Columns stay in definitions, while FK records retain column mappings
and link through `foreign_keys.target`.

Classes and rules belong to `.lore.yaml`; there are no runtime domain adapters.
`Document` retains raw structures without validating the original format. The
example does not resolve external references/component wrappers, calculate
effective inherited parameters/security, or interpret SQL/ClickHouse dependencies.
Indexing changes only derived data; authored files remain unchanged.
