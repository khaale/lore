---
kind: Decision
id: ADR-002
title: Validate documents before publishing an index
status: accepted
depends_on:
  - ADR-001
---

# Validate documents before publishing an index

Check authored files against a shared schema before exposing them to integrations.
An invalid edit must preserve the last valid index.
