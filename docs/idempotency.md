# Idempotency-Key Server Helper Design

Status: implemented; production durability remains application-owned.

Last consolidated: 2026-08-15

This document defines the guarantees, ownership boundary, and state model for
optional `Idempotency-Key` replay protection in Nuxt Endpoints. The public API,
storage types, and implementation must preserve these semantics.

The latest IETF work on the header is
[`draft-ietf-httpapi-idempotency-key-header-07`](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/07/).
As of this consolidation it is an expired Internet-Draft, not an RFC. It is
useful interoperability guidance, but this project must not present it as a
finished standard.

The draft defines its wire value as an RFC 8941 Structured Field String. This
initial implementation instead uses the widely deployed opaque raw-header form:
one non-empty value of at most 255 characters, with commas and control
characters rejected. Generated clients send that raw value. This is an explicit
interoperability decision rather than full draft syntax compliance; revisit it
if the draft advances or ecosystem behavior converges. A future strict mode
should delegate parsing and serialization to a tested Structured Fields
implementation rather than adding another hand-written parser.

## Start with domain idempotency

An application should prefer a natural domain key and a database uniqueness
constraint when the operation already has one. For example, a client-generated
resource ID can make a create operation safe without a replay layer:

```text
POST { id: client-generated-uuid, ... } -> 201
retry with the same id                   -> 409 or an application lookup
```

That solution is smaller, remains correct without a replay cache, and keeps the
business invariant in the database that owns it. `Idempotency-Key` is useful
when the operation has no natural unique key, when the original response must
be replayed, or when retries need to coordinate through a shared claim.

Typical candidates include additive operations such as granting points,
posting comments, incrementing counters, or submitting a multi-step command.
It can also coordinate retries around an external API call, but it cannot make
that external side effect atomic with the local replay record.

## Guarantee and non-goals

With a correct durable storage implementation, the helper guarantees:

- at most one active lease for the same endpoint, trusted scope, and client key;
- rejection when the same client key is reused with different request input;
- replay of a completed handler response while its record remains valid;
- fencing so an expired older lease cannot overwrite a newer execution;
- the same behavior across multiple server instances sharing the same storage.

One active lease does not mean one active handler forever. After a lease
expires, its older handler can still be running while a new owner begins. The
first version has no heartbeat or cancellation mechanism, and fencing protects
only the replay record from stale completion. Applications must size the lease
for the maximum expected handler duration and independently fence external
effects when overlap would be unsafe.

The helper does not guarantee exactly-once effects. A process can complete an
external effect and crash before recording the response. A retry can then run
the effect again. Applications must use the downstream service's own
idempotency key, a transactional outbox, or consumer-side deduplication when
that boundary matters.

The first implementation also does not attempt to own:

- database uniqueness rules or application conflict semantics;
- distributed transactions, sagas, or job delivery guarantees;
- automatic retries in the generated client;
- streams, file responses, redirects, or arbitrary native `Response` replay;
- storage-specific Redis, SQL, or cloud-service dependencies in the core package.

## Ownership boundary

Nuxt Endpoints owns the error-prone orchestration:

- reading and validating the configured request header;
- composing endpoint identity, trusted application scope, and client key;
- canonical request fingerprinting;
- interpreting atomic claim results;
- in-flight, conflict, completion, release, and expiry transitions;
- safe response recording and replay;
- generated client typing and OpenAPI metadata;
- conformance tests and a development-only memory storage.

The application owns:

- the durable storage implementation and its infrastructure lifecycle;
- the trusted user, tenant, or public scope resolver;
- key retention periods appropriate for the business operation;
- external-side-effect safety beyond the replay record;
- operational monitoring, capacity, and cleanup of durable records.

Redis and relational-database implementations are documentation recipes. They
demonstrate the atomic storage contract in
[Idempotency Storage Recipes](./idempotency-storage-recipes.md) without adding
those clients as runtime dependencies.

Generic Nitro caching, unstorage drivers, and distributed locks are not used as
the storage contract. Their common APIs do not jointly provide atomic claim,
fingerprint conflict detection, response replay, storage-clock lease expiry,
and stale-completion fencing. Existing idempotency packages can be adapted only
if their storage transition passes the same conformance suite; an HTTP
middleware wrapper cannot replace the endpoint-specific authorization,
validated-input fingerprint, generated client, or OpenAPI integration.

## Request identity

The storage lookup identity is a composite value:

```text
endpoint identity + trusted scope + client idempotency key
```

Endpoint identity uses the actual HTTP method and normalized route identity,
not only an optional operation name. This prevents two endpoints from sharing a
record accidentally. The Nuxt module must inject this route template and method
into the runtime handler whenever idempotency is enabled, independently of
whether OpenAPI generation is enabled. The raw request URL is not a substitute
because path parameter values already belong in the fingerprint.

Scope must come from trusted server context, normally an authenticated user or
tenant attached to `event.context` by Nitro middleware. The raw client must not
be allowed to select another user's scope. Anonymous or globally shared scope
must be an explicit application choice rather than a library default.

The same lookup identity always carries a fingerprint of the validated request.
The default projection is shown below. Method and route are already part of
the storage lookup identity, so they do not need to be duplicated inside the
fingerprint digest:

```text
canonical({ params, query, body, selectedHeaders }) -> SHA-256
```

Canonicalization sorts object keys recursively while preserving array order.
Authentication headers, cookies, tracing headers, and `Idempotency-Key` itself
are excluded by default. Endpoint policy provides an explicit fingerprint
projection for declared headers or other validated inputs that affect behavior,
such as currency or API version. An idempotent endpoint that reads undeclared
headers, cookies, or arbitrary event state which can change its result is not
supported unless that input is projected explicitly. Secrets must not enter the
stored projection.

Using validated input means semantically equivalent coercions, such as path
parameter `"123"` and parsed number `123`, produce the same fingerprint. Schema
transforms used for request validation therefore need to be deterministic.

The fingerprint is private to Nuxt Endpoints servers and is not exchanged with
clients or other languages. The small canonicalizer therefore preserves normal
JSON serialization behavior while rejecting unsupported values instead of
adding an [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) runtime
dependency. If fingerprints ever become a cross-language protocol, replace this
private format with a versioned standard canonicalization implementation and
migration plan.

## State model

Storage records have two durable states:

```text
absent
  | atomic claim
  v
in-flight { fingerprint, lease, leaseExpiresAt }
  | complete with matching lease
  v
completed { fingerprint, response, replayExpiresAt }
```

The library interprets an atomic claim as one of four outcomes:

- `acquired`: this request owns a new lease and may execute the handler;
- `in-flight`: the same fingerprint is currently executing;
- `completed`: the same fingerprint already completed and its response is returned;
- `conflict`: the lookup identity exists with a different fingerprint.

An `in-flight` record whose lease expired behaves as absent for a new atomic
claim. The new owner receives a new opaque lease. Completion requires that
lease, so the older execution cannot overwrite the newer record. Both handlers
can nevertheless overlap after expiry; storage fencing cannot stop the older
handler's application or external side effects.

Lease expiry is authoritative even when no newer claim has replaced the record.
After the storage clock reaches `leaseExpiresAt`, `complete` and `release` from
that lease return `lease-lost`. Adapters may delete the record eagerly or treat
it as absent lazily, but cannot allow expired completion.

A completed record whose replay TTL expired behaves as absent and may be
claimed again. Expiry policy must be documented by the application.

## HTTP behavior

The default header name is `Idempotency-Key`, with an option to override it for
an existing API. Header matching is case-insensitive. The implementation must
reject empty values, control characters, multiple values, and values longer
than its documented limit before using them in storage.

Endpoint policy chooses whether the header is optional or required:

- optional and absent: bypass the helper and execute normally;
- required and absent, or any present but malformed key: return `400 Bad Request`;
- same key and different fingerprint: return `422 Unprocessable Content`;
- same key and same fingerprint still in flight: return `409 Conflict`;
- same key and completed fingerprint: replay the recorded response.

The `400`, `422`, and `409` choices follow the expired IETF draft's current
guidance. They remain explicit project behavior even if that draft later
changes.

The first version does not wait or poll for an in-flight request. Returning a
conflict keeps request lifetimes bounded and avoids process-local coordination.

These helper-generated statuses use a stable Problem Details body with
`application/problem+json`. Like request-validation failures, they happen
before the application handler and are not added to the endpoint's declared
response union. OpenAPI adds the problem media type alongside any application
response already declared for the same status, without replacing it.

## Public API decision

Three declaration shapes were considered.

### A. Add idempotency to `defineEndpoint` runtime options

```ts
defineEndpoint(definition, {
  idempotency: { storage, scope },
})
```

This resembles the existing response-validation option, but the generated
client and OpenAPI need a type-level marker on the endpoint definition. Keeping
the marker only in runtime options makes build-time discovery reconstruct state
from a separate object, while exposing the whole runtime option would leak
server-only storage callbacks into generated types.

### B. Put the full configuration in the endpoint definition

```ts
defineEndpoint({
  ...definition,
  idempotency: { storage, scope },
})
```

This is easy for discovery, but mixes infrastructure functions into the HTTP
contract. The endpoint definition is imported during build and referenced by
generated client types, so storage wiring should not become part of that
surface.

### C. Add an immutable endpoint method

```ts
export const endpoint = defineEndpoint({
  operation: 'grantPoints',
  body: GrantPointsBody,
  responses: {
    201: GrantPointsResult,
  },
}).idempotency({
  storage: ({ event }) => event.context.idempotencyStorage,
  scope: ({ event }) => event.context.tenant.id,
  authorization: ({ event }) => requirePermission(event, 'points:grant'),
  fingerprint: ({ params, query, body, headers }) => ({
    params,
    query,
    body,
    currency: headers?.['x-currency'],
  }),
  required: true,
  leaseTtlMs: 60_000,
  replayTtlMs: 86_400_000,
  replayStatuses: [201],
})
```

Decision: adopt C. `DefinedEndpoint.idempotency()` returns a new endpoint and
does not mutate the original. The returned definition gains only serializable,
client-safe metadata:

```ts
type EndpointIdempotencyMetadata<HeaderName extends string, Required extends boolean> = {
  enabled: true
  headerName: HeaderName
  required: Required
}
```

The method return type preserves the configured string and boolean literals;
omitting `required` normalizes its metadata type to `false` rather than
`boolean`. This is what lets generated calls distinguish required and optional
keys.

The storage resolver, scope resolver, authorization policy, fingerprint
projection, TTLs, and replay-status policy stay in private server runtime
options. This gives discovery enough information for generated client and
OpenAPI output without exposing infrastructure callbacks.

The metadata is method-generated and cannot be supplied directly to
`defineEndpoint()`. Build and server startup also verify that metadata has a
matching private runtime policy, so untyped JavaScript cannot make generated
clients/OpenAPI claim idempotency while leaving the handler unprotected.

The callback context contains the already validated `event`, `params`, `query`,
`headers`, and `body`. Execution order is fixed:

```text
request validation
-> authorization policy
-> storage resolution
-> scope resolution
-> fingerprint projection
-> storage claim/replay
-> handler only when acquired
```

Storage resolution must return an existing application-owned adapter; it must
not open a connection per request. Applications can share one policy object or
resolver across endpoints, while every endpoint remains explicitly opted in.

Defaults:

- `headerName`: `Idempotency-Key`;
- `required`: `false`;
- `leaseTtlMs`: `60_000`;
- `replayTtlMs`: `86_400_000`;
- `replayStatuses`: every successful `2xx` result returned by the handler;
- `fingerprint`: validated params, query, and body with no headers/event state.

`authorization` has no implicit default. Every idempotent endpoint must either
supply a callback that runs on every request, including replay, or explicitly
set `authorization: 'middleware'` to assert that Nitro middleware already made
the full authorization decision. Authentication alone is not that assertion.

When behavior depends on headers or other request state, `fingerprint` becomes
an application requirement.

The generated client accepts `idempotencyKey` outside the ordinary `headers`
schema and maps it to the configured header. It is required in the client type
when endpoint metadata says `required: true`, otherwise optional. The client
never generates a key automatically because a retry must reuse the caller's
same key rather than create one per HTTP attempt.

Every generated runtime route, including the query adapter's route tables,
carries `{ headerName, required }`. Declaring the configured header again in the
ordinary endpoint `headers` schema is a case-insensitive discovery error; doing
so would otherwise create two incompatible client inputs for one wire header.
For an idempotent endpoint, a `headers` validator must therefore expose a
JSON-Schema-convertible object with inspectable fixed properties; opaque
Standard Schema validators are rejected because collision safety cannot be
proved.
The client also throws before sending if an untyped caller supplies both
`idempotencyKey` and the configured header inside `headers`.

TanStack Query and Infinite Query include `idempotencyKey` in their request key
segment. This both preserves required keys when a getter request is reconstructed
from its query key and prevents two different idempotent attempts from sharing
one exact cache entry.

When `required` is `true`, generated client options require `idempotencyKey`.
When it is `false`, the field is optional; if the endpoint has no other required
request input, the entire options argument remains optional.

The automatic Problem Details response has this stable shape:

```ts
type IdempotencyProblem = {
  type: 'about:blank'
  title: string
  status: 400 | 409 | 422
  detail: string
  code:
    | 'IDEMPOTENCY_KEY_REQUIRED'
    | 'IDEMPOTENCY_KEY_INVALID'
    | 'IDEMPOTENCY_REQUEST_IN_FLIGHT'
    | 'IDEMPOTENCY_KEY_REUSED'
    | 'IDEMPOTENCY_LEASE_LOST'
}
```

Because these problems use `type: 'about:blank'`, `title` is the standard HTTP
status phrase (`Bad Request`, `Conflict`, or `Unprocessable Content`). The
stable `code` and `detail` distinguish the idempotency-specific condition.

The helper's `400`, `409`, and `422` failures are framework-managed request
failures, like schema-validation `400` responses. They are deliberately not
merged into the declared `.result()` union in the first version. OpenAPI lists
their `application/problem+json` representation while preserving any declared
application response with the same status and a different media type.

### Central runtime policy

Decision (2026-08-15): the runtime options of `.idempotency()` are optional and
resolve per item as endpoint override → central policy → library default.

The original shape required `storage`, `scope`, and `authorization` on every
endpoint. Those are application-wide in practice, and repeating them per route
multiplies opportunities for security-relevant mistakes such as a mistyped
scope resolver. It also pulled infrastructure references into contract-defining
modules, which conflicts with build-time discovery evaluating those modules
(see the contract-file separation decision in type-generation.md).

The central policy is a convention file, `server/endpoints/idempotency.ts`,
default-exporting `defineIdempotencyPolicy({ storage, scope, authorization,
leaseTtlMs?, replayTtlMs? })`. The path can be overridden through the module
option `endpoints.idempotency.policy`. The file is Nitro runtime code: it is
bundled into the server and never evaluated by build-time discovery, so it can
create real storage connections. `nuxt.config.ts` was rejected as the policy
location because module options reach the runtime only through JSON
serialization and cannot carry functions or closures; this matches the Nuxt
convention split used by `app/router.options.ts`.

Layering is deliberate:

- Contract-side metadata stays endpoint-only: `headerName`, `required`,
  `replayStatuses`, and `fingerprint` affect generated client types, OpenAPI,
  or route-specific behavior. The policy cannot set them.
- Runtime wiring is policy-defaulted and endpoint-overridable: `storage`,
  `scope`, `authorization`, `leaseTtlMs`, `replayTtlMs`. Authorization remains
  required at the policy level, so "no implicit authorization default" is
  preserved — the explicitness moves to exactly one reviewed place, and
  route-specific permission checks stay available as endpoint overrides.

The "metadata implies a matching runtime policy" guarantee is preserved but
relocated. The `__idempotency_runtime_marker__` property records which runtime options
the endpoint provided. Build-time discovery fails when an endpoint has gaps and
no policy file exists (the policy file's contents are not inspected at build
time because it is never evaluated there). Nitro startup verifies the merged
configuration and fails when `storage`, `scope`, or `authorization` is still
missing, or when the policy file does not default-export a valid policy.
Supplying idempotency metadata directly to `defineEndpoint()` remains
rejected for the same reasons as before.

Deferred extensions, recorded as open questions: an application-wide
`headerName` default (conflicts with literal-type inference from the method),
a policy-level `fingerprint` default (invites implicit global behavior), and
multiple named policies (endpoint-level overrides cover the known cases).

## Runtime route metadata

The always-installed Nuxt Endpoints server plugin resolves endpoint handlers at
Nitro startup and attaches `{ method, routeTemplate }` to the event-handler
closure returned by `DefinedEndpoint.handler()`, not to the reusable endpoint
definition. This attachment runs even when OpenAPI is disabled. If the same
handler function is registered for two route identities, startup fails instead
of overwriting metadata. Two handlers independently created from one endpoint
definition remain valid because each has its own closure.

Runtime execution refuses an idempotent request if metadata is missing rather
than falling back to the raw URL and silently changing storage identity. During
build-time discovery, the module that defines each endpoint contract must be
evaluated successfully — the route module for co-located contracts, or only
the imported contract module when the route uses a separate contract file. If
Jiti evaluation fails, or evaluated exports do not expose endpoint metadata,
the module reports a build error because callbacks and metadata cannot be
reconstructed safely from source text. Contract-defining modules may import
resolver functions but must not create storage clients or connections at top
level; with a central policy, contract-side `.idempotency()` arguments are
fully serializable and this constraint becomes easy to satisfy.

## Completion and failure policy

A handler completion is recordable when Nuxt Endpoints can represent it as a
JSON endpoint response:

- a direct handler return is recorded as status `200` and its body;
- a declared `respond(status, body, options)` return records its status, body,
  and replay-safe response headers.

The default policy records successful `2xx` responses only. Endpoint policy can
opt specific additional declared statuses into replay. Helper-generated
idempotency errors, authentication/authorization errors, rate limits, and
transient `5xx` responses are never recorded.

Sensitive and hop-by-hop headers, including `set-cookie`, `authorization`,
`connection`, `transfer-encoding`, and content-length computed by the server,
must never be stored. The implementation should begin with a small allowlist or
declared response headers rather than a permissive blocklist.

If the handler throws, response validation fails, or response recording fails,
the library releases the matching lease instead of storing the failure. The
next retry may execute again. This policy does not imply that the handler had no
side effects before it failed; applications must design those effects accordingly.

If the handler returns after its lease has expired, storage rejects completion
and the helper returns `409` with `IDEMPOTENCY_LEASE_LOST` instead of reporting
an unrecorded success as safely replayable. The handler may already have
produced side effects, so this response is an explicit indeterminate outcome.

## Storage correctness requirements

The core package exposes this storage boundary:

```ts
interface IdempotencyStorage {
  claim(input: {
    storageKey: string
    fingerprint: string
    lease: string
    leaseTtlMs: number
  }): Promise<
    | { outcome: 'acquired' }
    | { outcome: 'in-flight'; retryAfterMs?: number }
    | { outcome: 'completed'; response: IdempotencyStoredResponse }
    | { outcome: 'conflict' }
  >

  complete(input: {
    storageKey: string
    fingerprint: string
    lease: string
    response: IdempotencyStoredResponse
    replayTtlMs: number
  }): Promise<{ outcome: 'applied' } | { outcome: 'lease-lost' }>

  release(input: {
    storageKey: string
    fingerprint: string
    lease: string
  }): Promise<{ outcome: 'applied' } | { outcome: 'lease-lost' }>
}
```

The library generates opaque digests and leases. Storage owns its clock, so a
Redis or database adapter can evaluate expiry atomically using server time
instead of trusting application-instance clocks.

`IdempotencyStoredResponse.hasBody` distinguishes a JSON body from an empty
endpoint response. When it is `true`, `serializedBody` is JSON text produced by
the core after response validation. When it is `false`, `serializedBody` is the
empty string. Storage adapters persist both fields without parsing or
re-encoding them, so Redis and database implementations replay the same HTTP
representation. Values that cannot be serialized as JSON are not recordable
and follow the failure/release path.

`leaseTtlMs` and `replayTtlMs` are validated by the core as finite positive
integer milliseconds no greater than `2_147_483_647`. `retryAfterMs`, when
returned, is a non-negative integer remaining duration computed from the
storage's clock.

A production storage implementation must:

- make claim and expired-record replacement atomic;
- compare fingerprints within the same atomic decision;
- return `acquired` when an in-flight record matches the same fingerprint and
  caller-proposed lease, making an uncertain claim retry idempotent;
- return the completed response from the claim decision or an equally
  consistent read;
- require the opaque lease when completing or releasing an in-flight record;
- reject completion and release after that lease's storage-clock expiry even
  when it has not yet been replaced;
- prevent a stale lease from mutating a newer record;
- preserve status, body presence, serialized body, replay-safe headers, and
  expiry without lossy encoding;
- make records visible to every application instance before reporting success.

A naive `get` followed by `insert` is not conforming because two instances can
both observe absence and run the handler. Recipes must use a Redis script or
transactional SQL operation with a unique key and locking/compare-and-swap.

## Security and privacy

The composite lookup key prevents one tenant's client key from directly
addressing another tenant's replay record. Implementations should hash the
composite key before using it as a physical storage key so untrusted strings do
not become SQL fragments, Redis namespaces, log labels, or metrics dimensions.

Idempotency keys and request fingerprints must not be treated as authentication.
Authentication and any authorization that protects replayed data must run for
every request before the storage lookup. Applications can satisfy this with
Nitro middleware or an idempotency policy authorization hook that is always
executed before claim/replay. Authorization performed only inside the wrapped
handler is unsupported because a completed replay skips that handler. The scope
resolver uses only trusted server state and should incorporate an authorization
version when permission changes must invalidate older replay records.
Stored response bodies can contain sensitive data, so durable adapters need the
same encryption, retention, access-control, and backup treatment as the source
data.

## Required conformance scenarios

Before a durable adapter is used in production, its tests must cover:

- first claim, completion, and replay;
- two concurrent claims from separate helper instances;
- same key with different fingerprint while in-flight and after completion;
- lease expiry followed by a new claim and rejected stale completion;
- replay expiry followed by a new claim;
- optional and required missing-key behavior;
- invalid and oversized keys;
- trusted scope isolation;
- authorization running again before completed replay;
- deterministic fingerprints across object key order;
- array-order differences producing different fingerprints;
- selected behavior-affecting headers changing the fingerprint;
- direct `200` and declared status/header replay;
- only explicitly configured non-success statuses being recorded;
- OpenAPI preserving a declared response while adding the helper problem media
  type for the same status;
- thrown handlers and response-validation failures releasing the lease;
- sensitive headers never entering the stored response;
- multiple server instances sharing one storage implementation.

## Delivered sequence

1. Storage types and the atomic result contract are frozen for the initial API.
2. The immutable `.idempotency()` declaration and application-owned storage
   wiring are implemented.
3. Fingerprint and storage-state conformance scenarios are executable
   tests.
4. Pure fingerprint helpers and development-only memory storage are implemented.
5. Runtime conformance tests, normalized route identity, authorization, replay,
   and fenced completion are implemented.
6. Generated-client, TanStack Query, Effect, and OpenAPI metadata/request mapping
   are implemented and covered by runtime and type tests.
7. Redis and relational-database storage contract recipes are published in
   [Idempotency Storage Recipes](./idempotency-storage-recipes.md).
