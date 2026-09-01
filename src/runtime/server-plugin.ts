import { defineNitroPlugin } from 'nitropack/runtime/plugin'
import endpointsOptions from '#nuxt-endpoints/options'
import endpointRuntimeModule from '#nuxt-endpoints/runtime'
import type { EndpointDefinition } from './contract'
import { idempotencyMetadataWithoutRuntimeMessage } from './endpoint'
import { idempotencyRuntimeOptionKeys } from './idempotency'
import type {
  DefinedEndpoint,
  EndpointIdempotencyRuntimeMarker,
  EndpointRouteIdentity,
} from './endpoint'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import type { EndpointRuntime } from './endpoint-runtime'
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
  // Private compatibility carrier for the canonical multi-method form.
  __endpoint_contracts__?: Record<string, DefinedEndpoint<EndpointDefinition>>
  __set_endpoint_route__?: (identity: EndpointRouteIdentity) => void
  __set_endpoint_runtime__?: (runtime: EndpointRuntime | undefined) => void
}

type HandlerDefinition = {
  route: string
  method: string
  load: () => Promise<HandlerFunction>
}

export default defineNitroPlugin(async () => {
  const options = endpointsOptions as EndpointsRuntimeOptions
  const { handlers: endpointHandlerManifest } = await import('#nuxt-endpoints/server-handlers')
  const endpointRuntime = assertValidEndpointRuntime(endpointRuntimeModule)
  const document = await initializeEndpointHandlers(
    endpointHandlerManifest as HandlerDefinition[],
    options,
    endpointRuntime,
  )
  if (document) {
    setOpenApiDocument(document)
  }
})

export async function initializeEndpointHandlers(
  handlers: HandlerDefinition[],
  options: EndpointsRuntimeOptions,
  runtime?: EndpointRuntime,
) {
  const endpoints = await extractEndpoints(handlers, runtime)
  if (!options.openApi.enabled) {
    return undefined
  }
  return createOpenApiDocument(endpoints, {
    title: options.openApi.title,
    version: options.openApi.version,
    // `document` and `extend` cannot come from `nuxt.config.ts`: one carries
    // arbitrary nested values and the other is a function, and module options
    // reach the server as JSON. They arrive from the endpoint runtime file for
    // the same reason the idempotency policy does.
    document: runtime?.openApi?.document,
    extend: runtime?.openApi?.extend,
  })
}

export async function extractEndpoints(
  definitions: HandlerDefinition[],
  runtime?: EndpointRuntime,
) {
  const endpoints = []

  for (const definition of definitions) {
    const handler = await resolveHandler(definition)
    const contract = resolveEndpointContract(handler, definition)
    if (!contract) {
      continue
    }

    // Every endpoint receives the application-wide hooks, whether or not it
    // declares its own: precedence is resolved per request, not by suppressing
    // this injection.
    handler.__set_endpoint_runtime__?.(runtime)

    if (contract.definition.idempotency) {
      const marker = contract.__idempotency_runtime_marker__
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

      const missing = findMissingIdempotencyRuntimeOptions(marker, runtime?.idempotency)
      if (missing.length > 0) {
        throw new Error(
          `[nuxt-endpoints] Idempotent endpoint ${definition.method} ${definition.route} is missing runtime options: ${missing.join(', ')}. Provide them in .idempotency() or declare an idempotency policy in server/endpoints/runtime.ts.`,
        )
      }
    }

    endpoints.push({
      path: definition.route,
      method: definition.method,
      definition: contract.definition,
    })
  }

  return endpoints
}

// A method-group dispatcher (`__endpoint_contracts__`) exposes one
// DefinedEndpoint per declared method instead of a single
// `__endpoint_contract__`; every manifest entry for such a route shares the
// same dispatcher, so the member matching this entry's own method is the one
// that applies here. Codegen only ever emits a manifest entry whose method
// was itself read from that same `__endpoint_contracts__` map (see
// composeHandlers in module.ts), so a missing member here means the running
// build's manifest and the loaded handler module have drifted apart.
function resolveEndpointContract(
  handler: HandlerFunction,
  definition: HandlerDefinition,
): DefinedEndpoint<EndpointDefinition> | undefined {
  if (!handler.__endpoint_contracts__) {
    return handler.__endpoint_contract__
  }

  const member = handler.__endpoint_contracts__[definition.method]
  if (!member) {
    throw new Error(
      `[nuxt-endpoints] Endpoint route ${definition.method} ${definition.route} has no matching member in its multi-method defineRouteHandler(). Declared methods: ${Object.keys(handler.__endpoint_contracts__).join(', ')}.`,
    )
  }
  return member
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

function assertValidEndpointRuntime(value: unknown): EndpointRuntime | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(
      '[nuxt-endpoints] server/endpoints/runtime.ts must default-export defineEndpointRuntime({ ... }).',
    )
  }
  const runtime = value as EndpointRuntime
  if (runtime.idempotency !== undefined && !isIdempotencyPolicyShape(runtime.idempotency)) {
    throw new Error(
      '[nuxt-endpoints] The idempotency policy in server/endpoints/runtime.ts needs storage, scope, and authorization.',
    )
  }
  return runtime
}
