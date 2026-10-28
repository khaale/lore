# Publishing Lore

Lore releases one public npm package, `@khaale/lore`, from
`https://github.com/khaale/lore`. The root version covers the CLI, SDK, skills and
examples. Internal workspace packages are private and are neither published nor
independently versioned by Changesets.

## Build and verify

Use Node 24.x and the repository's pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack:check
```

`pnpm check` includes the packaging test; `pack:check` is a focused alternative
when checking that boundary alone. It packs the root package, installs the actual
tarball in an isolated directory without workspace links, runs its CLI against
the included model, exercises SDK/PTC reads and checks TypeScript consumers.

`pnpm build` compiles internal modules, bundles the CLI and SDK with shared ESM
chunks and runtime dependencies, and rolls public declarations into one `.d.ts`.
The artifact has no runtime package dependencies and no `workspace:` references.
Bundled dependency licenses are retained under `dist/licenses/`.

The `files` allowlist contains only built output, skills with their references,
public documentation, the small decisions example and license/changelog files.
Local planning files, authored indexes, source tests and internal package sources
are excluded. `prepack` rebuilds output before ordinary `npm pack` or publication.
`prepublishOnly` runs the complete check before publication.

To inspect an archive without publishing:

```sh
npm pack --dry-run
```

## Initial npm setup

The initial version is 0.1.0. Before using the automated release workflow:

1. Ensure the GitHub repository is `khaale/lore` and the publishing npm account
   has access to the `@khaale` scope and package name.
2. Run the checks above. Create the initial commit and establish `main` as the
   repository's default branch. Do not overwrite existing remote history without
   an explicit decision to do so.
3. Publish the first version manually from an authenticated npm session:

   ```sh
   npm publish --access public
   ```

4. In the npm package settings, add a GitHub Actions trusted publisher for owner
   `khaale`, repository `lore`, workflow `release.yml`. Leave the environment empty
   because the workflow does not declare one. Enable direct `npm publish` for this
   publisher; Changesets uses direct publishing.
5. In GitHub Actions settings, allow Actions to create pull requests. Configure
   the normal CI check as required for merging. Once npm setup is complete, rerun
   the Release workflow if its first run occurred before the package existed.

Trusted publishing requires npm >=11.5.1; `pnpm release` checks the installed npm
version before invoking Changesets. The workflow uses Node 24 and GitHub OIDC
through `id-token: write`, with provenance enabled. No long-lived npm publish token
is configured in the workflow. Repository metadata must continue to match the
GitHub source used for publication.

## Subsequent releases

For a user-facing fix or feature, create a note for the root package:

```sh
pnpm changeset
```

Select `@khaale/lore` and choose the version bump that reflects its public API.
Commit that note with the implementation and documentation changes. Changes to
private modules are expressed as changes to this one public package.

On a push to `main`, the Release workflow installs the locked dependencies and
runs `pnpm check`. `changesets/action@v1` then creates or updates a release PR
containing the next version and changelog. Merging the release PR causes the next
workflow run to publish that version and create its GitHub release.

The workflow can also be dispatched manually. Publication is not part of ordinary
local builds or tests. Do not call `pnpm release` as a readiness check: it publishes.

## Skills

`skills/lore-modeling` and `skills/lore-usage` are included in the npm artifact and
can also be installed directly from GitHub with `npx skills add khaale/lore`.
Each folder contains all its own reference documents; packaging must preserve
that structure. Updating a skill alongside a public feature keeps the npm version
and its bundled instructions aligned.
