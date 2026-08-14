# Type Generation, Wire Responses, and Nuxt 5

Status: maintainer architecture note.

Last verified: 2026-08-14

This document is the source of truth for how Nuxt Endpoints discovers route
contracts, generates client types, stays aligned with Nitro 2 `InternalApi`,
and plans to integrate with Nuxt 5 typed fetch.

## Current Nuxt 4 and Nitro 2 implementation

Nuxt Endpoints does not use `InternalApi` as the source of its complete client
contract. `InternalApi` contains route methods and serialized success returns,
but it does not represent validated params, query, headers, request bodies,
status-specific error bodies, operation names, idempotency, or OpenAPI
metadata.

The current build flow is:

1. [`collectNitroRouteHandlers`](../src/nitro-route-handlers.ts) reads Nitro's
   discovered and configured route handlers.
2. The module evaluates each route module with Jiti and reads metadata from the
   exported endpoint definition or handler.
3. The generated `EndpointRouteEntry` imports the handler's
   `__endpoint_contract__` and `__endpoint_handler_return__` type markers.
4. Nitro independently generates `InternalApi` from the same route handler's
   public return type.

The contract markers remain the source for the richer endpoint surface.
Nitro's generated type remains an independent compatibility projection that is
checked in integration tests.

## Server values and client wire values

Response schemas describe the value returned and optionally validated on the
server. HTTP clients receive the JSON representation of that value. These are
not always the same TypeScript type.

```ts
const ResponseBody = z.object({
  createdAt: z.date(),
})

export default defineEndpointHandler(endpoint, () => ({
  createdAt: new Date(), // server/schema output: Date
}))

const body = await $endpoint('getItem')
body.createdAt // client/wire value: string
```

On the Nitro 2 support line, [`EndpointWireValue`](../src/runtime/wire.ts) is a
small compatibility adapter over Nitro's `Simplify<Serialize<T>>`. It is used
by every JSON client response surface:

- the default awaited success body;
- `.result()` and `useEndpointResult` status bodies;
- `.raw().json()`;
- `useEndpoint`;
- Effect result values;
- TanStack Query data and result modes.

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
They are exposed by `.result()` and `.raw()` and are not merged into
`InternalApi`'s successful handler-return projection.

## Discovery failure policy

Route-module evaluation is required for endpoint metadata. If a source file
appears to call `defineEndpoint` but evaluation fails, or its evaluated exports
do not expose endpoint metadata, the build fails with the route path and an
actionable explanation.

Nuxt Endpoints does not reconstruct operation names, callbacks, schemas, or
metadata from source text. Continuing from partial source inference could make
the generated client, runtime handler manifest, and OpenAPI document disagree.
Ordinary Nitro routes that do not define an endpoint remain unaffected.

Keep server-route top-level code lightweight, avoid opening connections or
performing application work during import, and ensure imports resolve during
Nuxt type generation.

## Nuxt 5 and `fetchdts`

Nuxt's typed-fetch work is tracked in
[`nuxt/nuxt#35769`](https://github.com/nuxt/nuxt/issues/35769). The reusable
Nitro typed-fetch work is tracked in
[`nitrojs/nitro#2758`](https://github.com/nitrojs/nitro/issues/2758). Until an
implementation and public extension surface land, this section is a migration
direction rather than a compatibility claim.

[`fetchdts`](https://github.com/unjs/fetchdts) supplies type utilities for a
schema containing paths, methods, query, body, headers, response, and response
headers. It does not discover Nuxt routes or provide runtime validation by
itself.

The preferred Nuxt 5 integration is:

1. Keep `defineEndpoint` and its Standard Schema contracts stable.
2. Adapt endpoint contract metadata into Nuxt's generated fetch schema through
   a public module hook.
3. Let Nuxt `$fetch`, `useFetch`, and Nuxt Endpoints consume the same successful
   fetch response projection.
4. Keep status-specific results, runtime validation, OpenAPI, idempotency,
   Effect, and TanStack Query at the Nuxt Endpoints layer.
5. Replace the Nitro 2 wire-type and route-discovery adapters only after the
   Nuxt 5 implementation is available in the compatibility matrix.

If Nuxt 5 does not expose a module extension hook, Nuxt Endpoints can retain
its generated contract schema and use `fetchdts` utilities internally. The
cross-generated equality tests remain required in that mode.

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
- runtime validation, OpenAPI, idempotency, Effect, and TanStack Query tests
  pass;
- Nitro 2 support is either preserved through an explicit adapter or removed
  in a documented major-version change.
