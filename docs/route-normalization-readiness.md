# Route normalization: Nuxt 5 integration

Updated: 2026-09-15. Applies to the working `nuxt5` branch.

## Status

The local integration now incorporates h3 rc.32 and Nitro #4600, with matching
changes in Nuxt and NE. Runtime routing, generated client metadata, and OpenAPI
use canonical route patterns. The custom route-contract APIs still require the
four prototype forks; this does not make the branch installable with official
npm packages alone.

The changes to the three affected forks are stored in `patches/upstream/` and
applied by `node scripts/apply-upstream-patches.mjs`. The README and Nuxt 5 CI
workflow apply them after checking out the pinned commits and before building.
No fork commits have been published or pushed as part of this work.

## Upstream changes

- [h3 v2.0.1-rc.32](https://github.com/h3js/h3/releases/tag/v2.0.1-rc.32)
  was published at 2026-09-14 18:46:42 UTC (September 15, 03:46:42 JST).
  It exports `normalizeRoute` and the `TypedHeaders` type and improves handler
  request type inference. The h3 patch incorporates the complete rc.31 → rc.32
  delta, preserving the fork's contract extensions.
- [h3 #1549](https://github.com/h3js/h3/pull/1549) exposes the existing internal
  normalizer through a public wrapper. Local normalization results already
  matched rc.32 before the update; public API access was missing.
- [Nitro #4600](https://github.com/nitrojs/nitro/pull/4600) was merged at
  2026-09-14 19:34:13 UTC (September 15, 04:34:13 JST), commit
  `ff9e92f9b1ff3e919eed42a74e075fe713ec3c81`. It normalizes router registration
  patterns and baseURL, leaving original descriptors unchanged. Build-time
  routeRules and Vercel functionRules retain `normalize: false` because they
  compare patterns with other patterns.

Status and timestamps were verified through the GitHub REST API. Inclusion in
a published Nitro npm release was not checked; this integration applies the
merged source change directly.

## Implementation

| Layer            | Change                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| h3               | Incorporate rc.32 and retain `EventHandlerRequestShape` in the new inference helpers so validated query values can still be numbers or other coerced types |
| Nitro            | Apply #4600 and normalize route values emitted by the contract provider and runtime contract registry                                                      |
| Nuxt             | Normalize ordinary handler patterns and contract metadata patterns before `routeNodeKeys()` produces segments for `ServerRoutes`                           |
| fetchdts         | No change: its generic compiler consumes the segments supplied by Nuxt                                                                                     |
| NE generation    | Normalize endpoint paths for clients, manifests, OpenAPI, and metadata lookup; preserve an optional `sourceRoute` for authored response configuration      |
| NE identity      | Normalize idempotency and runtime override keys, account for rou3's trailing-slash equivalence, and reject ambiguous endpoint or runtime identities        |
| NE forms         | Normalize the page action used by the form bridge and forward to the canonical endpoint target                                                             |
| NE type literals | Escape normalized path strings, including a quote decoded from `%27`, before emitting TypeScript                                                           |

The h3 and Nitro builds use srvx 1.0.5. Keeping the srvx dependency aligned also
avoids incompatible crossws peer types across the linked source trees.

### Authored paths and canonical paths

For a route authored as `/normalized/について`:

- The generated `$endpoint` path, OpenAPI path, and metadata lookup use
  `/normalized/%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6`.
- Browser requests using the authored spelling still reach that route through
  normal URL encoding.
- `server/routes.config.ts` response scopes retain their authored spelling.
  Both runtime response projection and generated `ServerRouteResponsesFor`
  use `sourceRoute`, so they continue to agree without reproducing URL
  normalization in TypeScript conditional types.
- `server/endpoints/runtime.ts` overrides are matched by canonical identity.
  Equivalent keys for the same method are rejected rather than selected
  according to insertion order.

`normalizeRoute()` preserves `%2F`, `%25`, and rou3 pattern syntax. It does not
remove trailing slashes; identity and OpenAPI collision comparisons handle
rou3's trailing-slash equivalence separately. Dynamic request parameter encoding
and route-rule normalization retain their existing semantics.

### Reproducing the fork updates

The patch script requires these exact existing pins:

| Fork  | Commit                                     |
| ----- | ------------------------------------------ |
| h3    | `7f4c1c901a15e2a6ac5c217a20fb638a740240f4` |
| Nitro | `cc9f56fcf2cc1bc8b19d1c81408853df8b1c7b07` |
| Nuxt  | `d9dab5edf132eb2ba7882966ff21e6ca1c427a32` |

It checks every patch before writing files, accepts an already-applied patch,
and stops on a partial application or conflict. Clean clones of all three pins
were used to verify first application and repeated application. The normalization patches
exclude prior working changes. A separate `nitro-contract-authoring.patch`
preserves the existing Nitro contract-authoring changes required by the current
NE branch; those changes were already present before this task.

The h3 patch includes its upstream lockfile. Nitro's patch changes dependency
requirements; the existing README/CI install step refreshes its lockfile while
selecting the TypeScript 6 compatibility package. That package exposes `tsc6`,
so standalone Nitro type checks in this environment use `vp exec tsc6`.

## Validation

All commands ran inside the workspace execution environment, not on the macOS
host. The checks used the existing working branch, including its prior changes.

| Check                                                                  | Result                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| h3 build, lint, and typecheck                                          | Passed                                                                |
| Full h3 Vitest suite                                                   | 2,871 passed, 48 skipped; no type errors                              |
| Nitro build                                                            | Passed                                                                |
| Nitro source, unit tests, and route-pattern integration test typecheck | Passed with a scoped tsconfig                                         |
| Nitro route-pattern unit and Vite integration tests                    | 11 passed, including non-ASCII baseURL, route rules, and prerendering |
| NE unit tests                                                          | 452 passed; integration placeholders skipped                          |
| Nuxt adapter lint                                                      | Passed                                                                |
| NE source/test typecheck                                               | Passed                                                                |
| Fixture generated types                                                | Passed, including canonical metadata and authored response scopes     |
| Nuxt integration                                                       | 81 passed, 6 browser-only tests skipped                               |
| Nuxt integration with Chromium                                         | 88 passed                                                             |
| Packed NE artifact in a separate Nuxt 5 project                        | Install, build, and runtime smoke test passed                         |
| Patch application to clean pinned clones                               | Passed; repeated application also passed                              |

The route fixture covers Japanese paths, spaces, `/%40handle`, `/%61dmin`,
literal and encoded dot segments, `%2F`, `%25`, trailing slashes, and `%27`.
It checks actual HTTP requests and canonical OpenAPI paths. Generated NE routes
are compared with Nuxt's `ServerRoutes`, and explicit fixture type assertions
check successful bodies and the response inherited from an authored Japanese
scope. Unit tests also cover duplicate canonical identities and form targets.

### Standalone Nitro limitations

The full Nitro typecheck includes unrelated React and Vue example projects
whose dependencies are missing or incompatible in this checkout. Source and
unit-test checks pass separately. The standalone contract-registry HMR test
also times out waiting for an edited operation to appear; the other 19 contract
provider tests pass. The same HMR timeout was reproduced using both the Nitro and h3
source snapshots from before these changes (h3 rc.31 without the public
`normalizeRoute` export), with the current installed tooling dependencies. This remains a separate
follow-up; the Nuxt production and browser integration results above do not
establish contract-registry HMR correctness.
