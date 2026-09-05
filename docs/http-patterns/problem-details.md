# RFC 9457 Problem Details

Status: proposed foundational contract helper.

## 1. Pattern overview

Problem Details provides a common machine-readable envelope for HTTP API
errors without replacing the semantics of the HTTP status itself. It is useful
when a status such as `403`, `409`, or `422` needs a stable problem identity,
human guidance, and typed application-specific fields.

```mermaid
sequenceDiagram
    Client->>Server: POST /payments
    Server-->>Client: 403 application/problem+json
    Note over Client,Server: type identifies the problem; status remains authoritative HTTP metadata
```

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) defines the JSON
members `type`, `status`, `title`, `detail`, and `instance`, extension members,
and the `application/problem+json` media type. It obsoletes RFC 7807.

## 2. HTTP contract

```text
HTTP error status (normally 4xx or 5xx)
Content-Type: application/problem+json

{
  type?: URI-reference,       // defaults conceptually to about:blank
  status?: integer 100..599,  // advisory; if present, matches HTTP status
  title?: string,             // stable summary for this type
  detail?: string,            // occurrence-specific human guidance
  instance?: URI-reference,
  ...typed extensions
}
```

The HTTP status is authoritative. The body `status`, when present, must agree
with it. Callers must branch on `type` or typed extensions, not parse `detail`.
Problem types should have stable URI identifiers and documented status/title.
Sensitive stack traces, credentials, and internal identifiers must not leak
through `detail` or extensions.

## 3. Server-side API proposal

The existing low-level NE contract already works:

```ts
validate: {
  response: {
    403: {
      body: OutOfCreditProblem,
      contentType: 'application/problem+json',
    },
  },
}
```

A small reusable constructor could remove correlation mistakes:

```ts
const OutOfCredit = defineHttpProblem({
  type: 'https://example.com/problems/out-of-credit',
  status: 403,
  title: 'Insufficient credit',
  extensions: z.object({ balance: z.number() }),
})

export default defineRouteHandler({
  validate: {
    response: {
      403: OutOfCredit.response,
    },
  },
  handler: (event) =>
    event.respond(
      403,
      OutOfCredit.create({
        detail: 'Add credit before retrying.',
        balance: 0,
      }),
    ),
})
```

`defineHttpProblem` is convenience over a normal response contract. It must not
invent an error transport or force every application error into Problem
Details. RFC 9457 explicitly allows existing domain formats when they are more
appropriate.

## 4. Server conformance

TypeScript can bind one literal problem `type`, `status`, stable `title`, and
the extension schema. It can ensure that the object passed to `create` has the
right extensions and that the response is installed at the matching status.

Runtime construction can:

- set `application/problem+json`;
- copy the literal status into the body, if the profile chooses to include it;
- validate URI references and extension output;
- reject reserved-member collisions in the extension schema;
- prevent a body/transport status mismatch.

No type can prove that `detail` is safe to disclose or that a type URI remains
documented. Security review remains an application concern.

## 5. Client-side raw usage

```ts
const result = await $endpoint('/api/payments', {
  method: 'post',
  body: payment,
})

if (result.status === 403) {
  result.body.type
  result.body.balance
}
```

The endpoint's existing status union already performs the important narrowing.
A generic `isProblem(value)` parser can help with undeclared middleware or
proxy responses, but it must return the RFC base shape with unknown extensions,
not pretend those extensions match an endpoint declaration.

## 6. Invocation Strategy

No general invocation strategy is necessary. Problem Details describes a
terminal response; it does not prescribe another request. A specific problem
type may define a link or `Retry-After`, but the corresponding rate-limit,
authentication, or other strategy owns that behavior.

The only reusable client behavior should be parsing and type discrimination.
Do not add `.handleProblem()` chains or silently throw declared status results.

## 7. Pinia Colada integration

No dedicated integration is recommended. A declared problem remains typed data
in NE's status-aware result. If an invocation strategy deliberately turns a
problem into a retry signal, that strategy's adapter defines Colada behavior.
Colada should not interpret RFC 9457 fields globally.

## 8. Existing implementations

- RFC 9457 supplies the normative model, media types, extension rules, and a
  non-normative JSON Schema.
- TypeSpec and OpenAPI can express the body/status/content-type shape, but the
  base TypeSpec HTTP library does not make every error a Problem Details value.
- Azure TypeSpec has a reusable service error envelope, historically shaped by
  Azure conventions rather than RFC 9457.
- Smithy models named error structures and HTTP status bindings; protocol
  implementations choose their wire error envelope.
- Misina detects `application/problem+json` and exposes the parsed value on an
  `HTTPError`; this is useful client ergonomics but couples the behavior to its
  throwing HTTP client.
- Hono and ts-rest can type a Problem Details response but provide no standard
  problem-type registry or status/body constructor.

## 9. Recommendation

| Criterion          | Assessment                                               |
| ------------------ | -------------------------------------------------------- |
| Frequency          | High across public and internal APIs                     |
| HTTP-native value  | Very high; Standards Track RFC and registered media type |
| Type-safety value  | Medium-high for status/type/extensions correlation       |
| Server DX          | High with a small constructor                            |
| Client DX          | Already strong through NE status unions                  |
| Colada integration | None needed                                              |
| Complexity         | Low                                                      |
| Alternatives       | Handwritten schemas; framework-specific error envelopes  |

**Priority: High.** Add a small core constructor/schema only after its shape is
tested against existing validation and idempotency problems. It is an excellent
foundation, but cursor pagination is the stronger first proof of the full
Contract → Strategy → Adapter direction.
