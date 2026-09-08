---
title: Idempotency
description: Idempotency-Key replay protection for unsafe endpoints, with an application-owned durable storage contract.
---

Nuxt Endpoints can protect a mutation such as posting a comment, granting
points, or incrementing a counter against duplicate execution. It coordinates
the standard `Idempotency-Key` request header with validated input, response
replay, the generated client, and OpenAPI.

Prefer a natural domain key and a database uniqueness constraint when the
operation already has one. Use this protocol when there is no natural key, the
original response must be replayed, or retries need to coordinate through a
shared claim.

## Declare it on a route

The normal route API is one line:

```ts
export default defineEndpoint({
  request: {
    body: z.object({ text: z.string() }),
  },
  idempotency: true,
  handler: (event) => saveComment(event.validated.body),
})
```

`idempotency: true` means that `Idempotency-Key` is required. NE normalizes it
to internal metadata containing `enabled: true`, the standard header name, and
`required: true`. Those fields drive client generation, OpenAPI, runtime
interception, and the typed `400`, `409`, and `422` branches; application code
does not write that metadata itself.

Method groups use the same declaration inside the relevant method:

```ts
export default defineEndpoint({
  post: {
    request: {
      body: z.object({ text: z.string() }),
    },
    idempotency: true,
    handler: (event) => saveComment(event.validated.body),
  },
})
```

Omit the property to disable idempotency. `idempotency: false` and
`{ enabled: false }` are rejected because this is a per-route opt-in, not an
inherited setting that needs to be cancelled.

Use an object only to differ from the defaults. A custom header remains
required unless `required: false` is explicit:

```ts
idempotency: {
  headerName: 'X-Request-Key'
}
```

Optional mode is explicit:

```ts
idempotency: {
  required: false
}
```

With optional mode:

- a request with no key still passes the authorization policy;
- storage, scope, fingerprint, and claim are skipped when the key is absent;
- the handler then executes normally;
- a request carrying a key uses the full claim and replay protocol;
- the generated client does not create a key unless the caller supplies
  `idempotencyKey: true` or a string.

## Runtime policy

The route declaration is portable metadata. Storage connections, trusted
scope, authorization, fingerprints, and TTLs are server-only and belong in
`server/endpoints/runtime.ts`.

### Public endpoints

An operation that returns no caller-specific secrets can choose one shared
namespace explicitly:

```ts
// server/endpoints/runtime.ts
import { defineEndpointRuntime } from 'nuxt-endpoints/runtime'
import { storage } from '../utils/idempotency-storage'
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: 'global',
    authorization: 'public',
  },
})
```

`scope: 'global'` means all callers share one idempotency namespace.
`authorization: 'public'` says that replay needs no access-control callback.
These are separate declarations because namespace isolation and authorization
are separate decisions.

A UUID makes accidental key collisions unlikely, but it does not isolate one
caller's recorded response from another caller. Use `global` only for public
operations whose stored responses contain no caller-specific secrets. For an
anonymous operation with caller-specific data, derive scope from a
server-trusted anonymous session identifier instead.

### Authenticated endpoints

Use a trusted user, tenant, or session identity as the scope. If middleware has
already completed authorization, state that separately:

```ts
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: ({ event }) => event.context.auth.userId,
    authorization: 'middleware',
  },
})
```

`authorization` may also be a callback. It runs on every request, including an
optional request without a key and a completed replay. This prevents replay
from becoming a path around ordinary access control.

Neither `scope` nor `authorization` has an implicit default. Startup fails if
an idempotent route cannot resolve `storage`, `scope`, and `authorization` from
its runtime configuration.

## Route-specific runtime settings

Fingerprint, replay-status, and TTL exceptions can be keyed by generated route
template and lowercase HTTP method. Route settings win over common policy:

```ts
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: 'global',
    authorization: 'public',
    leaseTtlMs: 5 * 60000,
  },
  routes: {
    '/api/slow-operation': {
      post: {
        idempotency: {
          leaseTtlMs: 15 * 60000,
        },
      },
    },
  },
})
```

Route entries may set `fingerprint`, `replayStatuses`, `leaseTtlMs`, and
`replayTtlMs`. Storage, scope, and authorization remain common application
policy. Contract declarations reject all of these runtime-only keys.

The default fingerprint contains validated `params`, `query`, and `body`, plus
the negotiated response media type when applicable. A bodyless idempotent route
must supply an explicit route fingerprint. Multipart input containing `File`
also needs an explicit serializable projection.

## Client usage

For a required route, the generated client creates a UUID when the
`$endpoint()` request object is created:

```ts
const request = $endpoint('/api/comments', {
  method: 'post',
  body: { text: 'Hello' },
})
```

That key belongs to the logical request object. Re-executing a Pinia Colada
mutation built from the same object sends a fresh HTTP request with the same
key; creating a new request object creates a new key:

```ts
const mutation = useMutation(mutationOptions(request))
```

For an optional route, pass `idempotencyKey: true` to ask NE to generate a key,
or pass a string when the key must survive a reload, process restart, or queue
handoff.

## HTTP behavior

- Required and absent, or any present but malformed key: `400 Bad Request`.
- Same key and a different request fingerprint: `422 Unprocessable Content`.
- Same key and fingerprint while another request owns the lease: `409 Conflict`.
- Same key and a completed fingerprint: replay the recorded response.
- Optional and absent: authorize, bypass the idempotency store, then execute.

These framework-generated failures use `application/problem+json` and appear
in the generated route type and OpenAPI document.

## Lease lifecycle and limits

The default in-flight `leaseTtlMs` is 60 seconds. The default completed-response
`replayTtlMs` is 24 hours. Both may be changed in the common runtime policy or
for one route; the route value has priority.

For a replayable response, NE snapshots the handler result and calls
`complete()` before sending it to the client. If the handler throws, response
snapshotting fails, or the status is not replayable, NE calls `release()`.
There is no persistent error state today. An expired in-flight or completed
record can be acquired by the next atomic `claim()`.

If a process crashes before release or completion, lease expiry is the recovery
boundary. A storage adapter must therefore treat an expired record as
atomically reclaimable. If a handler runs beyond its lease TTL, another request
may acquire a new lease and execute the handler concurrently. The lease token
prevents the older owner from applying a stale `complete()`, but it cannot undo
database writes or other external side effects that have already happened.

Choose a TTL comfortably above the maximum duration of an ordinary mutation.
For long work, prefer `202 Accepted` with a job identifier and polling, and
move the work out of the request lifecycle. Nitro Tasks can help run such work,
but they do not by themselves guarantee a durable queue.

NE intentionally does not implement lease heartbeat today. A safe heartbeat
would require an atomic storage `renew()` operation guarded by storage key,
fingerprint, and lease token; stopping renewal when the request ends; explicit
renew-failure and lease-loss behavior; handling process and event-loop stalls;
and support from every storage adapter, including serverless and edge runtimes
where background timers are constrained. A timer or cron that blindly extends
records can keep leases alive after their owners have died, so it is not a safe
substitute. Nitro Tasks and `scheduledTasks` are not request-scoped heartbeats.

## Storage responsibility

NE owns:

- reading and validating the idempotency header;
- generating the default fingerprint and the scope-aware storage key;
- calling `claim()`, interpreting in-flight/conflict/completed results, and
  replaying completed responses;
- snapshotting successful responses, calling `complete()`, and calling
  `release()` on failure or a non-replayable status;
- reusing a key for the same logical client request.

The application owns:

- a durable storage adapter with atomic `claim()`, `complete()`, and
  `release()` transitions;
- avoiding process-local memory storage in production;
- coordinating the business mutation and idempotency record transactionally
  when the operation requires that guarantee;
- protecting external side effects that cannot share that transaction.

Individual handlers do not read or write idempotency records. The
`createMemoryIdempotencyStorage()` adapter is for development and tests only.
Redis and PostgreSQL implementation guidance is in the
[storage recipes](https://github.com/nuxt-endpoints/nuxt-endpoints/blob/main/docs/idempotency-storage-recipes.md).

Even with a correct durable store, this protocol does not guarantee exactly
once external effects. A process can complete an external effect and crash
before recording the response. Use the downstream service's own idempotency
key, a transactional outbox, or domain-level deduplication when that boundary
matters.
