# Upstream delta

This document belongs to the `upstream-integration` branch. `main` remains the
stable Nuxt 4 / Nitro 2 / h3 v1 implementation and is not tracked here.

The branch is an integration experiment, not a port. The question it answers is
not "does Nuxt Endpoints run on Nuxt 5" but "how much of Nuxt Endpoints does the
Nuxt 5 stack make unnecessary, and what is missing upstream that would make it
unnecessary." Success is measured partly in deleted local code.

Everything below is recorded from code, tests, or release metadata. A row stays
UNVERIFIED until something in this repository proves it.

## Pinned baseline

Nuxt 5 is not on npm's `latest` channel; `nuxt@latest` is still 4.5.2 and the
`alpha` / `rc` dist-tags point at the finished 4.0.0 cycle. Nuxt 5 ships on the
nightly channel, and its own workspace pins the stack below. This branch adopts
those pins rather than newer prereleases, so that a failure here is a failure
Nuxt itself would see.

| Package               | Version pinned here                                         | Source of the pin                                    |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `nuxt`                | `npm:nuxt-nightly@5.0.0-29800730.fb02c57e`                  | `nuxt-nightly` dist-tag `5x`                         |
| `@nuxt/kit`           | `npm:@nuxt/kit-nightly@5.0.0-29800730.fb02c57e`             | same nightly build                                   |
| `@nuxt/schema`        | `npm:@nuxt/schema-nightly@5.0.0-29800730.fb02c57e`          | same nightly build                                   |
| `nitro`               | `^3.0.260610-beta`                                          | `nuxt/nuxt` `pnpm-workspace.yaml`, catalog `nitro-runtime` |
| `h3`                  | `2.0.1-rc.22`                                               | same catalog, "intentionally pinned to match nitro's dependency" |

Recorded on 2026-08-30. `nuxt/nuxt@main` declares version `5.0.0-0`; the nightly
above is built from commit `fb02c57e`.

Two facts about the pins are worth keeping in view:

- **h3 `2.0.1-rc.29` exists.** Nuxt pins `rc.22` to match Nitro's own
  dependency, so this branch does too. Testing against `rc.29` is a separate
  experiment, not the baseline.
- **Nuxt patches Nitro.** `nuxt/nuxt` carries
  `patches/nitro@3.0.260610-beta.patch`. Anything this branch observes about
  Nitro 3 inside a Nuxt app is observed through that patch, and anything
  observed against bare `nitro` is not.

`nitropack` has no 3.x release; Nitro 3 ships under the name `nitro`. Nuxt 5
also moves Nitro integration into a separate `@nuxt/nitro-server` package.

## What h3 v2 provides today

Measured against the installed `h3@2.0.1-rc.22`, not against `main` and not
against the open PRs. Every statement below was produced by running code in
this repository, and the probes are preserved as tests where they pin a
decision.

`defineValidatedHandler`'s full public signature at rc.22:

```ts
declare function defineValidatedHandler<
  RequestBody extends StandardSchemaV1,
  RequestHeaders extends StandardSchemaV1,
  RequestQuery extends StandardSchemaV1,
  Res extends EventHandlerResponse = EventHandlerResponse,
>(def: Omit<EventHandlerObject, 'handler'> & {
  validate?: {
    body?: RequestBody
    headers?: RequestHeaders
    query?: RequestQuery
    onError?: OnValidateError
  }
  handler: EventHandler<{
    body: InferOutput<RequestBody>
    query: StringHeaders<InferOutput<RequestQuery>>
  }, Res>
}): EventHandlerWithFetch<TypedRequest<InferOutput<RequestBody>, InferOutput<RequestHeaders>>, Res>
```

It is marked `@experimental`. `validate` has three slots: `body`, `headers`,
`query`. There is no `params` slot (h3#1501, open) and no `response` slot
(proposed in h3#1437, no PR).

**Async validators work.** h3#1491 is in rc.22: a `z.coerce.number()` body with
an async `.refine()` returned `42` typed `number` to the handler.

**Validation runs by mutating the request in place.** The handler receives the
same `event`; `event.req` is replaced by a `Proxy` whose `.json()` answers the
validated value, and `event.url.searchParams` is rewritten with validated
query. Nothing is handed to the handler as a separate argument.

Four measured consequences follow, and they decide how much of `request.ts`
can move:

1. **Body validation is lazy.** A handler that never reads the body never
   triggers it. `POST { n: 'nope' }` against `validate.body = z.object({ n:
   z.number() })` returned **200** when the handler ignored the body, and
   **400** when the handler awaited `event.req.json()`. A declared contract is
   therefore not enforced by declaring it.
2. **Repeated query values are lost.** `?tag=a&tag=b` reaches a plain h3
   handler as `{ tag: ['a', 'b'] }` via `getQuery`. Through
   `defineValidatedHandler` the validator itself receives `{ tag: 'b' }`, and
   the handler sees `searchParams` of `[['tag', 'b']]`. The loss happens
   before validation, so no validator can recover it. Endpoint contracts
   document repeated query values as supported input, so query validation
   cannot move to core until this changes.
3. **`.text()`, `.formData()`, and `.arrayBuffer()` throw** once JSON body
   validation is enabled: `TypeError: Cannot access .text on request with JSON
   validation enabled. Use .json() instead.` Media-type-map contracts need
   exactly those reads.
4. **`InferInput` is not in h3's public types.** The emitted `.d.mts` exports
   `InferOutput` only, and both the handler argument and the returned
   `TypedRequest` are built from `InferOutput`. What a client must *send* is
   not recoverable from a validated handler's type.

**Contract introspection already works at runtime, by accident.**
`defineHandler` ends with `Object.assign(eventHandler, input, …)`, and
`defineValidatedHandler` spreads its `def` through it. The returned function
therefore carries the schemas:

```
own keys               [ 'fetch', 'validate', 'meta', 'handler' ]
handler.validate.body === Body   true
handler.meta                     { operation: 'probe' }
```

The schema objects are held by identity, so `InferInput` *is* derivable from
them — downstream, from the raw schema, not from h3's types. `meta` is the
intentional metadata bag (`H3RouteMeta`); `validate` is incidental to how
`defineHandler` merges properties, is untyped on the return type, and is
covered by no test in h3. Nothing named `~routeDef` or `~validatedDef` exists.

## What Nitro 3 and fetchdts provide today

**Nitro 3 does not use fetchdts.** `nitro@3.0.260610-beta` lists no `fetchdts`
dependency and imports it nowhere. Typed `$fetch` is still Nitro's own
`InternalApi` / `MatchedRoutes` machinery, augmented through
`declare module 'nitro/types'`. nitro#2758 proposes the switch and has had no
maintainer comment since 2025-01-22.

`Serialize` and `Simplify` remain exported from `nitro/types`, and Nitro's own
codegen still composes route types as `Simplify<Serialize<…>>`. The wire
projection was an import path.

`definePlugin` is exported from the `nitro` root as an alias of
`defineNitroPlugin`; the `nitropack/runtime/plugin` subpath is gone.

Nitro's `types:extend` hook receives `NitroTypes`:

```ts
export type NitroTypes = {
  routes: Record<string, Partial<Record<HTTPMethod | 'default', string[]>>>
  tsConfig?: TSConfig
}
```

Each entry is a list of type-source strings for the **response** slot. There is
no request, per-status, or header slot in that structure, so richer contract
metadata cannot travel through it. `defineRouteMeta` is a separate,
experimental, OpenAPI-only channel that does not reach `$fetch` typing.

fetchdts's per-route metadata is one response per endpoint and method:

```ts
export interface EndpointMetadata {
  query: never | Record<string, unknown>
  headers: Record<string, unknown>
  body: never | Record<string, unknown>
  response: unknown
  responseHeaders: Record<string, unknown>
}
```

It carries request `body` / `query` / `headers` and `responseHeaders`, which is
more than Nitro 3 transports today — but `response` is a single type, with no
per-status key. Status discrimination stays downstream under this shape.

## Capability ledger

`Local` is what this repository implements today. `Upstream` is what the pinned
stack provides, verified in code. `Patch` is a local, isolated, upstreamable
change. `Removal condition` is the event that lets the local implementation be
deleted.

Every row is UNVERIFIED until this branch proves it. Rows are filled in as the
phases land; the table is deliberately empty of claims rather than populated
with expectations.

| Capability | Local implementation | Upstream status | Local patch | Removal condition |
| ---------- | -------------------- | --------------- | ----------- | ----------------- |
| _(pending)_ | | | | |

## Method

A capability moves out of Nuxt Endpoints only when all of these hold:

1. The upstream primitive exists in the pinned versions, read in its source.
2. A test in this repository exercises it through the real stack.
3. The observable behaviour this repository documents is preserved — including
   the behaviours pinned by existing tests, such as repeated query values
   surviving as arrays.
4. Deleting the local implementation does not lose a type projection. In
   particular the Standard Schema **input** type must remain recoverable and
   distinct from the **output** type, and the JSON wire type must remain
   distinct from the schema output type.

A capability stays downstream when the boundary argues for it, not merely
because the local implementation already works.
