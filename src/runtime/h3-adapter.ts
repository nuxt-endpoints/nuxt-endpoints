import {
  createError,
  defineEventHandler,
  getHeaders,
  getQuery,
  readBody,
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

export function getRuntimeRequestHeaders(
  event: RuntimeEvent,
): Readonly<Record<string, string | undefined>> {
  return getHeaders(event)
}

export function readRuntimeBody(event: RuntimeEvent): Promise<unknown> {
  return readBody(event)
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
