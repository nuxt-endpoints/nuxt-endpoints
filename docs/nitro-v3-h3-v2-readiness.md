# Nitro v3 and H3 v2 Readiness

Status: maintainer migration note; this is not a Nitro v3 or H3 v2 compatibility claim.

Last verified: 2026-08-18, against `h3@2.0.1-rc.26` and `nitro@3.0.260610-beta`.

The adapter maps below were previously unverified projections. They are now
measured: every row was checked against those installed packages, and the
runtime rows for H3 were additionally observed by dispatching requests through
a real `H3` app. Both upstream packages are prerelease, so re-verify when they
reach stable.

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

| Area                       | Current boundary                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H3 runtime calls           | [`src/runtime/h3-adapter.ts`](../src/runtime/h3-adapter.ts) is the only production runtime file that imports H3 directly.                                                      |
| Endpoint types             | `EndpointContext` depends on the adapter's `RuntimeEvent`, not directly on `H3Event`.                                                                                          |
| Web request access         | The H3 v1 adapter normalizes an event with `toWebRequest(event)`.                                                                                                              |
| Nitro handler discovery    | [`src/nitro-route-handlers.ts`](../src/nitro-route-handlers.ts) isolates the build-time `scannedHandlers` and configured-handler shape.                                        |
| Runtime handler manifest   | The module generates `#nuxt-endpoints/server-handlers`; runtime code no longer imports Nitro's private server-handler virtual module.                                          |
| OpenAPI route registration | The module uses Nuxt Kit's `addServerHandler`; it no longer mutates `nitro.h3App.stack`.                                                                                       |
| Nitro plugin import        | The runtime plugin uses the exported `nitropack/runtime/plugin` subpath instead of a `dist` path.                                                                              |
| Client JSON wire types     | [`src/runtime/wire.ts`](../src/runtime/wire.ts) isolates Nitro 2 `Simplify<Serialize<T>>`; integration tests compare every endpoint success body with generated `InternalApi`. |
| Compatibility range        | `nitropack` remains on `^2.10.0`; preparation is not advertised as Nitro 3 support.                                                                                            |

The current Nitro 2/H3 1 implementation is covered by unit, type, build, and
Nuxt end-to-end tests.

## H3 v1 to v2 adapter map

Measured against `h3@2.0.1-rc.26`. Only one call in the adapter has no v2
equivalent; every other v1 name still resolves and behaves identically, so the
migration is far smaller than a name-by-name rewrite would suggest.

| Operation           | H3 v1 adapter                      | v2 status                                                                       | v2-native form                                                                             |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Define a handler    | `defineEventHandler`               | Works unchanged, not deprecated (alias of `defineHandler`)                      | `defineHandler`                                                                            |
| Native event        | `H3Event`                          | Works unchanged                                                                 | `H3Event`                                                                                  |
| Web request         | `toWebRequest(event)`              | **Removed. The one required change**                                            | `event.req` (extends `Request`)                                                            |
| Request headers     | `getHeaders(event)`                | Works unchanged, deprecated. Returns a plain record                             | `Object.fromEntries(event.req.headers.entries())`                                          |
| Query               | `getQuery(event)`                  | Works unchanged, not deprecated. **Keep it** — see below                        | `getQuery(event)`                                                                          |
| Parsed body         | `readBody(event)`                  | Works unchanged, not deprecated. JSON by default, `undefined` for an empty body | `readBody(event)`                                                                          |
| Response status     | `setResponseStatus(event, status)` | Works unchanged, deprecated. Identical signature                                | `event.res.status = code` (assignment, not a call)                                         |
| Response headers    | `setHeaders(event, headers)`       | Works unchanged, deprecated                                                     | `event.res.headers.set(name, value)`, one at a time; a record cannot be assigned wholesale |
| HTTP error          | `createError`                      | Works, deprecated, **but the wire body changes** — see below                    | `new HTTPError({ status, statusText, data })`                                              |
| Node runtime access | `event.node`                       | Deprecated getter; `event.runtime` is the replacement                           | `event.runtime.node`                                                                       |

`event.context` survives unchanged and is the one event property the contract
layer touches outside the adapter, so Nitro middleware context keeps working.

### Query parsing must not move to `event.url.searchParams`

`getQuery` still returns repeated parameters as arrays in v2 (`?tag=a&tag=b` →
`{ tag: ['a', 'b'] }`), matching v1 exactly. `URLSearchParams.get()` returns
only the first value and `Object.fromEntries` collapses duplicates, so
"modernizing" this call silently drops repeated query values — which endpoint
contracts document as a supported input shape. `test/h3-adapter.test.ts` pins
this behavior through a real request so the regression fails loudly.

### The error wire body changes shape

This is the only behavioral break found, and it does not fail existing tests.
Thrown H3 errors serialize differently between majors:

```txt
v1: { message, statusCode, statusMessage, data }
v2: { message, status,     statusText,    data }
```

`HTTPError` still exposes `statusCode` / `statusMessage` as deprecated getters,
so assertions that read those properties keep passing while the response body
sent to clients has already changed. Test coverage cannot be relied on here.

The blast radius is limited by the existing design: `createRuntimeError` is
used only for internal `500` faults. Documented client-facing failures —
request validation and every idempotency problem — do not throw. They return a
value and set the status explicitly, so their Problem Details bodies are
unaffected. Decide deliberately whether to adopt the v2 shape for those `500`
bodies or to preserve the old keys by overriding `toJSON` in the adapter;
preserving them depends on Nitro's error rendering calling `toJSON`, which is
not yet verified.

H3 v1 and v2 both expose a property named `event.req`, but it does not have the
same contract: in H3 v1 it is a deprecated alias for the Node request, while in
H3 v2 it is the canonical Web `Request`. Therefore checks such as
`'req' in event` cannot select the correct adapter safely.

## Migration modes

### H3 v2-only release

The preferred migration path is to replace the implementation of
`h3-adapter.ts`, update dependency ranges, and run the complete compatibility
matrix. Endpoint definitions and handlers should not need to change.

### Simultaneous H3 v1 and v2 support

If one package release must support both majors, provide separate
implementations such as `h3-adapter-v1.ts` and `h3-adapter-v2.ts`, then select
one at build or module-setup time from the resolved H3 major. Do not import both
implementations into the server bundle and do not infer the H3 major for each
request from the event shape.

## Nitro 2 to 3 map

Measured against `nitro@3.0.260610-beta`. Nitro 3 ships under a new package
name: `nitropack` is renamed to `nitro`, and `nitropack` itself has no 3.x
releases. Every integration point survives; the changes are import paths plus
one renamed export.

| Integration point                            | Nitro 3 status                                                                                       | Change required      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `Serialize` / `Simplify` in `wire.ts`        | Present in `nitro/types`. Nitro's own build still composes `InternalApi` as `Simplify<Serialize<…>>` | Import path only     |
| `InternalApi`                                | Still declared in `nitro/types` and module-augmented during build                                    | Import path only     |
| `defineNitroPlugin`                          | The `nitropack/runtime/plugin` subpath is gone; the root export is `definePlugin`                    | Import path and name |
| `scannedHandlers`, `options.handlers`        | Present, same fields (`handler`, `route`, `method`, `middleware`)                                    | None                 |
| `options.scanDirs`, `options.ignore`         | Present, same meaning                                                                                | None                 |
| `types:extend`, `nitro:init`, `nitro:config` | Present with identical signatures                                                                    | None                 |

The runtime plugin already consumes a module-owned generated manifest rather
than Nitro's private `#nitro-internal-virtual/server-handlers`, so no private
surface is involved in the migration.

## Remaining work before a compatibility claim

Nothing here is blocked on this package. The blocking dependency is upstream
availability: Nuxt 5 exists only on the nightly channel, Nitro 3 is beta, and
H3 v2 is still in release candidates. Nuxt 5 also moves Nitro integration into
a separate `@nuxt/nitro-server` package, which is not yet stable.

- Decide the error-body policy described above and implement `createRuntimeError`
  accordingly; verify it against Nitro 3's error rendering, which the h3-only
  measurements could not cover.
- Run the full compatibility matrix — unit, type, build, and Nuxt end-to-end —
  on the new majors; nothing so far has exercised a running server on them.
- Update dependency and peer ranges, and `meta.compatibility.nuxt`, only after
  that matrix passes.
- Ensure only one compatible H3 runtime resolves into the server build. Nuxt
  has already seen this failure mode in [`nuxt/nuxt#35132`](https://github.com/nuxt/nuxt/issues/35132),
  where a hoisted H3 v2 conflicted with a Nitro handler on H3 v1.

## Nuxt 5 typed-fetch boundary

Nuxt Endpoints does not use Nitro 2 `InternalApi` as the source of request contracts or status-specific responses. It uses endpoint metadata for that richer surface and verifies that the successful JSON wire projection agrees with `InternalApi`.

For Nuxt 5, the preferred path is to contribute endpoint metadata to Nuxt's `fetchdts`-based schema through a public module extension API. If no such hook is exposed, the module keeps its contract schema and may consume `fetchdts` utilities internally. See [Type Generation, Wire Responses, and Nuxt 5](./type-generation.md) for the current flow and acceptance conditions.

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
- Successful JSON client bodies match the platform's typed-fetch projection, including serialization boundaries such as `Date`.
- Unit, type, build, and Nuxt end-to-end tests pass on every supported major.
