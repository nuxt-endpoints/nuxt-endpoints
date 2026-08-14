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

1. Update `package.json` to the intended version.
2. Replace `Unreleased` in `CHANGELOG.md` with the release date.
3. Run the full checks on Node 22:

   ```bash
   vp install --frozen-lockfile
   vp run check
   vp run build
   vp run site:generate
   ```

4. Preview the package contents without publishing:

   ```bash
   vp pm pack --out /tmp/nuxt-endpoints.tgz
   tar -tzf /tmp/nuxt-endpoints.tgz
   ```

5. Commit and push the release preparation.
6. Ensure the release commit is contained in `main`.
7. Create tag `v<version>` and publish the matching GitHub Release. Mark the
   GitHub Release as a prerelease exactly when the package version contains a
   SemVer prerelease suffix.

## Stage and approve

Publishing the GitHub Release runs `.github/workflows/release.yml`. The
workflow checks the tag and package version, reruns tests and the build, packs
the exact artifact, and sends it to npm staged publishing using OIDC. It also
requires the tag commit to be contained in `main` and rejects mismatches
between the package version and the GitHub prerelease flag. GitHub prereleases
use the `next` dist-tag; other releases use `latest`.

After the workflow succeeds:

1. Inspect the staged package on npm.
2. Approve it from a trusted maintainer session with 2FA.
3. Verify the published version and dist-tag on npmjs.org.

## Documentation deployment setup

The Pages workflow is gated by the repository variable `PAGES_ENABLED`. Before
setting it to `true`, enable GitHub Pages with
GitHub Actions as its source in the repository settings. Then run the Pages
workflow manually once. Until this setup is complete, ordinary pushes skip the
Pages jobs instead of failing CI.

If the GitHub repository is transferred, update `package.json`, documentation
URLs, and the npm Trusted Publisher before the next release.
