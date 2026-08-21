# Changelog

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
  client's typed `accept` option is part of the TanStack Query cache key.
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
- Vue Query cache keys include the `mediaType` option, so two calls to one
  route that differ only by media type no longer share a cache entry.
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
  Effect, and TanStack Query clients.
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
- Optional TanStack Vue Query factories, request-scoped SSR integration, and
  infinite-query helpers.
- Optional `Idempotency-Key` response replay with an application-owned durable
  storage contract and a development-only memory adapter.
- Direct access to the H3 event from endpoint handler context.

### Compatibility

- Nuxt `^4.5.0`.
- Node.js `^22.19.0 || ^24.11.0 || >=26.0.0`.
- TypeScript 7 for project type checking, with the official TypeScript 6
  compatibility package for build tools that still require the Compiler API.
