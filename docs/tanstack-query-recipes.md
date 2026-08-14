# TanStack Query Recipes

Status: infinite-query option factories are implemented and unit-tested (see
`test/query-infinite.test.ts`); the prefetching, optimistic-update, and
Devtools sections below document standard TanStack Query usage on top of the
generated option factories rather than new Nuxt Endpoints code - Nuxt
Endpoints ships no separate prefetch cache, optimistic-state engine, or
Devtools integration. See
[Infinite queries](./tanstack-query-adapter.md#infinite-queries),
[Prefetching and navigation](./tanstack-query-adapter.md#prefetching-and-navigation),
and
[Mutation options and invalidation](./tanstack-query-adapter.md#mutation-options-and-invalidation)
in the adapter design.

Last consolidated: 2026-07-18

This document complements
[docs/tanstack-query-ssr.md](./tanstack-query-ssr.md), which covers Nuxt SSR
`QueryClient` setup, dehydration, and hydration. This document covers usage
patterns that sit on top of any `QueryClient` setup, SSR or client-only:
infinite queries, prefetching, optimistic updates, and Devtools.

## Infinite queries

`endpointInfiniteQueryOptions` generates one factory per named `GET`/`HEAD`
operation, exactly like `endpointQueryOptions`, but each factory takes a
config object instead of a plain request:

```ts
import { useInfiniteQuery } from '@tanstack/vue-query'
import { endpointInfiniteQueryOptions } from '#endpoints/query'

const users = useInfiniteQuery(
  endpointInfiniteQueryOptions.searchUsers({
    initialPageParam: undefined,
    request: (pageParam) => ({
      query: { cursor: pageParam, term: 'ada' },
    }),
    getNextPageParam: (page) => page.nextCursor,
  }),
)
```

### Explicit pageParam-to-request mapping

The adapter never assumes a field name such as `cursor`, `page`, or `offset`.
`request(pageParam)` is the only place that decides which request field
receives the page param, and it can map to any field the endpoint's `query`
(or `params`, or `body`) contract declares - see
[Infinite queries in the adapter design](./tanstack-query-adapter.md#infinite-queries)
for why this cannot be inferred generically. `test/query-infinite.test.ts`
covers a config that maps `pageParam` into an arbitrarily named field to prove
the adapter carries no hidden field-name assumption.

### Key derivation and cache splitting

The generated `queryKey` is derived from `request(initialPageParam)`, not from
any later page. Concretely:

```ts
;['nuxt-endpoints', 'v1', 'searchUsers', 'infinite', { query: { cursor: undefined, term: 'ada' } }]
```

Because the key is computed once from the first page's request, and
`request` is a closure, two configs whose closures embed different filter
values produce different keys even though both start from the same
`initialPageParam`:

```ts
const search = (term: string) =>
  endpointInfiniteQueryOptions.searchUsers({
    initialPageParam: undefined,
    request: (pageParam) => ({ query: { cursor: pageParam, term } }),
    getNextPageParam: (page) => page.nextCursor,
  })

search('ada').queryKey // ends in { query: { term: 'ada', ... } }
search('grace').queryKey // ends in { query: { term: 'grace', ... } }
```

This is what makes per-filter caching work correctly: switching the search
term produces a distinct infinite-query cache entry instead of silently
reusing (or corrupting) another term's accumulated pages. `keyScope` is
accepted at the config level for the same tenant/locale/identity scoping
described in
[Request headers in query keys](./tanstack-query-adapter.md#4-request-headers-in-query-keys),
and is appended after the derived segment exactly as it is for the regular
(non-infinite) factories.

### Reactivity for changing filters

Do not read reactive filter state inside `request` or `queryFn` - by the time
`queryFn` runs for a later page, the filters it reads may have already changed
from the ones the key (and any earlier accumulated pages) were built from,
pairing new filters with stale page state. Instead, wrap the whole factory
call in a `computed`, exactly as the design document's
[reactive request input](./tanstack-query-adapter.md#5-reactive-request-input)
decision recommends for the non-infinite factories:

```ts
import { computed, ref } from 'vue'
import { useInfiniteQuery } from '@tanstack/vue-query'
import { endpointInfiniteQueryOptions } from '#endpoints/query'

const term = ref('ada')

const users = useInfiniteQuery(
  computed(() =>
    endpointInfiniteQueryOptions.searchUsers({
      initialPageParam: undefined,
      request: (pageParam) => ({ query: { cursor: pageParam, term: term.value } }),
      getNextPageParam: (page) => page.nextCursor,
    }),
  ),
)
```

Changing `term.value` now produces a whole new `queryKey`/`queryFn` pair
together, so TanStack Query starts a fresh infinite-query cache entry for the
new filter instead of appending pages fetched under the old one.

### Known interop caveat: `TPageParam` widens to `unknown`

`useInfiniteQuery(client.searchUsers(config), queryClient)` interoperates with
real `useInfiniteQuery` types, but one generic slot does not narrow as
tightly as the rest: vue-query's `UseInfiniteQueryOptions` is a mapped type
keyed over `InfiniteQueryObserverOptions<TQueryFnData, TError, TData,
TQueryKey, TPageParam>` rather than directly over the keys of the options
object passed in, so it is non-homomorphic and blocks generic inference
through it for anything that only appears inside that mapped type.

The generated `queryKey` is now branded with `DataTag<EndpointQueryKey,
InfiniteData<PAGE, PAGE_PARAM>>` (see
[Type-tagged keys](#type-tagged-keys-and-getquerydata) below), which fixes
`queryClient.getQueryData(...)` typing, but it does **not** fix this caveat:
`TPageParam` never appears anywhere in the `queryKey`'s own type - only inside
`initialPageParam`/`getNextPageParam`, which sit behind the same
non-homomorphic mapped type as everything else and so still cannot be
narrowed from the call site. It widens to `unknown` regardless of tagging.

In practice this means:

- `data.value.pages` stays exactly typed (`PageBody[]`), because the page type
  flows through `TQueryFnData`/`TData`, which the mapped type does preserve;
- `data.value.pageParams` widens to `unknown[]` instead of the actual page
  param type;
- `data.value` overall types as `InfiniteData<PageBody, unknown> | undefined`.

This is a TanStack-side inference limitation triggered by how its Vue
adapter's options type is shaped, not a Nuxt Endpoints defect, and it does
not affect runtime behavior - `pageParams` still contains the real, correctly
paginated values at runtime. `test/types/query-infinite.test-d.ts` encodes
this as an explicit `expectTypeOf` assertion with the same explanation, so a
future TanStack Query release that fixes the inference will fail that test
and prompt an update to this note.

### Type-tagged keys and `getQueryData`

`factory.key(request)` (and the infinite equivalents, `factory.key(config)`
and `factory.result.key(config)`) return a key branded with TanStack's
`DataTag<TQueryKey, DATA>`, so
`queryClient.getQueryData(endpointQueryOptions.getUser.key({ params: { id } }))`
is typed as the route's success body (or `InfiniteData<PAGE, PAGE_PARAM>` for
the infinite factories) instead of `unknown`, with no manual cast required.
`factory.key()` called with **no** argument stays untagged - see
[Optimistic updates](#optimistic-updates) below for why that specific,
argument-less form intentionally cannot carry a single data tag.

## Prefetching

`endpointQueryOptions.*` and `endpointInfiniteQueryOptions.*` factories return
ordinary TanStack Query options - there is no separate Nuxt Endpoints
prefetch cache, so every standard TanStack prefetch entry point works
unchanged.

```ts
const queryClient = useQueryClient()

// Fire-and-forget prefetch, e.g. on hover or route-enter:
await queryClient.prefetchQuery(endpointQueryOptions.getUser({ params: { id } }))

// Read-through cache access, e.g. inside route middleware:
const user = await queryClient.ensureQueryData(endpointQueryOptions.getUser({ params: { id } }))
```

Route middleware can call either helper before navigation resolves, exactly
as it would for any hand-written TanStack options object - the generated
factory does not change the middleware contract.

For data that must be present in server-rendered HTML, use the same
`onServerPrefetch` plus `suspense()` pattern documented in
[docs/tanstack-query-ssr.md](./tanstack-query-ssr.md#page-usage); that recipe
already works with both the regular and infinite factories because both
return the same `{ queryKey, queryFn, ... }` shape TanStack Query expects.

## Optimistic updates

Nuxt Endpoints does not implement a second optimistic-state engine - see
[Mutation options and invalidation](./tanstack-query-adapter.md#mutation-options-and-invalidation)
and
[Features deliberately delegated to TanStack Query](./tanstack-query-adapter.md#features-deliberately-delegated-to-tanstack-query).
Optimistic updates use TanStack's standard `onMutate` / `cancelQueries` /
`setQueryData` / rollback / `onSettled` lifecycle, addressed with the
generated key factories instead of hand-built key arrays:

```ts
const queryClient = useQueryClient()

const updateUser = useMutation({
  ...endpointMutationOptions.updateUser(),
  onMutate: async (variables) => {
    const detailKey = endpointQueryOptions.getUser.key({ params: { id: variables.params.id } })

    await queryClient.cancelQueries({ queryKey: detailKey })
    const previous = queryClient.getQueryData(detailKey)

    queryClient.setQueryData(detailKey, (current) => ({
      ...current,
      ...variables.body,
    }))

    return { previous, detailKey }
  },
  onError: (_error, _variables, context) => {
    if (context) {
      queryClient.setQueryData(context.detailKey, context.previous)
    }
  },
  onSettled: (_data, _error, variables) => {
    queryClient.invalidateQueries({
      queryKey: endpointQueryOptions.getUser.key({ params: { id: variables.params.id } }),
    })
    // Prefix-invalidate every cached listUsers page/filter variant.
    queryClient.invalidateQueries({ queryKey: endpointQueryOptions.listUsers.key() })
  },
})
```

`endpointQueryOptions.listUsers.key()` called with no argument returns the
namespace/version/operation prefix only (no request segment), so
`invalidateQueries` matches every cached `listUsers` variant regardless of
its filters - the same prefix-matching behavior documented for the
non-infinite key factories in
[Stable key input](./tanstack-query-adapter.md#4-stable-key-input).

**Key spec: no-argument `.key()` is a prefix, `.key({})` is exact.**
`factory.key()` called with **no argument** is the operation's _prefix_ key -
under TanStack's prefix-matching rules it matches every cached entry for that
operation, across the data, result, and infinite caches alike, which is
exactly what invalidation above wants. To target only the _exact_ cache entry
of a void-input operation (as opposed to every entry under its prefix), call
`factory.key({})` instead - optionally with `{ exact: true }` passed to
`invalidateQueries`/`cancelQueries` - since an explicit (even empty) request
argument produces the fully-qualified, single-entry key rather than the
prefix.

## Devtools

`@tanstack/vue-query-devtools` works unchanged against the generated option
factories; there is no adapter-specific Devtools integration to install or
configure. Generated keys are inspectable under the `nuxt-endpoints`
namespace segment (`['nuxt-endpoints', 'v1', operation, ...]`), which makes it
straightforward to spot a query in the panel by operation name.

By design, ordinary request headers and credentials never appear in a
generated key. The typed `idempotencyKey` input is the deliberate exception:
it becomes a header on the wire but remains visible as cache identity in
Devtools, so it must be an opaque identifier rather than a secret. Result-mode
cached data is always `{ status, ok, body }` with headers stripped - see
[Response headers in result-mode cache data](./tanstack-query-adapter.md#3-response-headers-in-result-mode-cache-data)
and
[Request headers in query keys](./tanstack-query-adapter.md#4-request-headers-in-query-keys).
Generated keys expose the application-provided `params`, `query`, `body`,
`idempotencyKey`, and `keyScope`. Applications must not place secrets in these
key fields.

## Coverage

| Claim in this document                                                                | Covered by                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infinite-query classification (`GET`/`HEAD` only, reserved and operationless skipped) | unit: `classification` in `test/query-infinite.test.ts`                                                                                                  |
| Key shapes, `keyScope`, insertion-order determinism, arbitrary page-param field names | unit: `keys` in `test/query-infinite.test.ts`                                                                                                            |
| Closure-embedded filters split the cache (different keys for different filter values) | unit: `produces different keys when request closures embed different filter values` in `test/query-infinite.test.ts`                                     |
| `queryFn` page-param mapping, signal forwarding, data/result modes                    | unit: `queryFn` in `test/query-infinite.test.ts`                                                                                                         |
| `initialPageParam`/`getNextPageParam`/`getPreviousPageParam` passthrough              | unit: `config passthrough` in `test/query-infinite.test.ts`                                                                                              |
| Fetcher injection and capture timing                                                  | unit: `fetcher injection` in `test/query-infinite.test.ts`                                                                                               |
| Real pagination walk (`fetchInfiniteQuery({ pages: 2 })`, `pageParams`, cache key)    | unit: `real @tanstack/vue-query pagination` in `test/query-infinite.test.ts`                                                                             |
| Prefetch/`ensureQueryData` mechanics on the regular (non-infinite) factories          | unit: `prefetch recipe mechanics (regular non-infinite query factories)` in `test/query-infinite.test.ts`                                                |
| `TPageParam`-widens-to-`unknown` interop caveat                                       | type test: `interoperates with real useInfiniteQuery, with a known TPageParam-widening caveat` in `test/types/query-infinite.test-d.ts`                  |
| Route-middleware prefetch                                                             | Documentation-only - not e2e-tested; it is a direct call to `prefetchQuery`/`ensureQueryData`, already covered generically by the prefetch tests above.  |
| Devtools inspectability                                                               | Documentation-only - no automated coverage; `@tanstack/vue-query-devtools` is a third-party panel with no Nuxt Endpoints-specific code path to test.     |
| Optimistic-update recipe                                                              | Documentation-only - standard TanStack lifecycle usage; no Nuxt Endpoints-specific behavior to unit-test beyond the key factories already covered above. |
