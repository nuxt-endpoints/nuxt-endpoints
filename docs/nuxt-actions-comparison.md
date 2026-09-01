# Nuxt Actions Comparison and Adoption Ledger

Status: comparison snapshot for maintainers and contributors.

Last consolidated: 2026-07-17

This document records the verified comparison between Nuxt Endpoints and Nuxt
Actions. It is evidence for roadmap decisions, not a claim that the two modules
belong to the same product category.

## Comparison boundary

Nuxt Endpoints keeps Nuxt `server/api` routes as the source of truth and derives
request validation, handler input types, typed clients, status-specific
responses, and OpenAPI from endpoint contracts next to those routes.

Nuxt Actions is action-centric. It scans actions, generates typed references
through `#actions`, and serves generated routes under `/api/_actions/...`.
It is the closest adjacent module found, but it is not an exact substitute for
the route-contract architecture.

The inspected upstream snapshot was Nuxt Actions `1.3.0` at commit
`deadc47f3d96a11560d533ebca96d2a83588be95`. README claims were checked against
source, playground examples, and tests before being used in this ledger.

## Adoption ledger

| Nuxt Actions capability           | Nuxt Endpoints decision               | Notes                                                                              |
| --------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| Standard Schema input validation  | Already supported                     | Keep schema-library-neutral runtime parsing                                        |
| End-to-end input/output inference | Already supported                     | Generated path-and-method clients are broader than action references               |
| Output validation                 | Already supported                     | Runtime response validation remains optional                                       |
| Typed middleware context          | Adopt in the core roadmap             | H3 event exposure is implemented; evaluate an immutable context builder separately |
| Optimistic updates                | Delegate to TanStack Query            | Provide generated keys and recipes, not a second rollback engine                   |
| SSR queries and cache             | Delegate state to TanStack Query      | Nuxt Endpoints supplies only optional Nuxt integration and a request-aware fetcher |
| Cache invalidation and tags       | Delegate to TanStack Query            | Prefer generated hierarchical keys over a separate tag registry                    |
| Infinite queries                  | Delegate page state to TanStack Query | Provide only a typed pageParam-to-request mapper                                   |
| Prefetching                       | Delegate to TanStack Query            | Standard options should work with `prefetchQuery` and `ensureQueryData`            |
| Retry and backoff                 | Delegate client policy                | Server-side mutation idempotency is a separate concern                             |
| Request deduplication             | Delegate to TanStack Query            | Preserve AbortSignal support in the endpoint request primitive                     |
| Form state and field dirtiness    | Delegate to form libraries            | Typed mutation inputs are the integration boundary                                 |
| Progressive form enhancement      | Defer                                 | Revisit only with a concrete native-form/SSR requirement                           |
| Idempotency-Key replay protection | Adopt as an optional server helper    | Require scoped keys and pluggable durable storage                                  |
| Global lifecycle hooks            | Adopt as narrow integration points    | Prefer operation-aware tracing and metrics; UI toasts remain application code      |
| Typed error codes                 | Covered differently                   | Status-specific response schemas are more precise than a global action-error union |
| OpenAPI generation                | Already supported                     | Preserve plain HTTP status codes and response contracts                            |
| Custom request headers            | Already supported                     | Fetcher injection is still useful for defaults and SSR forwarding                  |
| Streaming/SSE                     | Keep low-level for now                | Native `Response` and `.raw()` are the current escape hatches                      |
| Multipart file uploads            | Candidate for later                   | Design contracts, runtime parsing, client encoding, and OpenAPI together           |
| Auth preset                       | Delegate                              | Use application/Nitro middleware with typed request context                        |
| Rate limiting and CSRF presets    | Delegate                              | Do not make Nuxt Endpoints a security-policy framework                             |
| DevTools endpoint inspector       | Adopt after APIs stabilize            | Show discovered contracts without sensitive payloads                               |
| HMR type updates                  | Already part of generated-client work | Optional adapter templates must share the regeneration path                        |
| CLI action scaffold               | Low priority                          | Revisit after endpoint and adapter APIs stabilize                                  |
| Grouped action namespace          | No immediate need                     | Typed path-and-method endpoint calls provide the main ergonomics                   |

The product-level outcomes are maintained in the
[Nuxt Endpoints roadmap](./roadmap.md). Vue Query usage is documented in the public guide.

## Verified streaming findings

Nuxt Actions has three streaming surfaces:

- [`defineStreamAction`](https://github.com/billymaulana/nuxt-actions/blob/deadc47f3d96a11560d533ebca96d2a83588be95/src/runtime/server/utils/defineStreamAction.ts)
  defines a server-side SSE action and supplies disconnect cancellation;
- `useStreamAction` receives chunks on the client and exposes cancellation and
  timeout behavior;
- `useStreamActionQuery` adds a small cache around the completed chunk array.

Input is inferred from a schema and the implementation exposes a generic chunk
type, but it is not a strict end-to-end typed stream contract:

- the chunk type is not naturally derived from `stream.send(...)`;
- there is no chunk output schema or per-chunk runtime validation;
- the inspected playground manually casts received chunks;
- default cache identity does not necessarily include input without an
  appropriate explicit key;
- SSE `event`, `id`, and `retry` metadata is not modeled as a complete contract.

Nuxt Endpoints already supports raw native streaming:

```ts
const response = await $endpoint('/api/events', {
  method: 'get',
}).raw()

const reader = response.body?.getReader()
```

Conclusion: Nuxt Actions proves demand for streaming ergonomics, but its current
surface is not a reason to rush feature parity. Nuxt Endpoints should wait for
a complete chunk, validation, cancellation, error, protocol, and Effect Stream
design.

## Verified builder findings

Nuxt Actions has the builder that motivated the optional endpoint context
proposal:
[`createActionClient()`](https://github.com/billymaulana/nuxt-actions/blob/deadc47f3d96a11560d533ebca96d2a83588be95/src/runtime/server/utils/createActionClient.ts).

```ts
const authClient = createActionClient().use(authMiddleware).use(rateLimitMiddleware)

export default authClient.schema(inputSchema).action(async ({ input, ctx }) => {
  ctx.user
  ctx.rateLimit
})
```

Conceptually, each `.use()` returns an action client with
`CurrentContext & NewContext`. The builder also supplies:

- `.schema()` for input validation;
- `.outputSchema()` for output validation;
- `.metadata()` for middleware-visible metadata;
- `.idempotency()` for duplicate execution handling;
- `.action()` for the final handler.

Conclusion: compile-time context accumulation is worth learning from. The
action-specific execution chain should not be copied automatically. A Nuxt
Endpoints builder must preserve Nitro/H3 errors, endpoint status responses,
discovery, OpenAPI, generated-client isolation, and standard Nitro middleware
interoperability.

## Overall conclusion

Nuxt Actions is a substantial, feature-rich server-actions framework and the
closest adjacent Nuxt module found. Nuxt Endpoints should adopt selected ideas,
delegate state-management features, and keep several escape hatches, while
preserving its distinct `server/api` contract-first architecture.
