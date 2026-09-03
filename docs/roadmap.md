# Nuxt Endpoints Roadmap

Status: maintainer roadmap; proposed items are not public API commitments.

Last consolidated: 2026-09-02

## Product boundary

Nuxt Endpoints supports Nuxt 4.5+ today and brings the route-contract model
being developed for the Nuxt 5 generation to that support line.

The public product boundary is:

- `defineRouteHandler({...})` for route authoring;
- `$endpoint(path, { method, ...input })` for lazy status-aware requests;
- `useEndpoint(path, { method, ...input })` for Nuxt async data;
- request-object `.queryOptions()` and `.mutationOptions()` for Pinia Colada;
- OpenAPI generated from the same contracts.

`$endpoint` and `useEndpoint` are not temporary copies of upstream APIs.
They are the Nuxt Endpoints UX. H3, Nitro, and Nuxt own lower-level routing,
event, build, and typed-fetch primitives. As those projects expose suitable
integration points, Nuxt Endpoints should delegate to them and delete its
equivalent plumbing without forcing application code to change.

Compatibility is a design constraint, not an absolute promise. If an upstream
change makes a public adjustment unavoidable, ship it as an explicit migration
instead of silently changing semantics.

## Current branches

| Branch  | Purpose                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `main`  | Published Nuxt 4.5+ line using Nitro 2 and H3 1 compatibility adapters  |
| `nuxt5` | Integration prototype against the H3/Nitro/fetchdts route-contract work |

The two branches should keep the same application-facing API. Differences
belong behind the platform adapter and build-time metadata boundary.

## Implemented

- Direct, canonical `defineRouteHandler({...})` authoring, including grouped
  method definitions for method-suffix-free routes.
- Standard Schema request validation with Zod, Valibot, and Effect Schema.
- Declared per-status responses, development-default response validation, status-aware
  client results, and native `.raw()` access.
- Per-header response contracts in OpenAPI and runtime validation, including
  case-insensitive matching and native `Response` headers.
- Generated path-and-method clients and helper types from `#endpoints`.
- `useEndpoint` with Nuxt async-data behavior and SSR request forwarding.
- Request-object Pinia Colada options, verified with the official Nuxt module.
- Required idempotency keys generated when the request object is created and
  reused by retries of that object.
- Application-owned idempotency storage and central runtime policy.
- Global, path-prefix, and method response contracts from
  `server/routes.config.ts`, composed into client unions and OpenAPI without
  changing middleware execution.
- Route-reachable validation (`400`/`406`/`415`) and idempotency
  (`400`/`409`/`422`) defaults in the generated client status union.
- OpenAPI 3.1 generation, document extension, media request/response support,
  and Zod native JSON Schema conversion including `z.file()`.
- Incremental adoption beside ordinary Nitro routes.

## Stable decisions

- Path plus method is the public endpoint identity. Named operation client APIs
  and generated operation factories have been removed.
- Awaiting `$endpoint` returns the declared status union. There is no data mode
  and no public `.result()` compatibility layer.
- `useEndpoint` uses `useAsyncData`; a declared non-2xx response is data, not
  a Nuxt async-data error.
- Query and mutation integrations consume the same lazy endpoint request object.
- Idempotency declaration metadata remains in the contract. Runtime storage,
  scope, and authorization live in `server/endpoints/runtime.ts`.
- Zod conversion uses the schema's native `.toJSONSchema()`; a separate
  `file()` helper is unnecessary because Zod provides `z.file()`.

## Upstream integration

The goal is one underlying contract pipeline, not parallel implementations.

### H3

Prefer H3 to carry the resolved route contract on the request event. This lets
runtime consumers such as validation and idempotency share one contract without
introducing a second hook lifecycle.

### Nitro

Prefer a supported build-time route-contract provider. On the Nuxt 4 line,
route modules are currently evaluated through Jiti during discovery. A Nitro
provider should replace that evaluation and expose serializable contract
metadata without importing handler-only dependencies.

### Nuxt and fetchdts

Prefer Nuxt's generated fetch schema as the common successful-response
projection. Nuxt Endpoints still owns:

- schema input types for params, query, headers, and body;
- per-status result unions, including declared non-2xx bodies;
- `$endpoint`, `useEndpoint`, and request-object integrations;
- runtime validation, OpenAPI, and idempotency.

The adapter should contribute only metadata Nuxt's schema does not already
contain.

## Next work

1. Prepare the upstream proposal for attaching the route contract to the H3
   event.
2. Turn the Nitro route-contract prototype into a small reviewable upstream
   proposal.
3. Keep `main` and `nuxt5` API fixtures identical and isolate only platform
   integration differences.
4. Add released Nuxt 5 packages to the support matrix once the required public
   integration points stabilize.
5. Continue compatibility, storage-conformance, and OpenAPI edge-case testing.

## Non-goals

- Reimplementing Pinia Colada caching, invalidation, SSR hydration, or Devtools.
- Creating a second authentication, rate-limiting, CSRF, or middleware system.
- Typing arbitrary streaming chunks or pretending redirects and proxies are
  ordinary JSON contracts.
- Maintaining operation-name aliases alongside path-and-method calls.
- Promising support for an unreleased platform combination before it is covered
  by the test matrix.

## Supporting notes

- [Type generation and Nuxt 5](./type-generation.md)
- [Nitro v3 and H3 v2 readiness](./nitro-v3-h3-v2-readiness.md)
- [Idempotency behavior](./idempotency.md)
- [Idempotency storage recipes](./idempotency-storage-recipes.md)
- [Nuxt Actions comparison](./nuxt-actions-comparison.md)
