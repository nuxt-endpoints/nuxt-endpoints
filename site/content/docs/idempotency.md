---
title: Idempotency
description: Optional Idempotency-Key replay protection for unsafe endpoints, with an application-owned durable storage contract.
---

Nuxt Endpoints can add optional `Idempotency-Key` replay protection to a non-idempotent operation, such as a `POST` that grants points, posts a comment, or increments a counter. It is opt-in per endpoint. Prefer a natural domain key plus a database uniqueness constraint when the operation already has one; reach for `Idempotency-Key` when there is no natural unique key, the original response must be replayed, or retries need to coordinate through a shared claim.

## Central policy

Storage, scope resolution, and authorization are usually the same for every idempotent endpoint in an application. Define them once in `server/endpoints/runtime.ts`, alongside the other [application-wide endpoint settings](/docs/endpoints#hooks):

```ts
// server/endpoints/runtime.ts
import { createRedisIdempotencyStorage } from '../utils/idempotency-storage'

const storage = createRedisIdempotencyStorage()

export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: ({ event }) => event.context.auth.tenantId,
    authorization: 'middleware',
  },
})
```

- `storage` (required): returns an application-owned durable `IdempotencyStorage` adapter. It must return an existing adapter and must not open a connection per request.
- `scope` (required): returns a trusted server-derived string, such as an authenticated user or tenant id, or an explicit anonymous/global choice. The raw client must never select scope.
- `authorization` (required): either a callback run on every request, including replays, or the literal `'middleware'` asserting that Nitro middleware already made the full authorization decision. There is no implicit default; authentication alone is not that assertion.
- `leaseTtlMs` / `replayTtlMs` (optional): application-wide TTL defaults.

The policy file is server runtime code: it is bundled into the Nitro server and never evaluated during build-time discovery, so it can hold real infrastructure connections. It cannot live in `nuxt.config.ts` because module options must be serializable and cannot carry these functions into the server bundle. To use a different path, set `endpoints: { runtime: { path: 'server/policies/endpoints.ts' } }`.

The convention path is looked up in every root that can contribute server routes: the project `server/` directory, extended Nuxt layers, and custom Nitro `scanDirs`. The first match wins, project first.

## Declare it on an endpoint

With a central policy in place, an endpoint declares only its contract-side metadata. `.idempotency(options)` is an immutable method on a `defineEndpoint(...)` result: it returns a new endpoint and does not mutate the original.

```ts
import { z } from 'zod'

export const endpoint = defineEndpoint({
  operation: 'grantPoints',
  body: z.object({ userId: z.string(), amount: z.number().int().positive() }),
  responses: {
    201: z.object({ balance: z.number() }),
  },
}).idempotency({
  required: true,
  replayStatuses: [201],
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  return respond(201, { balance: grantPoints(body.userId, body.amount) })
})
```

Because these arguments are serializable metadata, the declaration also stays safe inside a [separate contract file](/docs/endpoints#separate-contract-files).

An endpoint can override any runtime option for route-specific needs — authorization is the most common case:

```ts
export const endpoint = defineEndpoint({ ... }).idempotency({
  required: true,
  authorization: ({ event }) => requirePermission(event, 'points:grant'),
})
```

Endpoints can also keep supplying everything locally, with no policy file — the original fully-explicit form is unchanged:

```ts
defineEndpoint({ ... }).idempotency({
  storage: () => storage,
  scope: ({ event }) => event.context.tenantId,
  authorization: 'middleware',
  required: true,
})
```

## Options and resolution order

Each runtime option resolves per item: **endpoint → central policy → library default** (where one exists).

Contract-side, endpoint-only:

- `headerName` (optional, default `Idempotency-Key`): overrides the header name. Matching is case-insensitive.
- `required` (optional, default `false`): whether the header is mandatory. Reflected in the generated client type.
- `replayStatuses` (optional): extra declared statuses to record for replay. Successful `2xx` responses are recorded by default.
- `fingerprint` (optional): projects the request into the stored fingerprint. The default projection is validated `params`, `query`, and `body`, with no headers or event state. Provide this when behavior depends on a header or other request state, such as currency or API version.

Runtime, policy-defaulted and endpoint-overridable:

- `storage`, `scope`, `authorization`: as described under Central policy. One of the two layers must provide each of them.
- `leaseTtlMs` (default `60000`): in-flight lease duration. Size it for the maximum expected handler duration.
- `replayTtlMs` (default `86400000`): how long a completed response remains replayable.

If an idempotent endpoint ends up without `storage`, `scope`, or `authorization` after merging, the build fails when no policy file exists, and server startup fails when the merged configuration is still incomplete — an idempotent endpoint never silently runs unprotected.

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
