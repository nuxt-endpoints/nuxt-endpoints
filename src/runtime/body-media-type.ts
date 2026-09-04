// Media-type-map `body` contracts: runtime discrimination against a single
// validator schema, definition-time validation (runs during `defineEndpoint`,
// including at build-time jiti evaluation), and the request-time parsing
// helpers used by `buildContext` in endpoint.ts.
import type { EndpointBodyMediaTypeMap } from './contract'
import { isEffectSchemaLike } from './validators/effect-schema'
import { isStandardSchema } from './validators/standard-schema'
import { isObjectLike, type ValidatorSchema } from './validators/common'

const jsonMediaType = 'application/json'
const urlEncodedMediaType = 'application/x-www-form-urlencoded'
const multipartMediaType = 'multipart/form-data'

export const supportedBodyMediaTypesMessage = `${jsonMediaType}, ${urlEncodedMediaType}, ${multipartMediaType}, or a specific text/* type (e.g. text/plain, text/csv)`

/**
 * Whether the runtime can turn a body of this media type into a value a schema
 * could check. Only a schema member is held to this: an unparsed member (`true`)
 * is handed over as bytes, so any well-formed media type will do.
 */
export function isSupportedBodyMediaType(mediaType: string): boolean {
  return (
    mediaType === jsonMediaType ||
    mediaType === urlEncodedMediaType ||
    mediaType === multipartMediaType ||
    mediaType.startsWith('text/')
  )
}

// Schema-shape markers reused from the existing validator dispatch
// (`parseValidator` in validator.ts): a Standard Schema, an Effect Schema, or
// (the catch-all in that dispatch) something with a Zod-like `safeParse`.
function isValidatorSchemaMarker(value: unknown): value is ValidatorSchema {
  return (
    isStandardSchema(value) ||
    isEffectSchemaLike(value) ||
    (isObjectLike(value) && typeof (value as { safeParse?: unknown }).safeParse === 'function')
  )
}

function isPlainMapCandidate(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Discriminates an `EndpointRequestContract['body']` value between a single
 * validator schema and a media-type map. Schema markers are checked first
 * (see `isValidatorSchemaMarker`); a map is recognized by every key
 * containing `/` and every value being object-like (vacuously true for an
 * empty object, so `defineEndpoint`'s dedicated "empty map" check — not this
 * function — is what rejects `{}`). Anything matching neither shape throws
 * instead of silently guessing.
 */
export function isBodyMediaTypeMap(
  body: ValidatorSchema | EndpointBodyMediaTypeMap,
): body is EndpointBodyMediaTypeMap {
  if (isValidatorSchemaMarker(body)) {
    return false
  }

  if (isPlainMapCandidate(body)) {
    const entries = Object.entries(body)
    if (
      entries.every(
        ([mediaType, member]) =>
          mediaType.includes('/') && (member === true || isObjectLike(member)),
      )
    ) {
      return true
    }
  }

  throw new TypeError(
    'Endpoint body contract must be either a validator schema or an object mapping media types (e.g. "application/json") to a validator schema or `true`.',
  )
}

/**
 * Definition-time validation for a media-type map `body` contract. Runs
 * inside `defineEndpoint`, so a malformed map fails at module evaluation —
 * including the jiti evaluation Nuxt performs at build time.
 */
export function validateBodyMediaTypeMapDefinition(map: EndpointBodyMediaTypeMap): void {
  const entries = Object.entries(map)
  if (entries.length === 0) {
    throw new TypeError('Endpoint body media-type map must declare at least one media type.')
  }

  for (const [mediaType, member] of entries) {
    if (mediaType !== mediaType.trim()) {
      throw new TypeError(
        `Endpoint body media type "${mediaType}" must not have leading or trailing whitespace.`,
      )
    }
    if (mediaType !== mediaType.toLowerCase()) {
      throw new TypeError(`Endpoint body media type "${mediaType}" must be lowercase.`)
    }
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)) {
      throw new TypeError(
        `Endpoint body media type "${mediaType}" is not a single type/subtype media type.`,
      )
    }

    // `true` is the unparsed door and accepts any media type. A schema member
    // has to name one the runtime can parse, because otherwise there is nothing
    // for that schema to check.
    if (member === true) {
      continue
    }
    if (!isValidatorSchemaMarker(member)) {
      throw new TypeError(
        `Endpoint body media-type map member "${mediaType}" must be a validator schema, or \`true\` to accept the media type and receive the body unparsed.`,
      )
    }
    if (!isSupportedBodyMediaType(mediaType)) {
      throw new TypeError(
        `Endpoint body media type "${mediaType}" cannot be validated by a schema, because the runtime does not parse it. Declare it as \`true\` to receive the body unparsed, or use one of: ${supportedBodyMediaTypesMessage}.`,
      )
    }
  }
}

/** Strips parameters (e.g. `; charset=utf-8`) and normalizes case/whitespace. */
export function normalizeBodyContentType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const [type] = value.split(';')
  const normalized = type?.trim().toLowerCase()
  return normalized || undefined
}

/**
 * Converts a `multipart/form-data` `FormData` into a plain object: repeated
 * keys become arrays, and values stay as `string` or `File` (never coerced).
 */
export function formDataToPlainObject(
  formData: FormData,
): Record<string, string | File | (string | File)[]> {
  const result: Record<string, string | File | (string | File)[]> = {}

  for (const [key, value] of formData.entries()) {
    const existing = result[key]
    if (existing === undefined) {
      result[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[key] = [existing, value]
    }
  }

  return result
}

/**
 * The media type a native `<form>` would send for this body contract, and the
 * member that describes it.
 *
 * A form can only submit url-encoded or multipart, so a contract that declares
 * neither cannot be reached by one - which is a declaration error rather than
 * something to discover at request time.
 */
export function findFormBodyMember(
  body: ValidatorSchema | EndpointBodyMediaTypeMap | undefined,
): { mediaType: string; schema: ValidatorSchema } | undefined {
  if (body === undefined || !isBodyMediaTypeMap(body)) {
    return undefined
  }
  const map = body as Record<string, unknown>
  for (const mediaType of [multipartMediaType, urlEncodedMediaType]) {
    const member = map[mediaType]
    if (isValidatorSchemaMarker(member)) {
      return { mediaType, schema: member }
    }
  }
  return undefined
}
