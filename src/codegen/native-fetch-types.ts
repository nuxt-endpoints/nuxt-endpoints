import { toImportPath } from './shared'
import type { EndpointRouteHandler, NativeServerRoute, ResolvePath } from './types'

type RouteNode = {
  methods: Map<string, Set<string>>
  children: Map<string, RouteNode>
}

function createNode(): RouteNode {
  return { methods: new Map(), children: new Map() }
}

function emitRouteTree(node: RouteNode, output: 'contracts' | 'headers', indent = '  '): string {
  const children = [...node.children].flatMap(([segment, child]) => {
    const fields = emitRouteTree(child, output, indent + '  ')
    if (!fields) return []
    const key = segment.startsWith('/') ? JSON.stringify(segment) : `[${segment}]`
    return [`${indent}${key}: {\n${fields}${indent}}\n`]
  })
  const methods = [...node.methods].filter(([method]) => method !== 'default')
  const fields = methods.flatMap(([method, contracts]) => {
    if (output === 'headers') {
      if (contracts.size !== 1 || contracts.has('undefined')) return []
      const [contract] = contracts
      return [`${indent}  ${JSON.stringify(method)}: NativeRequestHeaders<${contract}>\n`]
    }
    return [`${indent}  ${JSON.stringify(method)}: { response: ${[...contracts].join(' | ')} }\n`]
  })
  const fallback =
    output === 'contracts' && node.methods.has('default')
      ? ` & Record<Exclude<HTTPMethod, ${methods.map(([method]) => JSON.stringify(method)).join(' | ') || 'never'}>, { response: undefined }>`
      : ''
  return fields.length || fallback
    ? `${indent}[Endpoint]: {\n${fields.join('')}${indent}}${fallback}\n${children.join('')}`
    : children.join('')
}

export function generateNativeFetchTypes(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
  serverRoutes: readonly NativeServerRoute[],
): string {
  const supported = new Set(
    handlers
      .filter(({ mediaResponse, method }) => !mediaResponse && method !== 'head')
      .map(({ route, method, handler }) => JSON.stringify([route, method, handler])),
  )
  const routeTree = createNode()
  for (const route of serverRoutes) {
    if (!route.segments?.length || route.middleware) continue
    let node = routeTree
    for (const segment of route.segments) {
      const keys =
        segment.type === 'static'
          ? segment.value
              .split('/')
              .slice(1)
              .map((value) => `/${value}`)
          : [segment.type === 'dynamic' ? 'DynamicParam' : 'WildcardParam']
      // fetchdts keeps the root handler on the root node.
      for (const key of keys) {
        if (key === '/') continue
        const child = node.children.get(key) ?? createNode()
        node.children.set(key, child)
        node = child
      }
    }
    const method = route.method?.toUpperCase() ?? 'default'
    const contracts = node.methods.get(method) ?? new Set<string>()
    contracts.add(
      supported.has(JSON.stringify([route.route, route.method, route.handler]))
        ? `EndpointRouteForPathMethod<${JSON.stringify(route.route)}, ${JSON.stringify(route.method)}>`
        : 'undefined',
    )
    node.methods.set(method, contracts)
  }

  return `
import type { AsyncData, DynamicParam, Endpoint, HTTPMethod, NuxtError, TypedFetch, TypedFetchOptions, TypedFetchResponseBody, TypedServerResponse, UseFetch, UseFetchOptions, WildcardParam } from 'nuxt/app'
import type { MaybeRefOrGetter } from 'vue'
import type { EndpointClientOptions, EndpointResultData } from '${toImportPath(resolve('./runtime'))}'
import type { queryOptions as LegacyQueryOptions } from '${toImportPath(resolve('./runtime/colada'))}'

type NativePath = \`/${'${string}'}\`
// Checked segments retain the URL shape for Nuxt's own route matcher.
declare const checkedSegment: unique symbol
type BuiltSegment<S extends string> = S extends \`:\${string}\` ? string & { readonly [checkedSegment]: true } : S
type BuiltPath<P extends string> = P extends \`\${infer Head}/\${infer Tail}\`
  ? \`\${BuiltSegment<Head>}/\${BuiltPath<Tail>}\` : BuiltSegment<P>
type ParamNames<P extends string> = P extends \`\${infer Head}/\${infer Tail}\`
  ? ParamNames<Head> | ParamNames<Tail> : P extends \`:\${infer Name}\` ? Name : never
type PathParams<Route extends EndpointRouteEntry> = Route extends unknown
  ? EndpointClientOptions<Route['definition']> extends { params: infer Params }
    ? Params & Record<ParamNames<Route['path']>, unknown>
    : Record<ParamNames<Route['path']>, string | number>
  : never
export type BuildPath = <const P extends Extract<EndpointPath, \`\${string}/:\${string}\`>>(
  template: P, options: { params: PathParams<Extract<EndpointRouteEntry, { path: NoInfer<P> }>> },
) => BuiltPath<P>
type NativeRouteSchema = {
${emitRouteTree(routeTree, 'contracts')}}
type NativeRoute<Path extends NativePath, Method extends HttpMethod> = TypedFetchResponseBody<NativeRouteSchema, Path, Uppercase<Method>>
type NativeRouteIdentity<Route> = Route extends { path: infer Path extends string; method: infer Method extends string } ? \`${'${Method} ${Path}'}\` : never
type IsUnion<Value, Whole = Value> = Value extends unknown ? [Whole] extends [Value] ? false : true : never
type NativeRouteGuard<Path extends NativePath, Method extends HttpMethod> =
  true extends IsUnion<Method> ? never
    : 'head' extends Method ? never
    : [NativeRoute<Path, Method>] extends [never] ? never
    : [NativeRoute<Path, Method>] extends [EndpointRouteEntry]
      ? true extends IsUnion<NativeRouteIdentity<NativeRoute<Path, Method>>> ? never : unknown
      : never

type NativeRequestHeaders<Route extends EndpointRouteEntry, Request = Exclude<EndpointClientOptions<Route['definition']>, void>> =
  Pick<Request, Extract<keyof Request, 'headers'>>

declare module '@nuxt/schema' {
  interface ServerRoutes {
${emitRouteTree(routeTree, 'headers', '    ')}  }
}

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type NumericStatus<Status extends string> = Status extends \`${'${infer NumberStatus extends number}'}\` ? NumberStatus : never
type HttpStatus = 0 | NumericStatus<\`${'${1 | 2 | 3 | 4 | 5}${Digit}${Digit}'}\`>
type NativeRawResponse = Omit<Awaited<ReturnType<TypedFetch['raw']>>, 'status' | '_data'>
type ContractResult<Path extends NativePath, Method extends HttpMethod> = EndpointResultData<Extract<NativeRoute<Path, Method>, EndpointRouteEntry>>
type NativeResponseMember<Result> = Result extends { status: infer Status; body: infer Body }
  ? NativeRawResponse & { readonly status: Status; _data?: Body }
  : never
type NativeResponse<Path extends NativePath, Method extends HttpMethod> =
  | NativeResponseMember<ContractResult<Path, Method>>
  | (NativeRawResponse & { readonly status: Exclude<HttpStatus, ContractResult<Path, Method>['status']>; _data?: unknown })

// Nuxt can report failures without an HTTP response (for example, a failed
// connection) as 500. A status check alone cannot identify the contract body.
type ContractErrorStatus = Exclude<NumericStatus<\`${'${4 | 5}${Digit}${Digit}'}\`>, 500>
type NativeError = Omit<NuxtError<unknown>, 'status' | 'data'>
type ContractError<Result> = Result extends { status: infer Status extends ContractErrorStatus; body: infer Body }
  ? NativeError & { status: Status; data?: Body }
  : never
type NativeFetchError<Path extends NativePath, Method extends HttpMethod> =
  | ContractError<ContractResult<Path, Method>>
  | (NativeError & {
      status?: Exclude<HttpStatus, ContractError<ContractResult<Path, Method>>['status']>
      data?: unknown
    })

type NativeMethodOption<Method extends string> = { method?: Method } &
  (Method extends 'get' | 'GET' ? unknown : { method: Method })
type NativeWireMethod = HttpMethod | Uppercase<HttpMethod>
type NativeLowerMethod<Method extends NativeWireMethod> = Lowercase<Method>

// A distinct base URL or response parser can change the route or its wire value.
type NativeJsonOptions = { baseURL?: never; responseType?: 'json'; parseResponse?: never }
type NativeRaw = {
  <const Path extends NativePath, const Method extends NativeWireMethod = 'get'>(
    request: Path & NativeRouteGuard<NoInfer<Path>, NativeLowerMethod<NoInfer<Method>>>,
    options: Omit<TypedFetchOptions<NoInfer<Path>, NativeLowerMethod<NoInfer<Method>>>, 'method'> & NativeMethodOption<Method> &
      NativeJsonOptions & { ignoreResponseError: true },
  ): Promise<NativeResponse<Path, NativeLowerMethod<Method>>>
}

type NuxtResponseHook = Extract<NonNullable<UseFetchOptions<unknown>['onResponse']>, (...args: never[]) => unknown>
type NativeUseFetchResult<Path extends NativePath, Method extends HttpMethod> =
  AsyncData<TypedServerResponse<Path, unknown, Method> | undefined, NativeFetchError<Path, Method> | undefined>
type RequiredNativeBody<Path extends NativePath, Method extends HttpMethod> =
  TypedFetchOptions<Path, Method> extends { body: unknown } ? { body: unknown } : unknown
type NativeUseFetch = {
  <const Path extends NativePath>(
    request: MaybeRefOrGetter<Path> & NativeRouteGuard<NoInfer<Path>, 'get'> &
      (TypedFetchOptions<NoInfer<Path>, 'get'> extends { body: unknown } ? never : unknown),
  ): NativeUseFetchResult<Path, 'get'>
  <const Path extends NativePath, const Method extends NativeWireMethod = 'get'>(
    request: MaybeRefOrGetter<Path> & NativeRouteGuard<NoInfer<Path>, NativeLowerMethod<NoInfer<Method>>>,
    options: Omit<UseFetchOptions<
      TypedServerResponse<Path, unknown, NativeLowerMethod<NoInfer<Method>>>,
      TypedServerResponse<Path, unknown, NativeLowerMethod<NoInfer<Method>>>,
      never[], undefined, NoInfer<Path>, NativeLowerMethod<NoInfer<Method>>
    >, 'method' | 'onResponse' | 'transform' | 'pick' | 'default'> &
      NativeMethodOption<Method> & NativeJsonOptions & RequiredNativeBody<NoInfer<Path>, NativeLowerMethod<NoInfer<Method>>> & {
        $fetch?: never
        ignoreResponseError?: false
        transform?: never
        pick?: never
        default?: never
        onResponse?: (context: Omit<Parameters<NuxtResponseHook>[0], 'response'> & {
          response: NativeResponse<Path, NativeLowerMethod<NoInfer<Method>>>
        }) => ReturnType<NuxtResponseHook>
      },
  ): NativeUseFetchResult<Path, NativeLowerMethod<Method>>
}

type NativeResult<Path extends NativePath, Method extends HttpMethod> = ContractResult<Path, Method> |
  { status: Exclude<HttpStatus, ContractResult<Path, Method>['status']>; ok: boolean; body: unknown }

type QueryInputs<Path extends NativePath> = Pick<TypedFetchOptions<Path, 'get'>, 'query' | 'headers'>
type SchemaInputs<Path extends NativePath> = Exclude<EndpointClientOptions<MatchedRoute<Path, 'get'>['definition']>, void>
type RequiredQueryFields<Input> = {
  [Key in Extract<keyof Input, 'query' | 'headers'>]: {} extends NonNullable<Input[Key]> ? never : Key
}[Extract<keyof Input, 'query' | 'headers'>]
type ColadaQueryInputs<Path extends NativePath> = QueryInputs<Path> &
  Required<Pick<QueryInputs<Path>, RequiredQueryFields<SchemaInputs<Path>>>>
type ColadaQueryArgs<Path extends NativePath> = {} extends ColadaQueryInputs<Path>
  ? [options?: ColadaQueryInputs<Path>] : [options: ColadaQueryInputs<Path>]

export type NativeQueryOptions = {
  <const Path extends NativePath>(
    request: Path & NativeRouteGuard<NoInfer<Path>, 'get'>,
    ...options: ColadaQueryArgs<NoInfer<Path>>,
  ): {
    key: import('${toImportPath(resolve('./runtime'))}').EndpointCacheKey<'get'>
    query: (context: { signal: AbortSignal }) => Promise<NativeResult<Path, 'get'>>
  }
} & typeof LegacyQueryOptions

type MatchedRoute<Path extends NativePath, Method extends HttpMethod> = Extract<NativeRoute<Path, Method>, EndpointRouteEntry>
type WithoutPathParams<Input> = Input extends void ? unknown : Omit<Input, 'params'>
type UrlInputs<Route extends EndpointRouteEntry> = WithoutPathParams<EndpointClientOptions<Route['definition']>>
type MutationMethod = 'post' | 'put' | 'patch' | 'delete'
export type NativeMutationOptions = {
  <const Path extends NativePath, const Method extends MutationMethod | Uppercase<MutationMethod>>(
    request: Path & NativeRouteGuard<NoInfer<Path>, Lowercase<NoInfer<Method>>>,
    options: { method: Method } & UrlInputs<MatchedRoute<NoInfer<Path>, Lowercase<NoInfer<Method>>>>,
  ): {
    key: import('${toImportPath(resolve('./runtime'))}').EndpointCacheKey<Lowercase<Method>>
    mutation: () => Promise<NativeResult<Path, Lowercase<Method>>>
  }
} & typeof import('${toImportPath(resolve('./runtime/colada'))}').mutationOptions

type PageRoute<Path extends NativePath> = MatchedRoute<Path, 'get'>
export type NativeInfiniteQueryOptions = {
  <const Path extends NativePath>(
    request: Path & NativeRouteGuard<NoInfer<Path>, 'get'> &
      (PageRoute<NoInfer<Path>> extends { definition: { pagination: { kind: 'cursor' } } } ? unknown : never),
    ...options: ColadaQueryArgs<NoInfer<Path>>
  ): import('${toImportPath(resolve('./runtime/colada'))}').EndpointColadaInfiniteQueryOptions<
    import('${toImportPath(resolve('./runtime/client'))}').EndpointPaginationPage<PageRoute<Path>>,
    Exclude<NativeResult<Path, 'get'>, { status: 200 }>
  >
} & typeof import('${toImportPath(resolve('./runtime/colada'))}').infiniteQueryOptions

interface EndpointTypedFetch extends TypedFetch {
  raw: NativeRaw & TypedFetch['raw']
}

declare global {
  interface NuxtGlobalFetch {
    raw: EndpointTypedFetch['raw']
  }
}

export declare const $fetch: EndpointTypedFetch
export declare const useFetch: NativeUseFetch & UseFetch
`
}
