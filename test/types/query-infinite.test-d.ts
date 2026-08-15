import type { InfiniteData, QueryClient } from '@tanstack/vue-query'
import { useInfiniteQuery } from '@tanstack/vue-query'
import { describe, expectTypeOf, it } from 'vitest'
import type { EndpointResultData } from '../../src/runtime/client'
import type { EndpointInfiniteQueryOptionsClient } from '../../src/runtime/tanstack-query'
import type { StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type SearchUsersPage = { items: { id: number; name: string }[]; nextCursor?: string }

type Routes =
  | {
      path: '/api/users/search'
      method: 'get'
      operation: 'searchUsers'
      definition: {
        operation: 'searchUsers'
        query: Schema<{ cursor?: string; term?: string }>
        responses: {
          200: Schema<SearchUsersPage>
          400: Schema<{ message: string }>
        }
      }
    }
  | {
      path: '/api/users'
      method: 'post'
      operation: 'createUser'
      definition: {
        operation: 'createUser'
        body: Schema<{ name: string }>
        responses: {
          201: Schema<{ id: number; name: string }>
        }
      }
    }

declare const client: EndpointInfiniteQueryOptionsClient<Routes>
declare const queryClientInstance: QueryClient

describe('EndpointInfiniteQueryOptionsClient types', () => {
  it('exposes GET/HEAD operations only', () => {
    expectTypeOf<keyof typeof client>().toEqualTypeOf<'searchUsers'>()
  })

  it('infers the request pageParam type from initialPageParam', () => {
    client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam) => {
        expectTypeOf(pageParam).toEqualTypeOf<string>()
        return { query: { cursor: pageParam } }
      },
      getNextPageParam: (page) => page.nextCursor,
    })
  })

  it('rejects a request function whose return does not match the endpoint options', () => {
    client.searchUsers({
      initialPageParam: 'c0',
      // @ts-expect-error request must return the route's endpoint options (query here), not body.
      request: (pageParam: string) => ({ body: { nope: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })
  })

  it('rejects keyScope inside the per-page request', () => {
    type SearchUsersRequest = { query: { cursor?: string; term?: string } }

    client.searchUsers({
      initialPageParam: 'c0',
      // The explicit return annotation is required for TypeScript to excess-property-check
      // the literal below; without it, a callback's returned object literal is checked only
      // for missing properties, not excess ones.
      request: (pageParam: string): SearchUsersRequest =>
        // @ts-expect-error keyScope belongs at the config level, not inside the per-page request.
        ({ query: { cursor: pageParam }, keyScope: 'x' }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })
  })

  it('requires initialPageParam, request, and getNextPageParam', () => {
    // @ts-expect-error initialPageParam is required.
    client.searchUsers({
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })

    // @ts-expect-error request is required.
    client.searchUsers({
      initialPageParam: 'c0',
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })

    // @ts-expect-error getNextPageParam is required.
    client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
    })
  })

  it("types getNextPageParam's lastPage as the route's success body", () => {
    client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (lastPage) => {
        expectTypeOf(lastPage).toEqualTypeOf<SearchUsersPage>()
        return lastPage.nextCursor
      },
    })
  })

  it('types queryFn as resolving the success body', () => {
    const options = client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })

    expectTypeOf<Awaited<ReturnType<typeof options.queryFn>>>().toEqualTypeOf<SearchUsersPage>()
  })

  it("types .result(config)'s queryFn as resolving the declared status union without headers", () => {
    type SearchUsersResult = EndpointResultData<Extract<Routes, { operation: 'searchUsers' }>>

    const options = client.searchUsers.result({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersResult) => (page.ok ? page.body.nextCursor : undefined),
    })
    type ResultData = Awaited<ReturnType<typeof options.queryFn>>

    expectTypeOf<ResultData>().toEqualTypeOf<
      EndpointResultData<Extract<Routes, { operation: 'searchUsers' }>>
    >()

    void options
      .queryFn({ pageParam: 'c0', signal: new AbortController().signal })
      .then((value) => {
        // @ts-expect-error result-mode data is serializable and excludes headers.
        void value.headers
      })
  })

  it('types getQueryData through a tagged infinite key as InfiniteData<PAGE, PAGE_PARAM>, or undefined', () => {
    const config = {
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    }

    const data = queryClientInstance.getQueryData(client.searchUsers.key(config))

    expectTypeOf(data).toEqualTypeOf<InfiniteData<SearchUsersPage, string> | undefined>()
  })

  it('accepts keyScope at the config level', () => {
    client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      keyScope: 'scope',
    })
  })

  it('interoperates with real useInfiniteQuery, with a known TPageParam-widening caveat', () => {
    const options = client.searchUsers({
      initialPageParam: 'c0',
      request: (pageParam: string) => ({ query: { cursor: pageParam } }),
      getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
    })

    const query = useInfiniteQuery(options, queryClientInstance)

    // Known caveat, STILL PRESENT after the `queryKey` was branded with `DataTag`
    // (see EndpointTaggedQueryKey in src/runtime/tanstack-query.ts): vue-query's
    // `UseInfiniteQueryOptions` is a mapped type keyed over
    // `InfiniteQueryObserverOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>`,
    // not over `keyof typeof options` directly, so it is non-homomorphic and blocks
    // generic inference through it. Tagging `queryKey` with `DataTag<TQueryKey, DATA>`
    // fixes `queryClient.getQueryData(...)` (DATA flows through the key itself, see the
    // "types getQueryData through a tagged infinite key" test above) but does nothing
    // for `TPageParam`: that parameter never appears anywhere in the queryKey's type,
    // only inside `initialPageParam`/`getNextPageParam`, which sit behind the same
    // non-homomorphic mapped type and so still cannot be narrowed - it widens to
    // `unknown`. `pages` stays exactly typed because the page type flows through
    // `TQueryFnData`/`TData`, which the mapped type does preserve. This is a
    // TanStack-side inference limit, not a Nuxt Endpoints defect - see the "Infinite
    // queries" section of docs/tanstack-query-recipes.md.
    expectTypeOf(query.data.value).toEqualTypeOf<
      InfiniteData<SearchUsersPage, unknown> | undefined
    >()
  })

  it('fails to compile when accessing a non-existent operation', () => {
    // @ts-expect-error unknown operation.
    void client.doesNotExist
  })
})
