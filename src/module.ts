import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addImports,
  addPluginTemplate,
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
  generateEndpointQueryClient,
  generateEndpointQueryPlugin,
  generateEndpointQueryTypes,
  generateEndpointTypes,
  toImportPath,
} from './codegen'
import type { EndpointRouteHandler } from './codegen'
import { assertEndpointModuleEvaluated, resolveEndpointCarrierSource } from './discovery'
import type { ContractModuleLoaders } from './discovery'
import { collectNitroRouteHandlers } from './nitro-route-handlers'
import type { NitroRouteHandlerDescriptor, NitroRouteHandlerSource } from './nitro-route-handlers'
import {
  defineEndpoint,
  defineEndpointHandler,
  idempotencyMetadataWithoutRuntimeMessage,
  idempotencyRuntimeOptionKeys,
} from './runtime/endpoint'
import type { DefinedEndpoint, EndpointIdempotencyRuntimeMarker } from './runtime/endpoint'
import type { EndpointDefinition, EndpointIdempotencyMetadata } from './runtime/contract'
import { mutationHttpMethodList, queryHttpMethodList } from './runtime/tanstack-query'
import { inspectValidatorInputObject } from './runtime/validator'

export type EndpointsModuleOptions = {
  openApi?: boolean | EndpointsOpenApiModuleOptions
  client?: EndpointsClientModuleOptions
  idempotency?: EndpointsIdempotencyModuleOptions
}

export type EndpointsIdempotencyModuleOptions = {
  /**
   * Path to the central idempotency policy module, resolved from the
   * project root. Defaults to `server/endpoints/idempotency`.
   */
  policy?: string
}

const idempotencyPolicyExtensions = ['.ts', '.mts', '.js', '.mjs']

// Set form of the query/mutation HTTP method lists, for O(1) membership
// checks against a handler's (plain string) method below.
const queryHttpMethods = new Set<string>(queryHttpMethodList)
const mutationHttpMethods = new Set<string>(mutationHttpMethodList)

// Helpers that discovery-evaluated modules (route and contract files) may use
// through Nuxt auto-imports. Each needs a matching global shim while jiti
// evaluates those modules, where Nuxt auto-imports do not exist.
const discoveryEvaluatedServerHelpers = [
  { name: 'defineEndpoint', value: defineEndpoint },
  { name: 'defineEndpointHandler', value: defineEndpointHandler },
] as const

export type EndpointsOpenApiModuleOptions = {
  enabled?: boolean
  path?: string
  title?: string
  version?: string
}

export type EndpointsClientModuleOptions = {
  result?: boolean
  raw?: boolean
  effect?: boolean
  query?: boolean | EndpointsQueryClientModuleOptions
}

export type EndpointsQueryClientModuleOptions = {
  setup?: 'external' | 'auto'
  staleTime?: number
}

type ResolvedEndpointsModuleOptions = {
  openApi: {
    enabled: boolean
    path: string
    title: string
    version: string
  }
  client: {
    result: boolean
    raw: boolean
    effect: boolean
    query: boolean
    querySetup: 'external' | 'auto'
    queryStaleTime: number
  }
}

// The definition fields a discovery-evaluated module's carrier exposes.
// Derived (rather than hand-declared) so a shape change to `EndpointDefinition`
// surfaces here as a compile error instead of silently going unread.
type EndpointCarrierDefinition = Pick<EndpointDefinition, 'operation' | 'idempotency' | 'headers'>

// `__idempotency_runtime_marker__` stays optional here: hand-written endpoint exports
// (rejected by `parseIdempotencyRuntimeMarker` below) may omit it entirely.
type EndpointExport = Partial<
  Pick<DefinedEndpoint<EndpointDefinition>, '__idempotency_runtime_marker__'>
> & {
  definition?: EndpointCarrierDefinition
}

type EndpointCarrier = {
  __endpoint_contract__?: EndpointExport
}

type EndpointRouteModule = {
  default?: EndpointCarrier
  endpoint?: EndpointExport
}

type EndpointDetection = {
  operation?: string
  idempotency?: EndpointIdempotencyMetadata
  /** Runtime options (storage/scope/authorization) the endpoint itself did not provide. */
  idempotencyRuntimeGaps?: readonly string[]
}

type NitroWithEndpointHandlers = NitroRouteHandlerSource & {
  options: {
    scanDirs: string[]
  }
  hooks: {
    hook: (name: 'types:extend', listener: () => void | Promise<void>) => void
  }
}

type EndpointsNuxtHook = ((
  name: 'nitro:init',
  listener: (nitro: NitroWithEndpointHandlers) => void | Promise<void>,
) => void) &
  ((name: 'nitro:config', listener: (config: { ignore?: string[] }) => void) => void)

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
    const queryTypeFile = resolve(nuxt.options.buildDir, 'types/endpoints-query.d.ts')
    const queryRuntimeFile = resolve(nuxt.options.buildDir, 'endpoints-query.ts')
    const resolvedOptions = resolveModuleOptions(options, nuxt.options.dev)
    const logger = useLogger('nuxt-endpoints')
    let endpointHandlerManifest: EndpointRouteHandler[] | undefined
    // An explicit module option resolves immediately; the convention lookup is
    // deferred to `nitro:init` so it can walk Nitro's own resolved scanDirs
    // (project server dir, layer server dirs, custom scanDirs) instead of
    // re-deriving that list here.
    let idempotencyPolicyPath = options.idempotency?.policy
      ? await resolveExplicitIdempotencyPolicyPath(nuxt, options.idempotency.policy)
      : undefined
    let idempotencyPolicyPathResolved = options.idempotency?.policy !== undefined

    if (resolvedOptions.client.query && !isTanstackVueQueryResolvable(nuxt.options.rootDir)) {
      if (resolvedOptions.client.querySetup === 'auto') {
        throw new Error(
          '[nuxt-endpoints] endpoints.client.query.setup is "auto" but "@tanstack/vue-query" could not be resolved. Install it, or use the external setup mode.',
        )
      }
      logger.warn(
        'endpoints.client.query is enabled but "@tanstack/vue-query" could not be resolved. Install it as a dependency to use the generated useQuery/useMutation options.',
      )
    }

    if (resolvedOptions.client.query && resolvedOptions.client.querySetup === 'auto') {
      // Registered through Nuxt's template pipeline (not a plain fsp write)
      // so the file's content is produced by the same `generateApp()` pass
      // that reads it back for plugin annotation. `nuxi build`/`prepare`
      // clear the build directory and then call `generateApp()` once before
      // any module-registered lifecycle hook fires, so a file written
      // directly to disk during `setup()` (or any later hook) always loses
      // that race; `addPluginTemplate` has no such race because Nuxt itself
      // materializes the template as part of generating the app.
      addPluginTemplate({
        filename: 'endpoints-query-plugin.ts',
        write: true,
        getContents: () => generateEndpointQueryPlugin(resolvedOptions.client.queryStaleTime),
      })
    }

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
      resolveImport: (specifier, parentPath) => {
        try {
          const resolved = jiti.esmResolve(specifier, parentPath)
          return resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved
        } catch {
          return undefined
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
      filename: `#nuxt-${moduleName}/idempotency-policy`,
      // A namespace import (rather than `export { default } from '...'`) so a
      // policy file that forgets its default export still bundles cleanly;
      // Nitro startup validation reports that mistake with a clear message
      // instead of Rollup failing the build on a missing default export.
      getContents: () => {
        if (!idempotencyPolicyPathResolved) {
          throw new Error(
            '[nuxt-endpoints] Idempotency policy template was requested before Nitro route discovery completed.',
          )
        }
        return idempotencyPolicyPath
          ? `import * as policyModule from '${toImportPath(idempotencyPolicyPath)}'\nexport default policyModule.default\n`
          : 'export default undefined\n'
      },
    })

    const hook = nuxt.hook as unknown as EndpointsNuxtHook
    hook('nitro:config', (nitroConfig) => {
      nitroConfig.ignore = [...(nitroConfig.ignore ?? []), endpointContractIgnorePattern]
    })
    hook('nitro:init', async (nitro) => {
      const generateArtifacts = async () => {
        if (!options.idempotency?.policy) {
          idempotencyPolicyPath = await resolveConventionIdempotencyPolicyPath(
            nuxt.options.rootDir,
            nitro.options.scanDirs,
          )
          idempotencyPolicyPathResolved = true
        }
        const handlers = await composeHandlers(
          collectNitroRouteHandlers(nitro),
          loaders,
          idempotencyPolicyPath !== undefined,
          resolvedOptions.client.query,
          (message) => logger.warn(message),
        )
        endpointHandlerManifest = handlers
        await writeGenerated(typeFile, generateEndpointTypes(resolve, handlers, resolvedOptions))
        await writeGenerated(
          runtimeFile,
          generateEndpointClient(resolve, handlers, resolvedOptions),
        )
        if (resolvedOptions.client.query) {
          await writeGenerated(queryTypeFile, generateEndpointQueryTypes(resolve, handlers))
          await writeGenerated(
            queryRuntimeFile,
            generateEndpointQueryClient(resolve, queryTypeFile, handlers),
          )
        }
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
      // defineIdempotencyPolicy needs no jiti shim: the central policy file
      // is not a discovery-evaluated module (route or contract file), so
      // this auto-import is only ever exercised through Nitro's own bundling.
      { from: resolve('./runtime'), name: 'defineIdempotencyPolicy' },
    ])

    addImports([
      { from: runtimeFile, name: '$endpoint' },
      { from: runtimeFile, name: 'useEndpoint' },
      ...(resolvedOptions.client.result ? [{ from: runtimeFile, name: 'useEndpointResult' }] : []),
      ...(resolvedOptions.client.effect ? [{ from: runtimeFile, name: 'useEndpointEffect' }] : []),
      { from: typeFile, type: true, name: '$EndpointResponse' },
      { from: typeFile, type: true, name: '$EndpointResult' },
      { from: typeFile, type: true, name: '$EndpointRawResponse' },
      { from: typeFile, type: true, name: '$EndpointPathResponse' },
      { from: typeFile, type: true, name: '$EndpointPathCall' },
      { from: typeFile, type: true, name: '$EndpointPathResult' },
      { from: typeFile, type: true, name: '$EndpointPathRawResponse' },
      { from: typeFile, type: true, name: '$UseEndpoint' },
      { from: typeFile, type: true, name: '$UseEndpointPathCall' },
      { from: typeFile, type: true, name: '$UseEndpointResult' },
      { from: typeFile, type: true, name: '$UseEndpointResultPathCall' },
      { from: typeFile, type: true, name: '$UseEndpointEffect' },
      { from: typeFile, type: true, name: '$UseEndpointEffectPathCall' },
      { from: typeFile, type: true, name: 'EndpointOperation' },
      { from: typeFile, type: true, name: 'EndpointPath' },
      { from: typeFile, type: true, name: 'EndpointMethod' },
    ])

    nuxt.options.alias = {
      ...nuxt.options.alias,
      ...(resolvedOptions.client.query ? { '#endpoints/query': queryRuntimeFile } : {}),
      '#endpoints': typeFile,
    }
  },
})

export default nuxtEndpointsModule

async function composeHandlers(
  handlers: NitroRouteHandlerDescriptor[],
  loaders: ContractModuleLoaders,
  policyFileExists: boolean,
  queryClientEnabled: boolean,
  warn: (message: string) => void,
): Promise<EndpointRouteHandler[]> {
  const endpointHandlers: EndpointRouteHandler[] = []
  const operations = new Map<string, string>()

  for (const handler of handlers) {
    if (handler.middleware || !handler.route || !handler.method) {
      continue
    }

    const detection = await detectEndpoint(handler, loaders)
    if (!detection) {
      continue
    }

    const unsupportedSyntax = findUnsupportedRouteTemplateSyntax(handler.route)
    if (unsupportedSyntax) {
      throw new Error(
        `[nuxt-endpoints] Route ${handler.handler} (${handler.route}) declares an endpoint on a ${unsupportedSyntax} route. The generated client and OpenAPI document cannot represent it correctly yet; keep this route as a plain defineEventHandler.`,
      )
    }

    const { operation, idempotency, idempotencyRuntimeGaps } = detection
    if (idempotencyRuntimeGaps?.length && !policyFileExists) {
      throw new Error(
        `[nuxt-endpoints] Idempotent endpoint route ${handler.handler} does not provide ${idempotencyRuntimeGaps.join(', ')} and no idempotency policy file was found. Add them to .idempotency() or create server/endpoints/idempotency.ts.`,
      )
    }
    const existingHandlerPath = operation ? operations.get(operation) : undefined
    if (operation && existingHandlerPath) {
      throw new Error(
        `Duplicate endpoint operation "${operation}": ${existingHandlerPath} and ${handler.handler}`,
      )
    }
    if (operation) {
      operations.set(operation, handler.handler)
    }

    if (
      operation &&
      queryClientEnabled &&
      !queryHttpMethods.has(handler.method) &&
      !mutationHttpMethods.has(handler.method)
    ) {
      warn(
        `Operation "${operation}" uses method "${handler.method}", which is not a query (${queryHttpMethodList.join(', ')}) or mutation (${mutationHttpMethodList.join(', ')}) method. No Vue Query option factory is generated for it.`,
      )
    }

    endpointHandlers.push({
      ...handler,
      route: handler.route,
      method: handler.method,
      ...(operation ? { operation } : {}),
      ...(idempotency ? { idempotency } : {}),
    })
  }

  return endpointHandlers
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

async function detectEndpoint(
  handler: NitroRouteHandlerDescriptor,
  loaders: ContractModuleLoaders,
): Promise<EndpointDetection | null> {
  const fileContent = await fsp.readFile(handler.handler, { encoding: 'utf-8' })
  const source = await resolveEndpointCarrierSource(fileContent, handler.handler, loaders)

  if (source.kind === 'skip') {
    return null
  }
  if (source.kind === 'contract') {
    return getEndpointFromCarrier(source.carrier as EndpointExport | undefined)
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
  const carrier = routeModule?.default?.__endpoint_contract__ || routeModule?.endpoint
  return getEndpointFromCarrier(carrier)
}

// Exported for focused unit testing of the build-time idempotency gap
// computation without needing a full Nitro route-discovery/jiti pipeline.
export function getEndpointFromCarrier(
  carrier: EndpointExport | undefined,
): EndpointDetection | null {
  const definition = carrier?.definition

  if (!definition) {
    return null
  }

  const operation = typeof definition.operation === 'string' ? definition.operation : undefined
  const idempotency = parseEndpointIdempotencyMetadata(definition.idempotency)
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
    ...(operation ? { operation } : {}),
    ...(idempotency ? { idempotency } : {}),
    ...(idempotencyRuntimeGaps?.length ? { idempotencyRuntimeGaps } : {}),
  }
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
    openApi: {
      enabled: isDev,
      path: '/_endpoints/schema',
      title: 'Nuxt Endpoints API',
      version: '0.1.0',
    },
    client: {
      result: true,
      raw: true,
      effect: false,
      query: false,
      querySetup: 'external',
      queryStaleTime: 60_000,
    },
  }

  const client = {
    ...defaults.client,
    ...options.client,
    ...resolveQueryClientOption(options.client?.query),
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

// Exported for focused unit testing of the `client.query` boolean/object
// normalization in isolation from `resolveModuleOptions`.
export function resolveQueryClientOption(
  query: boolean | EndpointsQueryClientModuleOptions | undefined,
): {
  query: boolean
  querySetup: 'external' | 'auto'
  queryStaleTime: number
} {
  if (!query) {
    return { query: false, querySetup: 'external', queryStaleTime: 60_000 }
  }

  if (query === true) {
    return { query: true, querySetup: 'external', queryStaleTime: 60_000 }
  }

  return {
    query: true,
    querySetup: query.setup ?? 'external',
    queryStaleTime: query.staleTime ?? 60_000,
  }
}

// Exported for focused unit testing of the "explicit policy path must exist"
// rejection without a full Nuxt module setup pass.
export async function resolveExplicitIdempotencyPolicyPath(
  nuxt: Nuxt,
  policy: string,
): Promise<string> {
  const resolved = await findPath(join(nuxt.options.rootDir, policy), {
    cwd: nuxt.options.rootDir,
    extensions: idempotencyPolicyExtensions,
  })
  if (!resolved) {
    throw new Error(
      `[nuxt-endpoints] endpoints.idempotency.policy is set to "${policy}", but no matching file was found.`,
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
export async function resolveConventionIdempotencyPolicyPath(
  rootDir: string,
  scanDirs: readonly string[],
): Promise<string | undefined> {
  for (const scanDir of scanDirs) {
    const resolved = await findPath(join(scanDir, 'endpoints/idempotency'), {
      cwd: rootDir,
      extensions: idempotencyPolicyExtensions,
    })
    if (resolved) {
      return resolved
    }
  }
  return undefined
}

function isTanstackVueQueryResolvable(rootDir: string): boolean {
  try {
    const require = createRequire(`${rootDir}/package.json`)
    require.resolve('@tanstack/vue-query')

    return true
  } catch {
    return false
  }
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}
