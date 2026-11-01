## Why

A flat vocabulary leaves consumers to invent organization, while a single global
parent rule mixes composition, deployment, responsibility and evidence. The Praxis
and SA experiments produced useful editable metamodel forests using typed paths,
annotations and source layout. Consumers need to review these candidates and then
read instances through the selected definition without exporting the whole graph.

## What Changes

- Add SDK hierarchy conveniences: propose an editable type/group hierarchy and
  read bounded instance children using that definition, including consumer edits.
- Include concise labels, type counts and meaningful flags by default; preserve
  alternative viewpoints and make diagnostic detail opt-in.
- Distinguish semantic relations, schema-family/navigation groups and physical
  source-context hypotheses. Permit recursive and polymorphic type occurrences.
- Retain partial axes as alternatives with explicit unassigned handling; support
  selected shared-resource LCA policies without rewriting model assertions.
- Add matching CLI operations over saved JSON/SQLite workspaces.
- Keep entity hydration and visible canonical links on existing SDK operations.
- Offer opt-in per-entity focus hints on read, normalized per actual type over the
  entire selected hierarchy without score ordering or filtering.

## Capabilities

### New Capabilities

- `core/hierarchy`: editable metamodel hierarchy candidates and bounded instance
  projection semantics, including alternatives, grouping and placement policies.

### Modified Capabilities

- `interfaces/sdk`: expose hierarchy operations composed with existing flat
  reads and their existing freshness/coverage/error behavior for JSON and SQLite.
- `interfaces/cli`: provide compact and JSON hierarchy proposal/read commands.
- `interfaces/ptc`: expose hierarchy operations without removing their bounds.

## Impact

Private graph computation and SDK source adapters, public root declarations,
CLI parsing/rendering, SDK/modeling/usage documentation and a root changeset.
Depends on the completed `expose-metamodel-annotations` change. No authored-source
writes, storage migration, hosted workers, persistent view registry or analytics
library export. BB owns task intent, user agreement, saved views and presentation.

Validation uses the two available corpora plus renamed/reordered and adversarial
fixtures. A third real corpus is unavailable; semantic accuracy outside these
examples remains an explicit limitation, not a release prerequisite.

New snapshot, expected-generation, lease, registry or identity protocols are out
of scope. Existing reader envelopes and ordinary continuation validation remain.
A generic importance/ranking API, association-as-edge and package/version joins are deferred.
Following user steering, the proposal includes independent per-type structure and
connectivity focus hints, without filtering, a combined score or placement effects.
The number of methods is not an architectural constraint: see the composition
matrix in design.md for existing operations, shared computation and future seams.
