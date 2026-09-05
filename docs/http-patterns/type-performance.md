# Cursor pagination type-performance check

Status: implementation measurement on the Nuxt 5 development line.

Last measured: 2026-09-04 with TypeScript 7.0.2 and Node.js 24.20.0.

Run the synthetic 100- and 500-route fixtures with:

```bash
node scripts/benchmark-pagination-types.mjs 100 500
```

Each client route has a distinct item and 404 body type and is consumed through
`infiniteQueryOptions()` and Pinia Colada's `useInfiniteQuery()`. Each server
authoring fixture declares an independent cursor-paginated
`defineRouteHandler()`. Routes and consumers live in separate files to avoid
TypeScript's unrelated single-module control-flow size limit.

## Client adapter refactor

The original adapter inferred the complete route, then recalculated the page
and non-200 result union from it. The revised request carries one private
capability containing those already-resolved types:

```ts
type CursorPaginationCapability<Page, Failure> = {
  kind: 'cursor'
  page: Page
  failure: Failure
}
```

`infiniteQueryOptions()` now infers only `Page` and `Failure`. The server
contract, generated request input, handler return checking, and public client
result are unchanged.

| Routes | Metric         |     Before | Capability | Change |
| -----: | -------------- | ---------: | ---------: | -----: |
|    100 | Types          |    160,743 |    137,174 | -14.7% |
|    100 | Instantiations |  4,002,081 |  3,120,771 | -22.0% |
|    100 | Memory         |     282 MB |     272 MB |  -3.7% |
|    100 | Check time     |    0.435 s |    0.273 s | -37.2% |
|    500 | Types          |    578,101 |    513,732 | -11.1% |
|    500 | Instantiations | 87,890,281 | 68,523,771 | -22.0% |
|    500 | Memory         |     530 MB |     507 MB |  -4.2% |
|    500 | Check time     |    7.586 s |    5.638 s | -25.7% |

Instantiation counts are the primary comparison because wall-clock and memory
figures vary with filesystem cache and concurrent host activity. These are
single-run development measurements, not release performance guarantees.

## Generated route lookup

Splitting the benchmark into a raw `$endpoint()` call, the pagination adapter,
and the complete Colada call showed that all three previously produced roughly
68.5 million instantiations at 500 routes. The adapter was not the bottleneck.
Every call site was distributing `Extract` over the complete generated route
union to find its path and method.

Generated types now contain a path/method index:

```ts
type EndpointRouteMap = {
  '/api/articles': {
    get: ArticleListRoute
  }
}
```

The public `$endpoint(path, options)` API and its diagnostics are unchanged,
but route lookup is a direct indexed access. The `mapped-colada` suite measures
the same distinct routes and `useInfiniteQuery(infiniteQueryOptions(...))`
consumers using that generated representation.

| Routes | Metric         | Union lookup | Path map | Change |
| -----: | -------------- | -----------: | -------: | -----: |
|    100 | Types          |      137,408 |   63,652 | -53.7% |
|    100 | Instantiations |    3,121,212 |  175,589 | -94.4% |
|    100 | Memory         |       272 MB |   243 MB | -10.7% |
|    100 | Check time     |      0.321 s |  0.086 s | -73.2% |
|    500 | Types          |      513,966 |  146,310 | -71.5% |
|    500 | Instantiations |   68,524,212 |  595,689 | -99.1% |
|    500 | Memory         |       508 MB |   321 MB | -36.8% |
|    500 | Check time     |      5.542 s |  0.170 s | -96.9% |

The benchmark keeps the old union suites as regression controls, while the
generated client uses the path map. This optimization is not pagination
specific: ordinary `$endpoint()` and `useEndpoint()` calls use the same index.

## Server authoring result

The pagination-specific `defineRouteHandler()` overload was left intact. It
provides immediate editor feedback for the generated query, page response,
duplicate ownership, and handler return. The benchmark does not show it to be
a bottleneck:

| Routes |   Types | Instantiations | Memory | Check time |
| -----: | ------: | -------------: | -----: | ---------: |
|    100 |  49,728 |        148,153 | 232 MB |    0.084 s |
|    500 | 106,104 |        529,753 | 295 MB |    0.161 s |

Removing that overload would trade away local diagnostics without addressing
the measured cost. The remaining large-client scaling is dominated by resolving
many path calls across a large generated route union and the complete Colada
generic integration. It should be profiled separately from pagination before
changing the public contract model.
