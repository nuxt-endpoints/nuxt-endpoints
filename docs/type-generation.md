# Type Generation, Wire Responses, and Nuxt 5

Status: maintainer architecture note.

Last verified: 2026-09-02

This document is the source of truth for how Nuxt Endpoints discovers route
contracts, generates client types, and stays aligned with Nitro 3 and Nuxt 5.

## Current prototype implementation

Nuxt Endpoints does not use `InternalApi` as the source of its complete client
contract. `InternalApi` contains route methods and serialized success returns,
but it does not represent validated params, query, headers, request bodies,
status-specific error bodies, idempotency, or OpenAPI
metadata.

The current build flow is:

1. [`collectNitroRouteHandlers`](../src/nitro-route-handlers.ts) reads Nitro's
   discovered and configured route handlers.
2. Nitro's compiler extracts the contract expression and only its required
   bindings. Handler-only code is not imported during the build.
3. NE reads the supported `nitro.getRouteContracts()` provider; it no longer
   scans or Jiti-evaluates route files.
4. Nitro populates opaque `contract` metadata from its provider and generates
   `InternalRouteSchema`; NE contributes only its consumer-specific
   `handlerReturn` field through Nitro's type-generation input.
5. The endpoint client reads those fields through
   `TypedFetchMetadataField`.

The runtime handler keeps `~routeDef` for TypeScript inference, but build-time
metadata comes from Nitro's provider, not private NE carrier fields.

## Server values and client wire values

Response schemas describe the value returned and optionally validated on the
server. HTTP clients receive the JSON representation of that value. These are
not always the same TypeScript type.

```ts
export default defineRouteHandler({
  validate: {
    response: { 200: z.object({ createdAt: z.date() }) },
  },
  handler: () => ({ createdAt: new Date() }), // server/schema output: Date
})

const result = await $endpoint('/api/items/:id', { method: 'get', params: { id: '1' } })
result.body.createdAt // client/wire value: string
```

[`EndpointWireValue`](../src/runtime/platform/wire.ts) isolates Nitro's
`Simplify<Serialize<T>>` behind one alias in the platform seam. It is used
by every JSON client response surface:

- awaited `$endpoint` status bodies;
- `.raw().json()`;
- `useEndpoint`;
- Effect result values;
- Pinia Colada request options.

Runtime response validation still runs against the server/schema output before
the HTTP framework serializes it. Native `Response`, streams, files, redirects,
and custom non-JSON transports are outside this mapping and should use the raw
HTTP APIs.

## `InternalApi` agreement

The intended equality is limited to the successful JSON response projection:

```ts
$EndpointPathResponse<Path, Method> === InternalApi[Path][Method]
```

The Nuxt integration fixture extracts every generated endpoint path/method pair
and type-checks this equality against Nitro's generated `nitro-routes.d.ts`.
Serialization-boundary coverage includes `Date`, `toJSON` values, collections,
omitted non-JSON properties, declared status bodies, and inferred handler
returns.

Status-specific non-2xx bodies intentionally remain a Nuxt Endpoints feature.
They are exposed by awaiting `$endpoint(...)` and by `.raw()`, and are not merged into
`InternalApi`'s successful handler-return projection.

## Discovery failure policy

Nitro treats the direct `defineRouteHandler({...})` call as a macro. Unsupported
or mutable bindings fail with a source diagnostic; extraction never silently
drops part of a contract. Ordinary routes and unrelated helpers with the same
local name are ignored. The extracted module may evaluate schema imports, but
it does not retain handler-only callbacks such as `validate.onError`.

## Nuxt 5 and `fetchdts`

Nuxt's typed-fetch route generation landed in
[`nuxt/nuxt#36238`](https://github.com/nuxt/nuxt/pull/36238), under the broader
[`nuxt/nuxt#35769`](https://github.com/nuxt/nuxt/issues/35769) work. The reusable
Nitro typed-fetch work is tracked in
[`nitrojs/nitro#2758`](https://github.com/nitrojs/nitro/issues/2758). Until an
upstream generic metadata contribution point lands, this branch keeps Nuxt's
ordinary generated route map and Nitro's opaque contract metadata map as
compatible parallel projections.

[`fetchdts`](https://github.com/unjs/fetchdts) supplies type utilities for a
schema containing paths, methods, query, body, headers, response, and response
headers. It does not discover Nuxt routes or provide runtime validation by
itself.

The implemented prototype integration is:

1. Author the Standard Schema contract in H3's route shape.
2. Read it through Nitro's build-time registry provider.
3. Add opaque NE fields to Nitro's generated fetch schema.
4. Keep status-specific results, runtime validation, OpenAPI, idempotency,
   Effect, and Pinia Colada at the Nuxt Endpoints layer.
5. Make awaited `$endpoint` requests status-aware while keeping `.raw()` for native responses.

## Nuxt 5 acceptance conditions

Nuxt 5 support is claimed only after all of the following are verified against
released package versions:

- endpoint path and method discovery uses a supported integration API;
- successful JSON responses match Nuxt's typed fetch result for every fixture
  endpoint;
- params, query, headers, and body retain schema input types;
- handler context retains schema output types;
- status-specific result and raw-response unions remain intact;
- `Date` and other serialization boundaries match actual HTTP values;
- runtime validation, OpenAPI, idempotency, Effect, Pinia Colada, and SSR tests
  pass;
- Nitro 2 support is either preserved through an explicit adapter or removed
  in a documented major-version change.
