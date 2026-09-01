---
title: Comparison
description: How Nuxt Endpoints relates to Nuxt typed fetch, tRPC, and OpenAPI tooling.
---

Nuxt Endpoints adds a typed, validated contract around ordinary Nuxt server routes. This page positions it against the approaches it is usually compared with.

## Plain Nuxt `$fetch` typing

Nuxt already infers server route return types for `$fetch`. What it does not provide:

- Request validation. `getQuery`, `readBody`, and route params reach the handler unvalidated.
- Typed request input. Params, query, headers, and body are untyped on the caller side.
- Typed non-2xx responses. Error bodies are `unknown`.
- OpenAPI output.

Nuxt Endpoints keeps that workflow — routes stay ordinary files under `server/api`, and plain `$fetch` continues to work — and adds the contract on top for the routes that opt in. See [Incremental Adoption](/docs/incremental-adoption).

On the current Nitro 2 support line, Nuxt Endpoints generates its richer contract types independently, then applies Nitro's JSON wire mapping to client responses. Integration tests compare every generated endpoint success body directly with Nitro's generated `InternalApi`. Awaited `$endpoint` requests preserve status-specific non-2xx bodies outside `InternalApi`'s success-return model, and `.raw()` exposes the native response.

## Nuxt typed fetch and fetchdts

Nuxt's typed-fetch work and [`fetchdts`](https://github.com/unjs/fetchdts) are complementary to endpoint contracts. `fetchdts` is a type-generation engine, not by itself a Nuxt route declaration API: the detail it can generate depends on the contract metadata supplied by its integration.

Inferring a route's return type does not by itself define runtime request validation, header schemas, distinct response-status bodies, idempotency policy, or OpenAPI metadata. The canonical `defineRouteHandler` contract supplies that information. Its consumers can change without changing route authoring.

For the Nuxt 5 generation, the preferred direction is to contribute endpoint
metadata to Nuxt's generated fetch schema through a public integration point,
then let Nuxt clients and Nuxt Endpoints consume the same successful response
projection. `$endpoint` keeps the richer per-status result and `useEndpoint`
keeps its Nuxt async-data UX; upstream primitives replace duplicated plumbing
rather than those application-facing APIs. Until that integration is covered
by the package test matrix, this remains a migration direction rather than a
Nuxt 5 support claim.

## tRPC

tRPC provides excellent end-to-end typing, but it replaces REST routing with its own RPC protocol:

- Procedures are not plain HTTP routes; other consumers (mobile apps, other services, `curl`) need a tRPC client or an additional REST layer.
- Adopting or removing it is a routing-level decision, not a per-route one.

Nuxt Endpoints keeps endpoints as plain HTTP routes documented with OpenAPI 3.1, so they remain consumable by anything that speaks HTTP. Adoption and rollback are per route.

## Spec-first OpenAPI codegen

Tools like `openapi-typescript` generate types from a hand-maintained OpenAPI document. That works well when the spec is the source of truth owned elsewhere. When the same team owns both spec and handlers, the spec tends to drift from the implementation.

Nuxt Endpoints inverts the direction: the contract lives next to the handler in code, and the OpenAPI document is generated from it. There is no separate codegen step to run and no document to keep in sync by hand.

## OpenAPI client and proxy modules

Modules that consume an existing OpenAPI document to generate clients or proxy an external API solve the other direction: the specification already exists outside the Nuxt server route. They are a good fit for third-party and separately owned services.

Nuxt Endpoints starts with a locally owned Nuxt route, executes its schemas at runtime, and emits OpenAPI from the same definition. It is not intended to replace an external-API client generator.

## When not to use it

- Your API surface needs OpenAPI features that are not first-class yet (multiple media types, cookies, encodings) and the `document`/`extend` escape hatches are not enough — see [Limits](/docs/limits).
- Your handlers are mostly streams, redirects, or proxies. Those stay better as plain Nitro routes, with [Low-level HTTP](/docs/low-level-http) escape hatches for the few that need contracts.
- You want RPC-style calls without HTTP semantics at all — tRPC fits that shape better.
