---
'@khaale/lore': patch
---

Speed up graph builds with per-build reference-target indexes. Read source files
in bounded concurrent batches, preserve candidate/diagnostic order and avoid
repeated source-position scans and unnecessary Markdown tokenization.

Compile/discover once per SQLite rebuild and build secondary indexes after row
loading in the publication transaction. Publish the validated data read without
a post-build source-stability rescan; later refresh checks detect concurrent edits.
Filter bounded graph candidates before hydrating rejected edges/provenance,
preserving graph results and coverage.
