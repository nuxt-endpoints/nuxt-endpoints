# HTTP pattern research

Status: cursor pagination implemented on the Nuxt 5 development line; the
remaining patterns are design exploration.

Last reviewed: 2026-09-04.

This directory evaluates established HTTP interaction patterns as reusable
Nuxt Endpoints contracts and invocation strategies. Read
[the design principles](./design-principles.md) first.

The implemented pagination slice also has a reproducible
[type-performance check](./type-performance.md).

## Pattern index

| Pattern                                               | Contract center                                 | Strategy center                               | Priority   | Recommendation                                                    |
| ----------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| [Cursor pagination](./pagination.md)                  | request cursor, response cursor, items          | advance without changing the original filters | **High**   | Implemented vertical slice; core capability plus Colada options   |
| [Problem Details](./problem-details.md)               | status, media type, problem type, extensions    | normally none                                 | **High**   | Small core constructor/schema; use across framework errors        |
| [Idempotent mutation](./idempotency.md)               | `Idempotency-Key`, fingerprint, replay policy   | one key per logical invocation                | **High**   | Keep in core; improve dynamic-mutation adapter                    |
| [Conditional GET](./conditional-get.md)               | `200 + ETag`, optional request validator, `304` | retain validator and previous representation  | **Medium** | Prototype after pagination; initially opt-in                      |
| [Optimistic concurrency](./optimistic-concurrency.md) | strong `ETag`, required `If-Match`, `412`/`428` | carry a read validator into a write           | **Medium** | Optional strategy; server atomicity stays application-owned       |
| [Async operation / polling](./polling.md)             | `202 + Location`, linked monitor operation      | follow, wait, terminate, cancel               | **Medium** | Defer until route relations are proven by pagination              |
| [Rate-limit retry](./rate-limiting.md)                | `429`, optional `Retry-After`, Problem Details  | classify retry and compute delay              | **Medium** | Start as parser/classifier; adapter only with one scheduler owner |

## Common primitives that emerged

The research does not justify one universal strategy type. It does identify a
small set of likely shared implementation pieces:

- typed response-header access associated with a status branch;
- static capability metadata preserved in generated route types;
- build-time validation of endpoint references and field mappings;
- strict parsers for `Retry-After`, entity tags, `Location`, and `Link`;
- abortable delay with a caller-supplied wall-clock deadline;
- same-origin resolution for server-provided URLs by default;
- stable logical-request identity and cycle/attempt limits;
- a typed protocol signal when an external scheduler such as Colada owns retry.

These should be ordinary utilities. Do not expose a common public abstraction
until two shipped strategies need it.

## Responsibility boundary

| Layer                | Owns                                                                                     | Does not own                                    |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Contract             | HTTP fields, status/body/header correlation, endpoint relations, static invariants       | timers, stores, credentials, callbacks          |
| Server conformance   | handler return constraints, constructors, runtime validation, build-time relation checks | pretending TypeScript proves database atomicity |
| Invocation strategy  | protocol state and interpretation for one logical invocation                             | UI reactivity or general query-cache lifetime   |
| Pinia Colada adapter | turning a strategy into query/mutation/infinite-query options                            | parsing or assigning meaning to HTTP fields     |
| Pinia Colada         | cache, SSR hydration, invalidation, optimistic UI, scheduling                            | HTTP protocol semantics                         |

## Nuxt-specific and portable parts

Nuxt/H3-specific edges are contract authoring on `defineRouteHandler`, runtime
access to the H3 event, build-time route discovery, and `$endpoint` generation.
Entity-tag parsing, `Retry-After` parsing, cursor advancement, polling state
machines, deadlines, and same-origin URL policy can be written against web
platform types. Keep those internals free of Nuxt and Vue dependencies while
shipping them inside NE first.

## MVP sequence

1. **Cursor pagination** proves a complete Contract → Strategy → Colada adapter
   slice without new server storage, timers, or response-header hydration.
2. **Problem Details** supplies a consistent error vocabulary used by the
   remaining patterns and is independently small.
3. **Conditional GET** then proves status-aware header state and revalidation;
   that work can support optimistic concurrency afterward.

Idempotency is already an NE vertical slice rather than a future MVP. Polling
should follow only after endpoint relation metadata is validated in the simpler
pagination case. Rate-limit retry should follow only after the project decides
how typed HTTP results become Colada retry signals.

## First proposal: cursor pagination only

The first implementation proposal is the cursor pagination slice described in
[pagination.md](./pagination.md). It is both common and bounded:

- one `pagination` declaration constructs its request and successful response
  contract rather than mapping duplicate `validate` declarations;
- TypeScript verifies that the output cursor can be passed back as input;
- the raw `$endpoint` API remains unchanged;
- the page strategy derives the next request while preserving the original
  filters;
- `infiniteQueryOptions(request)` accepts only requests carrying that
  capability;
- the adapter maps directly to Pinia Colada's existing `useInfiniteQuery`
  vocabulary rather than adding `useEndpointPagination` or `useResource`.

Those pieces are covered by metadata extraction, generated capability typing,
server and raw-client tests, OpenAPI checks, and a real Colada infinite-query
SSR integration test. Do not implement another pattern in the same change.

## Deliberately deferred patterns

Range/resumable transfer, SSE reconnection with `Last-Event-ID`, authentication
challenges, digest/signature verification, and deprecation/sunset headers are
credible future idioms. Misina demonstrates several of them. They are omitted
from the first design set because they introduce streaming, security, or
transport ownership questions that deserve separate research.
