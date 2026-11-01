## ADDED Requirements

### Requirement: SQLite refresh input baseline

SQLite refresh SHALL observe eligible file additions/deletions as well as size/mtime, selected schema/import dependencies and ignore-file presence. Automatic model selection SHALL observe both default model names; explicit selection SHALL remain explicit. SQLite database/journal files SHALL not become authored inputs. Published-only reading SHALL not perform this observation.

#### Scenario: New record file

- **WHEN** an eligible file is added after publication
- **THEN** the next required source check detects the changed path set

#### Scenario: Ambiguous automatic model

- **WHEN** a second default model filename appears after an automatically selected model was published
- **THEN** refresh reports model ambiguity and retains the last valid generation

#### Scenario: Dependency repair

- **WHEN** a changed model imports an invalid dependency and is later repaired
- **THEN** the subsequent source-check/build path can validate and publish the repair
