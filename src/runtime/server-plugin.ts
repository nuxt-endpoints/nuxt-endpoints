import { defineNitroPlugin } from 'nitropack/runtime/plugin'
import endpointsOptions from '#nuxt-endpoints/options'
import type { EndpointDefinition } from './contract'
import type { DefinedEndpoint } from './endpoint'
import type { EndpointRouteIdentity } from './endpoint'
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
}

type HandlerDefinition = {
  route: string
  method: string
  load: () => Promise<HandlerFunction>
}

export default defineNitroPlugin(async () => {
  const options = endpointsOptions as EndpointsRuntimeOptions
  const { handlers: endpointHandlerManifest } = await import('#nuxt-endpoints/server-handlers')
  const document = await initializeEndpointHandlers(
    endpointHandlerManifest as HandlerDefinition[],
    options,
  )
  if (document) {
    setOpenApiDocument(document)
  }
})

export async function initializeEndpointHandlers(
  handlers: HandlerDefinition[],
  options: EndpointsRuntimeOptions,
) {
  const endpoints = await extractEndpoints(handlers)
  if (!options.openApi.enabled) {
    return undefined
  }
  return createOpenApiDocument(endpoints, {
    title: options.openApi.title,
    version: options.openApi.version,
  })
}

export async function extractEndpoints(definitions: HandlerDefinition[]) {
  const endpoints = []

  for (const definition of definitions) {
    const handler = await resolveHandler(definition)
    if (!handler.__endpoint_contract__) {
      continue
    }

    if (handler.__endpoint_contract__.definition.idempotency) {
      if (!handler.__endpoint_contract__.__idempotency_runtime__) {
        throw new Error(
          `[nuxt-endpoints] Idempotency metadata for ${definition.method} ${definition.route} has no matching server runtime policy. Use DefinedEndpoint.idempotency() instead of writing metadata directly.`,
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
