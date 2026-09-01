---
title: Idempotency
description: Optional Idempotency-Key replay protection with application-owned durable storage.
---

Use idempotency protection for unsafe operations that may be retried. Prefer a
natural domain key and database uniqueness constraint when one exists.

## Contract metadata

The canonical route definition contains serializable build-time metadata:

```ts
export default defineRouteHandler({
  operation: 'grantPoints',
  validate: {
    body: z.object({
      userId: z.string(),
      amount: z.number().int().positive(),
    }),
    response: {
      201: z.object({ balance: z.number() }),
    },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => {
    const { body } = event.validated
    return event.respond(201, { balance: grantPoints(body.userId, body.amount) })
  },
})
```

With `required: true`, the client automatically creates an idempotency key when
the `$endpoint(...)` request object is created unless the caller supplies one.

## Central runtime policy

Storage, scope, and authorization usually belong to the application rather than
one route:

```ts
// server/endpoints/runtime.ts
const storage = createRedisIdempotencyStorage()

export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: ({ event }) => event.context.auth.tenantId,
    authorization: 'middleware',
  },
})
```

- `storage` returns an application-owned durable adapter.
- `scope` returns a trusted server-derived user, tenant, or explicit global
  scope. The client cannot choose it.
- `authorization` is a callback executed for original requests and replays,
  or `'middleware'` when Nitro middleware already made the complete decision.
- `leaseTtlMs` and `replayTtlMs` provide application defaults.

The runtime file is server code and is not evaluated during contract discovery.
It may therefore reference infrastructure connections. Configure a different
location with `endpoints.runtime.path`.

Runtime callbacks do not belong in the route definition. They are rejected by
both TypeScript and runtime definition validation because Nitro evaluates the
serializable definition during build. Put `storage`, `scope`, and
`authorization` in the central runtime policy.

For an operation without a body contract, supply `fingerprint` explicitly so
the implementation cannot confuse an intentionally input-free operation with a
handler that reads undeclared input:

```ts
export default defineRouteHandler({
  operation: 'publishItem',
  params: z.object({ id: z.string() }),
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
    fingerprint: ({ params }) => ({ params }),
  },
  handler: (event) => publishItem(event.validated.params.id),
})
```

## HTTP behavior

- Missing required or malformed key: `400 Bad Request`.
- Same key with a different request fingerprint: `422 Unprocessable Content`.
- Same key while the original is still running: `409 Conflict`.
- Same key after completion: replay the recorded response.

Framework-generated failures use `application/problem+json`. They are not
inserted into the route's declared response union.

## Client usage

When idempotency is required, omitting `idempotencyKey` generates a UUID at
request-object creation. For an optional endpoint, use `idempotencyKey: true`
to opt into automatic generation. Supply a string when the logical operation
must survive a page reload, process restart, or queue handoff.

```ts
const request = $endpoint('grantPoints', {
  body: { userId: 'u_1', amount: 10 },
})

const mutation = useMutation(request.mutationOptions())
```

The key belongs to `request`. TanStack retries perform fresh HTTP attempts with
that same key, and the resolved key is included in mutation identity.

## Storage requirements

Production storage must provide atomic claim, complete, release, and lease
renewal behavior across every server instance. The memory adapter is for tests
and single-process development only. It is not durable and must not be used in
multi-instance production.

The storage key includes a versioned namespace, scope, method, route template,
and a SHA-256 digest of the raw key. The raw key is never stored. Completed
records contain status, selected headers, the response body, and expiry.

See the maintainer [storage recipes](https://github.com/nuxt-endpoints/nuxt-endpoints/blob/main/docs/idempotency-storage-recipes.md)
for Redis and PostgreSQL implementation guidance.
