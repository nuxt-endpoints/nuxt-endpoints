import fsp from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  addImports,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  addServerTemplate,
  createResolver,
  defineNuxtModule,
  findPath,
  useLogger,
} from '@nuxt/kit'
import type { Nuxt, NuxtModule } from '@nuxt/schema'
import type { NitroRouteContract, NitroTypes } from 'nitro/types'
import { camelCase } from 'scule'
import {
  generateEndpointClient,
  generateEndpointHandlerManifest,
  generateEndpointTypes,
  toImportPath,
} from './codegen'
import type { EndpointRouteHandler } from './codegen'
import { collectNitroRouteHandlers } from './nitro-route-handlers'
import type { NitroRouteHandlerDescriptor, NitroRouteHandlerSource } from './nitro-route-handlers'
import { isMediaResponseContract } from './runtime/response'
import type { EndpointDefinition, EndpointIdempotencyMetadata } from './runtime/contract'
import { inspectValidatorInputObject } from './runtime/validator'

export type EndpointsModuleOptions = {
  openApi?: boolean | EndpointsOpenApiModuleOptions
  client?: EndpointsClientModuleOptions
  runtime?: EndpointsRuntimeModuleOptions
}

export type EndpointsRuntimeModuleOptions = {
  /**
   * Path to the application-wide endpoint runtime module, resolved from the
   * project root. Defaults to `server/endpoints/runtime`.
   */
  path?: string
}

const idempotencyPolicyExtensions = ['.ts', '.mts', '.js', '.mjs']

// Only the canonical identifier is auto-imported. Nitro's contract macro
// recognizes no other name, so a route authored through anything else would be
// served without its contract ever reaching the build.
const endpointServerAutoImports = ['defineRouteHandler'] as const

export type EndpointsOpenApiModuleOptions = {
  enabled?: boolean
  path?: string
  title?: string
  version?: string
}

export type EndpointsClientModuleOptions = {
  raw?: boolean
}

type ResolvedEndpointsModuleOptions = {
  openApi: {
    enabled: boolean
    path: string
    title: string
    version: string
  }
  client: {
    raw: boolean
  }
}

// The definition fields a discovery-evaluated module's carrier exposes.
// Derived (rather than hand-declared) so a shape change to `EndpointDefinition`
// surfaces here as a compile error instead of silently going unread.
type EndpointCarrierDefinition = Pick<EndpointDefinition, 'idempotency' | 'headers' | 'responses'>

// Detection result for one declared method (single endpoint, or one member
// of a defineEndpointMethods() group).
type EndpointMethodDetection = {
  idempotency?: EndpointIdempotencyMetadata
  /** Set when any declared status is a media response, so it is never parsed. */
  mediaResponse?: true
}

// A single-endpoint route's detection stays exactly the shape it always was
// (EndpointMethodDetection, spread at the top level); a method-group route's
// detection instead carries one EndpointMethodDetection per declared method,
// keyed by that method. composeHandlers tells the two apart by checking for
// a `methods` property.
type EndpointDetection =
  | EndpointMethodDetection
  | { methods: Record<string, EndpointMethodDetection> }

type NitroWithEndpointHandlers = NitroRouteHandlerSource & {
  getRouteContracts: () => Promise<NitroRouteContract<EndpointDefinition>[]>
  options: {
    scanDirs: string[]
    dev?: boolean
    experimental?: { openAPI?: boolean }
    openAPI?: { route?: string; production?: false | 'runtime' | 'prerender' }
  }
  hooks: {
    hook: (name: 'types:extend', listener: (types: NitroTypes) => void | Promise<void>) => void
  }
}

type EndpointsNuxtHook = ((
  name: 'nitro:init',
  listener: (nitro: NitroWithEndpointHandlers) => void | Promise<void>,
) => void) &
  ((
    name: 'nitro:config',
    listener: (config: {
      ignore?: string[]
      experimental?: { routeContracts?: boolean; routeContractSources?: string[] }
    }) => void,
  ) => void)

// Sibling contract files live next to their route inside server/api, so Nitro
// must be told not to register them as routes. The pattern also excludes
// matching filenames from Nitro's public-asset copying — documented in the
// contract-file docs.
const endpointContractIgnorePattern = '**/*.endpoint-contract.*'

const moduleName = 'endpoints'

type NuxtEndpointsModule = NuxtModule<EndpointsModuleOptions, EndpointsModuleOptions, false>

const nuxtEndpointsModule: NuxtEndpointsModule = defineNuxtModule<EndpointsModuleOptions>({
  meta: {
    name: `nuxt-${moduleName}`,
    configKey: camelCase(moduleName),
    compatibility: {
      // The `upstream-integration` branch targets the Nuxt 5 nightly stack
      // only. `main` keeps the `^4.5.0` claim.
      nuxt: '^5.0.0-0',
    },
  },
  // All defaulting is centralized in `resolveModuleOptions` so there is a single
  // source of truth; a `defaults` block here would duplicate those values and
  // pre-fill `options.openApi`, making the `options.openApi === undefined`
  // branch below unreachable.
  // The parameters are annotated rather than inferred: `defineNuxtModule`
  // takes `ModuleDefinition<…> | NuxtModule<…>`, and contextual typing does
  // not reach a method's parameters through that union, so both arrive as
  // implicit `any`. Annotating restores exactly the types the overload would
  // have supplied.
  async setup(options: EndpointsModuleOptions, nuxt: Nuxt) {
    const resolver = createResolver(import.meta.url)
    const resolve = (...paths: string[]) => resolver.resolve(...paths)
    const typeFile = resolve(nuxt.options.buildDir, `types/${moduleName}.d.ts`)
    const runtimeFile = resolve(nuxt.options.buildDir, `${moduleName}.ts`)
    const resolvedOptions = resolveModuleOptions(options, nuxt.options.dev)
    const logger = useLogger('nuxt-endpoints')
    let endpointHandlerManifest: EndpointRouteHandler[] | undefined
    // An explicit module option resolves immediately; the convention lookup is
    // deferred to `nitro:init` so it can walk Nitro's own resolved scanDirs
    // (project server dir, layer server dirs, custom scanDirs) instead of
    // re-deriving that list here.
    let runtimePath = options.runtime?.path
      ? await resolveExplicitConventionPath(nuxt, options.runtime.path, 'endpoints.runtime.path')
      : undefined
    let runtimePathResolved = options.runtime?.path !== undefined

    addServerTemplate({
      filename: `#nuxt-${moduleName}/options`,
      getContents: () => `export default ${JSON.stringify(resolvedOptions, null, 2)}\n`,
    })
    addServerTemplate({
      filename: `#nuxt-${moduleName}/server-handlers`,
      getContents: () => {
        if (!endpointHandlerManifest) {
          throw new Error(
            '[nuxt-endpoints] Endpoint handler manifest was requested before Nitro route discovery completed.',
          )
        }
        return generateEndpointHandlerManifest(endpointHandlerManifest)
      },
    })

    addServerTemplate({
      filename: `#nuxt-${moduleName}/runtime`,
      getContents: () => {
        if (!runtimePathResolved) {
          throw new Error(
            '[nuxt-endpoints] Endpoint runtime template was requested before Nitro route discovery completed.',
          )
        }
        return runtimePath
          ? `import * as handlerModule from '${toImportPath(runtimePath)}'\nexport default handlerModule.default\n`
          : 'export default undefined\n'
      },
    })

    const hook = nuxt.hook as unknown as EndpointsNuxtHook
    hook('nitro:config', (nitroConfig) => {
      nitroConfig.ignore = [...(nitroConfig.ignore ?? []), endpointContractIgnorePattern]
      nitroConfig.experimental = {
        ...nitroConfig.experimental,
        routeContracts: true,
        routeContractSources: [
          ...(nitroConfig.experimental?.routeContractSources ?? []),
          resolve('./runtime'),
        ],
      }
    })
    hook('nitro:init', async (nitro) => {
      if (resolvedOptions.openApi.enabled) {
        assertOpenApiRoutesDoNotOverlap(nitro, resolvedOptions.openApi.path, (message) =>
          logger.warn(message),
        )
      }
      const generateArtifacts = async () => {
        if (!options.runtime?.path) {
          runtimePath = await resolveConventionPath(
            nuxt.options.rootDir,
            nitro.options.scanDirs,
            'endpoints/runtime',
          )
          runtimePathResolved = true
        }
        const handlers = await composeHandlers(
          collectNitroRouteHandlers(nitro),
          indexRouteContracts(await nitro.getRouteContracts()),
        )
        endpointHandlerManifest = handlers
        await writeGenerated(typeFile, generateEndpointTypes(resolve, handlers, resolvedOptions))
        await writeGenerated(
          runtimeFile,
          generateEndpointClient(resolve, handlers, resolvedOptions),
        )
      }

      await generateArtifacts()
      nitro.hooks.hook('types:extend', generateArtifacts)
    })

    nuxt.options.build.transpile.push(resolve('./runtime'))
    addServerPlugin(resolve('./runtime/server-plugin'))
    if (resolvedOptions.openApi.enabled) {
      addServerHandler({
        route: resolvedOptions.openApi.path,
        handler: resolve('./runtime/openapi-handler'),
      })
    }

    // Nitro auto-imports h3's `defineRouteHandler` from `nitro/h3` under the
    // same name. Ours is the superset the contract macro is configured to read,
    // so it has to win — but at equal priority unimport picks a winner from its
    // own array order and warns about the duplicate. Declaring a higher priority
    // makes ours deterministic instead of incidental, and silences the warning.
    addServerImports([
      ...endpointServerAutoImports.map((name) => ({
        from: resolve('./runtime'),
        name,
        priority: 10,
      })),
      { from: resolve('./runtime'), name: 'defineEndpointRuntime', priority: 10 },
    ])

    addImports([
      { from: runtimeFile, name: '$endpoint' },
      { from: runtimeFile, name: 'useEndpoint' },
      { from: typeFile, type: true, name: '$EndpointPathResponse' },
      { from: typeFile, type: true, name: '$EndpointPathCall' },
      { from: typeFile, type: true, name: '$EndpointPathRawResponse' },
      { from: typeFile, type: true, name: '$UseEndpoint' },
      { from: typeFile, type: true, name: '$UseEndpointPathCall' },
      { from: typeFile, type: true, name: 'EndpointPath' },
      { from: typeFile, type: true, name: 'EndpointMethod' },
    ])

    nuxt.options.alias = {
      ...nuxt.options.alias,
      '#endpoints': typeFile,
    }
  },
})

export default nuxtEndpointsModule

export async function composeHandlers(
  handlers: NitroRouteHandlerDescriptor[],
  routeContracts: ReadonlyMap<string, EndpointDetection>,
): Promise<EndpointRouteHandler[]> {
  const endpointHandlers: EndpointRouteHandler[] = []

  // Applies the checks a single detected method has always gone through
  // (catch-all/optional route rejection, idempotency-gap-without-policy
  // rejection and idempotency metadata extraction)
  // and pushes the resulting EndpointRouteHandler. Used once per single
  // endpoint and once per declared method of a defineEndpointMethods() group,
  // so every existing check keeps applying per method without being
  // reimplemented for the group case.
  function registerDetectedMethod(
    handler: NitroRouteHandlerDescriptor,
    route: string,
    method: string,
    detection: EndpointMethodDetection,
    methodGroup: boolean,
  ): void {
    const unsupportedSyntax = findUnsupportedRouteTemplateSyntax(route)
    if (unsupportedSyntax) {
      throw new Error(
        `[nuxt-endpoints] Route ${handler.handler} (${route}) declares an endpoint on a ${unsupportedSyntax} route. The generated client and OpenAPI document cannot represent it correctly yet; keep this route as a plain defineEventHandler.`,
      )
    }

    const { idempotency, mediaResponse } = detection

    endpointHandlers.push({
      ...handler,
      route,
      method,
      ...(mediaResponse ? { mediaResponse: true as const } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(methodGroup ? { methodGroup: true as const } : {}),
    })
  }

  for (const handler of handlers) {
    if (handler.middleware || !handler.route) {
      continue
    }
    const route = handler.route

    const detection = routeContracts.get(routeContractKey(handler.handler, handler.method))
    if (!detection) {
      continue
    }

    if (isEndpointGroupDetection(detection)) {
      if (handler.method) {
        throw new Error(
          `[nuxt-endpoints] Route ${handler.handler} (${route}) declares a multi-method defineRouteHandler() on a method-suffixed file (.${handler.method}.ts). Method entries belong on a method-suffix-free route file — its other declared methods would otherwise be unreachable. Move the declaration to a bare route file, or declare a single method.`,
        )
      }
      for (const [method, memberDetection] of Object.entries(detection.methods)) {
        registerDetectedMethod(handler, route, method, memberDetection, true)
      }
      continue
    }

    if (!handler.method) {
      throw new Error(
        `[nuxt-endpoints] Route ${handler.handler} (${route}) declares a single-method defineRouteHandler() but its file has no method suffix. Rename it to <name>.<method>.ts, or use the multi-method form.`,
      )
    }

    registerDetectedMethod(handler, route, handler.method, detection, false)
  }

  return endpointHandlers
}

export function indexRouteContracts(
  contracts: readonly NitroRouteContract<EndpointDefinition>[],
): Map<string, EndpointDetection> {
  const indexed = new Map<string, EndpointDetection>()
  const methodGroups = new Map<string, Record<string, EndpointMethodDetection>>()
  for (const entry of contracts) {
    const detection = getEndpointFromProviderContract(entry.contract)
    indexed.set(routeContractKey(entry.handler, entry.method), detection)
    if (entry.method) {
      const methods = methodGroups.get(entry.handler) ?? {}
      methods[entry.method] = detection
      methodGroups.set(entry.handler, methods)
    }
  }
  for (const [handler, methods] of methodGroups) {
    if (Object.keys(methods).length > 1) {
      indexed.set(routeContractKey(handler), { methods })
    }
  }
  return indexed
}

function getEndpointFromProviderContract(definition: EndpointDefinition): EndpointMethodDetection {
  const mediaResponse = hasMediaResponse(definition)
  const idempotency = parseEndpointIdempotencyMetadata(definition.idempotency)
  if (idempotency && definition.headers) {
    assertNoIdempotencyHeaderSchemaCollision(definition.headers, idempotency.headerName)
  }
  return {
    ...(mediaResponse ? { mediaResponse: true as const } : {}),
    ...(idempotency ? { idempotency } : {}),
  }
}

function routeContractKey(handler: string, method?: string): string {
  return `${handler}\0${method?.toLowerCase() ?? ''}`
}

function isEndpointGroupDetection(
  detection: EndpointDetection,
): detection is { methods: Record<string, EndpointMethodDetection> } {
  return 'methods' in detection
}

// Exported for focused unit testing of route-template rejection without a
// full Nitro route-discovery pipeline. Catch-all (`**`/`**:name`) and optional
// (`:name?`) segments cannot yet be represented in the generated client or
// OpenAPI document, so endpoints on those routes are rejected at build time.
export function findUnsupportedRouteTemplateSyntax(
  route: string,
): 'catch-all' | 'optional-parameter' | undefined {
  for (const segment of route.split('/')) {
    if (segment === '**' || segment.startsWith('**:')) {
      return 'catch-all'
    }
    if (segment.startsWith(':') && segment.endsWith('?')) {
      return 'optional-parameter'
    }
  }
  return undefined
}

// Small shared helper so every codegen builder above stays a pure
// content-in/string-out function; only this module writes to disk.
async function writeGenerated(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content)
}

// Nitro can serve an OpenAPI document of its own. It describes the same
// routes, but it cannot describe their contracts: `defineRouteMeta()` is a
// build-time AST macro whose argument is read as JSON literals only, so a
// schema built from Zod, Valibot, or Effect Schema can never reach it, and an
// an uncontracted route carries just a path, a method, and a `200` description.
// Two documents at two routes is legal, so it warns; two documents at one
// route is not, because whichever handler Nitro registered last silently wins.
//
// Deliberately narrow: this compares two fixed literal paths that come from two
// config keys, and is not a general route-conflict detector. Both are always
// static - neither key accepts a parameter or a wildcard - so comparing them
// after the same normalization h3 applies at registration is exact for this
// pair. Any wider claim would need Nitro's whole handler list plus its route
// matcher, and would still not be able to speak for handlers a plugin
// registers at runtime.
//
// Exported for focused unit testing without a Nitro instance.
export function assertOpenApiRoutesDoNotOverlap(
  nitro: NitroWithEndpointHandlers,
  schemaPath: string,
  warn: (message: string) => void,
): void {
  const nitroRoute = resolveNitroOpenApiRoute(nitro)
  if (!nitroRoute) {
    return
  }
  if (comparableRoutePath(nitroRoute) === comparableRoutePath(schemaPath)) {
    throw new Error(
      `[nuxt-endpoints] Nitro's built-in OpenAPI document is configured for ${nitroRoute}, the same route this module serves its own document on. Two handlers on one route leave which document is served up to registration order. Change endpoints.openApi.path or nitro.openAPI.route.`,
    )
  }
  warn(
    `Nitro's built-in OpenAPI is enabled, so two documents are served: ${nitroRoute} from Nitro and ${schemaPath} from endpoint contracts. Nitro's cannot see those contracts — defineRouteMeta() accepts JSON literals only, so a schema built from Zod, Valibot, or Effect Schema cannot reach it. Disable nitro.experimental.openAPI unless you want its Scalar or Swagger UI.`,
  )
}

// Mirrors Nitro's own condition for registering the handlers (dev, or an
// explicit production mode), so an enabled-but-unregistered document is not
// reported as a conflict.
function resolveNitroOpenApiRoute(nitro: NitroWithEndpointHandlers): string | undefined {
  const options = nitro.options
  if (!options.experimental?.openAPI) {
    return undefined
  }
  if (!options.dev && !options.openAPI?.production) {
    return undefined
  }
  return options.openAPI?.route || '/_openapi.json'
}

// h3 registers every route with its trailing slash removed, so `/schema/` and
// `/schema` are the same route to the router even though they are different
// strings in config.
function comparableRoutePath(path: string): string {
  const withLeadingSlash = normalizePath(path)
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash
}

// Read from the evaluated contract rather than from source text: a media
// response is plain serializable metadata, so discovery already has the real
// value here and does not have to guess at it.
function hasMediaResponse(definition: EndpointCarrierDefinition): boolean {
  return Object.values(definition.responses ?? {}).some(isMediaResponseContract)
}

function assertNoIdempotencyHeaderSchemaCollision(headers: unknown, headerName: string): void {
  const inspection = inspectValidatorInputObject(headers)
  if (!inspection.inspectable) {
    throw new Error(
      `[nuxt-endpoints] Idempotent endpoints with a headers schema require a JSON-Schema-convertible object so the configured idempotency header can be checked for collisions.`,
    )
  }
  const duplicate = Object.keys(inspection.properties).find(
    (name) => name.toLowerCase() === headerName.toLowerCase(),
  )
  if (duplicate) {
    throw new Error(
      `[nuxt-endpoints] Endpoint declares ${headerName} twice through its headers schema and idempotency metadata (schema property: ${duplicate}).`,
    )
  }
}

function parseEndpointIdempotencyMetadata(value: unknown): EndpointIdempotencyMetadata | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('enabled' in value) ||
    value.enabled !== true ||
    !('headerName' in value) ||
    typeof value.headerName !== 'string' ||
    !('required' in value) ||
    typeof value.required !== 'boolean'
  ) {
    return undefined
  }
  return { enabled: true, headerName: value.headerName, required: value.required }
}

// Exported for focused unit testing of option defaulting/normalization
// (openApi true/false/object, client/query combinations) without needing a
// full Nuxt module setup pass.
export function resolveModuleOptions(
  options: EndpointsModuleOptions,
  isDev: boolean,
): ResolvedEndpointsModuleOptions {
  const defaults: ResolvedEndpointsModuleOptions = {
    openApi: {
      enabled: isDev,
      path: '/_endpoints/schema',
      title: 'Nuxt Endpoints API',
      version: '0.1.0',
    },
    client: {
      raw: true,
    },
  }

  if (options.client && 'query' in options.client) {
    throw new TypeError(
      'endpoints.client.query was removed with the TanStack Query adapter. Install @pinia/colada-nuxt and @pinia/nuxt; endpoint request objects now expose Pinia Colada options directly.',
    )
  }

  const client = {
    ...defaults.client,
    ...options.client,
  }

  if (options.openApi === false) {
    return {
      client,
      openApi: {
        ...defaults.openApi,
        enabled: false,
      },
    }
  }

  if (options.openApi === true) {
    return {
      client,
      openApi: {
        ...defaults.openApi,
        enabled: true,
      },
    }
  }

  if (options.openApi === undefined) {
    return {
      ...defaults,
      client,
    }
  }

  return {
    client,
    openApi: {
      ...defaults.openApi,
      ...options.openApi,
      enabled: options.openApi.enabled ?? defaults.openApi.enabled,
      path: normalizePath(options.openApi.path ?? defaults.openApi.path),
    },
  }
}

// Exported for focused unit testing of the "explicit policy path must exist"
// rejection without a full Nuxt module setup pass.
export async function resolveExplicitConventionPath(
  nuxt: Nuxt,
  configuredPath: string,
  optionName: string,
): Promise<string> {
  const resolved = await findPath(join(nuxt.options.rootDir, configuredPath), {
    cwd: nuxt.options.rootDir,
    extensions: idempotencyPolicyExtensions,
  })
  if (!resolved) {
    throw new Error(
      `[nuxt-endpoints] ${optionName} is set to "${configuredPath}", but no matching file was found.`,
    )
  }
  return resolved
}

// Endpoint routes can come from the project server directory, extended Nuxt
// layers, and custom Nitro scanDirs. Nitro's resolved `options.scanDirs` is
// the exact directory list its route scanning uses, so walking it keeps the
// policy convention discoverable from every root that can contribute routes
// without re-deriving that list here.
// Exported for focused unit testing of the "first scanDir match wins" and
// "no policy file found" behavior without a full Nuxt module setup pass.
export async function resolveConventionPath(
  rootDir: string,
  scanDirs: readonly string[],
  relativePath: string,
): Promise<string | undefined> {
  for (const scanDir of scanDirs) {
    const resolved = await findPath(join(scanDir, relativePath), {
      cwd: rootDir,
      extensions: idempotencyPolicyExtensions,
    })
    if (resolved) {
      return resolved
    }
  }
  return undefined
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}
