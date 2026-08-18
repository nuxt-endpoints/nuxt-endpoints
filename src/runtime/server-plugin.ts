import { defineNitroPlugin } from 'nitropack/runtime/plugin'
import endpointsOptions from '#nuxt-endpoints/options'
import policyModule from '#nuxt-endpoints/idempotency-policy'
import type { EndpointDefinition } from './contract'
import { idempotencyMetadataWithoutRuntimeMessage } from './endpoint'
import { idempotencyRuntimeOptionKeys } from './idempotency'
import type {
  DefinedEndpoint,
  EndpointIdempotencyRuntimeMarker,
  EndpointRouteIdentity,
} from './endpoint'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import { createOpenApiDocument } from './openapi'
import { setOpenApiDocument } from './openapi-state'

type EndpointsRuntimeOptions = {
  openApi: {
    enabled: boolean
    title: string
    version: string
  }
}

type HandlerFunction = {
  __endpoint_contract__?: DefinedEndpoint<EndpointDefinition>
  __set_endpoint_route__?: (identity: EndpointRouteIdentity) => void
  __set_idempotency_policy__?: (policy: EndpointIdempotencyPolicy | undefined) => void
}

type HandlerDefinition = {
  route: string
  method: string
  load: () => Promise<HandlerFunction>
}

export default defineNitroPlugin(async () => {
  const options = endpointsOptions as EndpointsRuntimeOptions
  const { handlers: endpointHandlerManifest } = await import('#nuxt-endpoints/server-handlers')
  const policy = assertValidIdempotencyPolicy(policyModule)
  const document = await initializeEndpointHandlers(
    endpointHandlerManifest as HandlerDefinition[],
    options,
    policy,
  )
  if (document) {
    setOpenApiDocument(document)
  }
})

export async function initializeEndpointHandlers(
  handlers: HandlerDefinition[],
  options: EndpointsRuntimeOptions,
  policy?: EndpointIdempotencyPolicy,
) {
  const endpoints = await extractEndpoints(handlers, policy)
  if (!options.openApi.enabled) {
    return undefined
  }
  return createOpenApiDocument(endpoints, {
    title: options.openApi.title,
    version: options.openApi.version,
  })
}

export async function extractEndpoints(
  definitions: HandlerDefinition[],
  policy?: EndpointIdempotencyPolicy,
) {
  const endpoints = []

  for (const definition of definitions) {
    const handler = await resolveHandler(definition)
    if (!handler.__endpoint_contract__) {
      continue
    }

    if (handler.__endpoint_contract__.definition.idempotency) {
      const marker = handler.__endpoint_contract__.__idempotency_runtime_marker__
      if (!marker) {
        throw new Error(
          idempotencyMetadataWithoutRuntimeMessage(`for ${definition.method} ${definition.route}`),
        )
      }
      if (!handler.__set_endpoint_route__) {
        throw new Error(
          `[nuxt-endpoints] Idempotent endpoint ${definition.method} ${definition.route} does not expose a route metadata attachment hook.`,
        )
      }
      handler.__set_endpoint_route__({
        method: definition.method,
        routeTemplate: definition.route,
      })

      const missing = findMissingIdempotencyRuntimeOptions(marker, policy)
      if (missing.length > 0) {
        throw new Error(
          `[nuxt-endpoints] Idempotent endpoint ${definition.method} ${definition.route} is missing runtime options: ${missing.join(', ')}. Provide them in .idempotency() or define a central policy in server/endpoints/idempotency.ts.`,
        )
      }

      handler.__set_idempotency_policy__?.(policy)
    }

    endpoints.push({
      path: definition.route,
      method: definition.method,
      definition: handler.__endpoint_contract__.definition,
    })
  }

  return endpoints
}

async function resolveHandler(definition: HandlerDefinition): Promise<HandlerFunction> {
  return definition.load()
}

function findMissingIdempotencyRuntimeOptions(
  marker: EndpointIdempotencyRuntimeMarker,
  policy: EndpointIdempotencyPolicy | undefined,
): readonly string[] {
  return idempotencyRuntimeOptionKeys.filter((key) => !marker[key] && policy?.[key] === undefined)
}

function assertValidIdempotencyPolicy(value: unknown): EndpointIdempotencyPolicy | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isIdempotencyPolicyShape(value)) {
    throw new Error(
      '[nuxt-endpoints] server/endpoints/idempotency.ts must default-export defineIdempotencyPolicy({ storage, scope, authorization }).',
    )
  }
  return value
}

function isIdempotencyPolicyShape(value: unknown): value is EndpointIdempotencyPolicy {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.storage === 'function' &&
    typeof candidate.scope === 'function' &&
    (candidate.authorization === 'middleware' || typeof candidate.authorization === 'function')
  )
}
