// Method-suffix-free route files: a single `server/api/.../[id].ts` can
// declare handlers for several HTTP methods at once via
// `defineEndpointMethods` + `defineEndpointMethodHandlers`. Each declared
// method is still a plain `DefinedEndpoint` built by `defineEndpoint()`, so
// every existing per-endpoint feature (`.idempotency()`, `operation` names,
// media-type-map bodies, response validation, ...) keeps working unchanged —
// this module only adds HTTP-method dispatch in front of them; it never
// reimplements what a single endpoint already does.
import type { EndpointContext, EndpointDefinition, HandlerReturn } from './contract'
import type {
  DefinedEndpoint,
  EndpointEventHandler,
  EndpointHandlerSuccessBody,
  EndpointRouteIdentity,
} from './endpoint'
import { normalizeRouteIdentity } from './endpoint'
import {
  defineRuntimeHandler,
  getRuntimeMethod,
  setRuntimeResponseHeaders,
  setRuntimeResponseStatus,
} from './platform'
import type { RuntimeEvent } from './platform'
import type { EndpointRuntime } from './endpoint-runtime'

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

const declarableEndpointMethods = ['get', 'post', 'put', 'patch', 'delete'] as const

export type DeclarableEndpointMethod = (typeof declarableEndpointMethods)[number]

// Structural constraint for a `defineEndpointMethods()` member, deliberately
// narrower than `DefinedEndpoint` itself: `DefinedEndpoint.handler()`'s
// parameter type is contravariant in `DEFINITION`, so constraining directly
// against `DefinedEndpoint<EndpointDefinition>` would check every member
// against a single erased type at the constraint boundary. `const METHODS`
// on `defineEndpointMethods` still infers the full concrete
// `DefinedEndpoint<D>` type for every key regardless of how loose this
// constraint is, because a `const` type parameter's inferred type is the
// argument's own type, not the constraint it was checked against — verified
// in test/types/endpoint-methods.test-d.ts.
export type EndpointMethodMember = {
  readonly definition: EndpointDefinition
}

export type EndpointMethodsMap = Partial<Record<DeclarableEndpointMethod, EndpointMethodMember>>

export type EndpointMethodsDefinition<METHODS extends EndpointMethodsMap> = {
  readonly __endpoint_methods__: true
  readonly methods: METHODS
}

// Extracts a member's `EndpointDefinition` without indexing into `METHODS`
// (e.g. a `METHODS[KEY]['definition']` access) — like the analogous comment
// on `InferBodyOutputOrUndefined` in contract.ts, an indexed access on a
// generic parameter here produces a deferred type that breaks structural
// comparability across the type's own instantiations.
type EndpointMethodDefinition<MEMBER> =
  MEMBER extends DefinedEndpoint<infer DEFINITION extends EndpointDefinition> ? DEFINITION : never

export type EndpointMethodHandlersMap<METHODS extends EndpointMethodsMap> = {
  [KEY in keyof METHODS]: (
    context: EndpointContext<EndpointMethodDefinition<METHODS[KEY]>>,
  ) => MaybePromise<HandlerReturn<EndpointMethodDefinition<METHODS[KEY]>>>
}

export type EndpointMethodsSuccessBody<
  METHODS extends EndpointMethodsMap,
  HANDLERS extends EndpointMethodHandlersMap<METHODS>,
> = {
  [KEY in keyof HANDLERS]: KEY extends keyof METHODS
    ? EndpointHandlerSuccessBody<EndpointMethodDefinition<METHODS[KEY]>, ReturnType<HANDLERS[KEY]>>
    : never
}[keyof HANDLERS]

export type EndpointMethodsEventHandler<
  METHODS extends EndpointMethodsMap,
  HANDLERS extends EndpointMethodHandlersMap<METHODS>,
> = ((event: RuntimeEvent) => Promise<EndpointMethodsSuccessBody<METHODS, HANDLERS>>) & {
  __endpoint_contracts__: METHODS
  // `-readonly`/`-?`: HANDLERS is inferred through a `const` type parameter,
  // which (like `as const`) marks every property of the inferred object type
  // readonly. This mapped type is homomorphic over HANDLERS and would
  // otherwise silently inherit that readonly-ness onto a type that has
  // nothing to do with constness — it just carries handler return types.
  __endpoint_method_handler_returns__: {
    -readonly [KEY in keyof HANDLERS]-?: Awaited<ReturnType<HANDLERS[KEY]>>
  }
  __set_endpoint_route__: (identity: EndpointRouteIdentity) => void
  __set_endpoint_runtime__: (policy: EndpointRuntime | undefined) => void
}

/**
 * Declares several method contracts for one route file. Each member must be
 * a plain `DefinedEndpoint` produced by `defineEndpoint()` — `head` and
 * `options` are always derived automatically (HEAD from a declared GET,
 * OPTIONS from the full declared set) and cannot be declared here.
 */
export function defineEndpointMethods<const METHODS extends EndpointMethodsMap>(
  methods: METHODS,
): EndpointMethodsDefinition<METHODS> {
  validateEndpointMethodsDefinition(methods)
  return { __endpoint_methods__: true, methods }
}

/**
 * Builds the method-dispatching event handler for a `defineEndpointMethods()`
 * declaration. `handlers` must supply exactly one handler per declared
 * method. Each handler is turned into a real event handler up front via the
 * member's own `DefinedEndpoint.handler()` — the dispatcher only ever
 * decides which one runs for a given request.
 */
export function defineEndpointMethodHandlers<
  METHODS extends EndpointMethodsMap,
  const HANDLERS extends EndpointMethodHandlersMap<METHODS>,
>(
  endpoints: EndpointMethodsDefinition<METHODS>,
  handlers: HANDLERS,
): EndpointMethodsEventHandler<METHODS, HANDLERS> {
  validateEndpointMethodHandlersDefinition(endpoints, handlers)

  // Built once, here, and reused for every request (never per-request): each
  // sub-handler is a real `DefinedEndpoint.handler()` event handler, so every
  // feature it already implements (idempotency, response validation, body
  // media-type maps, ...) runs exactly as it would for a single-method route.
  const subHandlers: Record<string, EndpointEventHandler<EndpointDefinition, unknown>> = {}
  const methodMembers = endpoints.methods as Record<string, EndpointMethodMember>
  const handlerFunctions = handlers as Record<string, (context: never) => unknown>
  for (const method of Object.keys(methodMembers)) {
    const endpoint = methodMembers[method] as unknown as DefinedEndpoint<EndpointDefinition>
    subHandlers[method] = endpoint.handler(handlerFunctions[method] as never)
  }

  const allowedMethods = buildAllowedMethodsList(Object.keys(subHandlers))
  const allowHeader = allowedMethods.join(', ')

  const eventHandler = defineRuntimeHandler(async (event: RuntimeEvent): Promise<unknown> => {
    const method = getRuntimeMethod(event).toLowerCase()

    const subHandler = subHandlers[method]
    if (subHandler) {
      return subHandler(event)
    }

    if (method === 'head' && subHandlers.get) {
      // Verified against a real h3 v1 request (test/endpoint-methods.test.ts):
      // the web-handler layer strips the HEAD response body itself while
      // preserving status and content-type, so forwarding straight to the
      // GET sub-handler already produces correct HEAD semantics without any
      // extra bookkeeping here.
      return subHandlers.get(event)
    }

    if (method === 'options') {
      // The status is set explicitly rather than relying on h3 defaulting an
      // empty response to 204. The return value must be `null`, not
      // `undefined`: h3 treats an `undefined` event handler result as "not
      // handled" and keeps falling through (ending in a 404 here, confirmed
      // by this module's own tests), while `null` is a real, empty response
      // body that keeps the status set above.
      setRuntimeResponseStatus(event, 204)
      setRuntimeResponseHeaders(event, { allow: allowHeader })
      return null
    }

    return applyMethodNotAllowed(event, allowedMethods, allowHeader)
  })

  return Object.assign(eventHandler, {
    __endpoint_contracts__: endpoints.methods,
    __endpoint_method_handler_returns__: undefined,
    __set_endpoint_route__: (identity: EndpointRouteIdentity) => {
      const normalized = normalizeRouteIdentity(identity)
      const subHandler = subHandlers[normalized.method]
      if (!subHandler) {
        throw new Error(
          `[nuxt-endpoints] Cannot attach route identity for method "${identity.method}" to a method-dispatch handler that only declares: ${Object.keys(subHandlers).join(', ')}.`,
        )
      }
      subHandler.__set_endpoint_route__(normalized)
    },
    __set_endpoint_runtime__: (policy: EndpointRuntime | undefined) => {
      for (const subHandler of Object.values(subHandlers)) {
        subHandler.__set_endpoint_runtime__(policy)
      }
    },
  }) as unknown as EndpointMethodsEventHandler<METHODS, HANDLERS>
}

// Declared methods uppercased, plus HEAD when GET is declared, plus OPTIONS
// unconditionally, sorted — e.g. `['GET', 'HEAD', 'OPTIONS', 'PUT']`.
function buildAllowedMethodsList(declaredMethods: readonly string[]): string[] {
  const methods = new Set(declaredMethods.map((method) => method.toUpperCase()))
  if (methods.has('GET')) {
    methods.add('HEAD')
  }
  methods.add('OPTIONS')
  return [...methods].sort()
}

function applyMethodNotAllowed(
  event: RuntimeEvent,
  allowedMethods: readonly string[],
  allowHeader: string,
): { statusCode: 405; statusMessage: 'Method Not Allowed'; data: { allow: string[] } } {
  setRuntimeResponseStatus(event, 405, 'Method Not Allowed')
  setRuntimeResponseHeaders(event, { allow: allowHeader, 'content-type': 'application/json' })
  return {
    statusCode: 405,
    statusMessage: 'Method Not Allowed',
    data: { allow: [...allowedMethods] },
  }
}

function validateEndpointMethodsDefinition(methods: Record<string, unknown>): void {
  const keys = Object.keys(methods)
  if (keys.length === 0) {
    throw new TypeError(
      '[nuxt-endpoints] defineEndpointMethods requires at least one method (get/post/put/patch/delete).',
    )
  }

  for (const key of keys) {
    if (key === 'head' || key === 'options') {
      throw new TypeError(
        `[nuxt-endpoints] defineEndpointMethods cannot declare "${key}": HEAD and OPTIONS are derived automatically from the declared methods and must never be declared directly.`,
      )
    }
    if (!isDeclarableEndpointMethod(key)) {
      throw new TypeError(
        `[nuxt-endpoints] defineEndpointMethods received an unsupported method "${key}". Supported methods: ${declarableEndpointMethods.join(', ')}.`,
      )
    }
    if (!isDefinedEndpointLike(methods[key])) {
      throw new TypeError(
        `[nuxt-endpoints] defineEndpointMethods member "${key}" must be created with defineEndpoint().`,
      )
    }
  }
}

function isDeclarableEndpointMethod(value: string): value is DeclarableEndpointMethod {
  return (declarableEndpointMethods as readonly string[]).includes(value)
}

// `instanceof DefinedEndpoint` is deliberately avoided here: build-time
// discovery evaluates route files through jiti, which loads its own copy of
// this module in a separate realm from the one bundled into the running
// Nitro server, so a jiti-constructed `DefinedEndpoint` fails `instanceof`
// against this runtime's class even though it is a perfectly valid endpoint.
// A structural check on the members `defineEndpoint()` always produces
// (a `definition` property and a `handler` method) is stable across both
// realms.
function isDefinedEndpointLike(
  value: unknown,
): value is { definition: EndpointDefinition; handler: (handler: never) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'definition' in value &&
    'handler' in value &&
    typeof (value as { handler: unknown }).handler === 'function'
  )
}

function validateEndpointMethodHandlersDefinition(endpoints: unknown, handlers: unknown): void {
  if (
    typeof endpoints !== 'object' ||
    endpoints === null ||
    (endpoints as { __endpoint_methods__?: unknown }).__endpoint_methods__ !== true
  ) {
    throw new TypeError(
      '[nuxt-endpoints] defineEndpointMethodHandlers requires its first argument to be the return value of defineEndpointMethods().',
    )
  }
  if (typeof handlers !== 'object' || handlers === null) {
    throw new TypeError(
      '[nuxt-endpoints] defineEndpointMethodHandlers requires its second argument to be a map of method handlers.',
    )
  }

  const methodKeys = new Set(
    Object.keys((endpoints as { methods: Record<string, unknown> }).methods),
  )
  const handlerKeys = new Set(Object.keys(handlers))

  const missing = [...methodKeys].filter((key) => !handlerKeys.has(key))
  const extra = [...handlerKeys].filter((key) => !methodKeys.has(key))
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing handlers for: ${missing.join(', ')}` : undefined,
      extra.length > 0 ? `unexpected handlers for: ${extra.join(', ')}` : undefined,
    ].filter((part): part is string => part !== undefined)
    throw new TypeError(
      `[nuxt-endpoints] defineEndpointMethodHandlers must declare exactly one handler per declared method (${details.join('; ')}).`,
    )
  }
}
