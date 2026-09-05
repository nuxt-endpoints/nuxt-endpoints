import type { UseInfiniteQueryOptions } from '@pinia/colada'
import {
  EndpointPaginationError,
  createEndpointInfiniteQueryOptions,
  mutationOptions,
  queryOptions,
} from './client'
import type { EndpointCallInfiniteQueryOptions, EndpointCursorPaginatedRequest } from './client'

/** Colada options whose error retains every typed non-success route result. */
export type EndpointColadaInfiniteQueryOptions<PAGE, FAILURE> =
  EndpointCallInfiniteQueryOptions<PAGE> &
    Omit<
      UseInfiniteQueryOptions<
        PAGE,
        EndpointPaginationError<FAILURE>,
        string | undefined,
        undefined
      >,
      'getNextPageParam' | 'initialPageParam' | 'key' | 'query'
    >

/** Converts only a cursor-pagination-capable GET request into infinite-query options. */
export function infiniteQueryOptions<PAGE, FAILURE>(
  request: EndpointCursorPaginatedRequest<PAGE, FAILURE>,
): EndpointColadaInfiniteQueryOptions<PAGE, FAILURE> {
  return createEndpointInfiniteQueryOptions(request) as EndpointColadaInfiniteQueryOptions<
    PAGE,
    FAILURE
  >
}

/** Pinia Colada adapters for the typed request returned by `$endpoint()`. */
export { EndpointPaginationError, mutationOptions, queryOptions }
export type {
  EndpointCallInfiniteQueryOptions,
  EndpointCallMutationOptions,
  EndpointCallQueryOptions,
  EndpointCursorPaginatedRequest,
} from './client'
