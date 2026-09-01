# Type Generation and the Platform Transition

Status: maintainer architecture note.

Last verified: 2026-08-31

## Stable authoring surface

Both supported implementations use one canonical route shape:

```ts
export default defineRouteHandler({
  operation: 'getUser',
  params: UserParams,
  validate: {
    query: UserQuery,
    response: { 200: User, 404: NotFound },
  },
  handler: ({ params, query, respond }) => {
    // ...
  },
})
```

The default export exposes its source definition through `~routeDef`. Generated
client types project request schemas and handler returns from that protocol.
They do not refer to NE's private `__endpoint_contract__` or
`__endpoint_handler_return__` compatibility markers.

The old `defineEndpoint*()` authoring family is intentionally absent from the
package's public runtime exports and Nuxt auto-imports. It remains private only
because the Nitro 2/H3 1 adapter delegates validation and dispatch to the
already-tested implementation.

## Nuxt 4, Nitro 2, and H3 1 implementation

Nitro 2 has no route-contract compiler or metadata provider. This branch fills
that gap without changing application authoring:

1. Nitro's discovered route list supplies each route, method, and source file.
2. A conservative source scan selects only direct
   `defineRouteHandler({...})` routes.
3. Jiti evaluates the selected route module with the canonical helper installed
   as an auto-import-compatible global.
4. The adapter reads private runtime metadata from the returned handler to
   generate the client manifest and OpenAPI document.
5. Generated TypeScript imports the route's public `~routeDef` sidecar.

This is a compatibility implementation, not the desired upstream design.
Because the complete route file is evaluated, its top-level dependency graph
must be deterministic and safe at build time. Put reusable schemas and
contract values in ordinary modules such as `server/contracts/user.ts`; there
is no special `*.endpoint-contract.ts` convention.

Discovery fails closed. If a canonical route cannot be evaluated or its
default export does not expose contract metadata, generation stops instead of
silently producing an incomplete client.

## Nitro 3 implementation

The `upstream-integration` branch enables Nitro's experimental
`routeContracts` compiler and reads `nitro.getRouteContracts()`. Nitro
extracts the handler-free graph from the same canonical call, so NE no longer
scans or evaluates route handlers.

The intended replacement is:

```text
Nuxt 4 compatibility                 Upstream implementation
──────────────────────────────────   ─────────────────────────────────
source scan + Jiti evaluation    →   Nitro route-contract compiler
private runtime carrier          →   Nitro contract provider
NE validation/dispatch adapter   →   H3 defineRouteHandler
~routeDef generated type input   =   ~routeDef generated type input
```

That equality is the point of aligning this branch now: application route code
does not need another migration when the upstream implementation is adopted.

## Server values and client wire values

Response schemas describe values on the server. JSON clients receive their
serialized wire representation. For example, a schema output of `Date`
arrives as `string`.

On the Nitro 2 line, `EndpointWireValue` adapts Nitro's
`Simplify<Serialize<T>>`. The mapping is used by success bodies,
`.result()`, `.raw().json()`, `useEndpoint`, and Vue Query projections.
Native `Response`, streams, files, redirects, and other non-JSON transports
remain raw HTTP concerns.

## Nuxt typed-fetch boundary

Nuxt/Nitro's successful typed-fetch projection and NE's full status-aware
contract are related but distinct:

- Nuxt typed fetch owns the ordinary successful `$fetch` result.
- Status-specific bodies remain available through a separate result API.
- Request inputs come from schema input types; handlers receive schema output
  types.
- OpenAPI, Vue Query, and other consumers read the same Nitro contract
  provider rather than rescanning route files.

Cross-generated tests must continue to verify successful JSON responses against
Nitro's `InternalApi` until the Nuxt 5 typed-fetch provider replaces that
compatibility seam.
