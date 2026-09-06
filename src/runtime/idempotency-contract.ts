import type { EndpointIdempotencyMetadata } from './contract'
import { idempotencyRouteContractForbiddenOptionKeys } from './idempotency'

export const defaultIdempotencyHeaderName = 'Idempotency-Key'

/** Normalizes route-authoring syntax before it crosses the contract boundary. */
export function normalizeEndpointIdempotencyMetadata(
  input: unknown,
): EndpointIdempotencyMetadata | undefined {
  if (input === undefined) return undefined
  if (input === true) {
    return {
      enabled: true,
      headerName: defaultIdempotencyHeaderName,
      required: true,
    }
  }
  if (input === false || typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(
      'Idempotency is enabled by declaring `idempotency: true` or an options object; omit the property to disable it.',
    )
  }

  const candidate = input as Record<string, unknown>
  for (const runtimeOption of idempotencyRouteContractForbiddenOptionKeys) {
    if (runtimeOption in candidate) {
      throw new TypeError(
        `Runtime-only idempotency option \`${runtimeOption}\` cannot be declared in a route contract. Use server/endpoints/runtime.ts instead.`,
      )
    }
  }
  const unknown = Object.keys(candidate).find(
    (key) => !['enabled', 'headerName', 'required'].includes(key),
  )
  if (unknown) {
    throw new TypeError(`Unknown idempotency route option \`${unknown}\`.`)
  }
  if (candidate.enabled !== undefined && candidate.enabled !== true) {
    throw new TypeError('idempotency.enabled can only be true; omit idempotency to disable it.')
  }
  const headerName = candidate.headerName ?? defaultIdempotencyHeaderName
  if (typeof headerName !== 'string') {
    throw new TypeError('Idempotency headerName must be a string')
  }
  if (!isValidHttpHeaderName(headerName)) {
    throw new TypeError('Idempotency headerName must be a valid HTTP header field name')
  }
  if (candidate.required !== undefined && typeof candidate.required !== 'boolean') {
    throw new TypeError('Idempotency required must be a boolean')
  }
  return {
    enabled: true,
    headerName,
    required: (candidate.required as boolean | undefined) ?? true,
  }
}

export function isValidHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
}
