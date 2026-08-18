import {
  createError,
  defineEventHandler,
  getHeaders,
  getQuery,
  readBody,
  readFormData,
  readRawBody,
  setHeaders,
  setResponseStatus,
  toWebRequest,
} from 'h3'
import type { H3Event } from 'h3'

export type RuntimeEvent = H3Event

export type RuntimeHttpErrorOptions = {
  statusCode: number
  statusMessage: string
  data?: unknown
}

export function defineRuntimeHandler<RESPONSE>(
  handler: (event: RuntimeEvent) => RESPONSE,
): (event: RuntimeEvent) => RESPONSE {
  return defineEventHandler(handler as never) as unknown as (event: RuntimeEvent) => RESPONSE
}

export function createRuntimeError(options: RuntimeHttpErrorOptions): Error {
  return createError(options)
}

export function getRuntimeWebRequest(event: RuntimeEvent): Request {
  return toWebRequest(event)
}

export function getRuntimeQuery(event: RuntimeEvent): unknown {
  return getQuery(event)
}

/**
 * Reads the incoming request's HTTP method (e.g. `'GET'`). Used by the
 * method-dispatch runtime (endpoint-methods.ts) to pick which declared
 * method's sub-handler runs; kept here so h3 stays imported from this one
 * file only.
 */
export function getRuntimeMethod(event: RuntimeEvent): string {
  return event.method
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

export function setRuntimeResponseStatus(
  event: RuntimeEvent,
  status: number,
  statusMessage?: string,
): void {
  if (statusMessage) {
    setResponseStatus(event, status, statusMessage)
    return
  }
  setResponseStatus(event, status)
}

export function setRuntimeResponseHeaders(
  event: RuntimeEvent,
  headers: Record<string, string>,
): void {
  setHeaders(event, headers)
}
