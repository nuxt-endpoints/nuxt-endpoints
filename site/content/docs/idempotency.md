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

The policy file is server runtime code: it is bundled into the Nitro server and is not part of any route contract, so no build step evaluates it and it can hold real infrastructure connections. It cannot live in `nuxt.config.ts` because module options must be serializable and cannot carry these functions into the server bundle. To use a different path, set `endpoints: { runtime: { path: 'server/policies/endpoints.ts' } }`.

The convention path is looked up in every root that can contribute server routes: the project `server/` directory, extended Nuxt layers, and custom Nitro `scanDirs`. The first match wins, project first.

The same file can override request-time behavior for one generated route. Use the
route template (including `:param` segments) and lowercase HTTP method:

```ts
export default defineEndpointRuntime({
  idempotency: {
    storage: () => storage,
    scope: ({ event }) => event.context.auth.tenantId,
    authorization: 'middleware',
  },
  routes: {
    '/api/uploads/:id': {
      post: {
        idempotency: {
          fingerprint: ({ params, body }) => {
            const upload = body as { file: File }
            return {
              id: params.id,
              file: { name: upload.file.name, size: upload.file.size },
            }
          },
          replayStatuses: [409],
          leaseTtlMs: 30_000,
          replayTtlMs: 86_400_000,
        },
      },
    },
  },
})
```

Route TTLs override the corresponding application defaults. Storage, scope,
and authorization remain application policy and cannot vary by route. Startup
rejects a route or method that does not match a discovered endpoint.

## Declare it on an endpoint

With a central policy in place, an endpoint declares only its contract-side metadata, as an `idempotency` slot alongside the rest of the contract:

```ts
import { z } from 'zod'

export default defineRouteHandler({
  validate: {
    body: z.object({ userId: z.string(), amount: z.number().int().positive() }),
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

All three keys are written out. The slot is the serializable half of the feature, and the build reads it as a whole: a slot missing any of them is not recognized as idempotency metadata at all, so the endpoint would be generated as an ordinary route.

Because it is serializable metadata, the declaration also survives the contract macro unchanged, and the schemas it sits next to can still come from a [separate contract file](/docs/endpoints#separate-contract-files).

## Options

Contract-side, on the route:

- `enabled` (required, always `true`): marks the slot as idempotency metadata.
- `headerName` (required): the header carrying the key. Matching is case-insensitive.
- `required` (required): whether the header is mandatory. Reflected in the generated client type.

Request-time, in `server/endpoints/runtime.ts`:

- `storage`, `scope`, `authorization`: as described above. Define them once in
  the application policy; route entries do not accept them.
- `fingerprint`: a route-only projection for requests the default projection
  cannot represent, such as bodyless operations or multipart `File` input.
- `replayStatuses`: additional route response statuses that may be recorded;
  successful JSON responses are replayable by default.
- `leaseTtlMs` (default `60000`): in-flight lease duration. Size it for the maximum expected handler duration.
- `replayTtlMs` (default `86400000`): how long a completed response remains replayable.

The split is what keeps the two halves honest: the route contract reaches generated clients and OpenAPI, so it carries no functions and no infrastructure, while the runtime file holds callbacks and never leaves the server. Declaring `storage`, `scope`, `authorization`, `fingerprint`, `replayStatuses`, or either TTL in `defineRouteHandler` is rejected by TypeScript and again when the route module is loaded.

Request identity is the request the handler can observe: validated `params`, `query`, and `body`, plus the negotiated media type when the endpoint offers more than one. Because those values are the validated ones rather than the raw bytes, a retry differing only in JSON key order, insignificant whitespace, or a value the schema coerces (`?limit=010` and `?limit=10`) is the same request.

The default fingerprint requires a declared `body` contract. A bodyless
idempotent route must provide an explicit route fingerprint, even if that
fingerprint is a constant naming the operation. Multipart bodies containing a
`File` also need an explicit projection because a `File` is not JSON
serializable. A missing bodyless fingerprint fails at startup with the exact
runtime-map location to add; an unprojected `File` fails when the first such
request is fingerprinted rather than producing an incomplete identity.

If a policy is missing `storage`, `scope`, or `authorization` — or there is no policy file at all — server startup fails and names what is missing. An idempotent endpoint never silently runs unprotected.

## HTTP behavior

- Optional and absent: execute normally.
- Required and absent, or any present but malformed key: `400 Bad Request`.
- Same key and different request fingerprint: `422 Unprocessable Content`.
- Same key and same fingerprint still running: `409 Conflict`.
- Same key and completed fingerprint: replay the recorded response.

These framework-generated failures use a stable `application/problem+json` Problem Details body. They are not added to the endpoint's declared response union.

## Client usage

The generated client accepts a typed `idempotencyKey` request option, separate from `headers`, mapped to the configured header.

When `required: true`, omitting the option generates a UUID when the `$endpoint(...)` request object is created. For an optional endpoint, pass `idempotencyKey: true` to request the same automatic behavior. An explicit string always wins and is useful when a logical operation must survive a page reload, process restart, or queue handoff.

```ts
await $endpoint('/api/points/grants', {
  method: 'post',
  body: { userId: 'u_1', amount: 10 },
})
```

The generated key belongs to the request object, not to an individual fetch attempt. Directly awaiting the object is memoized, while re-executing its Pinia Colada mutation performs a fresh HTTP attempt with the same key:

```ts
import { useMutation } from '@pinia/colada'

const request = $endpoint('/api/points/grants', {
  method: 'post',
  body: { userId: 'u_1', amount: 10 },
})

const mutation = useMutation(request.mutationOptions())
```

The key belongs to `request`. Re-executing that logical mutation performs a
fresh HTTP attempt with the same key, and the resolved key is included in its
Pinia Colada mutation identity. Create a new request object for a separate action.

## Storage

`createMemoryIdempotencyStorage()` is process-local and intended for development and tests only: its records disappear on restart and are not shared across processes.

A media 2xx cannot be recorded for replay: a stream, a `Blob`, or raw bytes have no serializable snapshot, so an idempotent endpoint that answers with one fails loudly rather than replaying an empty object.

Production deployments must provide a durable adapter, such as Redis or SQL, implementing the `IdempotencyStorage` contract (`claim` / `complete` / `release`), and that implementation must be atomic. Durable-adapter conformance requirements and Redis/SQL recipes are documented in the project's storage recipes.

## Guarantees and limits

With a correct durable store, the helper guarantees:

- at most one active lease per endpoint, scope, and key;
- rejection when the same key is reused with different request input;
- replay of a completed response while it remains valid;
- fencing so an expired older lease cannot overwrite a newer execution;
- consistent behavior across instances that share one storage implementation.

It does not guarantee exactly-once side effects: a process can complete an external effect and then crash before recording the response. Use the downstream service's own idempotency key, a transactional outbox, or consumer-side deduplication when that boundary matters.
