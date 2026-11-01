# core/hierarchy

## Purpose

Offer compact editable hierarchies of types and navigation groups, then read
instances through a caller-selected definition without changing model assertions.

## Requirements

### Requirement: Editable metamodel candidates

Lore SHALL propose a serializable versioned hierarchy definition with explicit
type/branch keys, typed directed reference paths, recursive type occurrences,
navigation groups and alternative axes. It SHALL use effective schema metadata,
observed relationships and source layout without a domain-name dictionary or a
global parent/owner precedence. Different parent types SHALL permit repeated
occurrences of a type. Invalid definitions SHALL fail with path diagnostics before
instance evaluation. Unsupported definition versions SHALL fail explicitly.

#### Scenario: Polymorphic parents

- **WHEN** a catalog type has valid placements under both product and process types
- **THEN** the candidate preserves both placements rather than forcing global type uniqueness

### Requirement: Navigation and alternative viewpoints

Schema-family and source-navigation groups SHALL be distinguished from model
relations. Unique document roots with nested record locators and exact parent IDs
in source directories SHALL be marked source-context hypotheses, not assertions.
Incomplete functional axes SHALL be offered as alternatives without silently
placing all objects by their partial mapping. Unpopulated and inline schema types
SHALL remain identifiable separately from observed indexed entity populations.

#### Scenario: Incomplete ownership

- **WHEN** only part of a repository population has a known owner
- **THEN** its owner axis is an explicit alternative with unmatched quantities and is not assumed to organize the whole population

### Requirement: Bounded instance navigation

A read SHALL accept the proposed or caller-edited definition and return a bounded
page of root or direct-child placements. Group and entity placements SHALL be
distinguishable; only entities SHALL carry real entity IDs. A serializable placement
reference SHALL distinguish repeated occurrences and SHALL NOT require a hosted
registry. Entity hydration and canonical crosslinks SHALL remain separate existing
reads. Recursive paths SHALL have a finite traversal bound and report cycles or
unresolved placements without infinite expansion.

#### Scenario: Lazy expansion

- **WHEN** the consumer passes a returned parent placement reference
- **THEN** the read returns only that placement's requested child page

### Requirement: Optional grouping and placement policies

Caller-selected exact grouping by a declared single scalar field SHALL preserve
typed keys, distinguish missing values, and perform no joins, fuzzy matching or
value parsing. Optional shared-resource placement SHALL use explicit consumer
paths and a checked forest backbone over the declared placement scope, including
consumers outside the current visible page. Owner inclusion SHALL be explicit.
Unsupported or ambiguous placement SHALL be reported as deferred/unassigned, not
as successful ownership inference. Canonical assertions SHALL remain unchanged.

#### Scenario: Shared resource

- **WHEN** selected consumers have a unique common ancestor in the chosen backbone
- **THEN** a selected LCA policy can place their shared resource there as derived placement

#### Scenario: No unique placement

- **WHEN** the backbone is cyclic, multi-parent, disconnected or outside the checked scope
- **THEN** the placement remains explicitly deferred or unassigned

### Requirement: Compact metadata and precise counts

Default proposal presentation SHALL use short labels, explicitly named global
type totals and a small set of meaningful flags. Default instance pages SHALL use
identity, bounded labels, basis, expansion state and optional direct-child counts.
Counts SHALL identify their meaning and exact/lower-bound/unknown status; unknown
SHALL NOT mean zero. Global type totals SHALL NOT masquerade as local subtree
counts. Label selectors SHALL be declared scalar fields with ID fallback; no
title/name convention or narrative hydration SHALL be required. Truncation SHALL
be explicit. Diagnostic detail SHALL be opt-in without changing the definition.

#### Scenario: Repeated reference type

- **WHEN** a type appears under several parent types
- **THEN** its global total is distinguished from local child counts and is not summed across occurrences

### Requirement: Independent compute and output bounds

Input topology, traversal/intermediate work, depth, definition size and returned
pages SHALL have finite validated limits. Output truncation SHALL NOT imply
complete evaluation. Exceeded compute limits SHALL fail explicitly or report
unknown/deferred metrics; no false exact denominator SHALL be produced from a
partial query page. Empty results SHALL remain distinguishable from unevaluated
ones. A generic importance-ranking API, graph quotient links, relation-entity collapse and
package/version joins SHALL NOT be inferred from hierarchy placement.

#### Scenario: Budget exhaustion

- **WHEN** work cannot finish within the selected finite budget
- **THEN** the result does not claim exact full-scope placement or counts

### Requirement: Independent type focus hints
The proposal SHALL include structureScore and connectivityScore for every observed
candidate type, independently normalized to [0,1] within that proposal. Structural
score SHALL sum unique reachable descendant types with weight 1 at the first hop
and decay 0.65 per additional hop, then normalize by the largest type sum in the
proposal. Connectivity SHALL sum unique observed neighbor types weighted by
undirected hierarchy separation (zero for adjacent types, `1-2^(-(d-1))` at
distance d, one if disconnected), then normalize separately. Alternatives and
navigation groups SHALL NOT participate. Scores SHALL NOT filter types, change
placement or be combined into a semantic importance score. All-zero inputs SHALL
return zero. Formulas and interpretation limits SHALL be documented in the usage
skill rather than per-record explanation payloads.

#### Scenario: Repeated integration records do not dominate focus
- **WHEN** all instances and canonical links are duplicated without changing type topology
- **THEN** both scores remain unchanged and every candidate type remains present

### Requirement: Optional individual focus hints
Instance read SHALL support includeScores, disabled by default, returning scores
only on real entity placements. Individual structure SHALL sum unique different
actual descendant types using their shortest distance and 0.65 decay per additional
hop across active entity placement branches, including selected derived placement.
Individual connectivity SHALL sum distinct observed neighbor types other than the
entity's own actual type, weighted by their type-level hierarchy separation using
the proposal formula; it SHALL NOT claim entity-level geodesic or within-type
bridge detection. Repeated assertions SHALL NOT increase weights. Each component
SHALL be normalized independently among entities of the same actual type throughout
the selected hierarchy, including unassigned scope members, not among returned
page items. Alternative branches and virtual groups SHALL NOT add entity edges.
Scores SHALL NOT change order, definition, refs or placement. Existing finite work
limits SHALL apply; failure SHALL NOT silently substitute zero scores.

#### Scenario: Page independent individual hints
- **WHEN** an entity is returned through another occurrence or page size
- **THEN** it has the same scores for the same selected definition and source data

#### Scenario: Lightweight default
- **WHEN** includeScores is omitted
- **THEN** instance scores are absent and their extra whole-scope work is not performed
