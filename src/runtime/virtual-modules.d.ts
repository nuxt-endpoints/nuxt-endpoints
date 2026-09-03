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
