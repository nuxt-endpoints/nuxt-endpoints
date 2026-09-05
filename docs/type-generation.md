# Type Generation, Wire Responses, and Nuxt 5

Status: maintainer architecture note.

Last verified: 2026-09-03

## Public boundary

Application code should not depend on which route-discovery or typed-fetch
implementation is active. Both platform lines expose:

```ts
export default defineRouteHandler({
  name: 'getItem',
  params: z.object({ id: z.string() }),
  validate: {
    response: {
      200: z.object({ id: z.string(), createdAt: z.date() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: (event) => {
    const item = findItem(event.validated.params.id)
    return item ?? event.respond(404, { message: 'Not found' })
  },
})
```

```ts
const result = await $endpoint('/api/items/:id', {
  method: 'get',
  params: { id: '1' },
})

const sameResult = await $endpoint.getItem({ params: { id: '1' } })

const state = await useEndpoint('/api/items/:id', {
  method: 'get',
  params: { id: '1' },
})
```

Path plus method is the canonical client identity. An optional route `name`
adds a property alias to the same request without restoring operation factories
or creating a second contract identity.

Application-wide responses live separately in `server/routes.config.ts`.
Nuxt Endpoints adds matching global, exact-path, prefix (`/**`), and method
responses to the generated `$endpoint` union and OpenAPI. This is declarative
composition only: middleware registration and execution remain Nitro's job,
while NE-specific runtime policy remains in `defineEndpointRuntime`.

## Nuxt 4 main branch

The published Nuxt 4 line uses Nitro 2 and H3 1:

1. `collectNitroRouteHandlers` reads Nitro's discovered and configured route
   handlers.
2. Canonical route modules are evaluated through Jiti during type generation.
   Non-endpoint routes are skipped.
3. The runtime handler carries a private compatibility contract marker.
4. Nuxt Endpoints generates the route entries and `#endpoints` declarations.
5. The client projects server response values through the supported Nitro 2
   JSON wire mapping.

Because the complete route module is evaluated, build-time dependencies must be
deterministic. Runtime idempotency storage, scope, authorization, and the response
validation mode are kept in `server/endpoints/runtime.ts` and rejected in the
route contract. Response body/header schema traversal defaults to development;
`always` and `never` override that without changing generated types or the
declared-status check.

## Nuxt 5 prototype branch

The `nuxt5` branch verifies a smaller integration:

1. H3 owns the canonical route definition.
2. Nitro extracts the contract and exposes it through a build-time provider.
3. Nitro/fetchdts generates the common route schema.
4. Nuxt Endpoints contributes only opaque metadata that the common schema does
   not represent.
5. Nuxt Endpoints retains per-status results, validation, OpenAPI, idempotency,
   `$endpoint`, `useEndpoint`, and request-object adapters.

This is a prototype integration, not a support claim for released Nuxt 5
packages.

## Server values and wire values

Response schemas describe server values. HTTP clients receive serialized wire
values:

```ts
const ResponseBody = z.object({ createdAt: z.date() })

export default defineRouteHandler({
  validate: { response: { 200: ResponseBody } },
  handler: () => ({ createdAt: new Date() }), // server: Date
})

const result = await $endpoint('/api/items/latest', { method: 'get' })
result.body.createdAt // client: string
```

The mapping applies to awaited `$endpoint` results, `.raw().json()`,
`useEndpoint`, and Query/Mutation option results. Native responses, files,
streams, redirects, and other non-JSON transports stay outside it.

## Agreement with Nuxt generated fetch types

The intended equality is limited to the successful JSON projection:

```ts
$EndpointPathResponse<Path, Method> === InternalApi[Path][Method]
```

Declared non-2xx bodies remain part of Nuxt Endpoints' status union because
Nuxt's successful-return projection does not model them. Integration fixtures
must compare every endpoint success body with Nitro's generated route type while
also testing the complete status union separately.

## Discovery failure policy

Contract discovery must never silently omit a route or part of a definition:

- canonical direct calls are accepted;
- unsupported spreads, computed properties, or mutable bindings fail with a
  source diagnostic;
- ordinary route handlers are ignored;
- handler-only dependencies must not be evaluated by the future Nitro provider.

## Nuxt 5 acceptance conditions

Nuxt 5 support is claimed only after released package versions verify:

- endpoint path and method discovery through a supported integration API;
- successful JSON response agreement with Nuxt's generated fetch schema;
- schema input types for params, query, headers, and body;
- schema output types in the handler event;
- status-specific result and raw-response unions;
- actual HTTP serialization for `Date` and other wire boundaries;
- runtime validation, OpenAPI, idempotency, Pinia Colada, and SSR behavior;
- an explicit compatibility policy for the Nuxt 4 line.
