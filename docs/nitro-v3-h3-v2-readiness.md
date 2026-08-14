# Nitro v3 and H3 v2 Readiness

Status: maintainer migration note; this is not a Nitro v3 or H3 v2 compatibility claim.

Last verified: 2026-07-22

## Current support boundary

The current package baseline is Nitro 2 and H3 1. The `nitropack` dependency is
intentionally limited to `^2.10.0` until the runtime behavior described below
has been verified against Nitro 3.

The preparation already in the codebase is intended to keep the endpoint API
stable while version-sensitive Nitro and H3 integration is replaced behind
small adapters.

## Stable endpoint contract

`defineEndpointHandler` continues to receive an endpoint context and may return
a plain value. H3 v2 does not require endpoint authors to change handlers into
Web-standard `(request: Request) => Response` functions.

The handler context exposes both HTTP integration levels:

- `event` is the native H3 event and remains the escape hatch for Nitro
  middleware context and runtime-specific features.
- `request` is a normalized Web `Request` for portable access to the URL,
  method, headers, and abort signal.
- `body` remains the contract-validated body value and is the canonical way to
  consume an endpoint request body. Code must not assume that the raw
  `request` body can be consumed again after endpoint parsing.

```ts
export default defineEndpointHandler(endpoint, ({ event, request, body }) => {
  const requestId = request.headers.get('x-request-id')

  return {
    accountId: event.context.user.accountId,
    requestId,
    value: body.value,
  }
})
```

## Completed preparation

| Area                       | Current boundary                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| H3 runtime calls           | [`src/runtime/h3-runtime.ts`](../src/runtime/h3-runtime.ts) is the only production runtime file that imports H3 directly.               |
| Endpoint types             | `EndpointContext` depends on the adapter's `RuntimeEvent`, not directly on `H3Event`.                                                   |
| Web request access         | The H3 v1 adapter normalizes an event with `toWebRequest(event)`.                                                                       |
| Nitro handler discovery    | [`src/nitro-route-handlers.ts`](../src/nitro-route-handlers.ts) isolates the build-time `scannedHandlers` and configured-handler shape. |
| Runtime handler manifest   | The module generates `#nuxt-endpoints/server-handlers`; runtime code no longer imports Nitro's private server-handler virtual module.   |
| OpenAPI route registration | The module uses Nuxt Kit's `addServerHandler`; it no longer mutates `nitro.h3App.stack`.                                                |
| Nitro plugin import        | The runtime plugin uses the exported `nitropack/runtime/plugin` subpath instead of a `dist` path.                                       |
| Compatibility range        | `nitropack` remains on `^2.10.0`; preparation is not advertised as Nitro 3 support.                                                     |

The current Nitro 2/H3 1 implementation is covered by unit, type, build, and
Nuxt end-to-end tests.

## H3 v1 to v2 adapter map

The exact H3 v2 calls must be confirmed against the version selected for the
migration. The expected ownership boundary is:

| Operation           | H3 v1 adapter                      | H3 v2 adapter direction                                         |
| ------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Define a handler    | `defineEventHandler`               | `defineHandler`                                                 |
| Native event        | `H3Event`                          | `H3Event`                                                       |
| Web request         | `toWebRequest(event)`              | `event.req`                                                     |
| Request headers     | `getHeaders(event)`                | `event.req.headers` or a v2 utility                             |
| Query               | `getQuery(event)`                  | `event.url.searchParams` or a v2 utility                        |
| Parsed body         | `readBody(event)`                  | A v2 parser that preserves the existing endpoint body semantics |
| Response status     | `setResponseStatus(event, status)` | `event.res` or a v2 utility                                     |
| Response headers    | `setHeaders(event, headers)`       | `event.res.headers` or a v2 utility                             |
| HTTP error          | `createError`                      | `HTTPError` with equivalent public response semantics           |
| Node runtime access | `event.node`                       | `event.runtime.node` when Node-specific access is unavoidable   |

H3 v1 and v2 both expose a property named `event.req`, but it does not have the
same contract: in H3 v1 it is a deprecated alias for the Node request, while in
H3 v2 it is the canonical Web `Request`. Therefore checks such as
`'req' in event` cannot select the correct adapter safely.

## Migration modes

### H3 v2-only release

The preferred migration path is to replace the implementation of
`h3-runtime.ts`, update dependency ranges, and run the complete compatibility
matrix. Endpoint definitions and handlers should not need to change.

### Simultaneous H3 v1 and v2 support

If one package release must support both majors, provide separate
implementations such as `h3-runtime-v1.ts` and `h3-runtime-v2.ts`, then select
one at build or module-setup time from the resolved H3 major. Do not import both
implementations into the server bundle and do not infer the H3 major for each
request from the event shape.

## Remaining Nitro v3 work

The runtime plugin no longer imports Nitro's private
`#nitro-internal-virtual/server-handlers` module. It consumes a module-owned
generated manifest containing only detected endpoints and their route identity.

`scannedHandlers` remains an upstream Nitro build-time detail, but its use is
isolated in `collectNitroRouteHandlers`. If Nitro 3 removes or changes it, only
that collection boundary and its tests should need to change.

Other migration work:

- confirm the Nitro 3 runtime-plugin public import path;
- implement and test the H3 v2 adapter, especially error serialization,
  response headers/status, query parsing, and body parsing;
- update dependency and peer-compatibility ranges only after actual Nitro 3
  and H3 v2 verification;
- ensure only one compatible H3 runtime is resolved into the server build.

## Acceptance checklist

- Existing endpoint handlers continue to return plain values without adopting
  a `(Request) => Response` signature.
- `event.context` values from Nitro middleware remain available.
- `request` preserves URL, method, headers, and abort-signal behavior.
- Contract body parsing and validation remain unchanged.
- Validation and HTTP errors keep the documented status and response body.
- Explicit response status and headers remain correct.
- Idempotency receives the final route method and route template.
- The OpenAPI route is registered once and contains all endpoint operations.
- Ordinary Nitro handlers are not mistaken for endpoint handlers.
- Unit, type, build, and Nuxt end-to-end tests pass on every supported major.
