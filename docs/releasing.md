# Release Process

No release command runs from a normal branch push or pull request. The release
workflow starts only after a maintainer publishes a GitHub Release whose tag
matches `v<package.json version>`. It uploads the package to npm staged
publishing; a maintainer must inspect and approve that stage with 2FA before it
becomes public. The workflow remains disabled until the repository variable
`NPM_TRUSTED_PUBLISHING_ENABLED` is explicitly set to `true`.

## One-time setup

1. Protect the GitHub `npm` environment with required reviewers.
2. Publish version `0.1.0` manually by following
   [First package publication](#first-package-publication). npm requires a
   package to exist before a Trusted Publisher can be configured.
3. In the npm package settings, configure a GitHub Actions Trusted Publisher:
   - owner: `nuxt-endpoints`
   - repository: `nuxt-endpoints`
   - workflow: `release.yml`
   - environment: `npm`
   - allowed action: staged publishing only
4. Set the GitHub repository variable `NPM_TRUSTED_PUBLISHING_ENABLED` to
   `true` only after the Trusted Publisher has been configured.
5. Require 2FA and disallow traditional write tokens after the Trusted
   Publisher has been verified.

npm can publish a public package from either a public or private repository
through Trusted Publishing. Keep the repository public when provenance should
link consumers to the source tree.

## First package publication

The initial `0.1.0` publication cannot use npm staged publishing because the
package does not exist yet. Keep `NPM_TRUSTED_PUBLISHING_ENABLED` unset, run
the normal checks and pack step, inspect the tarball, and publish that exact
tarball manually only after receiving separate explicit approval:

```bash
vp pm publish /tmp/nuxt-endpoints.tgz --access public --tag latest
```

This is a real public npm release, not a dry run or an internal bootstrap.
After npm confirms `0.1.0`, publish the matching GitHub Release while the
repository variable is still unset; the staging job will be skipped. Then
configure the Trusted Publisher and enable the variable for later versions.

## Prepare a release

Use the repository release script from a clean `main` worktree. Before running
it, put every user-visible change under `## Unreleased` in `CHANGELOG.md` and
commit it.

Preview the version derived from commits since the previous tag:

```bash
node scripts/release.mjs --dry-run
```

Then run the complete release. This updates `package.json` and the changelog,
runs formatting, lint, type checks, fixture checks, unit tests, build, and a
fresh-app smoke test of the packed tarball. It commits the release preparation,
pushes `main` and the tag, and creates the GitHub Release:

```bash
node scripts/release.mjs
```

The final prompt requires typing the exact version because publishing the
GitHub Release starts the immutable npm release process. Pass an explicit
version such as `0.12.0` only when the derived version is intentionally being
overridden. Use `--no-publish` to prepare and commit without pushing; finish a
prepared release with `--publish-only`.

The browser E2E suite and documentation generation are not part of the local
release script. Run them before releasing when their affected surfaces changed:

```bash
vp run test:e2e:browser
vp run site:generate
```

CI repeats the full package checks, and the Pages workflow generates and
deploys the documentation after `main` is pushed.

## Stage and approve

Publishing the GitHub Release runs `.github/workflows/release.yml`. The
workflow checks the tag and package version, reruns tests and the build, packs
the exact artifact, and sends it to npm staged publishing using OIDC. It also
requires the tag commit to be contained in `main` and rejects mismatches
between the package version and the GitHub prerelease flag. GitHub prereleases
use the `next` dist-tag; other releases use `latest`.

After the workflow succeeds:

1. Sign in to npm and list the staged versions with `vp pm stage list`.
2. Inspect the stage with `vp pm stage view <stage-id>` and, when needed,
   download the exact tarball with `vp pm stage download <stage-id>`.
3. Approve it from a trusted maintainer session with
   `vp pm stage approve <stage-id>` and 2FA.
4. Verify the published version and dist-tag on npmjs.org.

## Documentation deployment setup

The Pages workflow is gated by the repository variable `PAGES_ENABLED`. Before
setting it to `true`, enable GitHub Pages with
GitHub Actions as its source in the repository settings. Then run the Pages
workflow manually once. Until this setup is complete, ordinary pushes skip the
Pages jobs instead of failing CI.

If the GitHub repository is transferred, update `package.json`, documentation
URLs, and the npm Trusted Publisher before the next release.
