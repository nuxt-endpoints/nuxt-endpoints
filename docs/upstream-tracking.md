# Upstream tracking

This is the canonical watchlist for upstream work that can change the Nuxt 5
integration architecture or its release readiness. The detailed capability
comparison lives in [`upstream-delta.md`](./upstream-delta.md); this file tracks
the moving GitHub state.

Stable repository ownership and per-feature implementation status live in the
[`$endpoint` responsibility map](./endpoint-responsibilities.md). Keep that
classification separate from this moving watchlist.

Issue and PR states last verified: 2026-09-10. Prototype baselines last
verified: 2026-09-03.

## Tracking policy

- **Active** means that an upstream decision or merge can remove local code,
  change an ownership boundary, or unblock the Nuxt 5 release line.
- **Related** means useful convergence with no immediate local change.
- **Resolved/reference** records decisions already reflected in the prototype.
  These entries do not return to the active list unless upstream changes their
  direction.
- Routine dependency, documentation, and unrelated runtime fixes are not
  listed.

At the prototype-baseline verification, the local prototype branches were
based on the current official code in Nuxt, H3, and fetchdts. Nitro official
`main` had three additional documentation-only commits and no code change to
port.

| Upstream | Prototype merge-base with official `main` | Official code commits to review |
| -------- | ----------------------------------------- | ------------------------------: |
| Nuxt     | `d070492f6d91`                            |                               0 |
| Nitro    | `eee779ff384d`                            |                               0 |
| H3       | `d78281bc7f48`                            |                               0 |
| fetchdts | `f48bb95919d5`                            |                               0 |

## Route normalization update — 2026-09-15

h3 rc.32 and [Nitro #4600](https://github.com/nitrojs/nitro/pull/4600) are now
incorporated locally through tracked patches over the existing fork pins.
Nuxt normalizes handler and contract patterns before segment generation, and
NE aligns generated paths and runtime identities while preserving authored
response scopes. See [the integration report](./route-normalization-readiness.md)
for reproduction steps, test results, and standalone Nitro limitations.

## Active watchlist

| Area              | Upstream item                                                                                           | State | Why it matters to Nuxt Endpoints                                                                                                        | Review trigger                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| H3 contracts      | [h3#1437 — richer validated-routing core and types](https://github.com/h3js/h3/issues/1437)             | Open  | Owns the broader direction for params, response contracts, per-method routing, validation errors, and contract introspection.           | A maintainer narrows the accepted contract surface or asks for an implementation slice.        |
| H3 params         | [h3#1501 — params validation in `defineValidatedHandler`](https://github.com/h3js/h3/pull/1501)         | Open  | Can replace part of the local request-validation implementation and affects where validated params live.                                | The PR is updated, reviewed by an H3 maintainer, merged, or superseded.                        |
| H3 context        | [h3#1502 — per-event typed `H3EventContext`](https://github.com/h3js/h3/pull/1502)                      | Draft | Explores carrying coerced params and, later, query/header values on a typed event context; currently stacked on #1501.                  | #1501 merges and the context design receives maintainer direction.                             |
| Nitro OpenAPI     | [nitro#4560 — infer request and response schemas](https://github.com/nitrojs/nitro/pull/4560)           | Open  | Adds request/response JSON Schema to route metadata. It is adjacent to the local contract provider and may offer reusable OpenAPI work. | The metadata shape changes, the PR receives maintainer direction, or it merges.                |
| fetchdts metadata | [fetchdts#195 — support consumer-owned route metadata](https://github.com/unjs/fetchdts/pull/195)       | Open  | Carries NE-owned contract metadata through the generic route compiler without making fetchdts status-aware.                             | Maintainer review, requested changes, or merge.                                                |
| Nuxt Content      | [content#3770 — Nuxt 5 `#imports` compatibility](https://github.com/nuxt/content/issues/3770)           | Open  | Tracks server-side dependencies on an alias no longer supplied by Nitro 3.                                                              | A module-side explicit-import fix or a documented Nuxt adapter compatibility boundary appears. |
| Nuxt Content      | [content#3772 — unresolved `nitropack/runtime` on Nitro 3](https://github.com/nuxt/content/issues/3772) | Open  | Blocks a clean Nuxt 5 documentation-site prerender with the currently published Content runtime.                                        | A Nitro 3 compatible Content release or migration PR appears.                                  |

`@nuxt/content@3.16.0`, the latest published version at the last verification,
still contains server runtime imports that are incompatible with the Nitro 3
prototype. This is a documentation-site release blocker, not a blocker for the
Nuxt Endpoints runtime, generated types, or browser integration.

## Contribution queue (handoff)

| Priority | Item                                                                                                   | Current action                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1        | [nitro#4560](https://github.com/nitrojs/nitro/pull/4560)                                               | Comment with the route-module-evaluation reproducer below. Follow response/status-map design after that.              |
| 2        | [h3#1501](https://github.com/h3js/h3/pull/1501)                                                        | Exercise params validation, coercion, strictness, and inferred handler input against NE.                              |
| 3        | [h3#1502](https://github.com/h3js/h3/pull/1502)                                                        | After #1501 direction settles, check whether coerced params/query/headers remain accurately typed in `event.context`. |
| Observe  | [h3#1437](https://github.com/h3js/h3/issues/1437)                                                      | No additional comment until maintainer direction or an implementation result creates new evidence.                    |
| Wait     | [fetchdts#195](https://github.com/unjs/fetchdts/pull/195)                                              | Consumer-owned metadata PR is open; wait for maintainer feedback.                                                     |
| Low      | [nitro#3542](https://github.com/nitrojs/nitro/issues/3542)                                             | Keep as the v2-era validator/OpenAPI reference; #4560 is the active v3 implementation.                                |
| Done     | [h3#1538](https://github.com/h3js/h3/pull/1538), [nuxt#36238](https://github.com/nuxt/nuxt/pull/36238) | Merged; no comment needed.                                                                                            |
| Closed   | [nitro#2758](https://github.com/nitrojs/nitro/issues/2758)                                             | Closed as not planned after typed-fetch ownership moved to Nuxt/fetchdts; no follow-up.                               |

### Nitro #4560 verification

Verified PR head `92a85ef4` (fetched 2026-09-10) against representative NE
routes:

- The PR's two unit tests and Vite OpenAPI integration test pass.
- TypeScript response inference produces the expected schema for an NE
  single-method route, including an absolute handler discovered from a custom
  scan directory.
- A status-declared NE route still yields only its successful body as the
  inferred default `200` schema. The PR has no per-status response model.
- An NE multi-method route yields no inferred response schema because one
  exported dispatcher does not provide one method-specific return type.
- Request inference recognizes only a direct
  `export default defineValidatedHandler(...)`; `defineEndpoint(...)` is not a
  recognized macro, so NE request schemas are not projected.
- Explicit OpenAPI `parameters`, `requestBody`, and `responses` replace the
  corresponding inferred fields rather than merging with them. This is the
  documented behavior, but it is not sufficient for NE's additive status and
  media metadata.
- Opening `/_openapi.json` dynamically imports every recognized validated
  route to read `module.default.validate`. A regression fixture with an
  otherwise-unrequested route-level counter observed `0` before the OpenAPI
  request and `1` afterwards. This is the strongest focused upstream review
  comment: schema generation should not execute route-module top-level code,
  or the runtime-evaluation behavior should be an explicit accepted boundary.

## Related, non-blocking

| Area                    | Upstream item                                                                                   | State    | Local impact                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| H3 headers              | [h3#1542 — re-export typed request/response header types](https://github.com/h3js/h3/pull/1542) | Open     | May simplify public type imports later; it does not change contract extraction or validation behavior. |
| Nitro validator OpenAPI | [nitro#3542 — validator definitions in OpenAPI](https://github.com/nitrojs/nitro/issues/3542)   | Open; v2 | Earlier problem statement now substantially overlapped by the v3 work in #4560.                        |

## Resolved or incorporated references

| Area              | Upstream item                                                                                                 | State                    | Consequence for the local design                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Nuxt typed fetch  | [nuxt#36238 — generate `$fetch`/`useFetch` types from server routes](https://github.com/nuxt/nuxt/pull/36238) | Merged                   | Nuxt owns the builder-neutral `ServerRoutes` pipeline consumed by both ordinary fetch and Nuxt Endpoints.                               |
| Nuxt type budget  | [nuxt#36254 — typed-fetch performance and output regression tests](https://github.com/nuxt/nuxt/pull/36254)   | Merged                   | The local Nuxt fork is based on this commit and retains its route-module and type-instantiation guards.                                 |
| Nitro typed fetch | [nitro#4572 — remove typed fetch from Nitro core](https://github.com/nitrojs/nitro/pull/4572)                 | Merged                   | The prototype does not restore `InternalApi`, `nitro-routes.d.ts`, or a Nitro-owned fetch type generator.                               |
| Nitro auto-import | [nitro#4573 — remove server auto-imports](https://github.com/nitrojs/nitro/pull/4573)                         | Merged                   | Nuxt 5 route files use explicit server imports; Nuxt Endpoints does not add a private compatibility alias.                              |
| Nitro direction   | [nitro#2758 — better typed fetch and routes](https://github.com/nitrojs/nitro/issues/2758)                    | Closed                   | Nitro may provide an opt-in solution later, while the current implementation lives in Nuxt/fetchdts.                                    |
| H3 async validate | [h3#1491 — async validation in `defineValidatedHandler`](https://github.com/h3js/h3/pull/1491)                | Merged                   | Uniform async validation is already part of the H3 baseline.                                                                            |
| H3 handler types  | [h3#1538 — expose validated query and headers](https://github.com/h3js/h3/pull/1538)                          | Merged                   | The H3 baseline can project validated body, query, and header types from a handler.                                                     |
| fetchdts routing  | [fetchdts#192 — compile router-equivalent route sets](https://github.com/unjs/fetchdts/pull/192)              | Merged                   | The metadata extension prototype is based on the current compiled-route implementation.                                                 |
| Nuxt Icon runtime | [icon#516 — support Nitro 3 runtime imports](https://github.com/nuxt/icon/pull/516)                           | Merged; local update due | Upstream removed the server `#imports` dependency. Update the Nuxt 5 site from `@nuxt/icon@2.2.3` to `2.5.1` and rerun `site:generate`. |

## Current decisions derived from upstream

- H3 interprets route contracts and owns validation semantics.
- Nitro extracts and exposes route contracts but does not own typed-fetch code
  generation.
- Nuxt joins builder route information with opaque type metadata and asks
  fetchdts to generate one `ServerRoutes` tree.
- Nuxt Endpoints keeps the status-aware client, Pinia Colada adapter, full
  per-status OpenAPI projection, and HTTP idempotency policy.
- The open Nitro OpenAPI work must be reviewed before proposing a parallel
  route-schema metadata shape.
- Nitro's server auto-import removal is intentional. Compatibility work should
  converge on explicit module-owned imports rather than an undocumented Nuxt
  Endpoints alias.
