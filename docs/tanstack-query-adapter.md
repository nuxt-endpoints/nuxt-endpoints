# TanStack Query Adapter Design

Status: Phases 1-3 are implemented behind the `endpoints.client.query` module
option, including Nuxt SSR integration and infinite-query factories.

Last consolidated: 2026-07-21

This is the source of truth for a first-class TanStack Query integration. It
covers generated option factories, key design, error modes, Nuxt SSR, delivery
phases, tests, and the eight confirmed public adapter decisions. It documents
the implemented initial API and the constraints that future changes must
preserve while the package remains pre-1.0.

Cross-feature priorities and non-TanStack proposals live in the
[Nuxt Endpoints roadmap](./roadmap.md). Comparison evidence lives in the
[Nuxt Actions comparison](./nuxt-actions-comparison.md).

## Current implementation status

| Area                                                             | Status                                           | Current evidence                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint contracts and generated client                          | Implemented                                      | Existing Nuxt Endpoints core                                                                                                                                                   |
| Memoized endpoint call plus fresh signal-aware request functions | Internal implementation exists                   | `request.data(signal)`, `request.result(signal)`, and `request.raw(signal)` in `src/runtime/client.ts`                                                                         |
| Public adapter-safe fresh-request boundary                       | Implemented                                      | `createEndpointRequest(route, options, { fetcher })` in `src/runtime/client.ts`                                                                                                |
| TanStack Query and Mutation option factories                     | Implemented                                      | `#endpoints/query` generated when `endpoints.client.query` is enabled                                                                                                          |
| Deterministic TanStack key factories                             | Implemented                                      | Shares `normalizeEndpointRequestKey`; result mode adds a `'result'` key segment                                                                                                |
| Nuxt SSR QueryClient integration                                 | External recipe and opt-in auto mode implemented | Recipe and SSR tests in docs/tanstack-query-ssr.md and test/fixtures/basic; `endpoints-query-plugin.ts` codegen for `endpoints.client.query.setup = 'auto'` in `src/module.ts` |
| Infinite-query option factories                                  | Implemented                                      | `endpointInfiniteQueryOptions` in `#endpoints/query`; recipes in docs/tanstack-query-recipes.md                                                                                |

## Confirmed public decision summary

The following decisions are approved for the initial public API. Result-mode
semantics, cached response headers, and opt-in automatic SSR setup were
confirmed on 2026-07-21.

- Keep endpoint contracts, request validation, response typing, and HTTP calls
  in Nuxt Endpoints.
- Let TanStack Query own server-state caching, retries, invalidation,
  optimistic updates, polling, focus/reconnect refetching, and infinite-query
  state.
- Do not add TanStack Query concepts to Nitro endpoint handlers. The backend
  must remain unaware of the adapter.
- Treat the adapter as frontend-facing but universal: its query functions must
  work during both Nuxt SSR and browser execution.
- Provide Nuxt SSR integration separately from the endpoint option factories.
  SSR requires a request-scoped `QueryClient`, dehydration/hydration, and a
  request-aware fetcher.
- Keep `useEndpoint` as the lightweight Nuxt-native option for applications
  that do not need TanStack Query.

## Decision record and alternatives

The eight decisions below are the choices that materially affect the public
adapter. Requirements such as request-scoped SSR caches, AbortSignal
propagation, and deterministic object normalization are safety constraints,
not product choices, and are recorded later in this document.

### 1. Query and Mutation classification

Alternatives:

- A: Generate Query options for `GET` and `HEAD`, and Mutation options for
  `POST`, `PUT`, `PATCH`, and `DELETE`.
- B: Generate both Query and Mutation options for every operation.
- C: Require an explicit per-operation classification in module
  configuration.

Recommendation: A, with a future C-style override only after a real use case
appears. It follows HTTP semantics and prevents a write such as `createUser`
from accidentally becoming a cacheable Query. B has the largest API surface
and permits invalid combinations.

Concrete consequence: a `GET getUser` operation generates only
`endpointQueryOptions.getUser(...)`; a `POST createUser` operation generates
only `endpointMutationOptions.createUser()`. A POST-based search cannot be a
Query in the first version. Adding an explicit override later is backward
compatible.

### 2. Treatment of declared non-2xx responses

Alternatives:

- A: Always throw for non-2xx responses, using a typed error class to preserve
  the declared status body.
- B: Provide a default throwing data mode and a separate typed result mode.
- C: Provide only result mode, so every caller narrows a status union.

Recommendation: B.

Concrete consequence:

```ts
// A declared 404 enters TanStack Query's error state.
endpointQueryOptions.getUser(request)

// A declared 404 is successful cached data with status === 404.
endpointQueryOptions.getUser.result(request)
```

This preserves normal TanStack Query behavior for most screens while allowing
typed `404` or `422` workflows. In result mode, declared non-2xx responses are
not retried as failures; transport failures still enter the error state.

Status: confirmed and implemented. A declared non-2xx response is successful
Query data only through the explicit `.result()` factory. Data mode continues
to reject, and transport failures reject in both modes.

### 3. Response headers in result-mode cache data

Alternatives:

- A: Cache only `{ status, ok, body }`.
- B: Convert headers to a serializable plain object and cache it.
- C: Cache the native `Headers` object.

Recommendation: A. C is unsuitable for SSR serialization. B is possible but
requires additional rules for repeated header values, sensitive headers, and
headers such as `set-cookie`.

Concrete consequence: this restriction applies only to TanStack Query result
data. The existing low-level `$endpoint(...).result()` API can continue to
expose headers. A caller that needs response metadata should use that low-level
API or a future explicitly designed serializable metadata mode.

Status: confirmed and implemented. Cached result data contains only
`{ status, ok, body }`. Native response headers remain available through the
low-level endpoint result API and never enter the dehydrated Query cache.

### 4. Request headers in query keys

Alternatives:

- A: Include every request header in the key.
- B: Exclude headers and accept a logical `keyScope` for values such as tenant,
  locale, user, or feature flag.
- C: Configure an allowlist of headers that may enter the key.

Recommendation: B. Authorization values and cookies must not appear in
DevTools or dehydrated state. Response-varying identity should be represented
by a stable logical value rather than by a credential.

The standard key therefore has this conceptual shape:

```ts
const queryKey = [
  'nuxt-endpoints',
  'v1',
  'getUser',
  { params, query, body, idempotencyKey },
  keyScope,
]
```

When the endpoint declares idempotency, the typed `idempotencyKey` request
input is also included in the normalized request segment. It is a deliberate
exception: the adapter turns it into a request header on the wire, but it
remains part of cache identity. It must therefore be an opaque request
identifier rather than a secret.

Concrete consequence: requests that differ only by ordinary headers share a
browser cache unless the application supplies a different `keyScope`. An
application that changes the signed-in identity within one QueryClient must
either clear the cache or scope keys by user or tenant. SSR remains isolated
by its request-scoped QueryClient.

### 5. Reactive request input

Alternatives:

- A: Accept only a plain request object.
- B: Accept either a plain object or a getter/ref for the complete request.
- C: Accept refs at arbitrary nested fields inside the request.

Recommendation: B.

```ts
endpointQueryOptions.getUser(() => ({
  params: { id: userId.value },
}))
```

Evaluating the complete request and key together prevents a new key from being
paired with stale request options. Deep ref support would complicate both
types and normalization and is not needed in the first version. Fixed plain
objects must remain supported.

### 6. Ownership of the Nuxt SSR plugin

Alternatives:

- A: Ship only option factories; the application owns QueryClient,
  VueQueryPlugin, dehydrate/hydrate, request scoping, and stale defaults.
- B: Support explicit `external` and opt-in `auto` setup modes.
- C: Always install and configure TanStack Query automatically.

Recommendation: B, with `external` as the conservative initial/default mode.

In `external` mode, Nuxt Endpoints creates no QueryClient. In `auto` mode, it
owns the request-scoped QueryClient, plugin registration, dehydrate/hydrate,
request-aware fetcher, and server cache cleanup. C is rejected because an
application may already have a QueryClient and VueQueryPlugin installation.

Status: confirmed and implemented as recommended — external default, opt-in
auto via `endpoints.client.query.setup = 'auto'`.

### 7. Default stale time in automatic SSR mode

Alternatives:

- A: Keep TanStack Query's `0` default.
- B: Use a short non-zero default, proposed as 60 seconds.
- C: Use `Infinity` and require explicit invalidation.

Recommendation: B for the automatic plugin only. The purpose is to avoid an
immediate browser refetch after hydration, not to claim that every domain has
a 60-second freshness policy. Every Query and the automatic plugin settings
must be able to override it. External mode does not change the application's
defaults.

Status: implemented — `endpoints.client.query.staleTime` defaults to 60,000ms
and is only applied by the generated `auto`-mode plugin; it has no effect in
`external` mode.

### 8. Mutation invalidation

Alternatives:

- A: The application explicitly invalidates generated Query keys in lifecycle
  callbacks.
- B: The endpoint or adapter configuration declares mutation-to-query
  relationships.
- C: Infer affected Queries from operation names or URLs.

Recommendation: A. The endpoint contract cannot know which cached views a
mutation affects. C is unsafe; B may be added after real applications reveal a
stable declaration model.

Concrete consequence: Nuxt Endpoints provides prefix and exact typed key
factories, while the application owns invalidation timing and target selection.
Optimistic updates use the same standard TanStack Query lifecycle APIs.

### Initial public surface

The confirmed generated surface is approximately:

```ts
// GET and HEAD operations
endpointQueryOptions.getUser(request)
endpointQueryOptions.getUser.result(request)
endpointQueryOptions.getUser.key()
endpointQueryOptions.getUser.key(request)

// POST, PUT, PATCH, and DELETE operations
endpointMutationOptions.createUser()
endpointMutationOptions.createUser.result()
```

The implemented initial contract is:

- classify Query and Mutation by HTTP method;
- throw declared non-2xx responses in default data mode;
- expose non-2xx status unions only through explicit result mode;
- cache `{ status, ok, body }`, not response headers;
- exclude ordinary request headers and credentials from generated keys while
  retaining the typed `idempotencyKey` as cache identity;
- allow explicit logical `keyScope` values;
- support reactivity at the whole-request getter boundary;
- separate `external` and opt-in `auto` SSR setup;
- use a configurable 60-second `staleTime` only in automatic setup;
- never guess invalidation relationships.

## Responsibility boundary

| Concern                                | Owner                              |
| -------------------------------------- | ---------------------------------- |
| Endpoint discovery and operation types | Nuxt Endpoints                     |
| Request/response validation            | Nuxt Endpoints                     |
| HTTP request construction              | Nuxt Endpoints                     |
| AbortSignal propagation                | Nuxt Endpoints adapter boundary    |
| Query and mutation keys                | Nuxt Endpoints adapter             |
| Query cache and stale/gc policy        | TanStack Query                     |
| Retry and request deduplication        | TanStack Query                     |
| Invalidation and background refetch    | TanStack Query                     |
| Optimistic update and rollback         | TanStack Query                     |
| Infinite-query page state              | TanStack Query                     |
| SSR cache transfer                     | Nuxt integration plugin            |
| Form field state and client validation | A form library or application code |

## Implemented user-facing shape

Each generated helper returns normal TanStack Query options rather than
wrapping or replacing `useQuery` and `useMutation`.

```ts
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import {
  endpointInfiniteQueryOptions,
  endpointMutationOptions,
  endpointQueryOptions,
} from '#endpoints/query'

const user = useQuery(
  endpointQueryOptions.getUser({
    params: { id: '123' },
  }),
)

const createUser = useMutation(endpointMutationOptions.createUser())

const users = useInfiniteQuery(
  endpointInfiniteQueryOptions.searchUsers({
    initialPageParam: undefined,
    request: (pageParam) => ({
      query: { cursor: pageParam },
    }),
    getNextPageParam: (page) => page.nextCursor,
  }),
)
```

Key helpers should be available independently so invalidation does not require
reconstructing internal key details:

```ts
const queryClient = useQueryClient()

await queryClient.invalidateQueries({
  queryKey: endpointQueryOptions.listUsers.key(),
})

await queryClient.invalidateQueries({
  queryKey: endpointQueryOptions.getUser.key({
    params: { id: '123' },
  }),
})
```

Path-and-method calls should remain possible, but named operations are the
preferred adapter API because they produce readable, stable keys and generated
properties.

## Required Nuxt Endpoints primitives

### 1. Fresh, signal-aware requests

TanStack Query passes an `AbortSignal` to every query function. The adapter
must call a fresh request function with that signal; it must not reuse the
memoized promise exposed by a previously awaited endpoint call.

The runtime already has internal signal-aware `request.data`,
`request.result`, and `request.raw` functions. Expose them through a typed,
deliberately small integration boundary, or construct TanStack options through
an endpoint client extension that can access those functions.

Do not expose the entire internal runtime object as public API.

### 2. Fetcher injection

The request primitive should accept or capture a fetcher. This is needed for:

- Nuxt SSR request-header and cookie forwarding;
- custom base URLs and authentication;
- tests and mocks;
- tracing and metrics;
- future Effect adapter improvements.

During SSR, the adapter must use a request-aware fetcher equivalent to
`useRequestFetch()`. A plain global `$fetch` does not automatically forward the
incoming user's cookies or authorization headers.

The fetcher must be captured while Nuxt context is available and then used by
the query function when TanStack Query executes it.

### 3. Generated request-option types

Export a generated type that maps an operation to its exact request options.
The adapter should not need to reverse-engineer an overloaded `$endpoint`
signature.

Conceptually:

```ts
type $EndpointOptions<Operation extends EndpointOperation> = unknown
```

The final type must preserve required versus optional params, query, headers,
and body fields.

### 4. Stable key input

Reuse a single deterministic normalization implementation for `useEndpoint`
keys and TanStack query keys where practical.

The key should contain:

- a Nuxt Endpoints namespace and key format version;
- the operation name, or path and method;
- normalized request params/query/body and the typed `idempotencyKey` that
  affect cache identity.

Do not include `signal`, callbacks, fetch functions, or other non-data options.

Headers require an explicit policy. Authorization and cookies normally do not
need to be included because browser QueryClients are user-scoped and SSR
QueryClients are request-scoped. Applications that switch identity without
recreating or clearing the QueryClient must be able to extend the key.

## Query options

The generated query option should:

- preserve the exact successful response body type;
- generate a deterministic `queryKey`;
- call a fresh endpoint request from `queryFn`;
- forward `QueryFunctionContext.signal`;
- support reactive input without freezing the initial key;
- return standard `queryOptions(...)` output so all TanStack options remain
  available to the caller;
- allow an explicit key extension for tenant, locale, feature flag, or other
  response-varying context.

The adapter should not duplicate `staleTime`, `gcTime`, `enabled`, `select`,
`placeholderData`, retry, polling, or focus/reconnect options. Those are passed
through to TanStack Query.

## Error and result policy

Normal endpoint data calls throw on non-successful HTTP responses and are the
natural default for TanStack Query.

`result()` has different semantics: it resolves a typed status union, including
non-2xx results. A resolved `404` result is data from TanStack Query's point of
view, not a query error.

Provide separate, explicit modes instead of guessing:

- `data`: successful body; non-2xx throws and drives TanStack error state;
- `result`: complete typed status union; callers narrow `status` themselves;
- `raw`: native response, intended for advanced use rather than cached JSON
  state.

Do not silently convert a typed `result()` failure into an exception. If a
throwing status-aware helper is added later, give it a distinct name and make
its error type explicit.

## Mutation options and invalidation

Mutation helpers should:

- infer the exact endpoint request input as `mutationFn` variables;
- infer the successful response body;
- provide a stable mutation key;
- forward AbortSignal if TanStack exposes one for the relevant mutation flow;
- stay compatible with normal TanStack lifecycle callbacks.

Nuxt Endpoints should provide query-key factories, not its own invalidation
registry. Applications should call `queryClient.invalidateQueries()` with the
generated keys.

Optimistic updates should be documented using TanStack Query's standard
`onMutate`, `setQueryData`, rollback, and `onSettled` flow. Do not implement a
second optimistic-state engine in Nuxt Endpoints.

## Infinite queries

An infinite-query adapter is useful, but page-param mapping cannot be inferred
reliably from an arbitrary endpoint contract.

The helper should therefore require a function that maps `pageParam` to
endpoint request options. TanStack Query remains responsible for `pages`,
`pageParams`, concurrent fetch handling, and next/previous-page state.

The adapter must not assume a field name such as `cursor`, `page`, or `offset`.

## SSR integration

SSR support does not require changes to Nitro endpoint handlers, but it does
require Nuxt runtime integration.

The integration should:

1. Create a new `QueryClient` for each SSR request.
2. Install `VueQueryPlugin` for both server rendering and the browser.
3. Dehydrate successful server queries after rendering.
4. Serialize the dehydrated state through Nuxt state.
5. Hydrate the browser QueryClient before normal client querying.
6. Avoid sharing query cache entries between SSR requests.
7. Use a request-aware endpoint fetcher so cookies and authorization headers
   reach internal API routes.
8. Choose a non-zero default `staleTime`, or clearly document that TanStack's
   zero default causes an immediate browser refetch after hydration.
9. Clear request-scoped server cache after dehydration if lifecycle behavior or
   configured `gcTime` makes that necessary.

SSR integration should be optional. Applications may already install and
configure `VueQueryPlugin`; the endpoint option factories must work with an
externally managed QueryClient.

Open question: provide automatic Nuxt plugin setup behind a module option, or
ship only option factories plus a documented plugin recipe. Automatic setup is
more convenient, but it increases module ownership and may conflict with an
application's existing QueryClient configuration.

## Prefetching and navigation

Because query option factories are ordinary TanStack options, they should work
unchanged with:

- `queryClient.prefetchQuery()`;
- `queryClient.ensureQueryData()`;
- route middleware or page-level prefetch;
- `onServerPrefetch()` and `suspense()`;
- explicit client-only prefetching.

No separate Nuxt Endpoints prefetch cache should be added.

## Optional dependency and generated exports

- Keep `@tanstack/vue-query` optional.
- Do not load TanStack Query runtime code unless the integration is enabled or
  its export is imported.
- Fail with a clear setup error when integration is enabled without the peer
  dependency.
- Generate a dedicated virtual import such as `#endpoints/query` so core
  `$endpoint` users do not receive unrelated APIs or types.
- Keep adapter generation aligned with endpoint HMR and operation-name
  collision handling.

## Features deliberately delegated to TanStack Query

Do not implement these in Nuxt Endpoints:

- cache storage and garbage collection;
- stale/fresh policy;
- retry and backoff;
- request deduplication;
- focus/reconnect refetch;
- polling;
- optimistic mutation queues and rollback;
- infinite-query page accumulation;
- offline mutation persistence;
- query devtools.

Form state is also out of scope for this adapter. TanStack Form, VeeValidate,
or application code can consume the typed mutation helper.

## Related roadmap decisions

Server context, idempotency, operation-aware observability, DevTools,
multipart, and typed streaming are separate product-level decisions. Their
status, detailed requirements, and overall priority live in the
[Nuxt Endpoints roadmap](./roadmap.md). The verified adoption evidence lives in
the [Nuxt Actions comparison](./nuxt-actions-comparison.md).

## Suggested delivery phases

### Phase 1: Typed option factories

- Add the signal-aware integration boundary.
- Export operation request-option types.
- Generate query and mutation option factories.
- Add deterministic key factories.
- Cover data/result error semantics.
- Add type tests and client runtime tests.

This phase is sufficient for client-rendered applications and for applications
that already manage their own QueryClient.

### Phase 2: Nuxt SSR integration

- Add request-scoped QueryClient setup.
- Add dehydrate/hydrate state transfer.
- Add request-aware fetcher capture.
- Test authenticated SSR requests and cache isolation.
- Test that hydration does not duplicate requests unexpectedly.

### Phase 3: Advanced ergonomics

- Add infinite-query factories.
- Add prefetch examples and route integration.
- Add optimistic-update recipes using generated keys.
- Add TanStack Query Devtools usage documentation.
- Evaluate optional automatic plugin setup after the manual integration is
  stable.

## Minimum test matrix

### Type tests

- Required and optional endpoint inputs are preserved.
- Query data is inferred from the operation response.
- Mutation variables are inferred from endpoint options.
- Named operations and path/method calls remain distinct.
- `data`, `result`, and `raw` modes have distinct result types.
- Infinite-query `pageParam` mapping preserves endpoint input types.
- Invalid operations and invalid request inputs fail compilation.

### Runtime tests

- Stable keys are independent of object insertion order.
- Different inputs produce different keys.
- Reactive input changes update both the key and request.
- Query cancellation aborts the underlying request.
- A refetch performs a fresh request.
- Non-2xx data calls enter TanStack error state.
- Result-mode non-2xx responses remain typed data.
- Mutation invalidation works through generated key helpers.
- Infinite queries do not merge stale or duplicate pages.

### SSR tests

- Query data appears in server-rendered HTML.
- Hydration reuses dehydrated data according to `staleTime`.
- Cookies and authorization headers are forwarded during SSR.
- QueryClient cache is isolated between two simulated users.
- Browser navigation and background refetch still work after hydration.
- Failed queries follow the documented dehydration policy.

## Compatibility criteria

The implemented adapter and future compatible changes must preserve these
properties:

- endpoint input and output types flow into `useQuery` and `useMutation`
  without manual generics;
- query keys are generated, inspectable, and reusable for invalidation;
- cancellation reaches the underlying HTTP request;
- SSR uses a request-scoped cache and forwards request credentials;
- hydration does not leak data across requests;
- users can opt out of automatic Nuxt integration;
- cache, optimistic, retry, and infinite-query algorithms remain owned by
  TanStack Query rather than duplicated in Nuxt Endpoints.

## Independent regression review brief

An independent reviewer should evaluate the implementation against this
decision record. The architectural boundary to preserve is:

- Nuxt `server/api` endpoint contracts remain the source of truth;
- Nuxt Endpoints owns request validation, response typing, generated endpoint
  calls, and transport integration points;
- TanStack Query owns server-state cache behavior and Query lifecycle;
- Nitro endpoint handlers remain unaware of TanStack Query;
- application-specific form state and security policy remain outside the
  adapter.

The most valuable regression-review questions are:

1. Does the adapter boundary reuse the fresh
   `request.data/result/raw(signal)` functions without creating a second
   conflicting request API?
2. Does the generated factory shape retain useful Vue reactivity while still
   returning ordinary TanStack Query options?
3. Are the hierarchical keys sufficient for prefix invalidation,
   identity changes, tenant scoping, and SSR serialization without leaking
   credentials?
4. Is a separate `.result()` factory the clearest way to preserve typed
   multi-status endpoint contracts?
5. Does opt-in automatic SSR setup remain isolated from applications that own
   their QueryClient through the default external mode?
6. Does the confirmed automatic setup keep `external` as the default and use a
   configurable 60-second stale time only in `auto` mode?
7. Can request-aware fetcher capture be implemented without relying on Nuxt
   context after the Query function begins executing?
8. Do Query and Mutation factories remain correctly classified by HTTP method,
   and has a real use case emerged that justifies an explicit override?

Reviewers should explicitly identify any implementation that diverges from
the eight confirmed decisions and whether a proposed change is backward
compatible.
