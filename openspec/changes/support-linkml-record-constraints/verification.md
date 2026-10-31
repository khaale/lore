# Implementation verification

Execution capsule: Node24.20.0 and pnpm10.17.0 from
`/Users/aleksander_khanteev/.nvm/versions/node/v24.20.0/bin`, prepended to existing
PATH with CI=true. `pnpm preflight` passed. No typemap option or sidecar was added.

## Original SA model

The supplied `_meta/metamodel.yaml` compiles unchanged:45 classes, two effective
DeploymentSite rules, one DeploymentSelector record constraint. Its nested
TechnologyPositionRefinement.scope is a reference. The original model contains
no classifiers for serialized `type` values; compilation does not imply record
classification. Only a disposable acceptance copy received existing
classification_rules derived from the supplied tooling-profile mapping.

A complete seven-record synthetic corpus against that copy passed built CLI
SQLite publication. Public SDK discovery, normalized nested scope properties and
bounded graph selection through position_refinements.scope succeeded. Negative
refresh cases all preserved the last valid generation:

| Case                                                       | Diagnostic           |
| ---------------------------------------------------------- | -------------------- |
| Component parent targets a DeploymentSite                  | REFERENCE_TYPE       |
| Inline refinement scope targets a missing entity           | BROKEN_REFERENCE     |
| Deployment selector supplies workload and application      | RECORD_CONSTRAINT    |
| Root deployment site supplies a parent                     | CLASS_RULE           |
| Two parent surfaces resolve to the same unique-list target | LIST_ELEMENTS_UNIQUE |

Repair published successfully. SA source files and existing BB indexes were
only read, never changed. This demonstrates model support and a scoped complete
corpus; it does not claim validation of every current SA record or execution of
its tooling-profile path/generator/waiver policies or custom severity annotations.

## Shared boundaries

Product-independent tests cover schema shape/inheritance, record and conditional
predicates, reference-aware uniqueness, actual target unions, nested/recursive
paths, value projection, mutation isolation and JSON/SQLite parity. Packed-consumer
checks exercise the built CLI and root SDK constraint DTOs and nested references.
Private SQLite storage stays compatible through additive optional model fields;
no migration or format version change was needed. Existing saved projections must
be rebuilt to establish the new validation; opening them does not revalidate data.

At later spec sync, apply/reconcile the completed add-sqlite-index delta before
this delta. Update the LinkML support table and unsupported prose alongside the
changed requirements. Main specs remain unchanged until that lifecycle step.

## Final gates

- `pnpm check`: passed,25 files /145 tests, including format, build, consumer types,
  lint and packed installation.
- `pnpm test:cli`: passed,4 files /15 tests.
- `openspec validate support-linkml-record-constraints --strict`: passed.
- `git diff --check`: passed.

Nested boolean range alternatives and literal/reference union projection/filtering
are covered, including false/zero presence, inherited rules and recursive selectors.
All14 tasks are complete. No typemap implementation, source edits, index migration,
publication or automatic change archive was performed.
