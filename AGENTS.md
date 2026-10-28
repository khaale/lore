# Lore repository guidance

Keep README, SDK documentation, public types and examples aligned with implemented
behavior. Reusable product skills live under `skills/`: `lore-modeling` for schemas
and authored knowledge, and `lore-usage` for CLI, SDK and PTC workflows.

`openspec/` and `.agents/` are local, ignored working materials. Do not require
them to build, use or contribute to the tracked project.

## Project command environment

Treat the runtime range, pinned package manager, and runtime-manager files
committed by the repository as authoritative. For non-interactive agent work,
the coordinating agent resolves the environment once and records a small
execution capsule containing:

- the resolved `node` and `pnpm` executable paths and versions;
- `CI=true`, except when explicitly testing interactive behavior;
- the exact command that passed the repository preflight.

Prepend the selected runtime directory to the existing `PATH`; never replace
`PATH` with a minimal value because tests may invoke other repository tools.
Reuse the capsule across implementing, reviewing, testing, and final
gate roles. Each executing role may confirm the supplied preflight once, but
must not rediscover the same environment or retry a command without first
changing the diagnosed cause of failure.

## Read-only product boundary

Lore reads and validates authored files. Keep CLI, SDK and caller-owned PTC.
Authored files stay externally owned; only the derived index is written.
Use `pnpm check` and `pnpm test:cli` for the console. Build before built CLI tests.

## Package and releases

Only the root `@khaale/lore` package is public. Workspace packages are private
implementation modules. Keep public SDK imports, documentation and skills on
`@khaale/lore`; do not expose workspace package names as installation requirements.
`pnpm build` bundles the CLI, SDK and declarations into root `dist/`.

`pnpm check` includes installing the packed tarball in an isolated consumer and
checking the CLI, SDK and TypeScript declarations. Run `pnpm pack:check` for that
boundary alone. Subsequent user-facing changes need a changeset for the root
package. Follow `PUBLISH.md`; publication is a separate external action.
