## ADDED Requirements

### Requirement: Reference column annotation
The supported profile SHALL include lore:markdown_reference_column as executable
metadata on a multivalued reference slot. Its mapping SHALL contain exactly
heading and column with nonempty string values and a valid heading selector.
Invalid shape, scalar/inline/single-reference usage or a competing
lore:markdown_selectors annotation on that slot SHALL fail schema compilation.

#### Scenario: Invalid column declaration
- **WHEN** a scalar field uses a reference-column annotation or its keys are invalid
- **THEN** compilation fails before reading source records
