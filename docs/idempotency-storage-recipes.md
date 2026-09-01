# Idempotency Storage Recipes

Status: storage contract patterns, not drop-in production adapters.

Last consolidated: 2026-07-21

Nuxt Endpoints deliberately does not depend on a Redis or database client. A
production application implements `IdempotencyStorage` with the infrastructure
it already owns, then supplies one shared adapter to `.idempotency()`.

This document describes the atomic operations an adapter must implement. The
pseudocode is not a copy-paste production adapter. Client-specific result
decoding, schema migration, datastore integration tests, observability, and
durability settings remain application responsibilities.

If Nuxt Endpoints later publishes ready-made adapters, they should be separate
optional packages with real Redis/PostgreSQL integration tests and the same
conformance suite as the development memory store. Untested client-specific
code does not belong in the core package or in a production recipe.

## What cannot be replaced by a generic cache

`IdempotencyStorage` is a three-operation compare-and-swap protocol, not a
`get`/`set` cache:

```ts
interface IdempotencyStorage {
  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult>
  complete(input: IdempotencyCompleteInput): Promise<IdempotencyLeaseMutationResult>
  release(input: IdempotencyReleaseInput): Promise<IdempotencyLeaseMutationResult>
}
```

Nitro caching and unstorage are useful for response caching, but their common
driver contract does not expose the atomic conditional transition needed here.
A generic distributed lock is also insufficient: the record must compare a
request fingerprint, replay the original response, and fence an old completion
after an expired lease is reclaimed.

An existing idempotency package can be wrapped only if its storage primitive
passes every conformance scenario below. Matching method names or supporting a
Redis TTL is not enough.

## Contract checklist

Every adapter must guarantee:

- `claim` atomically observes or creates one record by `storageKey`;
- absent and expired records become in-flight with the caller's fingerprint,
  lease, and storage-clock expiry;
- an uncertain retry with the same proposed lease returns `acquired` without
  extending that lease;
- a different fingerprint returns `conflict` for both in-flight and completed
  records;
- another unexpired lease returns `in-flight` with an optional remaining TTL;
- a completed record returns status, body presence, serialized body, and safe
  response headers from the same atomic observation;
- `complete` and `release` match storage key, fingerprint, lease, in-flight
  state, and unexpired lease;
- an expired or replaced lease returns `lease-lost` and cannot mutate the
  current record;
- a successful mutation is visible to every application instance before the
  adapter resolves.

The core supplies an opaque SHA-256 `storageKey`. Prefix it with a static,
versioned namespace. Never put a raw tenant scope or client key in a Redis key,
SQL identifier, log label, or metric dimension.

## Redis pattern

Use one Redis hash per storage key and one Lua script or Redis Function per
operation. A single-key script is atomic and Redis Cluster compatible because
it never crosses hash slots.

Store at least:

```text
state: in-flight | completed
fingerprint: opaque digest
lease: opaque fencing token (in-flight only)
expiresAt: Redis-server time in milliseconds
status, hasBody, serializedBody, headers (completed only)
```

Set a Redis key expiry for cleanup, but still compare `expiresAt` inside every
script. Physical expiration can be lazy, so key presence alone does not mean a
lease remains valid.

### `claim` script logic

```text
now = Redis TIME converted to milliseconds
record = read the hash

if record is absent or record.expiresAt <= now:
  replace it with in-flight(fingerprint, proposedLease, now + leaseTtlMs)
  set PEXPIREAT to that deadline
  return acquired

if record.fingerprint != fingerprint:
  return conflict

if record.state == completed:
  return completed(recorded response)

if record.lease == proposedLease:
  return acquired  // uncertain retry; do not extend expiry

return in-flight(max(0, record.expiresAt - now))
```

### `complete` script logic

```text
now = Redis TIME converted to milliseconds
record = read the hash

if record is not an unexpired in-flight record matching
   fingerprint and lease:
  return lease-lost

replace the in-flight fields with the response fields
set expiresAt and PEXPIREAT to now + replayTtlMs
return applied
```

Persist `hasBody` independently from `serializedBody`. An empty endpoint
response is `hasBody = false` and `serializedBody = ''`; a JSON `null` response
is `hasBody = true` and `serializedBody = 'null'`. Encode the optional headers
map as one JSON value or an equivalent lossless representation.

### `release` script logic

```text
now = Redis TIME converted to milliseconds
record = read the hash

if record is not an unexpired in-flight record matching
   fingerprint and lease:
  return lease-lost

delete the key
return applied
```

This pattern assumes Redis 5 or later, where effects replication is the default
for scripts that read server time and then write. Register scripts through the
client's script API or use `EVALSHA`; do not send script source on every normal
request. Script caches disappear after restart, failover, or `SCRIPT FLUSH`, so
the adapter must handle `NOSCRIPT` by loading the script again and retrying the
same operation. Configure persistence, replication, and acknowledged writes for
the business durability requirement. Script atomicity does not by itself
guarantee survival after primary failure.

## PostgreSQL pattern

Use a primary key for the physical identity and serialize competing claims with
a row lock. A minimal table contains:

```sql
CREATE TABLE endpoint_idempotency (
  storage_key text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('in-flight', 'completed')),
  fingerprint text NOT NULL,
  lease text,
  expires_at timestamptz NOT NULL,
  status integer,
  has_body boolean,
  serialized_body text,
  response_headers jsonb
);

CREATE INDEX endpoint_idempotency_expiry_idx
  ON endpoint_idempotency (expires_at);
```

Add state-dependent checks in the real migration: in-flight rows require a
lease and no response fields; completed rows require status, `has_body`, and
`serialized_body`, and have no lease.

Implement `claim` as one transaction or stored function:

```text
loop:
  INSERT the in-flight row ON CONFLICT DO NOTHING
  if inserted: return acquired

  SELECT the row FOR UPDATE
  if it disappeared before the lock: retry the loop

  now = clock_timestamp()  // after waiting for the lock
  if expired: UPDATE every state/request/response field to the new claim;
              return acquired
  if fingerprint differs: return conflict
  if completed: return completed(response fields)
  if lease equals proposed lease: return acquired without extending expiry
  return in-flight(ceil(expires_at - now in milliseconds))
```

Use `clock_timestamp()`, not a timestamp captured before a lock wait. The
primary key resolves concurrent first inserts; `FOR UPDATE` makes inspection
and expired-record replacement one serialized decision.

`complete` is one conditional update:

```sql
UPDATE endpoint_idempotency
SET state = 'completed',
    lease = NULL,
    expires_at = clock_timestamp() + replay_ttl,
    status = response_status,
    has_body = response_has_body,
    serialized_body = response_body,
    response_headers = safe_headers
WHERE storage_key = input_storage_key
  AND state = 'in-flight'
  AND fingerprint = input_fingerprint
  AND lease = input_lease
  AND expires_at > clock_timestamp();
```

Return `applied` only when exactly one row changed. `release` uses the same
predicate in a `DELETE`; zero changed rows means `lease-lost`. Pass every value
as a query parameter and never interpolate a storage key into SQL.

Expired rows are logically replaceable and need not be deleted synchronously.
Delete them periodically in bounded batches, using `FOR UPDATE SKIP LOCKED` if
cleanup can overlap live traffic.

## Application wiring

Create the datastore client and adapter once. The per-request storage resolver
returns the existing adapter; trusted scope and authorization still run on
every request.

```ts
const idempotencyStorage: IdempotencyStorage = createApplicationStorage(redis)

export default defineRouteHandler(
  {
    operation: 'grantPoints',
    validate: {
      body: GrantPointsBody,
      response: { 201: GrantPointsResult },
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
      storage: () => idempotencyStorage,
      scope: ({ event }) => event.context.tenant.id,
      authorization: ({ event }) => requirePermission(event, 'points:grant'),
    },
  },
)
```

## Conformance before production

Run integration tests against the same datastore/version used in production:

- two first claims from separate connections produce one owner;
- same proposed lease can safely retry an uncertain claim;
- a different fingerprint conflicts in both states;
- a reclaimed expired lease rejects the old owner's completion and release;
- completion at the expiry boundary cannot succeed late;
- completed response fields, including empty body versus JSON `null`, round-trip
  losslessly;
- replay expiry permits a new claim;
- datastore failover behavior matches the application's acknowledged-write
  assumption.

Also cap stored response size, monitor capacity and conflicts, protect response
bodies with appropriate encryption/retention/access controls, and use a
downstream idempotency key or transactional outbox for external effects that
must survive the crash window between effect and response completion.
