# distribution

## Purpose

Deliver one public package with CLI, typed SDK, examples, reusable skills and a consistent release boundary.

## Requirements

### Requirement: Single public package

The distributable SHALL be @khaale/lore, exposing the lore executable and ESM SDK with TypeScript declarations at the root import. Workspace packages SHALL remain private implementation modules and SHALL NOT be consumer installation requirements.

#### Scenario: Isolated consumer

- **WHEN** a consumer installs the packed root tarball
- **THEN** the CLI, root SDK import and declaration checking work without workspace packages

### Requirement: Supported toolchain

Lore SHALL require Node >=24.0.0 <25. Source development SHALL pin pnpm 10.17.0 with .node-version aligned to Node major 24. Preflight SHALL reject runtime, package-manager and declaration drift.

#### Scenario: Wrong runtime

- **WHEN** preflight receives a Node version outside the supported major
- **THEN** it exits nonzero with expected and actual versions

#### Scenario: Pinned package manager

- **WHEN** preflight runs with Node 24.20.0 and pnpm 10.17.0 against consistent declarations
- **THEN** it passes

### Requirement: Build and consumer boundary

The root build SHALL bundle CLI, SDK and declarations into dist. The packed package SHALL include self-contained lore-modeling and lore-usage skills, SDK documentation and the included decision example. OpenSpec planning documentation and local .agents/ materials SHALL NOT be required for building or using the product.

#### Scenario: Published skills

- **WHEN** a consumer inspects installed skill references
- **THEN** their required local reference files are included in the package

#### Scenario: Public type checks

- **WHEN** a consumer imports root SDK types
- **THEN** supported calls typecheck and invalid calls are rejected

### Requirement: Release discipline

Subsequent user-facing product changes SHALL carry a changeset for the root package. Publication SHALL follow PUBLISH.md as a separate explicit external action; specification maintenance alone SHALL NOT publish a package.

#### Scenario: Internal workspace change

- **WHEN** implementation modules change user-visible root package behavior
- **THEN** release metadata targets @khaale/lore
