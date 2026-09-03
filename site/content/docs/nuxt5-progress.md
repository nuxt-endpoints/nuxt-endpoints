---
title: Nuxt 5 Progress
description: What the Nuxt 5 integration branch delegates upstream today, and what is still owned by the module.
---

This is the Nuxt 5 integration branch. It builds against prototype forks of h3, Nitro, Nuxt, and
fetchdts that carry route-contract work not yet released upstream — see
[Compatibility](/docs/getting-started#compatibility) for the supported platform line. The
Nuxt 4 / Nitro 2 / h3 v1 line lives on the `main` branch and is the published release line.

Last updated: **2026-09-03**

## Working branches

| Project        | Branch                                                                                                   | Role in the prototype                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Nuxt Endpoints | [`nuxt5`](https://github.com/nuxt-endpoints/nuxt-endpoints/tree/nuxt5)                                   | Nuxt integration, `$endpoint`, `useEndpoint`, OpenAPI, and idempotency UX |
| H3             | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/h3/tree/prototype/route-contracts)       | Typed route contracts, validation, and the active contract on the event   |
| Nitro          | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/nitro/tree/prototype/route-contracts)    | Build-time contract extraction, the contract provider, and runtime wiring |
| Nuxt           | [`prototype/route-metadata`](https://github.com/nuxt-endpoints/nuxt/tree/prototype/route-metadata)       | Carries Nitro contract metadata through `server:routes` to `ServerRoutes` |
| fetchdts       | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/fetchdts/tree/prototype/route-contracts) | Extensible route metadata carried into generated client types             |

These are public working branches. **Nothing has been proposed to the official h3, Nitro,
fetchdts, or Nuxt repositories yet**, so nothing here should be read as an upstream commitment.
The branches are kept together because the prototype crosses project boundaries, and this
repository links these exact forks while the upstream API shape is being worked out.

Because those forks are resolved through local links, this branch cannot be installed from the
public npm registry. Use the `main` branch for that.

> **Current integration work:** Nitro removed its built-in typed-fetch pipeline in
> [nitro#4572](https://github.com/nitrojs/nitro/pull/4572), after route type generation moved to
> Nuxt and fetchdts. The prototype has now removed the earlier Nitro type bridge: Nitro exposes
> contracts, Nuxt joins them to `server:routes`, and one `ServerRoutes` tree serves both ordinary
> typed fetch and status-aware `$endpoint`. This page does not claim that the extension point has
> been accepted upstream.

## What moved upstream

The goal of this branch is to stop maintaining a second copy of infrastructure that belongs to
the platform. What the module no longer owns:

- **Contract authoring, dispatch, and validation** live in h3. `defineRouteHandler`, single and
  multi-method dispatch, request and response validation, `params`, and media-type body maps are
  h3's. The module re-exports h3's `validateRouteContractRequest` / `validateRouteContractResponse`
  instead of implementing its own.
- **Route discovery and contract extraction** live in Nitro. Nitro extracts contracts at build
  time and exposes them through `getRouteContracts()`, so the module no longer evaluates route
  files itself — the previous jiti-based scanner is gone.
- **Ordinary generated route types** now belong to Nuxt and fetchdts. Nitro removed its built-in
  `InternalApi` / `nitro-routes.d.ts` pipeline in nitro#4572. The module's own `types.routes` writer
  and `handlerReturn` metadata have also been deleted. The local Nuxt fork carries opaque contract
  metadata through `server:routes` without restoring typed-fetch generation inside Nitro.
- **Generic route-type compilation** lives in fetchdts, which carries opaque route metadata
  without interpreting status-aware semantics.

## What the module still owns

These are deliberately downstream, because they are product decisions rather than platform
primitives:

- Status-aware `$endpoint` and `useEndpoint`, including the response union and SSR request
  forwarding.
- Pinia Colada query and mutation option projection, delegating cache, SSR, and hydration to the
  official `@pinia/nuxt` and `@pinia/colada-nuxt` modules.
- OpenAPI generation. Nitro's built-in OpenAPI reads `defineRouteMeta`, which only accepts JSON
  literals, so schema objects from Zod, Valibot, or Effect Schema cannot reach it.
- HTTP idempotency: the storage contract, authorization identity, fingerprints, and replay.
- Content negotiation and `respond()`. Both are candidates to return to h3, which already owns
  the response contract shape but does not negotiate or provide a way to set a status.

## How the integration is verified

- A fixture-level type test compares every generated Nuxt Endpoints route with Nuxt's
  `ServerRoutes`, rejects missing or `never` entries, and checks that the ordinary successful
  response and status-aware contract remain compatible across the two client views.
- The SQLite idempotency adapter is exercised through independent real database connections in
  worker threads. The conformance test covers concurrent ownership, replay, fingerprint conflicts,
  lease fencing, expiry, and release rather than replacing the database with a mock.

These checks prove the current pinned prototype as a unit. They are not a claim that the extension
points have been accepted by the upstream projects.

## What stays stable

`$endpoint` and `useEndpoint` are useful application-facing APIs independently of where route
contract discovery and validation live. This branch therefore replaces module-owned plumbing with
upstream primitives while preserving that UX, and route files use the same `defineRouteHandler`
syntax on both lines.

Nitro 3 no longer provides server auto-imports, so Nuxt 5 route files explicitly import
`defineRouteHandler` from `nuxt-endpoints/runtime`. The declaration shape itself is unchanged.

The one authoring difference between the lines: this branch can declare `head`, `options`,
`connect`, and `trace` explicitly, while the Nuxt 4 line supports five methods, derives HEAD from
`get`, generates OPTIONS, and rejects the remaining two at the type level.

Upstream APIs are still evolving, so changes cannot be ruled out. Keeping application code stable
wherever practical is nevertheless a design constraint, and unavoidable changes will be documented
as migrations.

For the published release line, start with [Getting Started](/docs/getting-started).
