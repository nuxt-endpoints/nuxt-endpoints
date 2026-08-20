# Changelog

## Unreleased

### Added

- Application-owned OpenAPI document metadata, under an `openApi` key on
  `server/endpoints/runtime.ts`. `document` is deep-merged into the generated
  document and `extend` runs last on the merged result, which is how servers,
  security schemes, tags, and any last-mile edit reach the schema. Both existed
  on `createOpenApiDocument` already but were unreachable from a Nuxt app: the
  document is built inside the server plugin, and neither a nested patch nor a
  callback can travel through JSON-serialized module options.
- A build-time report on Nitro's own OpenAPI document. With
  `nitro.experimental.openAPI` enabled, two documents are served at two routes;
  the module now warns and names both, explaining that Nitro's cannot see
  endpoint contracts because `defineRouteMeta()` reads JSON literals only. If
  both are configured for the same route the build fails instead of leaving the
  served document up to handler registration order.
- Stream response declarations. A status declared as
  `{ stream: true, contentType, schema? }` keeps a streaming route inside its
  contract instead of forcing it to drop `responses` and become an untyped raw
  route: the status and its media type reach the OpenAPI document, the declared
  media type is applied unless the handler sets its own, and the payload is
  never validated — a stream cannot be buffered and checked without defeating
  the reason it is a stream. The generated client treats such a route as
  streaming end to end, telling the fetcher not to parse the body so callers
  receive the live stream rather than a decoded copy of it.
- Two extension points on every endpoint, declared with the same key names at
  either scope — as runtime options on `defineEndpoint()`, or application-wide
  in `server/endpoints/runtime.ts`. `onValidationError` replaces the response
  sent when a request does not match its contract; `wrapHandler` wraps handler
  execution after validation, and returning without calling `next()` answers on
  the handler's behalf. Wrappers nest application, then endpoint, then that
  endpoint's idempotency handling, which is now the built-in consumer of a
  public extension point rather than a privileged one.

### Changed

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
