# Upstream delta

This document belongs to the `upstream-integration` branch. `main` remains the
stable Nuxt 4 / Nitro 2 / h3 v1 implementation and is not tracked here.

The branch is an integration experiment, not a port. The question it answers is
not "does Nuxt Endpoints run on Nuxt 5" but "how much of Nuxt Endpoints does the
Nuxt 5 stack make unnecessary, and what is missing upstream that would make it
unnecessary." Success is measured partly in deleted local code.

Everything below is recorded from code, tests, or release metadata. A row stays
UNVERIFIED until something in this repository proves it.

## Local Nitro provider integration

The local Nitro prototype now exposes `nitro.getRouteContracts()` during
`nitro:init`. It compiles a contract-only entry with Nitro's own Rolldown
resolver and plugins, writes the resulting provider module under the Nitro
build directory, evaluates it, and returns `{ route, method, handler,
contract }` records to build-time consumers.

Nuxt Endpoints enables this provider and consumes its records directly. A
provider-backed route therefore does not read, import, or `jiti`-evaluate its
handler module. The fixtures and playground use one canonical declaration for
both runtime behavior and build-time metadata:

```ts
export default defineRouteHandler({
  params: UserParams,
  validate: {
    query: UserQuery,
    response: {
      200: User,
      404: NotFound,
    },
  },
  handler: ({ params, query }) => {
    // ...
  },
})
```

For a route file serving several methods, the same macro takes `get`, `post`,
and other method entries. Shared `params` stay at the root. There is no separate
public name for the multi-method form.

Nitro recognizes only a direct default-exported call with an object literal.
It uses AST scope/binding tracking to retain the contract expression and only
the imports and immutable local declarations reachable from it. `handler`,
`middleware`, and validation-error callbacks are removed before bundling;
the remaining imports are resolved by Nitro's normal Rolldown pipeline. Spread
and computed properties at the declaration boundary are build errors rather
than silently incomplete contracts.

The cross-repository proof covers imported and local schemas, import aliases,
shared multi-method fields, preservation of the actual schema object, exclusion
of handler-only imports and side effects, generated NE client types, and the
running Nuxt fixture.

The provider is also connected to Nitro's standard type pipeline. During
`types:extend`, NE contributes each method's success body to `NitroTypes.routes`
and opaque `contract` and `handlerReturn` expressions to
`NitroTypes.routeMetadata`. Nitro compiles both maps into one fetchdts schema,
augments `InternalRouteSchema`, and still generates the ordinary `InternalApi`.
Nuxt 5 receives the latter through `@nuxt/nitro-server`, while NE resolves the
opaque fields with `TypedFetchMetadataField` for status-aware endpoint results.

The first provider slice retained `jiti` as a compatibility fallback. That
migration is complete: `src/discovery.ts`, its dedicated tests, and NE's direct
`jiti`/`mlly` dependencies have been deleted. NE's `defineRouteHandler` is now
an application-layer adapter for the same authored shape. It delegates existing
request/response validation, idempotency, content negotiation, OpenAPI, and
client projection to NE's runtime without recreating build-time discovery.

## Capability map after the local integration

`A` means present in the official baseline, `B` means represented by an
official RFC/issue/PR, and `C` means no upstream design was found. The final
column records what the local virtual upstream proves; it does not change the
official classification.

|   # | Capability                                                         | Owner        | Official | Local proof                                                          |
| --: | ------------------------------------------------------------------ | ------------ | :------: | -------------------------------------------------------------------- |
|   1 | A unified single-definition route authoring API                    | H3           |    B     | A: `defineRouteHandler`                                              |
|   2 | Per-status response contract                                       | H3           |    B     | A: status-keyed `responses`                                          |
|   3 | Params and extensible downstream fields                            | H3           |    B     | A: params plus extension fields                                      |
|   4 | Per-method contracts in a multi-method route                       | H3           |    B     | A: method entries on `defineRouteHandler`                            |
|   5 | Static contract macro and dependency extraction                    | Nitro        |    B     | A: scope-aware imports and immutable local bindings                  |
|   6 | Build-time route/handler/method/contract provider                  | Nitro        |    B     | A: `getRouteContracts()`                                             |
|   7 | Typed-fetch metadata extension preserved by compilation/resolution | fetchdts     |    C     | A and connected: generic `compileRoutes` / `TypedFetchMetadataField` |
|   8 | Ordinary success-body typed `$fetch`                               | Nuxt/Nitro   |    A     | A: provider → `InternalApi` → Nuxt `ServerRoutes`                    |
|   9 | Status-aware endpoint request API                                  | Nuxt         |    C     | A in NE: awaited `$endpoint(...)`                                    |
|  10 | Raw status/body/header transport                                   | ofetch       |    A     | unchanged; NE uses `.raw()`                                          |
|  11 | OpenAPI projection from the full contract                          | NE consumer  |    C     | A                                                                    |
|  12 | Vue Query projection from operations                               | NE consumer  |    C     | A                                                                    |
|  13 | Build-safe idempotency metadata separated from runtime policy      | NE extension |    C     | A                                                                    |
|  14 | Full request/status-response contract validation runtime           | H3           |    B     | A: Standard Schema runtime in unified handler                        |

The fetchdts extension is implemented in a separate worktree based directly on
PR #192. It lets Nitro preserve arbitrary typed metadata through
`compileRoutes` and lets a downstream client recover a field without fetchdts
interpreting its semantics. The local Nitro fork now uses that extension for a
parallel `InternalRouteSchema`: `response` remains the ordinary success body,
while `contract` and `handlerReturn` carry NE's status-aware source types. This
is one compiled route tree, not another scanner or source of truth.

## Validation runtime ownership

The local H3 implementation now owns `defineRouteHandler()`,
`validateRouteContractRequest()`, and `validateRouteContractResponse()`.
Request source ordering and transformation,
undeclared-source hiding, body media member selection, unsupported-media
failure, status declaration lookup, response schema validation, and the rule
that media/stream responses are not consumed all live in H3.

H3's handler supports the single and multi-method forms, validates declared
request sources before the handler, exposes the transformed values, and checks
the response schema selected by the actual status. Its public overloads infer
each method's transformed request values independently and reject handler
returns outside the declared response schemas. NE's unified adapter preserves
the same guarantees, including shared params and method-specific `respond()`.
H3 also infers a root params schema into both `event.context.params` and
`event.validated.params`. A content-type body map becomes the union of its
schema outputs; a `true` member is passed through as a raw `ReadableStream`
without buffering.
NE retains a compatibility
schema adapter for Effect schemas that do not expose Standard Schema directly,
formats its application-specific errors, applies content negotiation and
idempotency policy, and projects the contract to OpenAPI and generated clients.
Those are downstream policy and consumer behavior, not another route scanner.

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
handler.meta                     {}
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

### fetchdts route machinery assessment

fetchdts PR #192 at `1323209` replaces the serializer with `compileRoutes`,
accepts route sets and already-tokenized segments, resolves paths like a
router, supports `ALL` plus method overrides, emits method-aware accessors, and
can resolve against an augmentable consumer interface. The local
`route-contract-extension` worktree is based directly on that commit rather
than forward-porting the old serializer patch.

The remaining gap in #192 is generated metadata extensibility: its runtime
compiler already preserves arbitrary string fields, but the public `Route`
type admits only fixed `EndpointMetadata` keys. The local overlay makes
`EndpointMetadata`, `Route`, `RouteSet`, and `compileRoutes` generic over an
explicit extension and adds `TypedFetchMetadataField`. A `contractType` field
therefore survives compilation and can be projected into GET/POST-specific
status unions without making fetchdts status-aware. Its full validation is 167
tests pass plus one todo, no type errors, lint/knip/build clean.

It does not replace a local type utility on the current public API boundary.
fetchdts resolves a _concrete request URL_ such as `/api/users/123` into one
fetch metadata object. Nuxt Endpoints deliberately accepts the _route template_
`/api/users/:id` plus a separately typed `{ params: { id } }`, because the
parameter names feed runtime substitution and OpenAPI. `RouteTree` erases those
names. Our `EndpointRouteEntry` union additionally carries the
full contract definition, handler return inference, per-status responses, raw
response types and awaited status discrimination; projecting that union into a
second route tree would add a parallel source of truth without deleting the
union or `path-template.ts`.

The reusable part is the ordinary typed-fetch projection once Nitro adopts it,
plus an opaque `contract` extension owned by the status-aware consumer. The
ordinary `response` accessor remains the success body. The local Nitro fork
owns the fetchdts dependency and re-exports the compiler's type primitives from
`nitro/types`, so an application or Nuxt module does not need a direct fetchdts
dependency. Named route parameters and OpenAPI remain outside fetchdts's
concrete-path route tree.

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

`@nuxt/nitro-server` bridges this boundary with `interface ServerRoutes extends
InternalApi {}`. The running fixture now proves the complete standard path:
provider records become method-specific Nitro `InternalApi` entries, Nuxt's
typed `$fetch` sees their success bodies, and a multi-method route exposes its
GET and PUT responses separately. `ServerRoutes` still carries one response
type per route and method; status discrimination travels through Nitro's
parallel opaque metadata schema and is consumed only by the separate result
API.

Also present is `RequestEventFallback`, "the fallback request event shape,
described in web standards only, used when no server builder has contributed
an event type" — `{ req: Request; url: URL; res: { status?, statusText?, … } }`,
the h3 v2 event shape expressed without depending on h3.

## Environment notes

The focused Nuxt integration suite has now run against the pinned stack through
Nuxt's patched Nitro: all 41 tests pass. This exercises real bound servers,
generated clients and types, SSR request forwarding, per-status responses,
OpenAPI, Vue Query hydration, and the SQLite-backed idempotency implementation.
The default suite also passes all 381 enabled tests, including the five native
`better-sqlite3` tests; three opt-in integration files remain skipped there.

The generated fixture now pins both transform boundaries explicitly. A
`z.coerce.number<string>()` query accepts `string` (and rejects `number`) in the
client while its real handler receives `number`. A `Date` in both the 200 and
422 response schemas is a `Date` in the handler contract and a `string` through
the generated client and on the real JSON wire.

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
| Route matching and typed-fetch metadata            | Named route-template params and rich `EndpointRouteEntry` union           | fetchdts #192 machinery is connected through Nitro's generated `InternalRouteSchema`; opaque fields remain consumer-owned | Nitro `routeMetadata` + fetchdts generic extension                 | Upstream accepts the shared projection; NE then retains only named-template/operation/result client policy                               |

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

## What Nuxt Endpoints becomes

The integration experiment answered its own question: most of what this module
did belongs upstream, and it is now there. This section records the direction
the remainder takes, so the split is a decision rather than a drift.

### The contract graduated; the projections stay

`defineEndpoint`'s value was never that one function did everything. It was that
**one declaration was read by everything** — validation, client types, OpenAPI,
idempotency, cache keys. That declaration still exists, and it is still one. It
moved upstream: Nitro's macro extracts it, `getRouteContracts()` exposes it at
build time, and `InternalRouteSchema` carries its types.

So this module is not losing a source of truth. It is losing ownership of one it
should never have owned. What is left is the set of things that read the
contract and project it somewhere else:

```text
route contract (owned upstream)
  -> OpenAPI document          projection
  -> per-status client types    projection
  -> cache keys and factories   projection
  -> file() lives inside the contract as a schema
  -> withIdempotency() reads the contract's metadata
```

That is one idea with several outputs, not a utility grab bag. The unifying
sentence is: **write the route contract once, then add only the projections you
need.**

### Add, never overlay

Two shapes are available for every capability here, and only one is acceptable
going forward.

- **Additive**: the caller uses the upstream API directly and opts into the
  extra capability at the point of use. Removing it leaves working code. There
  is no mandatory entry point.
- **Overlay**: everything must pass through an entry point of ours that
  re-implements or intercepts what upstream does. Removing it requires a
  rewrite.

This module is currently an overlay, and it pays for it. Its
`defineRouteHandler` shares h3's identifier and first-argument grammar but never
calls h3's implementation, so request validation, method dispatch, HEAD/OPTIONS
handling and media-type body reading are all duplicated locally. Behaviour has
already forked in both directions: our JSON media-type predicate is stricter
than h3's, and an h3 bug we did not share (repeated form fields collapsing)
existed for a while in only one of the two.

The additive forms are known for each remaining capability:

| Capability          | Additive shape                                         | Already upstream                                                 |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| File uploads        | `file({ maxSize, accept })` as a Standard Schema       | `parseFormData` already hands `File` through; `true` streams raw |
| Idempotency         | `withIdempotency(options, handler)` wrapping a handler | nothing — this is the most differentiated code here              |
| WebSocket payloads  | `withSchema(schema, hook)` wrapping one hook           | `defineWebSocket` / `defineWebSocketHandler`                     |
| OpenAPI             | build-time `contracts -> meta.openAPI`                 | Nitro owns the `meta.openAPI` slot and serves `/_openapi.json`   |
| Status-aware result | `resultOf()` over an existing raw response             | `.raw()`, `InternalRouteSchema`, `TypedFetchMetadataField`       |

`withIdempotency` matters beyond its own feature: h3 wires `middleware` outside
`runValidatedHandler`, so middleware cannot see coerced values, but wrapping the
`handler` itself can. That removes the need to ask h3 for a post-validation hook
phase. The one thing it cannot do is apply a policy application-wide without
touching each route, which is an accepted cost of being additive.

### The status-aware client shrinks

Measured, the genuinely status-aware logic is 212 lines — 198 of types and 14 of
runtime. The rest of the current client is fetch plumbing, caller-signature
types, a copy of Nuxt's `AsyncData` shape, and a reconstruction of a native
`Response` from ofetch's wrapper. Since `TypedFetchMetadataField` is keyed by
route template and method, the types need no client of ours at all.

Reducing it to a helper over `$fetch.raw()` deletes the `$endpoint` entry point,
which is the overlay in this area.

It is unlikely to be absorbed upstream. ofetch#364 and ofetch#370 are open and
point at a two-way `{ data, error }` split with one shared error type, not
per-status discrimination, and the maintainer's own comment on #370 prefers
keeping that on `$fetch.raw` rather than branching `$fetch`'s return type.
Nuxt's `ServerRoutes` carries one response type per route and method, and
fetchdts deliberately refuses status semantics while providing
`RouteMetadataExtension` so a consumer can carry them itself. Three layers drew
the same line independently.

### Two capabilities belong upstream, not here

- **Content negotiation.** Grepping h3 for `406`, `negotiat` and `quality`
  returns nothing; it owns the `{ media: [...] }` response contract shape and
  performs no negotiation on it. Whoever owns the declaration should own the
  negotiation.
- **`respond()` / `StatusResponse`.** `validate.response` lets an author declare
  statuses; h3 offers no way to produce one. A client-side result API needs this
  server-side counterpart to discriminate against.

### Consequence for packaging

Splitting means each piece competes on its own merits and can be proposed
upstream on its own. For a reference implementation that is the point, not a
regression — a single package can only say "adopt this module", while separate
pieces can each be offered to the layer that should own them. If the name
survives, it is most honest as documentation that shows how the projections
compose, not as a package that co-locates code which no longer needs to be
co-located.
