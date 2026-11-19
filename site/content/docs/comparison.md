---
title: Comparison
description: How Nuxt Endpoints relates to Nuxt typed fetch, tRPC, and OpenAPI tooling.
---

Nuxt Endpoints adds a typed, validated contract around ordinary Nuxt server routes. This page positions it against the approaches it is usually compared with.

## Plain Nuxt `$fetch` typing

On Nuxt 4.6, `experimental.routeTypedFetch` uses the server route and method to type `$fetch` and `useFetch`. Nuxt checks body and query inputs when their types are exposed by the handler and infers its successful response. [Nuxt 4.6 release notes](https://github.com/nuxt/nuxt/releases/tag/v4.6.0).

Nuxt Endpoints supplies those input types from `defineEndpoint({ validate, responses, handler })`. With native fetch types enabled, the module also types declared request headers and connects each declared status to its JSON body. For example, `error.value?.status === 409` narrows `error.value.data` in `useFetch`. The same contract validates incoming requests and generates OpenAPI. [Configuration and examples](/docs/client#nuxt-fetch-types).

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

- Your API surface needs OpenAPI features that are not first-class yet, such as
  cookie parameters or fine-grained encoding controls, and the
  `document`/`extend` escape hatches are not enough — see [Limits](/docs/limits).
- Your handlers are mostly streams, redirects, or proxies. Those stay better as plain Nitro routes, with [Low-level HTTP](/docs/low-level-http) escape hatches for the few that need contracts.
- You want RPC-style calls without HTTP semantics at all — tRPC fits that shape better.
