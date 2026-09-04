# Changelog

## Unreleased

### Added

- Cursor pagination contracts now generate their `cursor` / `limit` input,
  typed page envelope, runtime validation, OpenAPI schema, and Pinia Colada
  infinite-query options from one declaration.

### Changed

- **Breaking:** Pinia Colada projections are now explicit functions imported
  from `#endpoints/colada`: `queryOptions(request)`,
  `mutationOptions(request)`, and `infiniteQueryOptions(request)`. Endpoint
  request objects no longer expose adapter-specific methods.
- Generated clients index routes by path and method before selecting their
  contract, avoiding repeated whole-route-union analysis at each call site.
- Response body and declared-header schema validation now defaults to
  development builds instead of traversing every production response. Set
  `validation.response` in `server/endpoints/runtime.ts` to `always`,
  `development`, or `never`; request/protocol validation and undeclared-status
  rejection remain active in every mode.

## 0.8.0 - 2026-09-02

### Added

- `server/endpoints/runtime.ts` now accepts route-and-method runtime overrides
  for `fingerprint`, replay statuses and TTLs, plus validation-error handling.
  This makes bodyless and multipart/File idempotent routes
  expressible without putting callbacks in the build-time contract.

### Changed

- **Breaking:** endpoint routes now directly default-export the canonical
  `defineRouteHandler({ ... })` shape. The former `defineEndpoint*` authoring
  helpers are no longer public API. Request and response schemas live under
  `validate`, while path params remain at the route root.
- **Breaking:** generated clients use path plus HTTP method as their only public
  identity. Named operation calls, operation aliases, and generated operation
  Query factories have been removed.
- **Breaking:** awaiting `$endpoint(...)` now returns the declared
  `{ status, ok, body, headers }` union directly. The public `.result()`, data
  mode, and `useEndpointResult` compatibility APIs have been removed;
  `useEndpoint` exposes the serializable status union through Nuxt async data.
- **Breaking:** `.queryOptions()` and `.mutationOptions()` now return standard
  Pinia Colada options. The previous query dependency, adapter, and
  `endpoints.client.query` auto-setup option have been removed; the official
  Colada Nuxt module owns SSR prefetching and hydration.
  Required idempotency keys are generated when the request object is created
  and reused by repeated execution of that same logical request.
- Zod 4 schemas use their native `.toJSONSchema()` conversion. This includes
  end-to-end OpenAPI extraction for `z.file()` and raises the Zod peer baseline
  to 4.2.

### Fixed

- JavaScript route definitions now enforce the complete runtime-only
  idempotency boundary already enforced by TypeScript. `fingerprint`,
  `replayStatuses`, `leaseTtlMs`, and `replayTtlMs` are rejected instead of
  being silently discarded.
- Runtime route entries are validated against discovered endpoints at startup,
  so renamed paths and unsupported method settings cannot be silently ignored.

### Documentation

- Reframed the project as a Nuxt 4.5+ implementation of the route-contract
  direction being developed for the Nuxt 5 generation. `$endpoint` and
  `useEndpoint` remain the application-facing UX while compatible H3, Nitro,
  and Nuxt primitives replace internal plumbing over time.
- Updated the README, documentation site, browser type playground, local
  playground, architecture notes, and package smoke fixture to the current API.
- Added a public Nuxt 5 integration progress page linking the working branches
  for Nuxt Endpoints, H3, Nitro, and fetchdts.

## 0.7.2 - 2026-08-29

### Fixed

- `useEndpoint` and `useEndpointResult` now forward the incoming request's
  cookies and headers to the internal route during SSR. They stand in for
  `useFetch`, which swaps plain `$fetch` for `useRequestFetch()` on relative
  paths, but they were built on `useAsyncData` and kept plain `$fetch` — so a
  cookie-authenticated endpoint returned 401 during SSR and succeeded only
  after hydration. The legacy query adapter factories already captured the
  request-aware fetcher; the composables now use the same mechanism,
  re-capturing per call so concurrent SSR requests never share credentials.

  `$endpoint` is unchanged and still does not forward, matching Nuxt's own
  asymmetry between `$fetch` and `useFetch`.

### Documentation

- The [client docs](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/client)
  gained a "Request forwarding during SSR" section: which client forwards the
  incoming cookies and headers, which Nuxt primitive each one mirrors, and why
  `$endpoint` deliberately does not.

## 0.7.1 - 2026-08-27

### Changed

- The h3 and Nitro seam is now one directory, `src/runtime/platform/`, split
  by role: `request.ts` reads the request, `response.ts` writes the response,
  `handler.ts` registers the handler and aliases the event, and `wire.ts`
  projects a handler return through JSON serialization. It replaces
  `h3-adapter.ts` and the top-level `wire.ts`, whose single files answered
  "where do we touch h3?" but not "which of this does core absorb next?" —
  the directory README now carries that map, with each capability graded by
  how certainly h3 v2 / Nitro 3 take it over, and the four migration events
  kept separate. `test/platform-isolation.test.ts` pins that nothing outside
  the directory imports either package (the Nitro plugin wrapper in
  `server-plugin.ts` is the one documented exception), since nothing else
  would catch an import creeping back out.

## 0.7.0 - 2026-08-26

### Changed

- **Breaking:** the singular `response` contract is removed.
  `responses: { 200: … }` is the one way to declare a success body — the two
  spellings were exactly equivalent (`response: X` was folded into
  `{ 200: X }` everywhere), so there is no reason to keep both before 1.0.
  Migration is mechanical: replace `response: X` with `responses: { 200: X }`.
  Client types, handler checking, and the generated OpenAPI document are
  unchanged for a converted route. TypeScript rejects the removed key as an
  excess property, and a plain-JS route module that still writes one fails at
  definition time with the same migration hint.

### Added

- `defineEndpoint` now accepts the handler as part of the definition, so a route
  is one call instead of two:

  ```ts
  export default defineEndpoint({
    operation: 'getUser',
    params: z.object({ id: z.coerce.number() }),
    responses: { 200: User, 404: NotFound },
    handler: ({ params, respond }) => findUser(params.id) ?? respond(404, { message: 'Not found' }),
  })
  ```

  The two-call form keeps working unchanged; omitting `handler` still returns a
  contract to pass to `defineEndpointHandler`, which is what a route wants when
  the handler is defined elsewhere.

  The split existed because of an inference limit, not a preference. Receiving
  the definition as one whole-object type parameter and then using that same
  parameter to type the handler's argument in the same object literal makes
  TypeScript fall back to the parameter's constraint — `params` and `query`
  arrived as the constraint type rather than the schema's output. Passing the
  contract as a separate argument sidesteps it by making the contract a resolved
  value. Declaring one type parameter per slot and reassembling the definition
  from them sidesteps it too, and that is what this release does: each parameter
  is inferred from its own property, so the handler property never participates
  in inferring the contract. The contract type machinery is unchanged; only the
  entry signature moved.

### Fixed

- Build-time discovery classified `export default defineEndpoint({ … })` as a
  plain Nitro route, because the identifier is preceded by `default`, and the
  preceding-identifier check exists to skip this library's own
  `export function defineEndpoint` declaration. A merged route was dropped from
  codegen with no error reported.

## 0.6.0 - 2026-08-24

### Changed

- **Breaking:** the Effect HTTP client is removed. `.effect()` on generated
  calls, `useEndpointEffect`, the `endpoints.client.effect` module option, and
  the `nuxt-endpoints/effect` types (`EffectEndpointClient`,
  `EndpointClientError`, and the rest) are gone. The client's extension
  mechanism — `extensions` and `createCallExtension` on
  `EndpointClientRuntimeOptions` — existed only to attach `.effect()` to a
  call and is removed with it, since nothing else used it. `.result()` already
  returns the same typed `{ status, ok, body, headers }` value `.effect()`
  did, so most call sites only need to drop the `.effect()`/`Effect.runPromise`
  wrapping; a call that used Effect's retry or interruption needs its own
  replacement for that behavior. Effect Schema is unaffected: it remains a
  fully supported validator for `params`, `body`, and `responses`, and OpenAPI
  generation still uses Effect's JSON Schema converter for it.

## 0.5.0 - 2026-08-21

### Added

- A media-type request-body member can be declared `true` instead of a schema,
  which accepts that media type and hands the handler the body unparsed as a
  `Uint8Array`. `true` accepts any well-formed `type/subtype`, so XML, PDF, and
  arbitrary bytes are now declarable request bodies.

  This closes an asymmetry: a response could already be declared by media type
  with the payload left alone, while a request body could only name one of the
  four families the runtime parses. A schema member still requires a parseable
  family — a schema can only check a value that exists — and saying so is now
  what the error message does, pointing at `true` as the way out.

### Fixed

- **Breaking:** an idempotent endpoint that declares no `body` contract now
  requires an explicit `fingerprint`. The default projection has no validated
  body to cover there, and it cannot distinguish an operation that genuinely
  takes no input from a handler reading an undeclared body itself — in the
  second case two different payloads shared a fingerprint, so a retry was
  answered with the first response instead of `422`. That silently completed a
  write with the wrong answer, so the endpoint now states what identifies the
  request: `fingerprint: ({ params }) => ({ params })`, or
  `fingerprint: () => ({})` for an operation that really takes no input.
- The idempotency fingerprint ignored the negotiated response media type, so an
  endpoint offering several representations replayed the first one to a retry
  that reused the key and asked for another. The negotiated type is now part of
  request identity when the endpoint negotiates, making that retry a `422` — the
  other representation would need the handler to run again, which is what the
  key exists to prevent. Endpoints with one declared representation are
  unaffected, since there the type is constant.
- `RuntimeIdempotencyContext` gained `responseMediaType`, so a custom
  `fingerprint` can reason about it at all. It could not before.

## 0.4.0 - 2026-08-20

### Added

- `pnpm check` now type-checks the basic fixture against its own generated
  types (`test:fixture-types`). `test:typecheck` deliberately excludes
  `test/fixtures/**`, so the one place the library is consumed the way an
  application consumes it went unchecked - which is how a contract shape that
  did not type-check for a handler passed every check.
- Application-owned OpenAPI document metadata, under an `openApi` key on
  `server/endpoints/runtime.ts`. `document` is deep-merged into the generated
  document and `extend` runs last on the merged result, which is how servers,
  security schemes, tags, and any last-mile edit reach the schema. Both existed
  on `createOpenApiDocument` already but were unreachable from a Nuxt app: the
  document is built inside the server plugin, and neither a nested patch nor a
  callback can travel through JSON-serialized module options.
- Documentation for endpoints on routes registered through `nitro.handlers` or
  `addServerHandler` rather than by file scanning. Discovery already read
  Nitro's configured handlers alongside its scanned ones, so this was supported
  and unstated; it is now documented, covered by a fixture outside every
  scanned directory, and type-checked through the generated client.
- A build-time report on Nitro's own OpenAPI document. With
  `nitro.experimental.openAPI` enabled, two documents are served at two routes;
  the module now warns and names both, explaining that Nitro's cannot see
  endpoint contracts because `defineRouteMeta()` reads JSON literals only. If
  both are configured for the same route the build fails instead of leaving the
  served document up to handler registration order.
- Non-JSON response declarations, through one door. A status declared as
  `{ media: '<type>', schema? }` keeps XML, CSV, file downloads, event streams,
  and raw bytes inside the contract instead of forcing the route to drop
  `responses` and become an untyped raw route: the media type reaches both the
  wire and the OpenAPI document, and the payload is never validated — there is
  no schema to check it against, and a stream cannot be buffered and checked
  without defeating the reason it is a stream. The generated client treats such
  a route as unparsed end to end, telling the fetcher not to read the body so
  callers receive the live stream rather than a decoded copy of it.
- `Accept`-based content negotiation for media responses. `media` accepts an
  array, and the runtime selects per RFC 9110 — quality weights honored, a more
  specific range overriding a wider one, `q=0` a refusal — then hands the choice
  to the handler as `responseMediaType`, narrowed to the declared union. A
  request that accepts nothing the endpoint can produce is refused with `406`
  before the handler runs, through `onValidationError` like any other failure.
  Every response of a negotiating endpoint carries `Vary: Accept`, and the
  client's typed `accept` option is part of the request-object query cache key.
  Declaration order is the endpoint's preference: it breaks ties and answers a
  request that expresses none. This is the mirror image of a media-type request
  body, and it is affordable here only because nothing on the response side is
  typed by media type — negotiating a _validated_ body would still need an
  answer to where non-JSON encoders come from.
- Every framework-generated response is in the OpenAPI document, not just the
  idempotency ones: the `400` any validating endpoint can answer with, the `415`
  a media-type-map body can answer with, and the `406` a negotiating endpoint
  can answer with. Each is derived from the contract alone, and a status the
  author also declared is merged as a `oneOf` rather than hidden.
- A validated response body may be labelled with a `+json` profile such as
  `application/problem+json`, and that media type is now actually sent. It was
  previously accepted, written into the OpenAPI document, and then silently
  ignored at runtime, so the document claimed one media type while the response
  carried `application/json`.
- Two extension points on every endpoint, declared with the same key names at
  either scope — as runtime options on `defineEndpoint()`, or application-wide
  in `server/endpoints/runtime.ts`. `onValidationError` replaces the response
  sent when a request does not match its contract; `wrapHandler` wraps handler
  execution after validation, and returning without calling `next()` answers on
  the handler's behalf. Wrappers nest application, then endpoint, then that
  endpoint's idempotency handling, which is now the built-in consumer of a
  public extension point rather than a privileged one.

### Fixed

- An array `media` did not type-check. `ResponseBody` and
  `HasMediaResponseContract` still matched `{ media: string }` only, so a status
  declaring several representations typed its handler body as `never` and lost
  the client's unparsed-stream type while the runtime streamed it anyway.
- The client's `accept` option destroyed caller headers that arrived as a
  `Headers` instance or a tuple list, which is how the idempotency helper hands
  them on — so passing both `accept` and `idempotencyKey` dropped the
  `Idempotency-Key` and turned an idempotent write into an ordinary one.
- Negotiation was computed over every status rather than the successful ones,
  so a media-typed error status made an otherwise single-representation
  endpoint start answering `406`, and a request could negotiate an error's
  media type and have the success response mislabelled with it.
- `Vary: Accept` was missing from the `406` itself, from validation failures,
  and from idempotency replays, and a handler that declared its own `Vary`
  silently replaced it instead of adding to it.
- An idempotent endpoint answering with a media 2xx recorded `{}` for replay —
  `JSON.stringify` does not fail on a `ReadableStream` or a `Blob` — and
  replayed that empty object to the retry. Those bodies are now refused.
- A media response with several declared types shared one documentation
  schema, so `media: ['text/csv', 'application/json']` with a `schema`
  documented the CSV representation with a JSON object schema. `schema` now
  takes a map keyed by media type, and a bare schema alongside several types
  fails the build instead of being copied onto each.
- A `406` was decided after the request body had been read and validated, while
  its mirror `415` is decided before. `Accept` does not depend on the rest of
  the request, so it is settled first and an unanswerable request no longer
  pays for parsing an upload.
- Declared media types are validated at definition time, matching the request
  side: `media: 'text/csv, application/json'` and `media: ['csv', 'json']` now
  fail the build instead of becoming a nonsense `Content-Type` or an endpoint
  that answers `406` to everything.

### Changed

- **Breaking:** the `stream: true` response variant is replaced by `media`.
  `{ stream: true, contentType: 'text/csv' }` becomes `{ media: 'text/csv' }`.
  `stream` was the wrong name for the general non-JSON door — returning an XML
  string is not streaming — and one required key reads better than a boolean
  plus an optional one. The media type has no default any more: taking this
  door means knowing what you are sending.
- **Breaking:** the generated client route config's `stream` flag is now
  `mediaResponse`, and `EndpointMediaBody` is now `EndpointMediaResponseBody`.
  The old names described the ofetch option and not the contract concept — a
  30-byte `text/csv` string is not a stream. `isJsonMediaType` is no longer
  exported, matching its request-side counterpart; `mediaTypesOf` and
  `ResponseMediaTypes` now are.
- **Breaking:** a non-string or empty `accept` client option throws instead of
  being ignored, matching `mediaType` and `idempotencyKey`. A silently dropped
  `accept` comes back as the wrong representation, which is harder to trace.
- **Breaking:** `contentType` on a validated response body is restricted to
  JSON media types and fails the build otherwise, naming `media` as the
  replacement. A validated body is always serialized as JSON, so any other
  value described one thing and sent another.
- **Breaking:** application-wide endpoint settings moved from
  `server/endpoints/idempotency.ts` to `server/endpoints/runtime.ts`, where the
  idempotency policy is one key alongside the hooks. `defineIdempotencyPolicy`
  is replaced by `defineEndpointRuntime({ idempotency: { … } })`, and the module
  option `endpoints.idempotency.policy` by `endpoints.runtime.path`. One file
  now holds every application-wide setting that `nuxt.config.ts` cannot,
  because module options reach the server as JSON and cannot carry functions.

## 0.3.0 - 2026-08-19

### Added

- Request bodies can be declared per media type: a `body` map from
  `application/json`, `application/x-www-form-urlencoded`,
  `multipart/form-data`, or a `text/*` type to its own schema. The request
  Content-Type selects the member, a mismatch answers `415`, and the handler
  context gains `bodyMediaType` narrowing which member matched. Generated
  client calls take a `mediaType` option typed to the wire value of the
  selected member, and OpenAPI lists every member under `requestBody.content`.
  The client labels every media type it can; `multipart/form-data` is the
  exception, because its boundary is generated while the request is built, so
  those calls belong on the client.
- A method-suffix-free route file can declare several methods at once with
  `defineEndpointMethods()` and `defineEndpointMethodHandlers()`. Members are
  ordinary `defineEndpoint()` contracts, so operations, idempotency, and
  media-type bodies all work per method. The dispatcher derives `HEAD` from
  `GET`, answers `OPTIONS` with `204`, and returns `405` with an `Allow`
  header listing every reachable method.

### Fixed

- Tuple response schemas are satisfiable again. The handler-return check
  collapsed every array to `Item[]`, so a `z.tuple()` response could not be
  met even by an explicitly typed tuple.
- Inline literal and tuple responses no longer need an `as const` assertion,
  while values that do not match the contract are still rejected — including
  tuple arity. Endpoints with no declared responses keep widening their
  handler return, so a sample value does not narrow the generated client type.
- Request-object query cache keys include the `mediaType` option, so two calls
  to one route that differ only by media type no longer share a cache entry.
- Build-time discovery no longer reads files that are not user route sources.
  Handlers registered programmatically, this module's own OpenAPI route among
  them, are recognized by path shape instead.

### Changed

- Endpoint routes declared on catch-all or optional-parameter paths now fail
  the build with an explanation rather than generating client URLs and
  OpenAPI paths that cannot be correct.
- The idempotency execution path moved behind a named interception point
  between request validation and handler execution. Behavior is unchanged;
  the seam is what will let the application layer sit on a future primitive
  layer.

## 0.2.0 - 2026-08-16

### Added

- Endpoint contracts can live in separate modules, including sibling
  `*.endpoint-contract.ts` files that are automatically excluded from Nitro
  route scanning.
- Central idempotency runtime policies can provide shared storage, scope,
  authorization, and TTL defaults from `server/endpoints/idempotency.ts` or a
  configured policy path.

### Changed

- Build-time discovery now evaluates only modules that define endpoint
  contracts, skips non-endpoint routes, and fails closed when an imported
  contract cannot be resolved safely.
- Catch-all and optional-parameter endpoint routes now fail during generation
  instead of producing invalid client and OpenAPI paths.
- The README and documentation site now follow a benefits-first introduction
  with dedicated mental-model and adoption guidance.

## 0.1.1 - 2026-08-15

### Fixed

- Client response types now follow Nitro's JSON wire serialization, including
  boundaries such as `Date` to `string`, across the default, result, raw,
  Effect, and request-object query clients.
- Generated endpoint success responses are checked against Nitro's generated
  `InternalApi` for every integration fixture route.
- Endpoint discovery now fails closed when route evaluation cannot expose the
  complete contract instead of reconstructing partial metadata from source.
- Built-in server values such as `Date`, `Map`, and `Set` retain their semantic
  types during handler return validation.

### Documentation

- Documented the current Nitro 2 type-generation boundary and the planned Nuxt
  5 and `fetchdts` migration path.

## 0.1.0 - 2026-08-14

Initial public release.

### Added

- Typed Nuxt server endpoint contracts with runtime validation for Zod,
  Valibot, and Effect Schema.
- Generated endpoint clients, Nuxt async-data composables, and OpenAPI 3.1
  output.
- Optional request-object query factories, request-scoped SSR integration, and
  infinite-query helpers.
- Optional `Idempotency-Key` response replay with an application-owned durable
  storage contract and a development-only memory adapter.
- Direct access to the H3 event from endpoint handler context.

### Compatibility

- Nuxt `^4.5.0`.
- Node.js `^22.19.0 || ^24.11.0 || >=26.0.0`.
- TypeScript 7 for project type checking, with the official TypeScript 6
  compatibility package for build tools that still require the Compiler API.
