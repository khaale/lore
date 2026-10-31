---
'@khaale/lore': minor
---

Add a shared SQLite index including stored narrative, explicit indexed/refresh-on-read SDK policies, transactional grouped reads and conditional CLI refresh. Preserve JSON defaults and make JSON graph preparation lazy.

Handle transient SQLite reader startup contention with bounded asynchronous waiting and an explicit INDEX_BUSY error instead of incorrect rebuild guidance.
