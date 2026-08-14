---
title: Idempotency
description: Optional Idempotency-Key replay protection for unsafe endpoints, with an application-owned durable storage contract.
---

Nuxt Endpoints can add optional `Idempotency-Key` replay protection to a non-idempotent operation, such as a `POST` that grants points, posts a comment, or increments a counter. It is opt-in per endpoint. Prefer a natural domain key plus a database uniqueness constraint when the operation already has one; reach for `Idempotency-Key` when there is no natural unique key, the original response must be replayed, or retries need to coordinate through a shared claim.

## Declare it on an endpoint

`.idempotency(options)` is an immutable method on a `defineEndpoint(...)` result: it returns a new endpoint and does not mutate the original.

```ts
import { z } from 'zod'
import { createMemoryIdempotencyStorage } from 'nuxt-endpoints/runtime'

const storage = createMemoryIdempotencyStorage()

export const endpoint = defineEndpoint({
  operation: 'grantPoints',
  body: z.object({ userId: z.string(), amount: z.number().int().positive() }),
  responses: {
    201: z.object({ balance: z.number() }),
  },
}).idempotency({
  storage: () => storage,
  scope: ({ event }) => event.context.tenantId,
  authorization: 'middleware',
  required: true,
  replayStatuses: [201],
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  return respond(201, { balance: grantPoints(body.userId, body.amount) })
})
```

## Options

- `storage` (required): returns an application-owned durable `IdempotencyStorage` adapter. It must return an existing adapter and must not open a connection per request.
- `scope` (required): returns a trusted server-derived string, such as an authenticated user or tenant id, or an explicit anonymous/global choice. The raw client must never select scope.
- `authorization` (required): either a callback run on every request, including replays, or the literal `'middleware'` asserting that Nitro middleware already made the full authorization decision. There is no implicit default; authentication alone is not that assertion.
- `fingerprint` (optional): projects the request into the stored fingerprint. The default projection is validated `params`, `query`, and `body`, with no headers or event state. Provide this when behavior depends on a header or other request state, such as currency or API version.
- `headerName` (optional, default `Idempotency-Key`): overrides the header name. Matching is case-insensitive.
- `required` (optional, default `false`): whether the header is mandatory.
- `leaseTtlMs` (optional, default `60000`): in-flight lease duration. Size it for the maximum expected handler duration.
- `replayTtlMs` (optional, default `86400000`): how long a completed response remains replayable.
- `replayStatuses` (optional): extra declared statuses to record for replay. Successful `2xx` responses are recorded by default.

## HTTP behavior

- Optional and absent: execute normally.
- Required and absent, or any present but malformed key: `400 Bad Request`.
- Same key and different request fingerprint: `422 Unprocessable Content`.
- Same key and same fingerprint still running: `409 Conflict`.
- Same key and completed fingerprint: replay the recorded response.

These framework-generated failures use a stable `application/problem+json` Problem Details body. They are not added to the endpoint's declared `.result()` response union.

## Client usage

The generated client accepts a typed `idempotencyKey` request option, separate from `headers`, mapped to the configured header. It is required in the client type when `required: true`, and optional otherwise. The client never auto-generates a key: a retry must reuse the caller's same key.

```ts
await $endpoint('grantPoints', {
  idempotencyKey: crypto.randomUUID(),
  body: { userId: 'u_1', amount: 10 },
})
```

TanStack Query and Infinite Query include `idempotencyKey` in the cache key segment.

## Storage

`createMemoryIdempotencyStorage()` is process-local and intended for development and tests only: its records disappear on restart and are not shared across processes.

Production deployments must provide a durable adapter, such as Redis or SQL, implementing the `IdempotencyStorage` contract (`claim` / `complete` / `release`), and that implementation must be atomic. Durable-adapter conformance requirements and Redis/SQL recipes are documented in the project's storage recipes.

## Guarantees and limits

With a correct durable store, the helper guarantees:

- at most one active lease per endpoint, scope, and key;
- rejection when the same key is reused with different request input;
- replay of a completed response while it remains valid;
- fencing so an expired older lease cannot overwrite a newer execution;
- consistent behavior across instances that share one storage implementation.

It does not guarantee exactly-once side effects: a process can complete an external effect and then crash before recording the response. Use the downstream service's own idempotency key, a transactional outbox, or consumer-side deduplication when that boundary matters.
