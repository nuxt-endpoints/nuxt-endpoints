# The platform seam

Everything this runtime needs from [h3](https://github.com/h3js/h3) and
[Nitro](https://github.com/nitrojs/nitro) lives in this directory. Nothing
outside it imports either package; `test/platform-isolation.test.ts` pins that
boundary.

Until 0.7.x this was two files, `src/runtime/h3-adapter.ts` and
`src/runtime/wire.ts`; they are split by role so that each file answers one
question about the platform.

```mermaid
flowchart TB
    contract["contract layer<br/>defineEndpoint · client types · OpenAPI · idempotency"]
    subgraph seam["src/runtime/platform"]
        direction LR
        request["request.ts<br/>read the request"]
        response["response.ts<br/>write the response"]
        handler["handler.ts<br/>event & registration"]
        middleware["middleware.ts<br/>middleware & internal dispatch"]
        plugin["plugin.ts<br/>server plugin registration"]
        wire["wire.ts<br/>JSON projection"]
    end
    h3["h3 — execution"]
    nitro["Nitro — contract extraction and serving"]
    nuxt["Nuxt — wire and typed fetch"]

    contract --> seam
    request --> h3
    response --> h3
    handler --> h3
    middleware --> h3
    middleware --> nitro
    plugin --> nitro
    wire --> nuxt
```

| File            | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `request.ts`    | Query, headers, and the four body shapes a contract can declare         |
| `response.ts`   | The status and headers a declared contract resolves to; internal errors |
| `handler.ts`    | The `RuntimeEvent` alias, handler registration, method dispatch input   |
| `middleware.ts` | Middleware registration, internal dispatch, and redirects — the bridge  |
| `plugin.ts`     | The platform-specific server plugin constructor                         |
| `wire.ts`       | What a handler return looks like after JSON serialization               |

## Prototype responsibility split

This branch tests the future boundary directly:

- H3 owns the normalized route contract and shared request/response validation.
- Nitro recognizes registered contract macros and exposes its contract registry.
- Nuxt joins contracts to server routes and generates `ServerRoutes` through
  fetchdts; fetchdts resolves fields without owning status semantics.
- NE keeps status-aware endpoint requests, OpenAPI, idempotency, Effect, and
  Pinia Colada integration.

`request.ts` now contains transport adaptation only: preserving repeated query
values, normalizing H3's query container to a plain record, and reading
media-type-specific bodies. Validation semantics delegate to H3.

NE owns the concise `defineEndpoint({ request, responses, handler })` authoring
shape and normalizes it to H3's route contract. NE-only metadata travels
through the Nitro registry and remains interpreted by NE.

### Route identity

`normalizeRuntimeRouteIdentity()` uses h3's public `normalizeRoute()` and removes
trailing slashes for identity comparisons, matching rou3's slash equivalence.
The build-time module keeps the authored route as `sourceRoute` when normalization
changes it. Generated paths and metadata lookups use the canonical route; shared
response configuration and its generated type lookup use the authored route.
Runtime overrides are matched by canonical identity and reject ambiguous aliases.
