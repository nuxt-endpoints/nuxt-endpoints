import type { StreamResponseContract } from './contract'

export type StatusCode = number

/** Media type sent for a stream response that does not declare one. */
export const defaultStreamContentType = 'application/octet-stream'

/**
 * Whether a declared response hands its payload to the socket untouched. The
 * `stream: true` marker is the discriminant: a validator schema never carries
 * it, and neither does the validated `{ body }` form.
 */
export function isStreamResponseContract(contract: unknown): contract is StreamResponseContract {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'stream' in contract &&
    (contract as { stream: unknown }).stream === true
  )
}

export type ResponseOptions<HEADERS extends Record<string, string> = Record<string, string>> = {
  headers?: HEADERS
}

const statusResponseSymbol = Symbol.for('nuxt-endpoints.status-response')

export type StatusResponse<
  STATUS extends StatusCode,
  BODY,
  HEADERS extends Record<string, string> = Record<string, string>,
> = {
  readonly [statusResponseSymbol]: true
  readonly status: STATUS
  readonly body: BODY
  readonly headers?: HEADERS
}

export function createResponse<
  const STATUS extends StatusCode,
  const BODY,
  const HEADERS extends Record<string, string> = Record<string, string>,
>(
  status: STATUS,
  body: BODY,
  options?: ResponseOptions<HEADERS>,
): StatusResponse<STATUS, BODY, HEADERS> {
  return {
    [statusResponseSymbol]: true,
    status,
    body,
    headers: options?.headers,
  }
}

export const respond = createResponse

export function isStatusResponse(value: unknown): value is StatusResponse<StatusCode, unknown> {
  return typeof value === 'object' && value !== null && statusResponseSymbol in value
}
