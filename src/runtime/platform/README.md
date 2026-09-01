# The platform seam

Everything this runtime needs from [h3](https://github.com/h3js/h3) and
[Nitro](https://github.com/nitrojs/nitro) lives in this directory. Nothing
outside it imports either package, with one documented exception —
`../server-plugin.ts` uses `defineNitroPlugin` to register startup logic, and
moving 195 lines of bootstrapping here would bury the seam in it.
`test/platform-isolation.test.ts` pins both statements.

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
        wire["wire.ts<br/>JSON projection"]
    end
    h3["h3 — execution"]
    nitro["Nitro — build, serving, fetch types"]

    contract --> seam
    request --> h3
    response --> h3
    handler --> h3
    wire --> nitro
```

| File          | Role                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `request.ts`  | Query, headers, and the four body shapes a contract can declare         |
| `response.ts` | The status and headers a declared contract resolves to; internal errors |
| `handler.ts`  | The `RuntimeEvent` alias, handler registration, method dispatch input   |
| `wire.ts`     | What a handler return looks like after JSON serialization               |

## Prototype responsibility split

This branch tests the future boundary directly:

- H3 owns the route-contract shape and shared request/response validation.
- Nitro recognizes the H3 macro, provides the registry, and generates types.
- fetchdts resolves fields without owning status-aware semantics.
- NE keeps `.result()`, OpenAPI, idempotency, Effect, and Query integration.

`request.ts` now contains transport adaptation only: preserving repeated query
values, normalizing H3's query container to a plain record, and reading
media-type-specific bodies. Validation semantics delegate to H3.

NE's `defineRouteHandler` mirrors H3's single definition shape. The
`validate.params/query/headers/body/response` slots map to the H3 contract;
NE-only metadata travels through the Nitro registry and remains interpreted by
NE.
