// Reading the incoming request: query, headers, and the four body shapes the
// contract model accepts. This is the half of the seam h3 is growing into —
// h3 v2's `defineValidatedHandler` executes body/headers/query validation
// itself. What it cannot hold yet, and what can never move, is laid out in
// README.md.
import { getHeaders, getQuery, readBody, readFormData, readRawBody } from 'h3'
import type { RuntimeEvent } from './handler'

export function getRuntimeQuery(event: RuntimeEvent): unknown {
  return getQuery(event)
}

export function getRuntimeRequestHeaders(
  event: RuntimeEvent,
): Readonly<Record<string, string | undefined>> {
  return getHeaders(event)
}

export function readRuntimeBody(event: RuntimeEvent): Promise<unknown> {
  return readBody(event)
}

/**
 * Reads a `multipart/form-data` request body as a Web `FormData` instance.
 * Kept separate from `readRuntimeBody` because h3's `readBody` does not
 * decode multipart bodies the way it does JSON/urlencoded ones.
 */
export function readRuntimeFormData(event: RuntimeEvent): Promise<FormData> {
  return readFormData(event)
}

/**
 * Reads a request body as raw UTF-8 text. Unlike `readRuntimeBody` (which
 * applies h3's `destr` coercion — e.g. turning `"123"` into a number), this
 * always yields the exact request body text, which `text/*` contracts need.
 */
export async function readRuntimeTextBody(event: RuntimeEvent): Promise<string> {
  return (await readRawBody(event, 'utf8')) ?? ''
}

/**
 * Reads a request body as raw bytes, for a media-type map member declared
 * `true`. Buffered rather than streamed: the value becomes `context.body`,
 * which downstream code (the idempotency fingerprint, for one) projects as
 * data.
 */
export async function readRuntimeBinaryBody(event: RuntimeEvent): Promise<Uint8Array> {
  const raw = await readRawBody(event, false)
  return raw ? new Uint8Array(raw) : new Uint8Array()
}
