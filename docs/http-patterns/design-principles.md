# HTTP idiom contracts and invocation strategies

Status: design exploration, not a committed public API.

Last reviewed: 2026-09-04.

Nuxt Endpoints treats the HTTP endpoint as the primary primitive. It should not
hide an HTTP exchange behind a server-function protocol, and it should not add
a second vocabulary where HTTP already has one. Its opportunity is to make an
established HTTP interaction safe to implement and safe to invoke.

This direction is broader than typed fetch. A request body type answers “what
can I send?” and a status union answers “what came back?”. An HTTP idiom
contract additionally answers “which sequence of requests and responses makes
this operation correct?”. Examples include carrying one entity tag from a read
into a conditional update, reusing one idempotency key across attempts, or
feeding a response cursor into the next request.

## Three separate layers

### Contract

A contract describes observable HTTP facts:

- method, status, body, and media type;
- required or optional request and response fields;
- the correlation between a status, its body, and its headers;
- relations between operations;
- invariants such as “the output cursor is accepted as the next input cursor”.

Contract metadata must be static and serializable. The Nuxt 5 build extracts it
without evaluating handler code, transports it through Nitro and Nuxt route
metadata, and projects it into generated client types. A database callback,
clock, authorization resolver, fingerprint function, or storage adapter is not
contract metadata; it belongs in runtime configuration or application code.

TypeScript should reject locally provable mistakes. Runtime constructors and
validators should enforce facts that types cannot prove. A build-time relation
validator may check references between route contracts. Business facts, such
as whether an ETag comparison and a database update were atomic, remain the
application's responsibility and must be stated as such.

### Invocation strategy

An invocation strategy interprets one particular contract. It can retain the
minimum protocol state, alter the next request, and turn a multi-exchange HTTP
conversation into a useful result. It is not a transport and it is not a query
cache.

Each idiom should start with its own small strategy. Do not begin with a
universal `InvocationStrategy<TContract, TState, ...>` abstraction. Polling,
conditional requests, retries, and pagination have materially different
termination and state rules. Common primitives should be extracted only after
at least two implementations need the same behavior.

Every strategy needs explicit rules for:

- cancellation and a wall-clock deadline;
- what owns retry or polling scheduling;
- maximum attempts/pages and cycle detection where applicable;
- whether redirects or server-provided URLs may cross origins;
- which state is keyed per logical request;
- what the caller receives on terminal protocol and transport failures.

### Adapter or integration

An adapter presents a strategy to a state manager. Pinia Colada should continue
to receive ordinary promise-producing functions and own cache lifetime,
reactivity, invalidation, SSR serialization, optimistic UI, and scheduling.
Colada must not learn the meaning of `ETag`, `Location`, or
`Idempotency-Key`.

The adapter owns the impedance mismatch. For example, a conditional request
strategy sees `304` and a previous representation, while Colada receives the
same `Promise<T>` it would have received after a `200`. If Colada's retry plugin
owns a delay, the NE strategy must expose a typed retry signal and must not also
sleep and retry internally.

An integration is optional. Problem Details needs no cache adapter. Polling can
be exposed as an imperative task before any reactive integration exists.

## Capability, not operation names

Generated endpoint types should carry small capability markers derived from
the contract. A helper for conditional GET must reject an endpoint that lacks a
successful response with `ETag` and a `304` branch. A safe mutation retry must
reject an unsafe operation unless it has an idempotency contract. A cursor
paginator must know the request cursor, response cursor, and item fields.

These are compile-time constraints over real HTTP fields, not runtime feature
flags. They should not create generated RPC operation names. Path and method
remain the endpoint identity.

## Low level first, paved road second

Every pattern must remain usable through the ordinary status-aware request:

```ts
const result = await $endpoint('/api/resources/:id', {
  method: 'get',
  params: { id },
})

if (result.status === 200) {
  result.body
  result.headers
}
```

The first server API is the existing `defineRouteHandler` contract plus the
smallest metadata necessary to express the idiom. A convenience helper is
justified only when it prevents repeated, error-prone protocol wiring. It must
still emit the same underlying HTTP contract and allow raw access.

## Representation and execution state

HTTP response headers are part of the representation. They cannot be discarded
when a later invocation depends on them. NE currently removes headers from the
values produced by its Colada query projection to keep data serializable.
Conditional requests and optimistic concurrency therefore need an explicit,
serializable sidecar or adapter design; silently hiding an ETag in a
module-global variable would mix users during SSR.

Framework adapters should be explicit imports rather than methods added to the
HTTP request object. For Colada, the intended boundary is:

```ts
import { infiniteQueryOptions, mutationOptions, queryOptions } from '#endpoints/colada'
```

`queryOptions(request)` and `mutationOptions(request)` need only the HTTP method
capability. Pattern-specific adapters such as `infiniteQueryOptions(request)`
must additionally require the corresponding static server contract.

Execution state is different. An idempotency key belongs to one logical
mutation invocation, not to the resource cache. A polling deadline belongs to
one waiter. A rate-limit budget may be shared by an origin and credential
scope. Each strategy document identifies its state scope rather than treating
all state as one generic store.

## HTTP profiles, not invented standards

Some useful patterns are standards; others are profiles built from standard
parts. RFC 9110 defines `202`, `Location`, validators, preconditions, and
`Retry-After`, but it does not require every `202` response to contain a
polling URL. “`202` plus `Location` points to a status monitor” is therefore an
NE contract profile and must be documented as such.

Likewise, the `Idempotency-Key` work remains an expired Internet-Draft as of
this review. NE may implement and document a stable local policy, but must not
call it an RFC. Vendor conventions such as Azure's `Operation-Location` or
Google's body-level `etag` are useful comparisons, not automatically the NE
wire format.

## Where code should live

The initial vertical slices should live inside NE. The HTTP idiom logic should
depend on `Request`, `Response`, `Headers`, `AbortSignal`, and plain data—not on
Vue, Nuxt composables, H3 events, or Pinia Colada. Thin edges may adapt it:

```text
defineRouteHandler / H3 event
        -> contract conformance helper

$endpoint request / ofetch
        -> HTTP invocation strategy
        -> optional Pinia Colada options
```

This preserves an extraction path to a future framework-independent package
without designing that package prematurely. H3 remains the eventual home for
generic single-request contract validation. Nitro and Nuxt remain responsible
for route discovery and metadata transport. NE owns cross-request client
semantics and NE-specific application policy.

## Admission rule for NE core

A pattern belongs in NE core only when all of the following are true:

1. it has a recognizable HTTP wire contract;
2. contract metadata prevents a real implementation or invocation mistake;
3. the strategy adds more than a renamed `$fetch` call;
4. the behavior composes with raw HTTP and does not require Colada;
5. the server and client halves can be tested as a vertical slice.

Otherwise it should be documentation, an optional integration, or deferred.

## Sources shaping this direction

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [TypeSpec HTTP](https://typespec.io/docs/libraries/http/reference/)
- [TypeSpec pagination](https://typespec.io/docs/standard-library/pagination/)
- [Azure TypeSpec long-running operations](https://azure.github.io/typespec-azure/docs/howtos/azure-core/long-running-operations/)
- [Smithy behavior traits](https://smithy.io/2.0/spec/behavior-traits.html)
- [Smithy waiters](https://smithy.io/2.0/additional-specs/waiters.html)
- [OpenAPI 3.1 Link Object](https://spec.openapis.org/oas/v3.1.1.html#link-object)
- [Misina](https://github.com/productdevbook/misina), used as an implementation
  case study rather than a proposed dependency
