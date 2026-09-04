import { definePlugin } from 'nitro'
import { formRoutes } from '#nuxt-endpoints/form-routes'
import endpointsOptions from '#nuxt-endpoints/options'
import endpointRuntimeModule from '#nuxt-endpoints/runtime'
import serverRouteConfigModule from '#nuxt-endpoints/server-route-config'
import type { EndpointDefinition } from './contract'
import { idempotencyMetadataWithoutRuntimeMessage } from './endpoint'
import { idempotencyRuntimeOptionKeys } from './idempotency'
import type {
  DefinedEndpoint,
  EndpointIdempotencyRuntimeMarker,
  EndpointRouteIdentity,
} from './endpoint'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import {
  resolveEndpointResponseValidation,
  resolveEndpointRouteRuntime,
  validateEndpointRuntime,
} from './endpoint-runtime'
import type {
  EndpointRouteRuntime,
  EndpointRuntime,
  EndpointRuntimeAttachmentOptions,
} from './endpoint-runtime'
import { setFormRoutes } from './form-routes-state'
import type { EndpointFormRouteEntry } from '../codegen/form-routes'
import { createOpenApiDocument } from './openapi'
import { setOpenApiDocument } from './openapi-state'
import { resolveServerRouteResponseMaps, validateServerRouteConfig } from './server-route-config'
import type { ServerRouteConfig } from './server-route-config'

type EndpointsRuntimeOptions = {
  dev: boolean
  openApi: {
    enabled: boolean
    title: string
    version: string
  }
}

type HandlerFunction = {
  __endpoint_contract__?: DefinedEndpoint<EndpointDefinition>
  // Present on a defineEndpointMethodHandlers() dispatcher instead of
  // __endpoint_contract__: one DefinedEndpoint per declared method, keyed by
  // that method. Every manifest entry for a method-group route shares the
  // same dispatcher (same `load()`), differing only in `definition.method`
  // below, so the matching member is picked per manifest entry.
  __endpoint_contracts__?: Record<string, DefinedEndpoint<EndpointDefinition>>
  __set_endpoint_route__?: (identity: EndpointRouteIdentity) => void
  __set_endpoint_runtime__?: (
    runtime: EndpointRuntime | undefined,
    endpointRuntime?: EndpointRouteRuntime,
    identity?: EndpointRouteIdentity,
    attachment?: EndpointRuntimeAttachmentOptions,
  ) => void
}

type HandlerDefinition = {
  route: string
  method: string
  load: () => Promise<HandlerFunction>
}

export default definePlugin(async () => {
  const options = endpointsOptions as EndpointsRuntimeOptions
  // Handed over rather than imported by the bridge itself - see
  // form-routes-state.ts for why.
  setFormRoutes(formRoutes as Readonly<Record<string, EndpointFormRouteEntry>>)
  const { handlers: endpointHandlerManifest } = await import('#nuxt-endpoints/server-handlers')
  const endpointRuntime = assertValidEndpointRuntime(endpointRuntimeModule)
  const serverRouteConfig = assertValidServerRouteConfig(serverRouteConfigModule)
  const document = await initializeEndpointHandlers(
    endpointHandlerManifest as HandlerDefinition[],
    options,
    endpointRuntime,
    serverRouteConfig,
  )
  if (document) {
    setOpenApiDocument(document)
  }
})

export async function initializeEndpointHandlers(
  handlers: HandlerDefinition[],
  options: EndpointsRuntimeOptions,
  runtime?: EndpointRuntime,
  serverRouteConfig?: ServerRouteConfig,
) {
  const endpoints = await extractEndpoints(handlers, runtime, serverRouteConfig, options.dev)
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
  serverRouteConfig?: ServerRouteConfig,
  isDevelopment = true,
) {
  const endpoints = []
  const matchedRuntimeEntries = new Set<string>()
  const handlerRegistrations = new WeakMap<
    HandlerFunction,
    { identity: string; hasOverride: boolean }
  >()
  const attachment: EndpointRuntimeAttachmentOptions = {
    responseValidation: resolveEndpointResponseValidation(runtime, isDevelopment),
  }

  for (const definition of definitions) {
    const handler = await resolveHandler(definition)
    const contract = resolveEndpointContract(handler, definition)
    if (!contract) {
      continue
    }

    const identity = {
      method: definition.method.toLowerCase(),
      routeTemplate: definition.route,
    }
    const routeRuntime = resolveEndpointRouteRuntime(
      runtime,
      identity.routeTemplate,
      identity.method,
    )
    assertRouteRuntimeIsNotShared(handler, identity, routeRuntime, handlerRegistrations)
    if (routeRuntime) {
      matchedRuntimeEntries.add(runtimeEntryKey(identity.routeTemplate, identity.method))
      if (!handler.__set_endpoint_runtime__) {
        throw new Error(
          `[nuxt-endpoints] Endpoint ${identity.method} ${identity.routeTemplate} does not expose a runtime attachment hook.`,
        )
      }
      handler.__set_endpoint_runtime__(runtime, routeRuntime, identity, attachment)
    } else {
      // Every endpoint receives application defaults and the build-mode
      // decision even when it has no route-specific runtime override.
      handler.__set_endpoint_runtime__?.(runtime, undefined, identity, attachment)
    }

    if (routeRuntime?.idempotency && !contract.definition.idempotency) {
      throw new Error(
        `[nuxt-endpoints] Runtime entry ${identity.method} ${identity.routeTemplate} configures idempotency, but the route contract does not enable it.`,
      )
    }

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
        method: identity.method,
        routeTemplate: identity.routeTemplate,
      })

      if (
        contract.__idempotency_fingerprint_deferred__ &&
        contract.definition.body === undefined &&
        routeRuntime?.idempotency?.fingerprint === undefined
      ) {
        throw new Error(
          `[nuxt-endpoints] Bodyless idempotent endpoint ${identity.method} ${identity.routeTemplate} needs routes["${identity.routeTemplate}"].${identity.method}.idempotency.fingerprint in server/endpoints/runtime.ts.`,
        )
      }

      const missing = findMissingIdempotencyRuntimeOptions(marker, runtime?.idempotency)
      if (missing.length > 0) {
        throw new Error(
          `[nuxt-endpoints] Idempotent endpoint ${definition.method} ${definition.route} is missing runtime options: ${missing.join(', ')}. Provide route overrides or an application idempotency policy in server/endpoints/runtime.ts.`,
        )
      }
    }

    endpoints.push({
      path: definition.route,
      method: definition.method,
      definition: contract.definition,
      serverResponseMaps: resolveServerRouteResponseMaps(
        serverRouteConfig,
        definition.route,
        definition.method,
      ),
    })
  }

  assertNoUnmatchedRuntimeEntries(runtime, matchedRuntimeEntries)

  return endpoints
}

function assertRouteRuntimeIsNotShared(
  handler: HandlerFunction,
  identity: EndpointRouteIdentity,
  routeRuntime: EndpointRouteRuntime | undefined,
  registrations: WeakMap<HandlerFunction, { identity: string; hasOverride: boolean }>,
): void {
  // A method-group dispatcher targets a distinct member for each identity.
  if (handler.__endpoint_contracts__) return

  const current = `${identity.method} ${identity.routeTemplate}`
  const previous = registrations.get(handler)
  if (previous && (previous.hasOverride || routeRuntime !== undefined)) {
    throw new Error(
      `[nuxt-endpoints] Route-specific runtime settings cannot be attached to a handler shared by ${previous.identity} and ${current}. Export a distinct defineRouteHandler() instance for each route.`,
    )
  }
  registrations.set(handler, {
    identity: previous?.identity ?? current,
    hasOverride: previous?.hasOverride === true || routeRuntime !== undefined,
  })
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
      `[nuxt-endpoints] Endpoint route ${definition.method} ${definition.route} has no matching method entry in its defineRouteHandler(). Declared methods: ${Object.keys(handler.__endpoint_contracts__).join(', ')}.`,
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

function assertNoUnmatchedRuntimeEntries(
  runtime: EndpointRuntime | undefined,
  matched: ReadonlySet<string>,
): void {
  for (const [path, methods] of Object.entries(runtime?.routes ?? {})) {
    for (const method of Object.keys(methods)) {
      if (!matched.has(runtimeEntryKey(path, method))) {
        throw new Error(
          `[nuxt-endpoints] Runtime entry ${method} ${path} does not match a discovered endpoint route.`,
        )
      }
    }
  }
}

function runtimeEntryKey(path: string, method: string): string {
  return `${method.toLowerCase()} ${path}`
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
  try {
    validateEndpointRuntime(value)
  } catch (error) {
    throw new Error(
      '[nuxt-endpoints] server/endpoints/runtime.ts must default-export a valid defineEndpointRuntime({ ... }) value.',
      { cause: error },
    )
  }
  const runtime = value
  if (runtime.idempotency !== undefined && !isIdempotencyPolicyShape(runtime.idempotency)) {
    throw new Error(
      '[nuxt-endpoints] The idempotency policy in server/endpoints/runtime.ts needs storage, scope, and authorization.',
    )
  }
  return runtime
}

function assertValidServerRouteConfig(value: unknown): ServerRouteConfig | undefined {
  if (value === undefined) {
    return undefined
  }
  try {
    validateServerRouteConfig(value)
  } catch (error) {
    throw new Error(
      '[nuxt-endpoints] server/routes.config.ts must default-export a valid defineServerRouteConfig({ ... }) value.',
      { cause: error },
    )
  }
  return value
}
