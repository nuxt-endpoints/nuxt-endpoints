// Reading the incoming request: query, headers, and the four body shapes the
// contract model accepts. This is the half of the seam h3 is growing into —
// h3 v2's `defineValidatedHandler` executes body/headers/query validation
// itself. What it cannot hold yet, and what can never move, is laid out in
// README.md and docs/upstream-delta.md.
import { getQuery, readBody } from 'h3'
import type { RuntimeEvent } from './handler'

/**
 * Deliberately still h3's `getQuery` rather than `event.url.searchParams`.
 * `getQuery` returns repeated parameters as arrays (`?tag=a&tag=b` →
 * `{ tag: ['a', 'b'] }`), which endpoint contracts document as a supported
 * input shape; `URLSearchParams.get()` and `Object.fromEntries` both keep one
 * value and drop the rest. `test/platform.test.ts` pins this through a real
 * request.
 *
 * h3 v2's own `defineValidatedHandler` collapses repeats here — measured, see
 * docs/upstream-delta.md — which is why query validation has not moved to it.
 */
export function getRuntimeQuery(event: RuntimeEvent): unknown {
  // H3 v2 may return its parsed-query record with an internal prototype.
  // Contracts and idempotency treat query data as JSON-shaped application
  // input, so remove that transport-specific identity while preserving array
  // values for repeated parameters.
  return { ...(getQuery(event) as Record<string, string | string[]>) }
}

export function getRuntimeRequestHeaders(
  event: RuntimeEvent,
): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(event.req.headers.entries())
}

/**
 * Still h3's `readBody` rather than `event.req.json()`: it applies h3's
 * `destr` coercion and answers `undefined` for an empty body, both of which
 * the contract layer's body handling is written against.
 */
export function readRuntimeBody(event: RuntimeEvent): Promise<unknown> {
  return readBody(event)
}

/**
 * Reads a `multipart/form-data` request body as a Web `FormData` instance.
 * Kept separate from `readRuntimeBody` because h3's `readBody` does not
 * decode multipart bodies the way it does JSON/urlencoded ones.
 */
export function readRuntimeFormData(event: RuntimeEvent): Promise<FormData> {
  return event.req.formData()
}

/**
 * Reads a request body as raw UTF-8 text. Unlike `readRuntimeBody` (which
 * applies h3's `destr` coercion — e.g. turning `"123"` into a number), this
 * always yields the exact request body text, which `text/*` contracts need.
 */
export async function readRuntimeTextBody(event: RuntimeEvent): Promise<string> {
  return await event.req.text()
}

/**
 * Reads a request body as raw bytes, for a media-type map member declared
 * `true`. Buffered rather than streamed: the value becomes `context.body`,
 * which downstream code (the idempotency fingerprint, for one) projects as
 * data.
 */
export async function readRuntimeBinaryBody(event: RuntimeEvent): Promise<Uint8Array> {
  return new Uint8Array(await event.req.arrayBuffer())
}
