// The idempotency execution flow, wired in as the built-in consumer of the
// handler-wrapper extension point (see `interceptor.ts`). Everything
// here runs between request validation and handler execution for endpoints
// that called `.idempotency()`; it owns key parsing, authorization,
// storage claim/replay, and completion, and always resolves to an
// `EndpointRuntimeResponse` rather than mutating the event itself.
import type { EndpointDefinition } from './contract'
import { createRuntimeError, getRuntimeRequestHeaders } from './h3-adapter'
import type { RuntimeEvent } from './h3-adapter'
import type {
  EndpointRouteIdentity,
  IdempotencyAuthorizationDelegation,
  NormalizedEndpointIdempotencyOptions,
  RuntimeIdempotencyContext,
} from './endpoint'
import type { EndpointHandlerWrapper, EndpointRuntimeResponse } from './interceptor'
import {
  createIdempotencyFingerprint,
  createIdempotencyStorageKey,
  hasHttpControlCharacter,
  idempotencyRuntimeOptionKeys,
} from './idempotency'
import type {
  IdempotencyReleaseInput,
  IdempotencyStorage,
  IdempotencyStoredResponse,
} from './idempotency'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

export type IdempotencyProblem = {
  type: 'about:blank'
  title: string
  status: 400 | 409 | 422
  detail: string
  code:
    | 'IDEMPOTENCY_KEY_REQUIRED'
    | 'IDEMPOTENCY_KEY_INVALID'
    | 'IDEMPOTENCY_REQUEST_IN_FLIGHT'
    | 'IDEMPOTENCY_KEY_REUSED'
    | 'IDEMPOTENCY_LEASE_LOST'
}

type IdempotencyKeyResult =
  | { outcome: 'missing' }
  | { outcome: 'invalid' }
  | { outcome: 'value'; value: string }

type ResolvedIdempotencyRuntimeOptions = {
  storage: (context: RuntimeIdempotencyContext) => MaybePromise<IdempotencyStorage>
  scope: (context: RuntimeIdempotencyContext) => MaybePromise<string>
  authorization:
    | IdempotencyAuthorizationDelegation
    | ((context: RuntimeIdempotencyContext) => MaybePromise<void>)
  leaseTtlMs: number
  replayTtlMs: number
}

const defaultIdempotencyLeaseTtlMs = 60_000
const defaultIdempotencyReplayTtlMs = 86_400_000

const replaySafeResponseHeaders = new Set([
  'cache-control',
  'content-language',
  'content-type',
  // A replay bypasses handler execution, so anything the response layer would
  // otherwise add has to survive here or be lost. `Vary` describes which
  // request fields the recorded answer depended on, and dropping it would let
  // a cache reuse this representation for a client that asked for another.
  'vary',
  'etag',
  'last-modified',
  'location',
  'retry-after',
])

export function createIdempotencyInterceptor<DEFINITION extends EndpointDefinition>(input: {
  options: NormalizedEndpointIdempotencyOptions
  getRouteIdentity: () => EndpointRouteIdentity | undefined
  getPolicy: () => EndpointIdempotencyPolicy | undefined
  /**
   * Whether this endpoint picks its response media type from `Accept`. Only
   * then does the negotiated type belong in the default fingerprint: with one
   * declared representation it is constant, so including it would change every
   * stored fingerprint without ever distinguishing two requests.
   */
  negotiatesResponseMediaType: boolean
}): EndpointHandlerWrapper<DEFINITION> {
  const { options: idempotency, getRouteIdentity, getPolicy, negotiatesResponseMediaType } = input

  return async (context, next) => {
    const key = readIdempotencyKey(context.event, idempotency.headerName)
    if (key.outcome === 'invalid') {
      return toIdempotencyProblemResponse(
        createIdempotencyProblem(
          400,
          'Bad Request',
          `The ${idempotency.headerName} header must contain one value between 1 and 255 characters without control characters or commas.`,
          'IDEMPOTENCY_KEY_INVALID',
        ),
      )
    }
    if (key.outcome === 'missing' && idempotency.required) {
      return toIdempotencyProblemResponse(
        createIdempotencyProblem(
          400,
          'Bad Request',
          `The ${idempotency.headerName} header is required for this endpoint.`,
          'IDEMPOTENCY_KEY_REQUIRED',
        ),
      )
    }

    const runtime = resolveIdempotencyRuntimeOptions(idempotency, getPolicy())
    const runtimeContext = context as unknown as RuntimeIdempotencyContext
    if (runtime.authorization !== 'middleware') {
      await runtime.authorization(runtimeContext)
    }

    if (key.outcome === 'missing') {
      return next()
    }

    const routeIdentity = getRouteIdentity()
    if (!routeIdentity) {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Route Metadata Error',
        data: { message: 'The endpoint route identity was not injected at Nitro startup.' },
      })
    }

    const storage = await runtime.storage(runtimeContext)
    assertIdempotencyStorage(storage)
    const scope = await runtime.scope(runtimeContext)
    if (typeof scope !== 'string' || scope.length === 0) {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Scope Error',
        data: { message: 'The idempotency scope resolver must return a non-empty string.' },
      })
    }

    // The default projection covers what the handler can observe, which is
    // what makes two requests the same request: a retry differing only in JSON
    // key order or in a value the schema coerces is one request, and a retry
    // asking for a different representation is not.
    const projection = idempotency.fingerprint
      ? await idempotency.fingerprint(runtimeContext)
      : {
          params: context.params,
          query: context.query,
          body: context.body,
          ...(negotiatesResponseMediaType ? { responseMediaType: context.responseMediaType } : {}),
        }
    const fingerprint = await createIdempotencyFingerprint(projection)
    const storageKey = await createIdempotencyStorageKey({
      method: routeIdentity.method,
      routeTemplate: routeIdentity.routeTemplate,
      scope,
      key: key.value,
    })
    const lease = globalThis.crypto.randomUUID()
    const claim = await storage.claim({
      storageKey,
      fingerprint,
      lease,
      leaseTtlMs: runtime.leaseTtlMs,
    })

    if (claim.outcome === 'completed') {
      return toReplayResponse(claim.response)
    }
    if (claim.outcome === 'conflict') {
      return toIdempotencyProblemResponse(
        createIdempotencyProblem(
          422,
          'Unprocessable Content',
          'This idempotency key was already used with a different request.',
          'IDEMPOTENCY_KEY_REUSED',
        ),
      )
    }
    if (claim.outcome === 'in-flight') {
      return toIdempotencyProblemResponse(
        createIdempotencyProblem(
          409,
          'Conflict',
          'A request with this idempotency key is still being processed.',
          'IDEMPOTENCY_REQUEST_IN_FLIGHT',
        ),
      )
    }
    if (claim.outcome !== 'acquired') {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Storage Error',
        data: { message: 'The storage adapter returned an unknown claim outcome.' },
      })
    }

    const leaseInput = { storageKey, fingerprint, lease }
    let response: EndpointRuntimeResponse
    try {
      response = await next()
    } catch (error) {
      await releaseLeaseAfterFailure(storage, leaseInput)
      throw error
    }

    if (!isReplayableStatus(response.status, idempotency.replayStatuses)) {
      await storage.release(leaseInput)
      return response
    }

    let snapshot: IdempotencyBodySnapshot
    try {
      snapshot = createIdempotencyBodySnapshot(response.body)
    } catch (error) {
      await releaseLeaseAfterFailure(storage, leaseInput)
      throw error
    }

    let completion
    try {
      completion = await storage.complete({
        ...leaseInput,
        response: {
          status: response.status,
          hasBody: snapshot.hasBody,
          serializedBody: snapshot.serializedBody,
          headers: filterReplaySafeHeaders(response.headers),
        },
        replayTtlMs: runtime.replayTtlMs,
      })
    } catch (error) {
      await releaseLeaseAfterFailure(storage, leaseInput)
      throw error
    }

    if (completion.outcome === 'lease-lost') {
      return toIdempotencyProblemResponse(
        createIdempotencyProblem(
          409,
          'Conflict',
          'The request exceeded its idempotency lease and its response was not recorded.',
          'IDEMPOTENCY_LEASE_LOST',
        ),
      )
    }
    if (completion.outcome !== 'applied') {
      await releaseLeaseAfterFailure(storage, leaseInput)
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Storage Error',
        data: { message: 'The storage adapter returned an unknown completion outcome.' },
      })
    }

    return { ...response, body: snapshot.body }
  }
}

// Startup validation (server-plugin.ts) guarantees every idempotent endpoint
// resolves storage/scope/authorization from itself or the central policy, so
// this is a defensive fallback rather than a path exercised in practice.
function resolveIdempotencyRuntimeOptions(
  endpointOptions: NormalizedEndpointIdempotencyOptions,
  policy: EndpointIdempotencyPolicy | undefined,
): ResolvedIdempotencyRuntimeOptions {
  // The policy's context type (`EndpointIdempotencyContext<EndpointDefinition>`)
  // is erased the same way as in `normalizeIdempotencyOptions`.
  const runtimePolicy = policy as unknown as Partial<ResolvedIdempotencyRuntimeOptions> | undefined
  const resolved = {
    storage: endpointOptions.storage ?? runtimePolicy?.storage,
    scope: endpointOptions.scope ?? runtimePolicy?.scope,
    authorization: endpointOptions.authorization ?? runtimePolicy?.authorization,
  }

  if (!hasAllIdempotencyRuntimeOptions(resolved)) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Runtime Options Error',
      data: {
        message:
          'The endpoint and its central policy together did not provide storage, scope, and authorization.',
      },
    })
  }

  return {
    storage: resolved.storage,
    scope: resolved.scope,
    authorization: resolved.authorization,
    leaseTtlMs:
      endpointOptions.leaseTtlMs ?? runtimePolicy?.leaseTtlMs ?? defaultIdempotencyLeaseTtlMs,
    replayTtlMs:
      endpointOptions.replayTtlMs ?? runtimePolicy?.replayTtlMs ?? defaultIdempotencyReplayTtlMs,
  }
}

function hasAllIdempotencyRuntimeOptions(resolved: {
  storage?: (context: RuntimeIdempotencyContext) => MaybePromise<IdempotencyStorage>
  scope?: (context: RuntimeIdempotencyContext) => MaybePromise<string>
  authorization?:
    | IdempotencyAuthorizationDelegation
    | ((context: RuntimeIdempotencyContext) => MaybePromise<void>)
}): resolved is {
  storage: (context: RuntimeIdempotencyContext) => MaybePromise<IdempotencyStorage>
  scope: (context: RuntimeIdempotencyContext) => MaybePromise<string>
  authorization:
    | IdempotencyAuthorizationDelegation
    | ((context: RuntimeIdempotencyContext) => MaybePromise<void>)
} {
  return idempotencyRuntimeOptionKeys.every((key) => resolved[key] !== undefined)
}

function readIdempotencyKey(event: RuntimeEvent, headerName: string): IdempotencyKeyResult {
  const lowerName = headerName.toLowerCase()
  const values: string[] = []

  for (const [name, value] of Object.entries(getRuntimeRequestHeaders(event))) {
    if (name.toLowerCase() !== lowerName || value === undefined) {
      continue
    }
    values.push(value)
  }

  if (values.length === 0) {
    return { outcome: 'missing' }
  }
  if (values.length !== 1) {
    return { outcome: 'invalid' }
  }

  const value = values[0]!
  if (
    value.length === 0 ||
    value.length > 255 ||
    value.includes(',') ||
    hasHttpControlCharacter(value)
  ) {
    return { outcome: 'invalid' }
  }
  return { outcome: 'value', value }
}

function assertIdempotencyStorage(value: unknown): asserts value is IdempotencyStorage {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('claim' in value) ||
    typeof value.claim !== 'function' ||
    !('complete' in value) ||
    typeof value.complete !== 'function' ||
    !('release' in value) ||
    typeof value.release !== 'function'
  ) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The idempotency storage resolver returned an invalid adapter.' },
    })
  }
}

function toIdempotencyProblemResponse(problem: IdempotencyProblem): EndpointRuntimeResponse {
  return {
    status: problem.status,
    body: problem,
    headers: { 'content-type': 'application/problem+json' },
    explicitStatus: true,
  }
}

function toReplayResponse(response: IdempotencyStoredResponse): EndpointRuntimeResponse {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response has an invalid HTTP status.' },
    })
  }

  if (typeof response.hasBody !== 'boolean') {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response must declare whether it has a body.' },
    })
  }
  if (typeof response.serializedBody !== 'string') {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response body must be JSON text.' },
    })
  }

  const headers = filterReplaySafeHeaders(response.headers)

  if (!response.hasBody) {
    if (response.serializedBody !== '') {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Storage Error',
        data: { message: 'A stored empty response must have an empty serialized body.' },
      })
    }
    return {
      status: response.status,
      body: undefined,
      ...(headers ? { headers } : {}),
      explicitStatus: true,
    }
  }

  let body: unknown
  try {
    body = JSON.parse(response.serializedBody)
  } catch (error) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response body is not valid JSON.', cause: error },
    })
  }

  return { status: response.status, body, ...(headers ? { headers } : {}), explicitStatus: true }
}

function filterReplaySafeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }
  const safeHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (replaySafeResponseHeaders.has(normalizedName)) {
      safeHeaders[normalizedName] = value
    }
  }
  return Object.keys(safeHeaders).length > 0 ? safeHeaders : undefined
}

function isReplayableStatus(status: number, additionalStatuses: readonly number[]): boolean {
  return (status >= 200 && status < 300) || additionalStatuses.includes(status)
}

function isUnserializableMediaBody(body: unknown): boolean {
  return (
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    // A Node readable, matched the way the HTTP layer sniffs for one.
    (typeof body === 'object' &&
      body !== null &&
      typeof (body as { pipe?: unknown }).pipe === 'function')
  )
}

type IdempotencyBodySnapshot =
  | { hasBody: false; serializedBody: ''; body: undefined }
  | { hasBody: true; serializedBody: string; body: unknown }

function createIdempotencyBodySnapshot(body: unknown): IdempotencyBodySnapshot {
  try {
    if (body === undefined) {
      return { hasBody: false, serializedBody: '', body: undefined }
    }
    if (typeof Response !== 'undefined' && body instanceof Response) {
      throw new TypeError('Native Response values are not supported by idempotency replay')
    }
    // Every other member of `EndpointMediaResponseBody` has to be rejected explicitly,
    // because `JSON.stringify` does not fail on them - a `ReadableStream` or a
    // `Blob` serializes to `{}` and a `Uint8Array` to `{"0":...}`. Recording
    // that would replay an empty object to a caller who was promised bytes.
    if (isUnserializableMediaBody(body)) {
      throw new TypeError(
        'Streamed and binary response bodies are not supported by idempotency replay',
      )
    }
    const serialized = JSON.stringify(body)
    if (serialized === undefined) {
      throw new TypeError('The response body is not JSON serializable')
    }
    return { hasBody: true, serializedBody: serialized, body: JSON.parse(serialized) }
  } catch (error) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Response Serialization Error',
      data: { message: 'The endpoint response body is not JSON serializable.', cause: error },
    })
  }
}

async function releaseLeaseAfterFailure(
  storage: IdempotencyStorage,
  input: IdempotencyReleaseInput,
): Promise<void> {
  try {
    await storage.release(input)
  } catch {
    // Preserve the original handler/storage error. The lease TTL is the final
    // recovery boundary when best-effort release cannot reach the adapter.
  }
}

function createIdempotencyProblem(
  status: IdempotencyProblem['status'],
  title: string,
  detail: string,
  code: IdempotencyProblem['code'],
): IdempotencyProblem {
  return { type: 'about:blank', title, status, detail, code }
}
