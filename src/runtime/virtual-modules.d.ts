// Nitro 2 declared a global `$fetch` from `nitropack/types`; Nitro 3 does not,
// and Nuxt supplies it to an app through auto-imports that this package's own
// type-check does not see. The runtime falls back to the global when no
// request-aware fetcher was captured, so the declaration has to live here.
declare const $fetch: {
  (path: string, options?: Record<string, unknown>): Promise<unknown>
  raw: (path: string, options?: Record<string, unknown>) => Promise<unknown>
}

declare module '#nuxt-endpoints/options' {
  const options: unknown
  export default options
}

declare module '#nuxt-endpoints/server-handlers' {
  export const handlers: unknown
}

declare module '#nuxt-endpoints/runtime' {
  const runtime: import('./endpoint-runtime').EndpointRuntime | undefined
  export default runtime
}

declare module '#nuxt-endpoints/server-route-config' {
  const config: import('./server-route-config').ServerRouteConfig | undefined
  export default config
}
