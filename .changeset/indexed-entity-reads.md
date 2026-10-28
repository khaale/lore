---
'@khaale/lore': minor
---

Index entity identities and incident relations once per workspace to accelerate batch reads and reference filters. Graph methods accept query/read collections and arrays of entity identities directly. Selected reference fields now appear in entity properties as resolved target IDs (arrays for multivalued fields), alongside detailed relations; inferred inverse relations remain separate from authored property values.
