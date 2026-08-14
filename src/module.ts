import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  addImports,
  addPluginTemplate,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  addServerTemplate,
  createResolver,
  defineNuxtModule,
  useLogger,
} from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import { createJiti } from 'jiti'
import { camelCase } from 'scule'
import {
  collectNitroRouteHandlers,
  generateEndpointHandlerManifest,
  type NitroRouteHandlerDescriptor,
  type NitroRouteHandlerSource,
} from './nitro-route-handlers'
import { assertEndpointModuleEvaluated } from './operation'
import { defineEndpoint, defineEndpointHandler } from './runtime/endpoint'
import type { EndpointIdempotencyMetadata } from './runtime/contract'
import { inspectValidatorInputObject } from './runtime/validator'

export type EndpointsModuleOptions = {
  openApi?: boolean | EndpointsOpenApiModuleOptions
  client?: EndpointsClientModuleOptions
}

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

type EndpointRouteHandler = Omit<NitroRouteHandlerDescriptor, 'route' | 'method'> & {
  route: string
  method: string
  operation?: string
  idempotency?: EndpointIdempotencyMetadata
}

type EndpointCarrier = {
  __endpoint_contract__?: {
    __idempotency_runtime__?: unknown
    definition?: {
      operation?: unknown
      idempotency?: unknown
      headers?: unknown
    }
  }
}

type EndpointExport = {
  __idempotency_runtime__?: unknown
  definition?: {
    operation?: unknown
    idempotency?: unknown
    headers?: unknown
  }
}

type EndpointRouteModule = {
  default?: EndpointCarrier
  endpoint?: EndpointExport
}

type RouteModuleLoadResult = {
  module?: EndpointRouteModule
  error?: unknown
}
type RouteModuleLoader = (path: string) => Promise<RouteModuleLoadResult>
type EndpointDetection = {
  operation?: string
  idempotency?: EndpointIdempotencyMetadata
}

type NitroWithEndpointHandlers = NitroRouteHandlerSource & {
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
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const resolve = (...paths: string[]) => resolver.resolve(...paths)
    const typeFile = resolve(nuxt.options.buildDir, `types/${moduleName}.d.ts`)
    const runtimeFile = resolve(nuxt.options.buildDir, `${moduleName}.ts`)
    const queryTypeFile = resolve(nuxt.options.buildDir, 'types/endpoints-query.d.ts')
    const queryRuntimeFile = resolve(nuxt.options.buildDir, 'endpoints-query.ts')
    const resolvedOptions = resolveModuleOptions(options, nuxt.options.dev)
    const logger = useLogger('nuxt-endpoints')
    let endpointHandlerManifest: EndpointRouteHandler[] | undefined

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
    const loadRouteModule: RouteModuleLoader = async (path) => {
      const restoreGlobals = installEndpointServerImportGlobals()
      try {
        return { module: await jiti.import<EndpointRouteModule>(path) }
      } catch (error) {
        return { error }
      } finally {
        restoreGlobals()
      }
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

    const hook = nuxt.hook as unknown as EndpointsNuxtHook
    hook('nitro:init', async (nitro) => {
      const generateArtifacts = async () => {
        const handlers = await composeHandlers(collectNitroRouteHandlers(nitro), loadRouteModule)
        endpointHandlerManifest = handlers
        await generateEndpointTypes(resolve, typeFile, handlers, resolvedOptions)
        await generateEndpointClient(resolve, runtimeFile, handlers, resolvedOptions)
        if (resolvedOptions.client.query) {
          await generateEndpointQueryTypes(resolve, queryTypeFile, handlers)
          await generateEndpointQueryClient(resolve, queryRuntimeFile, queryTypeFile, handlers)
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
      { from: resolve('./runtime'), name: 'defineEndpoint' },
      { from: resolve('./runtime'), name: 'defineEndpointHandler' },
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
  loadRouteModule: RouteModuleLoader,
): Promise<EndpointRouteHandler[]> {
  const endpointHandlers: EndpointRouteHandler[] = []
  const operations = new Map<string, string>()

  for (const handler of handlers) {
    if (handler.middleware || !handler.route || !handler.method) {
      continue
    }

    const detection = await detectEndpoint(handler, loadRouteModule)
    if (!detection) {
      continue
    }
    const { operation, idempotency } = detection
    const existingHandlerPath = operation ? operations.get(operation) : undefined
    if (operation && existingHandlerPath) {
      throw new Error(
        `Duplicate endpoint operation "${operation}": ${existingHandlerPath} and ${handler.handler}`,
      )
    }
    if (operation) {
      operations.set(operation, handler.handler)
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

function buildEndpointRouteEntryUnion(handlers: EndpointRouteHandler[]): string {
  return handlers.length
    ? handlers
        .map((handler) => {
          const operation = handler.operation ? `, operation: '${handler.operation}'` : ''
          return `  | { path: '${handler.route}', method: '${handler.method}'${operation}, definition: typeof import('${toImportPath(handler.handler)}').default['__endpoint_contract__']['definition'], handlerReturn: typeof import('${toImportPath(handler.handler)}').default['__endpoint_handler_return__'] }`
        })
        .join('\n')
    : '  | never'
}

async function generateEndpointTypes(
  resolve: (path: string) => string,
  filePath: string,
  handlers: EndpointRouteHandler[],
  options: ResolvedEndpointsModuleOptions,
) {
  const endpointUnion = buildEndpointRouteEntryUnion(handlers)
  const effectImport = options.client.effect
    ? `import type { EffectEndpointClient, EffectEndpointOperationCall, EffectEndpointPathCall, UseEndpointEffectClient, UseEndpointEffectClientMethod } from '${toImportPath(resolve('./runtime/effect'))}'\n`
    : ''
  const clientFeatures = `{
  result: ${options.client.result ? 'true' : 'false'}
  raw: ${options.client.raw ? 'true' : 'false'}
}`
  const endpointClientType = options.client.effect
    ? 'EffectEndpointClient<EndpointRouteEntry, EndpointClientFeatures>'
    : 'EndpointClient<EndpointRouteEntry, EndpointClientFeatures>'
  const endpointOperationCallType = options.client.effect
    ? 'EffectEndpointOperationCall'
    : 'EndpointOperationCall'
  const endpointPathCallType = options.client.effect ? 'EffectEndpointPathCall' : 'EndpointPathCall'
  const resultType = options.client.result
    ? "\nexport type $EndpointResult<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['result']>>\nexport type $EndpointPathResult<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['result']>>"
    : '\nexport type $EndpointResult<OPERATION extends EndpointOperation> = never\nexport type $EndpointPathResult<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const rawResponseType = options.client.raw
    ? "\nexport type $EndpointRawResponse<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['raw']>>\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['raw']>>"
    : '\nexport type $EndpointRawResponse<OPERATION extends EndpointOperation> = never\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const useEndpointResultType = options.client.result
    ? '\nexport type $UseEndpointResult = UseEndpointResultClient<EndpointRouteEntry, EndpointClientFeatures>\nexport type $UseEndpointResultPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointResultClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>'
    : '\nexport type $UseEndpointResult = never\nexport type $UseEndpointResultPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const useEndpointEffectType = options.client.effect
    ? '\nexport type $UseEndpointEffect = UseEndpointEffectClient<EndpointRouteEntry, EndpointClientFeatures>\nexport type $UseEndpointEffectPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointEffectClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>'
    : '\nexport type $UseEndpointEffect = never\nexport type $UseEndpointEffectPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'

  const content = `
import type { EndpointClient, EndpointOperationCall, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointResultClient, UseEndpointResultClientMethod } from '${toImportPath(resolve('./runtime'))}'
${effectImport}

type EndpointRouteEntry =
${endpointUnion}

type EndpointClientFeatures = ${clientFeatures}
type EndpointOperationFrom<ROUTE> = ROUTE extends { operation: infer OPERATION extends string } ? OPERATION : never
type EndpointRouteForPath<PATH extends EndpointPath> = Extract<EndpointRouteEntry, { path: PATH }>
type EndpointRouteForPathMethod<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Extract<EndpointRouteEntry, { path: PATH, method: METHOD }>

export type $EndpointClient = ${endpointClientType}
export type EndpointOperation = EndpointOperationFrom<EndpointRouteEntry>
export type EndpointPath = EndpointRouteEntry['path']
export type EndpointMethod<PATH extends EndpointPath> = EndpointRouteForPath<PATH>['method']
export type $EndpointResponse<OPERATION extends EndpointOperation> = Awaited<$EndpointCall<OPERATION>>
export type $EndpointCall<OPERATION extends EndpointOperation> = ${endpointOperationCallType}<EndpointRouteEntry, OPERATION, EndpointClientFeatures>
export type $EndpointPathResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<$EndpointPathCall<PATH, METHOD>>
export type $EndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ${endpointPathCallType}<EndpointRouteEntry, PATH, METHOD, EndpointClientFeatures>
export type $UseEndpoint = UseEndpointClient<EndpointRouteEntry, EndpointClientFeatures>
export type $UseEndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>
${useEndpointResultType}${useEndpointEffectType}${resultType}${rawResponseType}
export type { EndpointClient, EndpointOperationCall, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointResultClient, UseEndpointResultClientMethod }
`.trimStart()

  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content)
}

async function generateEndpointClient(
  resolve: (path: string) => string,
  filePath: string,
  handlers: EndpointRouteHandler[],
  options: ResolvedEndpointsModuleOptions,
) {
  const routes = handlers.map((handler) => {
    return {
      path: handler.route,
      method: handler.method,
      ...(handler.operation ? { operation: handler.operation } : {}),
      ...(handler.idempotency
        ? {
            idempotency: {
              headerName: handler.idempotency.headerName,
              required: handler.idempotency.required,
            },
          }
        : {}),
    }
  })
  const effectImport = options.client.effect
    ? `import { createEndpointEffectExtension, createUseEndpointEffect } from '${toImportPath(resolve('./runtime/effect'))}'\n`
    : ''
  const useEndpointResultRuntimeImport = options.client.result ? ', createUseEndpointResult' : ''
  const useEndpointResultTypeImport = options.client.result ? ', $UseEndpointResult' : ''
  const useEndpointEffectTypeImport = options.client.effect ? ', $UseEndpointEffect' : ''
  const clientFeatures = {
    result: options.client.result,
    raw: options.client.raw,
  }
  const clientOptions = options.client.effect
    ? `, { features: ${JSON.stringify(clientFeatures)}, extensions: [createEndpointEffectExtension()] }`
    : `, { features: ${JSON.stringify(clientFeatures)} }`
  const asyncDataClientOptions = `, { features: ${JSON.stringify(clientFeatures)} }`
  const asyncDataRuntime = '__useEndpointAsyncData'
  const useEndpointResultExport = options.client.result
    ? `\nexport const useEndpointResult = createUseEndpointResult(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpointResult`
    : ''
  const useEndpointEffectExport = options.client.effect
    ? `\nexport const useEndpointEffect = createUseEndpointEffect(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpointEffect`
    : ''

  const content = `
import { createUseAsyncData } from '#app/composables/asyncData'
import { createEndpointClient, createUseEndpoint${useEndpointResultRuntimeImport} } from '${toImportPath(resolve('./runtime/client'))}'
${effectImport}
import type { $EndpointClient, $UseEndpoint${useEndpointResultTypeImport}${useEndpointEffectTypeImport} } from '#endpoints'

const routes = ${JSON.stringify(routes, null, 2)} as const
export const __useEndpointAsyncData = createUseAsyncData()

export const $endpoint = createEndpointClient(routes${clientOptions}) as unknown as $EndpointClient
export const useEndpoint = createUseEndpoint(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpoint${useEndpointResultExport}${useEndpointEffectExport}
`.trimStart()

  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content)
}

async function generateEndpointQueryTypes(
  resolve: (path: string) => string,
  filePath: string,
  handlers: EndpointRouteHandler[],
) {
  const endpointUnion = buildEndpointRouteEntryUnion(handlers)

  const content = `
import type { EndpointInfiniteQueryOptionsClient, EndpointMutationOptionsClient, EndpointQueryOptionsClient } from '${toImportPath(resolve('./runtime/query'))}'

type EndpointRouteEntry =
${endpointUnion}

export type $EndpointQueryOptions = EndpointQueryOptionsClient<EndpointRouteEntry>
export type $EndpointMutationOptions = EndpointMutationOptionsClient<EndpointRouteEntry>
export type $EndpointInfiniteQueryOptions = EndpointInfiniteQueryOptionsClient<EndpointRouteEntry>
`.trimStart()

  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content)
}

async function generateEndpointQueryClient(
  resolve: (path: string) => string,
  filePath: string,
  queryTypeFile: string,
  handlers: EndpointRouteHandler[],
) {
  const routes = handlers.map((handler) => {
    return {
      path: handler.route,
      method: handler.method,
      ...(handler.operation ? { operation: handler.operation } : {}),
      ...(handler.idempotency
        ? {
            idempotency: {
              headerName: handler.idempotency.headerName,
              required: handler.idempotency.required,
            },
          }
        : {}),
    }
  })
  const queryRuntimeImportPath = toImportPath(resolve('./runtime/query'))
  const queryTypeImportPath = toImportPath(queryTypeFile.replace(/\.d\.ts$/, ''))

  const content = `
import { useRequestFetch } from 'nuxt/app'
import { createEndpointInfiniteQueryOptions, createEndpointMutationOptions, createEndpointQueryOptions } from '${queryRuntimeImportPath}'

import type { EndpointFetcherRuntime } from '${queryRuntimeImportPath}'
import type { $EndpointInfiniteQueryOptions, $EndpointMutationOptions, $EndpointQueryOptions } from '${queryTypeImportPath}'

const routes = ${JSON.stringify(routes, null, 2)} as const

const captureFetcher = () => {
  try {
    return useRequestFetch() as unknown as EndpointFetcherRuntime
  } catch (error) {
    if (import.meta.server) {
      throw new Error(
        '[nuxt-endpoints] endpointQueryOptions/endpointMutationOptions/endpointInfiniteQueryOptions factories must be called while Nuxt context is available (component setup, plugins, or route middleware), so the request-aware fetcher can be captured for SSR.',
        { cause: error },
      )
    }
    return undefined
  }
}

export const endpointQueryOptions = createEndpointQueryOptions(routes, { captureFetcher }) as unknown as $EndpointQueryOptions
export const endpointMutationOptions = createEndpointMutationOptions(routes, { captureFetcher }) as unknown as $EndpointMutationOptions
export const endpointInfiniteQueryOptions = createEndpointInfiniteQueryOptions(routes, { captureFetcher }) as unknown as $EndpointInfiniteQueryOptions
`.trimStart()

  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content)
}

function generateEndpointQueryPlugin(staleTime: number): string {
  return `
import type { DehydratedState } from '@tanstack/vue-query'
import { QueryClient, VueQueryPlugin, dehydrate, hydrate } from '@tanstack/vue-query'
import { defineNuxtPlugin, useState } from 'nuxt/app'

export default defineNuxtPlugin((nuxtApp) => {
  const vueQueryState = useState<DehydratedState | null>('nuxt-endpoints-vue-query', () => null)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: ${staleTime},
      },
    },
  })
  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient })

  if (import.meta.server) {
    nuxtApp.hooks.hook('app:rendered', () => {
      vueQueryState.value = dehydrate(queryClient)
      queryClient.clear()
    })
  }

  if (import.meta.client) {
    hydrate(queryClient, vueQueryState.value)
  }
})
`.trimStart()
}

async function detectEndpoint(
  handler: NitroRouteHandlerDescriptor,
  loadRouteModule: RouteModuleLoader,
): Promise<EndpointDetection | null> {
  const loadResult = await loadRouteModule(handler.handler)
  const importedEndpoint = getImportedEndpoint(loadResult.module)
  if (importedEndpoint) {
    return importedEndpoint
  }

  const fileContent = await fsp.readFile(handler.handler, { encoding: 'utf-8' })
  assertEndpointModuleEvaluated(fileContent, handler.handler, loadResult.error)
  return null
}

function getImportedEndpoint(
  routeModule: EndpointRouteModule | undefined,
): { operation?: string; idempotency?: EndpointIdempotencyMetadata } | null {
  const carrier = routeModule?.default?.__endpoint_contract__ || routeModule?.endpoint
  const definition = carrier?.definition

  if (!definition) {
    return null
  }

  const operation = typeof definition.operation === 'string' ? definition.operation : undefined
  const idempotency = parseEndpointIdempotencyMetadata(definition.idempotency)
  if (idempotency && carrier.__idempotency_runtime__ !== true) {
    throw new Error(
      '[nuxt-endpoints] Endpoint idempotency metadata has no matching server runtime policy. Use DefinedEndpoint.idempotency() instead of writing metadata directly.',
    )
  }
  if (idempotency && definition.headers) {
    assertNoIdempotencyHeaderSchemaCollision(definition.headers, idempotency.headerName)
  }
  return {
    ...(operation ? { operation } : {}),
    ...(idempotency ? { idempotency } : {}),
  }
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
  const previous = {
    defineEndpoint: {
      exists: 'defineEndpoint' in globalObject,
      value: globalObject.defineEndpoint,
    },
    defineEndpointHandler: {
      exists: 'defineEndpointHandler' in globalObject,
      value: globalObject.defineEndpointHandler,
    },
  }

  globalObject.defineEndpoint = defineEndpoint
  globalObject.defineEndpointHandler = defineEndpointHandler

  return () => {
    restoreGlobalValue(globalObject, 'defineEndpoint', previous.defineEndpoint)
    restoreGlobalValue(globalObject, 'defineEndpointHandler', previous.defineEndpointHandler)
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

function resolveModuleOptions(
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

function resolveQueryClientOption(query: boolean | EndpointsQueryClientModuleOptions | undefined): {
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

function toImportPath(path: string): string {
  return path.replace(/\\/g, '/')
}
