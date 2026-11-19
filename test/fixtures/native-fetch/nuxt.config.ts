import NuxtEndpoints from '../../../src/module'

export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@pinia/colada-nuxt', NuxtEndpoints],
  experimental: { routeTypedFetch: true, strictRouteTypes: true },
  endpoints: { client: { nativeFetch: true } },
})
