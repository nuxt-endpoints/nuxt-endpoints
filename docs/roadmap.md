# Nuxt Endpoints Roadmap and Design Decisions

Status: maintainer roadmap; proposed items are not public API commitments.

Last consolidated: 2026-08-15

This is the source of truth for product-level implementation priorities and
for recommendations that are not specific to one client adapter. Detailed
adapter and comparison evidence live in focused documents so they can evolve
without hiding the broader roadmap.

## Design document map

| Document                                                        | Responsibility                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| This roadmap                                                    | Cross-feature status, priorities, non-TanStack proposals, delegation decisions, and review questions                           |
| [TanStack Query adapter](./tanstack-query-adapter.md)           | Query/Mutation factories, key design, error modes, SSR integration, test matrix, and the eight adapter decisions               |
| [Nuxt Actions comparison](./nuxt-actions-comparison.md)         | Verified upstream feature comparison and the adopt/delegate/defer ledger                                                       |
| [Idempotency-Key helper](./idempotency.md)                      | Guarantees, state model, storage correctness, security boundary, and delivery sequence                                         |
| [Idempotency storage recipes](./idempotency-storage-recipes.md) | Redis Lua and PostgreSQL row-lock adapters, operational guidance, and production review                                        |
| [Nitro v3 and H3 v2 readiness](./nitro-v3-h3-v2-readiness.md)   | Stable endpoint contract, completed preparation, adapter boundary, remaining risks, and acceptance checklist                   |
| [Type generation and Nuxt 5](./type-generation.md)              | Current contract markers, JSON wire types, `InternalApi` agreement, discovery failure policy, and Nuxt 5 typed-fetch migration |

## Current implementation status

| Area                                                                  | Status                           | Next decision                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint contracts, runtime validation, generated client, and OpenAPI | Implemented                      | Continue stabilization and compatibility work                                                                                                                                                                                                                                                                                                                                                                                                     |
| Contract-file separation for build-time discovery                     | Implemented                      | Discovery statically resolves the handler's contract import and evaluates only the contract module; non-endpoint routes are never evaluated. Standard placement is a sibling `*.endpoint-contract.*` file, excluded from Nitro scanning through the public `ignore` option; the suffix is deliberately fixed (not configurable) because it exists only for that ignore pattern — contracts placed outside route directories need no suffix at all |
| JSON wire response mapping and Nitro `InternalApi` agreement          | Implemented                      | Replace only through a tested Nuxt 5 typed-fetch adapter                                                                                                                                                                                                                                                                                                                                                                                          |
| H3 event in endpoint handler context                                  | Implemented                      | Learn whether application-wide H3 augmentation is sufficient                                                                                                                                                                                                                                                                                                                                                                                      |
| Immutable typed `.use()` endpoint builder                             | Not implemented                  | Add only if endpoint-local context composition solves real application pain                                                                                                                                                                                                                                                                                                                                                                       |
| Shared fresh-request and fetcher extension boundary                   | Implemented                      | `createEndpointRequest`, fetcher injection, and shared key normalization                                                                                                                                                                                                                                                                                                                                                                          |
| TanStack Query adapter                                                | Phases 1-3 implemented           | Initial public decisions confirmed; monitor adoption and compatibility                                                                                                                                                                                                                                                                                                                                                                            |
| Idempotency-Key helper                                                | Implemented                      | Application-owned durable adapters must pass the conformance contract                                                                                                                                                                                                                                                                                                                                                                             |
| Idempotency central runtime policy                                    | Implemented                      | `server/endpoints/idempotency.ts` supplies storage/scope/authorization defaults; endpoints keep contract metadata and overrides                                                                                                                                                                                                                                                                                                                   |
| Operation-aware observability                                         | Proposed, later                  | Stabilize operation metadata and hook boundaries                                                                                                                                                                                                                                                                                                                                                                                                  |
| Nuxt DevTools endpoint inspector                                      | Proposed after API stabilization | Avoid duplicating Query cache DevTools                                                                                                                                                                                                                                                                                                                                                                                                            |
| Multipart request contracts                                           | Candidate for later              | Design runtime parsing, client serialization, and OpenAPI together                                                                                                                                                                                                                                                                                                                                                                                |
| Catch-all route contracts                                             | Designed but deferred            | Build-time rejection shipped instead. Full support needs two recorded decisions: client value shape and slash encoding for `**:param`, and the GitHub-style `{param}` OpenAPI representation despite single-segment path templating in the spec. Implement when real demand appears                                                                                                                                                               |
| Optional path-parameter contracts                                     | Rejected                         | OpenAPI has no honest representation for optional path parameters; declare two routes instead. Build-time rejection shipped                                                                                                                                                                                                                                                                                                                       |
| First-class typed streaming/SSE                                       | Deferred                         | Require a complete chunk, cancellation, and error contract                                                                                                                                                                                                                                                                                                                                                                                        |
| Low-level files, streams, redirects, and proxies                      | Available                        | Keep native HTTP escape hatches documented                                                                                                                                                                                                                                                                                                                                                                                                        |

The H3 event change is covered by runtime and type tests and is now part of the
core endpoint handler context.

## Decision principles

- Keep Nuxt `server/api` endpoint contracts as the source of truth.
- Preserve plain HTTP, status-specific response contracts, and OpenAPI output.
- Add extension boundaries that can support multiple consumers instead of
  embedding one state-management library into the endpoint core.
- Reuse Nitro and H3 middleware semantics before creating a second middleware
  ecosystem.
- Delegate cache algorithms, form state, and application security policy to
  the ecosystems that already own them.
- Add convenience APIs only when they preserve the contract model and can be
  tested at both the runtime and type levels.
- Keep low-level native HTTP escape hatches when a first-class contract would
  be incomplete or misleading.

## Roadmap summary

| Capability                                  | Decision                           | Priority                                               |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| H3 event in handler context                 | Adopted and implemented            | Complete                                               |
| Typed endpoint context builder              | Conditional adoption               | After real Level 1 usage feedback                      |
| Shared client extension primitives          | Adopt                              | Foundation work                                        |
| TanStack Query integration                  | Adopted and implemented            | Stabilization and compatibility                        |
| Idempotency-Key replay protection           | Adopted and implemented            | Complete for the initial application-owned storage API |
| Operation-aware tracing, metrics, and hooks | Adopt as narrow integration points | After operation metadata stabilizes                    |
| DevTools endpoint inspector                 | Adopt                              | After public APIs stabilize                            |
| Multipart request contracts                 | Revisit                            | Later                                                  |
| Typed streaming/SSE                         | Keep low-level for now             | Last, after a complete design                          |
| Progressive form enhancement                | Defer                              | Only with a concrete native-form requirement           |
| Auth preset                                 | Delegate                           | Application/Nitro middleware ecosystem                 |
| Rate limiting and CSRF presets              | Delegate                           | Nitro/server middleware ecosystem                      |
| Form field state and dirtiness              | Delegate                           | TanStack Form, VeeValidate, or application code        |
| CLI endpoint scaffold                       | Low priority                       | After endpoint and adapter APIs stabilize              |
| Grouped action-style namespace              | No immediate need                  | Named operations cover the main ergonomics             |

## Shared client extension track

The following primitives are useful beyond TanStack Query and should be
designed as shared client infrastructure:

- typed fetcher injection for authentication, base URL, tracing, metrics,
  tests, and mocks;
- a fresh, AbortSignal-aware request boundary without exposing the whole
  internal runtime object;
- generated operation-to-request-options types;
- one deterministic request-key normalization implementation;
- documented SSR cookie and authorization forwarding behavior;
- a stable extension API for optional clients such as Effect and TanStack
  Query.

The TanStack adapter is the first concrete consumer and therefore contains the
current detailed requirements. The shared boundary must not be named or shaped
so narrowly that Effect, testing, tracing, or future adapters need to bypass it.

## Typed server middleware context

Typed server context is independent of TanStack Query. It supports request
authentication, tenant resolution, database transactions, request IDs,
permissions, and tracing inside endpoint handlers.

### Level 1: expose the H3 event

Status: implemented.

`EndpointContext` now exposes the original `H3Event`, so standard Nitro
middleware can attach values to `event.context` and endpoint handlers can read
the same request-scoped object.

```ts
// server/middleware/auth.ts
export default defineEventHandler(async (event) => {
  event.context.user = await getCurrentUser(event)
})
```

```ts
export default defineEndpointHandler(endpoint, ({ event, params }) => {
  return findUserForAccount(event.context.user.accountId, params.id)
})
```

TypeScript does not infer the assignment by inspecting middleware code. The
application supplies the static type through normal H3 module augmentation:

```ts
// types/h3.d.ts
declare module 'h3' {
  interface H3EventContext {
    user: User
  }
}

export {}
```

The runtime value comes from Nitro middleware; the application-wide static
type comes from `H3EventContext` augmentation. The public guide documents this
in [Request event and middleware context](../site/content/docs/endpoints.md).

### Level 2: optional typed context builder

Recommendation: defer until Level 1 proves insufficient.

An immutable builder could accumulate middleware return types for a specific
endpoint family without application-wide augmentation:

```ts
const authenticatedEndpoint = createEndpointBuilder()
  .use(authMiddleware) // adds { user: User }
  .use(tenantMiddleware) // adds { tenant: Tenant }

export const endpoint = authenticatedEndpoint.define({
  operation: 'getProject',
  params: ProjectParams,
  response: Project,
})

export default endpoint.handler(({ params, ctx }) => {
  return findProject(ctx.tenant.id, params.id)
})
```

Requirements:

- every `.use()` returns a new immutable builder;
- context types accumulate as an intersection in declaration order;
- middleware sees the H3 event and only previously accumulated context;
- runtime execution matches the inferred type order;
- H3 errors and endpoint status responses preserve normal Nitro semantics;
- middleware cannot execute the downstream handler twice;
- discovery and OpenAPI depend on the endpoint definition, not middleware
  implementation details;
- middleware code never enters generated client types or browser bundles;
- standard Nitro middleware remains supported and interoperable;
- request context remains isolated between concurrent requests.

| Level 1: H3 event context | Level 2: typed endpoint builder     |
| ------------------------- | ----------------------------------- |
| `event.context.user`      | `ctx.user`                          |
| Application-wide type     | Endpoint-family-specific type       |
| H3 module augmentation    | Middleware return-type inference    |
| Standard Nitro middleware | Endpoint-specific composition chain |
| Small and implemented     | More precise but not implemented    |

The builder becomes materially useful when public, authenticated, and admin
endpoint groups have different context; middleware is distributed as a
package; omitting authentication should fail compilation; or context must
accumulate in stages such as `user -> tenant -> permissions`.

Required tests before publication:

- handlers see all fields added by preceding middleware;
- middleware sees only fields accumulated before it;
- missing fields fail compilation;
- blocked or failed middleware does not execute the handler;
- runtime order matches type accumulation order;
- context is isolated between concurrent requests;
- middleware implementation is absent from generated client output;
- ordinary `event.context` remains accessible.

## Idempotency-Key replay protection

The detailed design and conformance requirements live in
[Idempotency-Key Server Helper Design](./idempotency.md).

Mutation retry and server-side replay protection are different concerns. A
timed-out write may need a stable `Idempotency-Key` so a retry does not perform
the operation twice.

Adopted and implemented as an optional endpoint helper with an explicit
storage contract. The client does not hide a replay cache, and the
development-only memory adapter is not presented as production-safe.

Implemented design points:

- configurable header name and TTL;
- pluggable durable storage;
- request fingerprinting to reject key reuse with different input;
- explicit user or tenant scope;
- defined behavior for in-flight, successful, failed, and expired operations;
- endpoint metadata or OpenAPI documentation where useful;
- concurrency tests across duplicate requests and multiple server instances.

Deliberate first-version omissions, recorded in the design document and
collected here so their triggers stay discoverable. None is scheduled; all are
demand- or externally-driven:

- Strict IETF Structured Fields key syntax — revisit if the expired draft
  advances or ecosystem behavior converges (design doc, header syntax note).
- Lease heartbeat/cancellation — only if post-expiry handler overlap becomes a
  real operational problem for long-running handlers.
- Waiting/polling on in-flight requests instead of an immediate `409` — only
  on real retry-UX demand.
- Merging helper-generated `400`/`409`/`422` problems into the typed
  `.result()` union — on demand for typed handling of those failures.

The first two would rework the claim/complete execution path inside
`DefinedEndpoint.handler()`; that is the moment to also extract that path into
its own module (see Deferred internal refactorings).

## Operation-aware observability

Named operations provide stable labels for tracing and metrics. Shared
infrastructure should expose operation name, route, method, duration, result
status, and transport failure without forcing every application to wrap
`$endpoint` manually.

Candidate integration points:

- typed fetcher interceptors on the client;
- narrow Nuxt request/success/error/settled hooks;
- server timing and tracing around validation and handler execution;
- Effect annotations using the same operation metadata.

Request bodies, response bodies, authorization headers, and cookies must not be
emitted by default. UI toasts and user-facing messages are application concerns,
not observability.

## Nuxt DevTools endpoint inspector

Recommendation: implement only after endpoint and adapter APIs stabilize.

A future tab could show:

- discovered path, method, and operation name;
- request and response contract summaries;
- runtime response-validation status;
- generated client features and enabled adapters;
- OpenAPI document links;
- discovery and operation-name collision diagnostics.

It must not expose sensitive payloads or duplicate TanStack Query Devtools'
cache inspector.

## Multipart and typed streams

Multipart upload support affects request types, runtime parsing, client
serialization, OpenAPI media types, and encoding metadata together. Avoid a
convenience-only `FormData` wrapper that cannot be represented accurately in
the endpoint contract.

Typed streaming and SSE should remain raw HTTP until a design preserves:

- chunk schemas and end-to-end chunk inference;
- optional per-chunk runtime validation;
- cancellation and disconnect AbortSignal behavior;
- SSE `event`, `id`, and `retry` metadata;
- typed error events;
- EventSource versus POST streaming semantics;
- non-JSON payloads and SSR limitations;
- native `Response` escape hatches;
- Effect Stream integration where its model differs from browser streams.

Current public guidance remains [Low-level HTTP](../site/content/docs/low-level-http.md).

## Delegated and deliberately omitted features

- Cache storage, stale policy, retry, request deduplication, optimistic rollback,
  polling, offline persistence, and infinite-page state belong to TanStack
  Query when that adapter is used.
- Form fields, dirtiness, touched state, and client validation belong to form
  libraries or application code.
- Authentication presets, rate limiting, and CSRF policy belong to application
  and Nitro middleware ecosystems. Typed request context should make those
  integrations ergonomic without turning Nuxt Endpoints into a security-policy
  framework.
- Status-specific endpoint response schemas remain more precise than one global
  action-error code union. Any convenience error API must preserve HTTP status
  semantics.
- Grouped action namespaces are not currently justified because named endpoint
  operations and explicit generated helpers provide the useful ergonomics.

## Deferred internal refactorings

Recorded so the "why not" survives; none of these block current work.

- Extracting the idempotency execution path (~150 lines) out of
  `DefinedEndpoint.handler()` requires reworking the late-injection closures
  (`routeIdentity`, `idempotencyPolicy`). Do it together with the next
  substantial idempotency change, not on its own.
- Splitting `runtime/client.ts` into type and implementation files adds imports
  without adding testability: the boundary is already clear inside the file and
  the type surface has a dedicated `.test-d.ts` suite.
- The landing page's pitch copy lives inside `site/app/pages/index.vue`;
  extracting it into data modules and card components is worthwhile only once
  marketing copy churn becomes frequent.

## Overall delivery priority

1. Stabilize the current Nuxt 4/Nitro 2 contract, wire response, discovery, and
   package release surface.
2. Track the Nuxt 5 typed-fetch and public route-metadata extension APIs; add a
   compatibility adapter only against released, testable versions.
3. Evaluate the endpoint context builder only after learning from real H3 event
   usage.
4. Add operation-aware observability after operation metadata boundaries
   stabilize.
5. Add advanced adapter ergonomics and DevTools only after the public API is
   stable.
6. Implement first-class multipart or typed streams only after concrete demand
   and a complete transport contract exist.

```text
Nuxt 4 / Nitro 2 contract stability
-> Nuxt 5 typed-fetch and route-metadata adapter
-> optional typed context builder
-> operation-aware observability
-> advanced adapter ergonomics
-> DevTools and scaffolding
-> multipart and typed streams
```

## Independent review brief

Reviewers should answer:

1. Does Level 1 H3 context cover enough applications to defer a builder?
2. Can a future builder remain fully interoperable with Nitro/H3?
3. Is idempotency scoped narrowly enough, and is durable storage mandatory?
4. Are the proposed observability fields useful without leaking payloads or
   credentials?
5. Does the DevTools proposal avoid duplicating existing tools?
6. Is typed streaming correctly deferred until all chunk, cancellation, error,
   and protocol semantics are designed together?
7. Which proposed item blocks current adoption, and which can remain a
   backward-compatible later extension?

Adapter-specific reviewers should separately evaluate the eight decisions in
the [TanStack Query adapter document](./tanstack-query-adapter.md).
