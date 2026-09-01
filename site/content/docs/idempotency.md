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
  handler: ({ body, respond }) => {
    return respond(201, { balance: grantPoints(body.userId, body.amount) })
  },
})
```

`required: true` makes `idempotencyKey` required in the generated client
request. The client never creates a key automatically because a retry must
reuse exactly the same value.

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

## Route-specific runtime policy

The optional second argument contains request-time functions. This keeps them
outside the handler-free contract graph:

```ts
export default defineRouteHandler(
  {
    operation: 'grantPoints',
    validate: {
      body: GrantPoints,
      response: { 201: Balance },
    },
    idempotency: {
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    },
    handler: ({ body, respond }) => respond(201, grantPoints(body)),
  },
  {
    idempotency: {
      storage: () => storage,
      scope: ({ event }) => event.context.auth.tenantId,
      authorization: ({ event }) => requirePermission(event, 'points:grant'),
      replayStatuses: [201],
    },
  },
)
```

Each runtime option resolves route → central policy → library default. One of
those layers must provide `storage`, `scope`, and `authorization`.

For an operation without a body contract, supply `fingerprint` explicitly so
the implementation cannot confuse an intentionally input-free operation with a
handler that reads undeclared input:

```ts
export default defineRouteHandler(
  {
    operation: 'publishItem',
    params: z.object({ id: z.string() }),
    idempotency: {
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    },
    handler: ({ params }) => publishItem(params.id),
  },
  {
    idempotency: {
      fingerprint: ({ params }) => ({ params }),
    },
  },
)
```

## HTTP behavior

- Missing required or malformed key: `400 Bad Request`.
- Same key with a different request fingerprint: `422 Unprocessable Content`.
- Same key while the original is still running: `409 Conflict`.
- Same key after completion: replay the recorded response.

Framework-generated failures use `application/problem+json`. They are not
inserted into the route's declared `.result()` union.

## Client usage

```ts
await $endpoint('grantPoints', {
  idempotencyKey: crypto.randomUUID(),
  body: { userId: 'u_1', amount: 10 },
})
```

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
