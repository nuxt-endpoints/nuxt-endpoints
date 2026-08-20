import type { MediaResponseContract } from './contract'

export type StatusCode = number

/**
 * Whether a declared response hands its payload to the socket untouched. A
 * string `media` is the discriminant: a validator schema never carries one,
 * and neither does the validated `{ body }` form - that one declares a
 * `contentType` instead, which is checked to be a JSON media type.
 */
export function isMediaResponseContract(contract: unknown): contract is MediaResponseContract {
  if (typeof contract !== 'object' || contract === null || !('media' in contract)) {
    return false
  }
  const media = (contract as { media: unknown }).media
  return typeof media === 'string' || Array.isArray(media)
}

/**
 * The media types a declared response offers, in declaration order. That order
 * is the endpoint's own preference, and negotiation uses it to break ties and
 * to answer a request that expresses none.
 */
export function mediaTypesOf(contract: MediaResponseContract): readonly string[] {
  return typeof contract.media === 'string' ? [contract.media] : contract.media
}

/**
 * Whether a media type still describes a JSON payload. Covers
 * `application/json` and every `+json` profile - `application/problem+json`,
 * `application/vnd.api+json`, `application/ld+json` - which are the cases
 * where a validated body and a non-default media type genuinely coexist.
 */
export function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(';')[0]!.trim().toLowerCase()
  return /^application\/([\w.-]+\+)?json$/.test(essence)
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
