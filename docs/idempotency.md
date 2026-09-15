# Idempotency-Key Design

Status: current maintainer architecture note.

For application setup and examples, use the
[public idempotency guide](../site/content/docs/idempotency.md). This document
records the guarantees and implementation boundary that contributors must
preserve.

Nuxt Endpoints follows the semantics described by the current
[`Idempotency-Key` Internet-Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/),
but the draft is not an RFC. NE accepts the common opaque header form: one
non-empty value of at most 255 characters, with commas and control characters
rejected.

## Public contract and runtime policy

A route opts in with serializable contract metadata:

```ts
export default defineEndpoint({
  request: {
    body: CreatePayment,
  },
  responses: { 201: Payment },
  idempotency: true,
  handler: (event) => event.respond(201, createPayment(event.validated.body)),
})
```

`idempotency: true` means:

```ts
{
  enabled: true,
  headerName: 'Idempotency-Key',
  required: true,
}
```

That expanded shape is normalized internal metadata, not the preferred
authoring syntax. Omit `idempotency` to disable the feature. `false` and
`{ enabled: false }` are rejected. Object authoring is reserved for exceptions:

```ts
idempotency: {
  required: false
}
idempotency: {
  headerName: 'X-Request-Key'
}
```

An empty object and an object without `required` still default to
`required: true`. The normalized `{ enabled: true, ... }` form is accepted only
as deprecated input for compatibility.

Request-time infrastructure is configured separately so contract discovery
never evaluates storage or authorization dependencies:

```ts
// server/endpoints/runtime.ts
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: ({ event }) => event.context.auth.userId,
    authorization: 'middleware',
  },
})
```

`storage`, `scope`, and `authorization` have no implicit defaults. Startup
fails when an opted-in route cannot resolve all three. Public operations must
say so explicitly with `scope: 'global'` and `authorization: 'public'`.
`authorization: 'middleware'` means middleware has already performed the
authorization decision; it does not mean that authorization is unnecessary.

Route-specific runtime entries currently override only `fingerprint`,
`replayStatuses`, `leaseTtlMs`, and `replayTtlMs`:

```ts
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: 'global',
    authorization: 'public',
  },
  routes: {
    '/api/payments': {
      post: {
        idempotency: {
          leaseTtlMs: 5 * 60000,
          replayStatuses: [201],
        },
      },
    },
  },
})
```

Scope and authorization cannot be selected inside the handler: authorization,
storage identity, claim, and replay all happen before the handler, and a replay
does not execute it.

## Client behavior

The generated client accepts `idempotencyKey` separately from ordinary route
headers. For a required route, omission generates a UUID when the `$endpoint()`
request object is created. Re-executing that same object, including through
Pinia Colada `mutationOptions()`, reuses the key. Create a new request object
for a new logical operation.

For an optional route, no key is generated unless the caller passes
`idempotencyKey: true`; a string supplies an application-owned key. A stable
explicit string is necessary when one logical operation must survive a reload,
process restart, or queue handoff.

The configured idempotency header cannot also be declared by the route's normal
header schema. Discovery rejects that collision case-insensitively. Untyped
callers are also rejected if they supply both `idempotencyKey` and the wire
header manually.

## Execution order

The request path is deliberately ordered as follows:

```text
request validation
-> resolve runtime policy
-> authorization
-> if optional and key is absent: handler
-> storage and scope resolution
-> fingerprint
-> atomic claim or replay
-> handler only for an acquired claim
-> response snapshot and complete
```

Authorization runs even when an optional route receives no key. Storage,
scope, fingerprint, and claim are skipped in that case. Moving authorization
after the missing-key branch would let an optional request bypass a callback
that may also protect ordinary execution.

For keyed requests, authorization also runs before a completed response is
read. Authorization performed only inside the handler is insufficient because
replay skips that handler.

## Request identity and fingerprint

The storage lookup identity is:

```text
HTTP method + normalized route template + trusted scope + client key
```

The route template, rather than the raw URL, keeps path values in the request
fingerprint and prevents unrelated routes from sharing a record. Scope must be
derived from trusted server state. Use a user, tenant, or server-trusted
anonymous-session identifier whenever responses contain caller-specific data.
`scope: 'global'` is only appropriate when callers may safely share a replayed
response.

Every record also carries a fingerprint of validated request input. The default
projection includes params, query, and body. Object keys are sorted recursively
and array order is preserved before SHA-256 hashing. Authentication headers,
cookies, tracing headers, and the idempotency key are excluded.

Use a route-specific `fingerprint` when declared headers or other trusted input
changes the operation's meaning. Secrets must not enter the projection. A
bodyless operation or a multipart body containing `File` needs an explicit
projection because NE cannot derive an unambiguous default.

## State model and HTTP behavior

Storage records have two states:

```text
absent
  | atomic claim
  v
in-flight { fingerprint, lease, leaseExpiresAt }
  | complete with matching lease
  v
completed { fingerprint, response, replayExpiresAt }
```

An atomic claim returns one of four outcomes:

- `acquired`: this request owns the lease and may execute;
- `in-flight`: the same fingerprint is already executing;
- `completed`: replay the stored response;
- `conflict`: the key was reused for different input.

The wire behavior is:

- required key absent, or any malformed key: `400 Bad Request`;
- matching request still in flight: `409 Conflict`;
- same key with a different fingerprint: `422 Unprocessable Content`;
- completed matching request: replay without running the handler.

These failures use a stable Problem Details body and
`application/problem+json`. They are framework-managed failures, so they appear
in OpenAPI but are not merged into the handler's declared response union.

## Completion, release, and leases

The default lease TTL is 60 seconds and the default completed-response TTL is
24 hours. The common runtime policy may change either value, and a route entry
takes precedence over the common value.

For a replayable response, NE snapshots the response and calls `complete()`
before returning it to the client. Successful `2xx` statuses are replayable by
default; a route may explicitly add other declared statuses. Only JSON endpoint
responses that NE can snapshot are supported. Sensitive and hop-by-hop headers,
including cookies and authorization headers, are never stored.

When the handler throws, response validation or serialization fails, or the
status is not replayable, NE calls `release()`. There is no permanent error
record. An expired in-flight or completed record can be acquired by a later
claim.

If execution exceeds the lease TTL, another request may acquire a new lease and
run the handler concurrently. The lease token prevents the older owner from
overwriting the newer record, but it cannot undo database or external side
effects that already occurred. Size the TTL above the expected maximum for
short mutations. Prefer `202 Accepted` plus a job identifier and polling for
long-running work.

NE does not implement a heartbeat. Safe renewal would require an atomic
storage `renew()` operation guarded by storage key, fingerprint, and lease
token, plus lifecycle and lease-loss semantics for every runtime and adapter.
Nitro scheduled tasks are not tied to one live request and must not renew all
in-flight records. They may help run a detached job, but do not by themselves
provide a durable queue.

## Ownership boundary

Nuxt Endpoints owns:

- header parsing and validation;
- fingerprint and scoped storage-key generation;
- claim outcome interpretation and completed-response replay;
- response snapshot, `complete()`, and failure-path `release()`;
- stale-completion fencing;
- generated client behavior, status branches, and OpenAPI projection;
- reuse of one key for one logical client request object.

The application owns:

- a durable production storage adapter;
- atomic `claim()`, `complete()`, and `release()` transitions;
- trusted scope and authorization policy;
- transactional coordination with the business mutation where needed;
- external-side-effect deduplication, retention, monitoring, and cleanup.

The bundled memory adapter is for development and tests only. Generic caches
or a non-atomic `get` followed by `insert` are not sufficient. See
[Idempotency Storage Recipes](./idempotency-storage-recipes.md) for Redis and
SQL transition patterns.

Individual handlers never read or write idempotency records. NE does not
guarantee exactly-once external effects: a process can commit an external
effect and crash before recording the replay response. Use the downstream
service's own idempotency mechanism, a transactional outbox, or another domain
invariant when that boundary matters.

## Storage conformance

A production adapter must be tested for:

- concurrent first claims from separate instances;
- fingerprint conflicts while in flight and after completion;
- replay and replay expiry;
- lease expiry, reacquisition, and rejected stale completion;
- idempotent retry of an uncertain claim by the proposed lease owner;
- scope isolation;
- exact preservation of status, body presence, serialized body, and safe
  headers;
- visibility of completed records across application instances.

The complete checklist and example algorithms live in
[Idempotency Storage Recipes](./idempotency-storage-recipes.md).
