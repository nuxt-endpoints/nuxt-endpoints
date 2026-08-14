export type StatusCode = number

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
