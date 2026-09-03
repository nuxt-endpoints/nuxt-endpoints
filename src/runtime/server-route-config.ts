import type { EndpointResponsesContract, HttpMethod } from './contract'

export type ServerRouteMethodConfig = {
  responses?: EndpointResponsesContract
}

export type ServerRouteScopeConfig = {
  responses?: EndpointResponsesContract
  methods?: Partial<Record<HttpMethod, ServerRouteMethodConfig>>
}

/**
 * Application response contracts that apply across endpoint files. This is
 * deliberately separate from defineEndpointRuntime(): these values are part
 * of the public HTTP contract and are consumed by client type generation and
 * OpenAPI, while endpoint runtime policies may close over server resources.
 */
export type ServerRouteConfig = {
  responses?: EndpointResponsesContract
  routes?: Record<string, ServerRouteScopeConfig>
}

export function defineServerRouteConfig<const CONFIG extends ServerRouteConfig>(
  config: CONFIG,
): CONFIG {
  validateServerRouteConfig(config)
  return config
}

export function validateServerRouteConfig(config: unknown): asserts config is ServerRouteConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('defineServerRouteConfig() expects an object.')
  }

  const candidate = config as ServerRouteConfig
  assertOnlyKeys(candidate, ['responses', 'routes'], 'defineServerRouteConfig()')
  if (candidate.responses !== undefined) {
    validateResponseMap(candidate.responses, 'responses')
  }
  if (candidate.routes === undefined) {
    return
  }
  if (
    typeof candidate.routes !== 'object' ||
    candidate.routes === null ||
    Array.isArray(candidate.routes)
  ) {
    throw new TypeError('defineServerRouteConfig(): "routes" must be an object.')
  }

  for (const [pattern, scope] of Object.entries(candidate.routes)) {
    validateRoutePattern(pattern)
    validateRouteScope(pattern, scope)
  }
}

/** Returns every matching map separately so duplicate statuses remain unions. */
export function resolveServerRouteResponseMaps(
  config: ServerRouteConfig | undefined,
  path: string,
  method: string,
): readonly EndpointResponsesContract[] {
  if (!config) {
    return []
  }

  const maps: EndpointResponsesContract[] = []
  if (config.responses) {
    maps.push(config.responses)
  }

  for (const [pattern, scope] of Object.entries(config.routes ?? {})) {
    if (!serverRoutePatternMatches(pattern, path)) {
      continue
    }
    if (scope.responses) {
      maps.push(scope.responses)
    }
    const methodConfig = scope.methods?.[method.toLowerCase() as HttpMethod]
    if (methodConfig?.responses) {
      maps.push(methodConfig.responses)
    }
  }
  return maps
}

export function serverRoutePatternMatches(pattern: string, path: string): boolean {
  if (pattern === '/**') {
    return true
  }
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  return path === pattern
}

type GlobalResponseMap<CONFIG> = CONFIG extends {
  responses: infer RESPONSES extends EndpointResponsesContract
}
  ? RESPONSES
  : never

type MatchingRouteScopes<CONFIG, PATH extends string> = CONFIG extends {
  routes: infer ROUTES
}
  ? {
      [PATTERN in keyof ROUTES]: PATTERN extends string
        ? ServerRoutePatternMatches<PATTERN, PATH> extends true
          ? ROUTES[PATTERN]
          : never
        : never
    }[keyof ROUTES]
  : never

type ScopeResponseMaps<SCOPE, METHOD extends string> = SCOPE extends unknown
  ?
      | (SCOPE extends { responses: infer RESPONSES extends EndpointResponsesContract }
          ? RESPONSES
          : never)
      | (SCOPE extends { methods: infer METHODS }
          ? METHOD extends keyof METHODS
            ? METHODS[METHOD] extends {
                responses: infer RESPONSES extends EndpointResponsesContract
              }
              ? RESPONSES
              : never
            : never
          : never)
  : never

type ResponseMapKeys<MAPS> = MAPS extends unknown ? keyof MAPS : never

type ResponseAtStatus<MAPS, STATUS> = MAPS extends unknown
  ? STATUS extends keyof MAPS
    ? MAPS[STATUS]
    : never
  : never

type MergeResponseMaps<MAPS> = {
  [STATUS in ResponseMapKeys<MAPS>]: ResponseAtStatus<MAPS, STATUS>
}

type ServerRoutePatternMatches<PATTERN extends string, PATH extends string> = PATTERN extends '/**'
  ? true
  : PATTERN extends `${infer PREFIX}/**`
    ? PATH extends PREFIX | `${PREFIX}/${string}`
      ? true
      : false
    : PATH extends PATTERN
      ? true
      : false

/** Response contracts inherited by one generated path/method. */
export type ServerRouteResponsesFor<
  CONFIG,
  PATH extends string,
  METHOD extends string,
> = MergeResponseMaps<
  GlobalResponseMap<CONFIG> | ScopeResponseMaps<MatchingRouteScopes<CONFIG, PATH>, METHOD>
>

const serverRouteMethods = new Set<HttpMethod>([
  'get',
  'head',
  'post',
  'put',
  'delete',
  'connect',
  'options',
  'trace',
  'patch',
])

function validateRoutePattern(pattern: string): void {
  if (!pattern.startsWith('/')) {
    throw new TypeError(
      `defineServerRouteConfig(): route pattern "${pattern}" must start with "/".`,
    )
  }
  if ((pattern.includes('*') && !pattern.endsWith('/**')) || pattern.slice(0, -3).includes('*')) {
    throw new TypeError(
      `defineServerRouteConfig(): route pattern "${pattern}" may only use a trailing "/**" prefix match.`,
    )
  }
}

function validateRouteScope(pattern: string, value: unknown): void {
  const location = `routes["${pattern}"]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`defineServerRouteConfig(): ${location} must be an object.`)
  }
  const scope = value as ServerRouteScopeConfig
  assertOnlyKeys(scope, ['responses', 'methods'], location)
  if (scope.responses !== undefined) {
    validateResponseMap(scope.responses, `${location}.responses`)
  }
  if (scope.methods === undefined) {
    return
  }
  if (typeof scope.methods !== 'object' || scope.methods === null || Array.isArray(scope.methods)) {
    throw new TypeError(`defineServerRouteConfig(): ${location}.methods must be an object.`)
  }
  for (const [method, methodConfig] of Object.entries(scope.methods)) {
    if (!serverRouteMethods.has(method as HttpMethod)) {
      throw new TypeError(
        `defineServerRouteConfig(): ${location}.methods.${method} is not a supported lowercase HTTP method.`,
      )
    }
    if (typeof methodConfig !== 'object' || methodConfig === null || Array.isArray(methodConfig)) {
      throw new TypeError(
        `defineServerRouteConfig(): ${location}.methods.${method} must be an object.`,
      )
    }
    assertOnlyKeys(methodConfig, ['responses'], `${location}.methods.${method}`)
    const responses = (methodConfig as ServerRouteMethodConfig).responses
    if (responses !== undefined) {
      validateResponseMap(responses, `${location}.methods.${method}.responses`)
    }
  }
}

function validateResponseMap(value: unknown, location: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`defineServerRouteConfig(): ${location} must be a response map.`)
  }
  for (const status of Object.keys(value)) {
    const parsed = Number(status)
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
      throw new TypeError(
        `defineServerRouteConfig(): ${location} status "${status}" must be an HTTP status integer from 100 to 599.`,
      )
    }
  }
}

function assertOnlyKeys(value: object, allowed: readonly string[], location: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) {
    throw new TypeError(`defineServerRouteConfig(): ${location}.${unknown} is not supported.`)
  }
}
