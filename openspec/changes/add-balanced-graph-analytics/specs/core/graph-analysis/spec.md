## Purpose

Provide bounded, reproducible graph ranking and community summaries over explicit
logical projections without confusing bulk record volume with general relevance.
This phase provides an internal computation capability; public SDK/PTC methods
are deferred to a separately agreed interface change.

## ADDED Requirements

### Requirement: Explicit induced analysis scope

Analysis SHALL select an induced graph by optional runtime types (including
descendants) and exact canonical relation predicates. Both endpoints SHALL belong
to the selected types. Generic prose links SHALL be excluded; inferred-only
canonical edges SHALL participate without counting duplicate inverse presentations.
An inverse presentation name SHALL NOT implicitly relabel/reverse a canonical
predicate. Rank SHALL support out/in/both orientation, default out; communities
SHALL use undirected endpoint pairs. Isolated selected nodes SHALL be counted
separately and excluded from solver and balance populations. Empty selectors SHALL
fail; omitted selectors SHALL include all eligible logical data.

#### Scenario: A path through an excluded type

- **WHEN** a type-scoped analysis would connect two selected records only through an excluded type
- **THEN** that excluded record and its incident edges do not participate, unlike hidden-node traversal

#### Scenario: Only isolated records

- **WHEN** no selected node has an eligible incident edge
- **THEN** analysis returns complete-empty items and the selected isolate count

### Requirement: Normalized node ranking

Rank SHALL return top participating identities/types/scores from standard normalized
PageRank over the oriented projection. Parallel canonical triples SHALL count as
separate unit links; self-loops SHALL remain one logical edge. Scores SHALL be
normalized over the complete participating scope before output truncation. Equal
scores SHALL sort by locale ID order. Non-converged or non-finite computations
SHALL fail rather than return a partial ranking. Scores SHALL NOT assert business
criticality, content quality or human authorship.

#### Scenario: Dangling node mass

- **WHEN** a selected directed graph contains a node with no outgoing edges
- **THEN** normalized scores preserve the documented standard personalized/uniform ranking convention

#### Scenario: A top-k prefix

- **WHEN** output is limited below the number of ranked nodes
- **THEN** scores retain their full-scope values rather than being renormalized over the prefix

### Requirement: Community summaries

Communities SHALL partition the undirected projection with deterministic configured
behavior, collapsing endpoint duplicates to unit links. Returned groups SHALL
contain anchorId (the minimum real member ID under documented locale ordering),
complete member count, prior mass and at most three ranked representative identities.
The anchor SHALL be independent of balance/representative selection and valid only
within the same snapshot/schema, normalized scope and solver convention. It SHALL
NOT imply correspondence between projections/generations or identify an authored
community entity. Groups SHALL sort by prior mass with deterministic identity tie breaks.
Isolates SHALL NOT become misleading single-node communities. Results SHALL NOT
create persistent community entities or claim stable identities across generations.

#### Scenario: Bulk leaf records

- **WHEN** one community contains many low-prior records
- **THEN** its size reports the raw membership while its mass and ordering use the selected priors

#### Scenario: Representative ordering changes

- **WHEN** balance changes representatives or their order for the same partition
- **THEN** the group anchor remains unchanged and need not be one of the returned representatives

### Requirement: Optional type-frequency balance

Balance SHALL default to none. Type balance SHALL assign each participating node
q=1/(1+n_type/k), where n_type counts its concrete runtime type and k is the median
populated type size, averaging the two middle counts when even. Normalized q SHALL
supply personalized ranking priors and community mass. Balance SHALL affect ranking,
representatives and group order, not community membership or ordinary entity/query/
search reads. Source format, path and volume SHALL NOT be treated as proof of authorship.

#### Scenario: A very large type

- **WHEN** records of one type grow while the median type size remains fixed
- **THEN** that type's unnormalized total prior approaches k instead of growing without bound

#### Scenario: Balance changes

- **WHEN** communities are read with the same scope and different balance policies
- **THEN** membership and sizes remain the same, while representatives, mass and order can change

### Requirement: Bounded generation-owned computation

Analysis SHALL operate on one loaded source/index generation, preserve its freshness
meaning and isolate internal topology from mutation of returned results. Reuse SHALL
NOT retain an unbounded set of projections or retired generations. Maximum projected
inputs SHALL be 100000 nodes and 1000000 canonical edges, enforced before solver
allocation. Exceeding them SHALL fail without silently sampling. Output limits SHALL
NOT be presented as computation limits. Lore SHALL NOT imply a hard RSS/time limit
or host background workers for callers.

#### Scenario: New generation overlaps a read

- **WHEN** a new generation is adopted while an earlier analysis remains active
- **THEN** each operation retains its own generation and inactive retired data is released

#### Scenario: Small output over oversized input

- **WHEN** a caller requests ten results from a projected graph above an input cap
- **THEN** the operation fails with the documented input-limit error instead of computing an unbounded report
