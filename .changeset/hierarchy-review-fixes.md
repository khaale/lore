---
'@khaale/lore': patch
---

Bound intermediate hierarchy placements before allocating child arrays, including
repeated type occurrences and child-count lookahead. Include direct owners before
checking whether LCA placement has multiple distinct participants. Claim matching
Markdown-table links when frontmatter already supplies the same reference value,
preventing an extra generic edge while preserving frontmatter provenance.
