declare module '#nuxt-endpoints/options' {
  const options: unknown
  export default options
}

declare module '#nuxt-endpoints/server-handlers' {
  export const handlers: unknown
}

declare module '#nuxt-endpoints/idempotency-policy' {
  const policy: import('./idempotency-policy').EndpointIdempotencyPolicy | undefined
  export default policy
}

declare module '#nuxt-endpoints/hooks' {
  const hooks: import('./hooks').EndpointHooks | undefined
  export default hooks
}
