---
name: lore-modeling
description: Create or evolve a Lore knowledge model using LinkML schemas and typed source documents, including relationships and structured Markdown. Use when modeling a domain, adding record types or adapting existing documentation to Lore.
---

# Model knowledge with Lore

Lore reads authored files; the domain vocabulary belongs to the project's
`.lore.yaml` (or `model.yaml`). Work directly on those files using normal editing
tools. If both model names exist, select the schema explicitly rather than
assuming one takes precedence.
For nested YAML/JSON documents such as OpenAPI or database catalogs, read
[declarative sources](references/declarative-sources.md) and declare `lore:sources`
alongside user-defined classes.
The JSON index is generated and is never the place to author or repair knowledge.

## Start from the project's vocabulary

Identify the intended knowledge root, existing schema, representative documents
and the questions the model must answer. Reuse existing IDs, class names and
relations before adding new ones. Preserve the user's document structure where
the available representations can express it.

For a new model, define only the record types, fields and relationships needed
for those questions. A class describes a durable kind of record; a record's
status is normally a property or enum, not a separate class. Choose IDs that
remain stable when titles or paths change.

Use a slot with `identifier: true` for identity and a required slot with
`designates_type: true` for the record's class. A relation's `range` names its
target class; use `multivalued: true` when multiple targets are allowed. Prefer
typed references for relationships that must be validated or traversed, rather
than relying on narrative hyperlinks.

## Choose an authored representation

- Markdown frontmatter is a straightforward default for records with prose.
- YAML, JSON, JSONL and CSV suit structured records and tabular inputs.
- Opt-in sections and tables can give existing Markdown a typed structure.
  A heading or table alone does not declare a record.

Read only the relevant packaged reference:

- [LinkML support](references/linkml-support.md) when choosing constraints,
  adapting another LinkML schema or checking supported versus metadata-only features.
- [File formats](references/file-formats.md) when choosing YAML/JSON/CSV or using
  structured Markdown, heading identities, tables or manifests.
- [Model patterns](references/model-patterns.md) for a minimal linked model and
  compact authoring recipes.

Lore is not a general-purpose LinkML processor. Builtin `linkml:types` and local
schema imports are supported; do not introduce network imports or custom
annotations without checking support. Compilation alone does not prove that an
accepted metadata field supplies executable semantics.

## Validate the authored result

Resolve an available Lore executable with `lore --help`. In a Lore source checkout,
build the declared toolchain and use `node dist/cli.js` instead. Do not
assume that a package is globally installed or invent an installation source.

From a directory containing `knowledge/`, run:

```sh
lore check --strict knowledge
```

Fix model, value and relation diagnostics at their source. Do not hide errors
with broad ignore rules or remove useful constraints just to make a corpus pass.
After validation succeeds, rebuild the projection and inspect relevant records:

```sh
lore index knowledge
lore explore --view card knowledge ADR-001
```

Substitute actual paths and IDs. Report what changed in the model and documents,
which checks passed, and any unresolved modeling decisions. Schema or source
changes require reindexing before SDK reads.
