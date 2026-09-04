import fsp from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
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
import { createJiti } from 'jiti'
import { camelCase } from 'scule'
import {
  generateEndpointClient,
  generateEndpointHandlerManifest,
  generateEndpointTypes,
  toImportPath,
} from './codegen'
import type { EndpointRouteHandler } from './codegen'
import { assertEndpointModuleEvaluated, resolveEndpointCarrierSource } from './discovery'
import type { ContractModuleLoaders } from './discovery'
import { collectNitroRouteHandlers } from './nitro-route-handlers'
import type { NitroRouteHandlerDescriptor, NitroRouteHandlerSource } from './nitro-route-handlers'
import { idempotencyMetadataWithoutRuntimeMessage } from './runtime/endpoint'
import { defineRouteHandler } from './runtime/route-handler'
import { idempotencyRuntimeOptionKeys } from './runtime/idempotency'
import { isMediaResponseContract } from './runtime/response'
import type { DefinedEndpoint, EndpointIdempotencyRuntimeMarker } from './runtime/endpoint'
import type { EndpointDefinition, EndpointIdempotencyMetadata } from './runtime/contract'
import { inspectValidatorInputObject } from './runtime/validator'
import { cursorPaginationRouteMetadata } from './runtime/pagination'
import type { EndpointPaginationRouteMetadata } from './runtime/pagination'

export type EndpointsModuleOptions = {
  openApi?: boolean | EndpointsOpenApiModuleOptions
  client?: EndpointsClientModuleOptions
  runtime?: EndpointsRuntimeModuleOptions
  serverRouteConfig?: EndpointsServerRouteConfigModuleOptions
}

export type EndpointsRuntimeModuleOptions = {
  /**
   * Path to the application-wide endpoint runtime module, resolved from the
   * project root. Defaults to `server/endpoints/runtime`.
   */
  path?: string
}

export type EndpointsServerRouteConfigModuleOptions = {
  /**
   * Path to the application response contract, resolved from the project
   * root. Defaults to `server/routes.config`.
   */
  path?: string
}

const idempotencyPolicyExtensions = ['.ts', '.mts', '.js', '.mjs']

// Helpers that discovery-evaluated modules (route and contract files) may use
// through Nuxt auto-imports. Each needs a matching global shim while jiti
// evaluates those modules, where Nuxt auto-imports do not exist.
const discoveryEvaluatedServerHelpers = [
  { name: 'defineRouteHandler', value: defineRouteHandler },
] as const

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
  dev: boolean
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
type EndpointCarrierDefinition = Pick<
  EndpointDefinition,
  'idempotency' | 'headers' | 'responses' | 'pagination'
>

// `__idempotency_runtime_marker__` stays optional here: hand-written endpoint exports
// (rejected by `parseIdempotencyRuntimeMarker` below) may omit it entirely.
type EndpointExport = Partial<
  Pick<DefinedEndpoint<EndpointDefinition>, '__idempotency_runtime_marker__'>
> & {
  definition?: EndpointCarrierDefinition
}

type EndpointCarrier = {
  __endpoint_contract__?: EndpointExport
  // Private Nitro 2 compatibility carrier for the canonical multi-method
  // route form, keyed by declared HTTP method.
  __endpoint_contracts__?: Record<string, EndpointExport>
}

type EndpointRouteModule = {
  default?: EndpointCarrier
}

// Detection result for one declared method (a single-method route, or one
// member of a multi-method `defineRouteHandler()` definition).
type EndpointMethodDetection = {
  idempotency?: EndpointIdempotencyMetadata
  /** Runtime options (storage/scope/authorization) the endpoint itself did not provide. */
  idempotencyRuntimeGaps?: readonly string[]
  /** Set when any declared status is a media response, so it is never parsed. */
  mediaResponse?: true
  pagination?: EndpointPaginationRouteMetadata
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
  options: {
    scanDirs: string[]
    dev?: boolean
    experimental?: { openAPI?: boolean }
    openAPI?: { route?: string; production?: false | 'runtime' | 'prerender' }
  }
  hooks: {
    hook: (name: 'types:extend', listener: () => void | Promise<void>) => void
  }
}

type EndpointsNuxtHook = (
  name: 'nitro:init',
  listener: (nitro: NitroWithEndpointHandlers) => void | Promise<void>,
) => void

const moduleName = 'endpoints'

type NuxtEndpointsModule = NuxtModule<EndpointsModuleOptions, EndpointsModuleOptions, false>

const nuxtEndpointsModule: NuxtEndpointsModule = defineNuxtModule<EndpointsModuleOptions>({
  meta: {
    name: `nuxt-${moduleName}`,
    configKey: camelCase(moduleName),
    compatibility: {
      nuxt: '^4.5.0',
    },
  },
  // All defaulting is centralized in `resolveModuleOptions` so there is a single
  // source of truth; a `defaults` block here would duplicate those values and
  // pre-fill `options.openApi`, making the `options.openApi === undefined`
  // branch below unreachable.
  async setup(options, nuxt) {
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
    let serverRouteConfigPath = options.serverRouteConfig?.path
      ? await resolveExplicitConventionPath(
          nuxt,
          options.serverRouteConfig.path,
          'endpoints.serverRouteConfig.path',
        )
      : undefined
    let serverRouteConfigPathResolved = options.serverRouteConfig?.path !== undefined

    const jiti = createJiti(nuxt.options.rootDir, {
      alias: nuxt.options.alias,
      moduleCache: false,
    })
    const loaders: ContractModuleLoaders = {
      loadModule: async (path) => {
        const restoreGlobals = installEndpointServerImportGlobals()
        try {
          return { module: await jiti.import<EndpointRouteModule>(path) }
        } catch (error) {
          return { error }
        } finally {
          restoreGlobals()
        }
      },
    }

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
    addServerTemplate({
      filename: `#nuxt-${moduleName}/server-route-config`,
      getContents: () => {
        if (!serverRouteConfigPathResolved) {
          throw new Error(
            '[nuxt-endpoints] Server route config template was requested before Nitro route discovery completed.',
          )
        }
        return serverRouteConfigPath
          ? `import * as configModule from '${toImportPath(serverRouteConfigPath)}'\nexport default configModule.default\n`
          : 'export default undefined\n'
      },
    })

    const hook = nuxt.hook as unknown as EndpointsNuxtHook
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
        if (!options.serverRouteConfig?.path) {
          serverRouteConfigPath = await resolveConventionPath(
            nuxt.options.rootDir,
            nitro.options.scanDirs,
            'routes.config',
          )
          serverRouteConfigPathResolved = true
        }
        const handlers = await composeHandlers(
          collectNitroRouteHandlers(nitro),
          loaders,
          runtimePath !== undefined,
        )
        endpointHandlerManifest = handlers
        await writeGenerated(
          typeFile,
          generateEndpointTypes(resolve, handlers, {
            ...resolvedOptions,
            serverRouteConfigPath,
          }),
        )
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

    addServerImports([
      ...discoveryEvaluatedServerHelpers.map(({ name }) => ({ from: resolve('./runtime'), name })),
      // defineEndpointRuntime needs no jiti shim: the runtime file
      // is not a discovery-evaluated module (route or contract file), so
      // this auto-import is only ever exercised through Nitro's own bundling.
      { from: resolve('./runtime'), name: 'defineEndpointRuntime' },
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
      '#endpoints/colada': resolve('./runtime/colada'),
      '#endpoints': typeFile,
    }
  },
})

export default nuxtEndpointsModule

async function composeHandlers(
  handlers: NitroRouteHandlerDescriptor[],
  loaders: ContractModuleLoaders,
  policyFileExists: boolean,
): Promise<EndpointRouteHandler[]> {
  const endpointHandlers: EndpointRouteHandler[] = []

  // Applies the checks a single detected method has always gone through
  // (catch-all/optional route rejection, idempotency-gap-without-policy
  // rejection and idempotency metadata extraction)
  // and pushes the resulting EndpointRouteHandler. Used once per single
  // endpoint and once per declared method of a multi-method route,
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

    const { idempotency, idempotencyRuntimeGaps, mediaResponse, pagination } = detection
    if (idempotencyRuntimeGaps?.length && !policyFileExists) {
      throw new Error(
        `[nuxt-endpoints] Idempotent endpoint route ${handler.handler} needs ${idempotencyRuntimeGaps.join(', ')}, but no endpoint runtime file was found. Declare an application policy or route override in server/endpoints/runtime.ts.`,
      )
    }
    if (pagination && method.toLowerCase() !== 'get') {
      throw new Error(
        `[nuxt-endpoints] Route ${handler.handler} (${route}) declares cursor pagination, but its method is ${method.toUpperCase()}. Cursor pagination is only supported on GET routes.`,
      )
    }
    endpointHandlers.push({
      ...handler,
      route,
      method,
      ...(mediaResponse ? { mediaResponse: true as const } : {}),
      ...(idempotency ? { idempotency } : {}),
      ...(pagination ? { pagination } : {}),
      ...(methodGroup ? { methodGroup: true as const } : {}),
    })
  }

  for (const handler of handlers) {
    if (handler.middleware || !handler.route) {
      continue
    }
    const route = handler.route

    const detection = await detectEndpoint(handler, loaders)
    if (!detection) {
      continue
    }

    if (isEndpointGroupDetection(detection)) {
      if (handler.method) {
        throw new Error(
          `[nuxt-endpoints] Route ${handler.handler} (${route}) declares a multi-method defineRouteHandler() on a method-suffixed file (.${handler.method}.ts). Multi-method handlers belong on a method-suffix-free route file — their other methods would otherwise be unreachable. Move the definition to a bare route file, or keep only one root handler.`,
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

// A scanned user route is always an absolute path to a JS/TS file. The other
// two shapes Nitro hands over are not route sources and must not be read:
// module-registered handlers resolve to an absolute path with no extension
// (this module's own OpenAPI route among them, whose specifier sits right
// next to a real runtime file), and Nuxt's internal handlers use virtual
// specifiers such as `#internal/nuxt/island-renderer.mjs`, which carry an
// extension but no file.
const routeSourceFilePattern = /\.[cm]?[jt]sx?$/

function isScannedRouteSource(handlerPath: string): boolean {
  return isAbsolute(handlerPath) && routeSourceFilePattern.test(handlerPath)
}

async function detectEndpoint(
  handler: NitroRouteHandlerDescriptor,
  loaders: ContractModuleLoaders,
): Promise<EndpointDetection | null> {
  if (!isScannedRouteSource(handler.handler)) {
    return null
  }
  // A scanned route file that cannot be read is a real problem, so this stays
  // loud rather than treating the route as non-endpoint.
  const fileContent = await fsp.readFile(handler.handler, { encoding: 'utf-8' })
  const source = await resolveEndpointCarrierSource(fileContent)

  if (source.kind === 'skip') {
    return null
  }
  const loadResult = await loaders.loadModule(handler.handler)
  const routeModuleEndpoint = getEndpointFromRouteModule(
    loadResult.module as EndpointRouteModule | undefined,
  )
  if (routeModuleEndpoint) {
    return routeModuleEndpoint
  }

  assertEndpointModuleEvaluated(fileContent, handler.handler, loadResult.error)
  return null
}

function getEndpointFromRouteModule(
  routeModule: EndpointRouteModule | undefined,
): EndpointDetection | null {
  const defaultExport = routeModule?.default
  if (defaultExport?.__endpoint_contracts__) {
    return { methods: getEndpointMethodDetections(defaultExport.__endpoint_contracts__) }
  }
  const carrier = defaultExport?.__endpoint_contract__
  return getEndpointFromCarrier(carrier)
}

// Applies getEndpointFromCarrier() to every private compatibility member
// instead of reimplementing operation/idempotency gap logic per method.
function getEndpointMethodDetections(
  methods: Record<string, EndpointExport>,
): Record<string, EndpointMethodDetection> {
  const detections: Record<string, EndpointMethodDetection> = {}
  for (const method of Object.keys(methods)) {
    detections[method] = getEndpointFromCarrier(methods[method]) ?? {}
  }
  return detections
}

// Exported for focused unit testing of the build-time idempotency gap
// computation without needing a full Nitro route-discovery/jiti pipeline.
export function getEndpointFromCarrier(
  carrier: EndpointExport | undefined,
): EndpointMethodDetection | null {
  const definition = carrier?.definition

  if (!definition) {
    return null
  }

  const mediaResponse = hasMediaResponse(definition)
  const idempotency = parseEndpointIdempotencyMetadata(definition.idempotency)
  const pagination = definition.pagination
    ? cursorPaginationRouteMetadata(definition.pagination)
    : undefined
  let idempotencyRuntimeGaps: readonly string[] | undefined
  if (idempotency) {
    const marker = parseIdempotencyRuntimeMarker(carrier.__idempotency_runtime_marker__)
    if (!marker) {
      throw new Error(idempotencyMetadataWithoutRuntimeMessage('on this endpoint'))
    }
    idempotencyRuntimeGaps = idempotencyRuntimeOptionKeys.filter((key) => !marker[key])
  }
  if (idempotency && definition.headers) {
    assertNoIdempotencyHeaderSchemaCollision(definition.headers, idempotency.headerName)
  }
  return {
    ...(mediaResponse ? { mediaResponse: true as const } : {}),
    ...(idempotency ? { idempotency } : {}),
    ...(pagination ? { pagination } : {}),
    ...(idempotencyRuntimeGaps?.length ? { idempotencyRuntimeGaps } : {}),
  }
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

// `false` marks an endpoint with hand-written (unsupported) idempotency
// metadata; anything else that doesn't match the marker shape is treated the
// same way so hand-written metadata is always rejected rather than silently
// skipping the runtime-option build check.
function parseIdempotencyRuntimeMarker(
  value: unknown,
): EndpointIdempotencyRuntimeMarker | false | undefined {
  if (value === false) {
    return false
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    idempotencyRuntimeOptionKeys.every(
      (key) => key in value && typeof (value as Record<string, unknown>)[key] === 'boolean',
    )
  ) {
    return value as EndpointIdempotencyRuntimeMarker
  }
  return undefined
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

function installEndpointServerImportGlobals(): () => void {
  const globalObject = globalThis as typeof globalThis & Record<string, unknown>
  const restorations = discoveryEvaluatedServerHelpers.map(({ name, value }) => {
    const previous = { exists: name in globalObject, value: globalObject[name] }
    globalObject[name] = value
    return { name, previous }
  })

  return () => {
    for (const { name, previous } of restorations) {
      restoreGlobalValue(globalObject, name, previous)
    }
  }
}

function restoreGlobalValue(
  globalObject: Record<string, unknown>,
  key: string,
  previous: { exists: boolean; value: unknown },
) {
  if (previous.exists) {
    globalObject[key] = previous.value
    return
  }
  delete globalObject[key]
}

// Exported for focused unit testing of option defaulting/normalization
// (openApi true/false/object, client/query combinations) without needing a
// full Nuxt module setup pass.
export function resolveModuleOptions(
  options: EndpointsModuleOptions,
  isDev: boolean,
): ResolvedEndpointsModuleOptions {
  const defaults: ResolvedEndpointsModuleOptions = {
    dev: isDev,
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
      'endpoints.client.query was removed with the TanStack Query adapter. Install @pinia/colada-nuxt and @pinia/nuxt; import the Pinia Colada queryOptions and mutationOptions adapters from #endpoints/colada.',
    )
  }

  const client = {
    ...defaults.client,
    ...options.client,
  }

  if (options.openApi === false) {
    return {
      dev: defaults.dev,
      client,
      openApi: {
        ...defaults.openApi,
        enabled: false,
      },
    }
  }

  if (options.openApi === true) {
    return {
      dev: defaults.dev,
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
    dev: defaults.dev,
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
