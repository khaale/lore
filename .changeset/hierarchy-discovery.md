---
'@khaale/lore': minor
---

Add editable hierarchy candidates and bounded instance navigation to SDK and CLI,
including source-context hypotheses, alternative axes, exact scalar groups,
explicit labels and optional checked forest-LCA placement. Keep ordinary flat
queries and canonical graph reads available for composition. Include independent
relative structure/connectivity type hints without filtering or changing placement.

Support optional individual entity scores with includeScores / CLI --scores,
normalized per actual type across the selected hierarchy without changing pages.

Reuse one bounded hierarchy analysis and lazy instance-score calculation within
each readSnapshot callback; evict on definition/budget changes and errors, and
release on callback exit without changing formulas or the public API.
