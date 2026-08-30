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

| Package        | Version pinned here                                | Source of the pin                                                |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `nuxt`         | `npm:nuxt-nightly@5.0.0-29800730.fb02c57e`         | `nuxt-nightly` dist-tag `5x`                                     |
| `@nuxt/kit`    | `npm:@nuxt/kit-nightly@5.0.0-29800730.fb02c57e`    | same nightly build                                               |
| `@nuxt/schema` | `npm:@nuxt/schema-nightly@5.0.0-29800730.fb02c57e` | same nightly build                                               |
| `nitro`        | `^3.0.260610-beta`                                 | `nuxt/nuxt` `pnpm-workspace.yaml`, catalog `nitro-runtime`       |
| `h3`           | `2.0.1-rc.22`                                      | same catalog, "intentionally pinned to match nitro's dependency" |

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
>(
  def: Omit<EventHandlerObject, 'handler'> & {
    validate?: {
      body?: RequestBody
      headers?: RequestHeaders
      query?: RequestQuery
      onError?: OnValidateError
    }
    handler: EventHandler<
      {
        body: InferOutput<RequestBody>
        query: StringHeaders<InferOutput<RequestQuery>>
      },
      Res
    >
  },
): EventHandlerWithFetch<TypedRequest<InferOutput<RequestBody>, InferOutput<RequestHeaders>>, Res>
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
   `TypedRequest` are built from `InferOutput`. What a client must _send_ is
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

The schema objects are held by identity, so `InferInput` _is_ derivable from
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

## Nuxt 5 moves the typed-fetch extension point

This is the largest structural change found so far, and it is Nuxt's, not
Nitro's. `@nuxt/schema` on the 5.x nightly declares two new interfaces:

```ts
interface ServerTypes {}
interface ServerRoutes {}
```

`ServerRoutes` is documented as the extension point "through which the
configured `server.builder` contributes the response types of the routes its
runtime serves", augmented as:

```ts
declare module '@nuxt/schema' {
  interface ServerRoutes {
    '/api/hello': { get: { message: string } }
  }
}
```

Keys are route patterns and may contain `:param` and `**` segments; values map
a lowercased method — or `default` — to the type the route resolves to. The
doc comment says `@nuxt/nitro-server` declares Nitro's scanned routes there,
"so `$fetch` and `useFetch` typing stays accurate without the app layer
depending on a particular server runtime."

Two consequences for this module, neither yet verified by a running app:

- The augmentation target for typed `$fetch` in a Nuxt 5 app is plausibly
  `@nuxt/schema`'s `ServerRoutes` rather than `nitro/types`' `InternalApi`.
  This branch still writes the Nitro 2-era projection; whether both, one, or
  neither is read at runtime is unknown until the playground builds.
- `ServerRoutes` carries **one response type per route and method**, the same
  shape as Nitro's `InternalApi` and fetchdts's `EndpointMetadata`. Three
  layers now independently agree on one-response-per-route, which is evidence
  that status discrimination is a downstream concern by design rather than an
  oversight.

Also present is `RequestEventFallback`, "the fallback request event shape,
described in web standards only, used when no server builder has contributed
an event type" — `{ req: Request; url: URL; res: { status?, statusText?, … } }`,
the h3 v2 event shape expressed without depending on h3.

## Environment notes

The full Nuxt integration suite has now run against the pinned stack through
Nuxt's patched Nitro: 46 tests pass and the three browser-only tests remain
explicitly skipped unless `NUXT_ENDPOINTS_BROWSER_E2E=1` is set. This exercises
real bound servers, generated clients and types, SSR request forwarding,
per-status responses, OpenAPI, Vue Query hydration, and the SQLite-backed
idempotency implementation. The unit suite also passes all 409 tests, including
the five native `better-sqlite3` tests.

The first full Nuxt 5 integration run exposed two generated-type path changes,
both adaptations to Nitro 3 rather than module defects. Nitro now writes its
route augmentation to `types/nitro/nitro-routes.d.ts`, and that file augments
`nitro/types` rather than `nitropack/types`. The integration assertions now
consume those Nitro 3 locations. This was measured through the Nuxt nightly's
patched Nitro, not bare Nitro.

The same run found one remaining Nitro 2 application import outside the module:
the playground database helper imported `useRuntimeConfig` from
`nitropack/runtime`. That pulled Nitro 2's runtime into the Nitro 3 production
build, where Rolldown failed to resolve `#nitro-internal-virtual/app-config`.
Moving the helper to Nitro 3's focused `nitro/runtime-config` export fixes the
build. This was our playground assuming a Nitro 2 package path, not an upstream
defect.

Nitro does not currently make evaluated route handler exports available during
type generation. In `nitro@3.0.260610-beta`, `scanServerRoutes` stores
`NitroEventHandler.handler` as a file path string, `nitro.scannedHandlers` and
`nitro.routing.routes` retain those descriptors, and `writeTypes` builds
response-type strings from `typeof import(path).default` before calling
`types:extend`. Its routing metadata virtual module also statically parses only
a literal `defineRouteMeta(...)` call through a `?meta` transform; it does not
load the route's default export. Therefore blessing h3's runtime
`handler.validate` property would remove an unsafe introspection assumption but
would not remove this module's need to evaluate route modules. An evaluated
handler export or a richer build-time metadata channel is a separate Nitro gap.

The repeated-query defect was also reproduced directly on h3 `main` at
`1892ee9cae06533c7db72a5213bceda61cc1d58d` (`2.0.1-rc.29`): an upstream-style
test expecting `{ tag: ['a', 'b'] }` fails because the validator receives
`{ tag: 'b' }`. At that SHA, `validatedURL` still constructs its input with
`Object.fromEntries(url.searchParams.entries())`. h3#1539 is the isolated
upstream patch: it reuses h3's existing `parseQuery`, writes validated arrays
back as repeated `URLSearchParams` entries, and passes h3's full 2,734-test
suite, lint, typecheck, and coverage run.

h3#1538 now exposes the validated body/query/header output shape from a returned
handler, but still projects all three slots through `InferOutput`. A prototype
on its head commit `4cf1110` typed the already-present `.validate` property with
the original schemas. Its type test preserved both `{ count: string }` from
`z.input<typeof Body>` and the handler's `{ count: number }` output, with all 26
type tests passing. That result was shared on #1538 before opening any competing
change; no separate PR has been opened.

Nitro 3 no longer declares a global `$fetch`. Nitro 2's `nitropack/types`
provided it; the Nitro 3 `declare global` block carries only `ImportMeta`. Nuxt
supplies `$fetch` to an app through auto-imports, which this package's own
type-check does not see, so `src/runtime/virtual-modules.d.ts` declares it.

The `createApp()` / `createRouter()` shims still exist on h3 v2 but no longer
populate `event.context.params` from route matching — they answer `{}` where
`new H3()` + `app.all()` answers `{ id: '7' }`. The runtime's own
`event.context.params` read is correct on v2; only test fixtures built on the
shims broke. `test/endpoint-methods.test.ts` now builds a v2-native app.

`defineNuxtModule`'s parameter is `ModuleDefinition<…> | NuxtModule<…>`, and
contextual typing does not reach a method's parameters through that union, so
`setup(options, nuxt)` arrives as implicit `any` under `strict`. The parameters
are annotated explicitly in `src/module.ts`.

## Capability ledger

`Local` is what this repository implements today. `Upstream` is what the pinned
stack provides, verified in code. `Patch` is a local, isolated, upstreamable
change. `Removal condition` is the event that lets the local implementation be
deleted.

Every row is UNVERIFIED until this branch proves it. Rows are filled in as the
phases land; the table is deliberately empty of claims rather than populated
with expectations.

| Capability                                         | Local implementation                                                      | Upstream status                                                                                                           | Local patch                                                        | Removal condition                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated query parsing                             | `getRuntimeQuery` preserves duplicate keys for contract validation        | h3 `getQuery` preserves them, but `defineValidatedHandler` loses them before validation on rc.22 and main `1892ee9`       | h3#1539                                                            | The fix ships in the h3 version pinned by Nuxt/Nitro and the real-request array test passes through `defineValidatedHandler`             |
| Validated-handler contract introspection           | Discovery evaluates route modules and extracts their endpoint definitions | h3 retains `.validate` schemas by identity, but the property is undocumented and untyped                                  | Prototype shared on h3#1538; h3#1437 tracks the contract direction | h3 intentionally types/tests schema identity and Nitro provides a supported way to obtain evaluated handlers or equivalent rich metadata |
| Nitro 3 platform imports and generated route types | Platform seam plus integration assertions                                 | Nuxt's patched Nitro serves the module successfully; Nitro 3 uses `nitro/*` and generates `types/nitro/nitro-routes.d.ts` | Local import/test-path adaptation only                             | Complete for the pinned stack; retain the seam for upstream version isolation                                                            |

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
