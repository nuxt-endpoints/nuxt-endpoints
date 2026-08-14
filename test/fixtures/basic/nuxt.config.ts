import { createResolver } from '@nuxt/kit'
import NuxtEndpoints from '../../../src/module'

const resolver = createResolver(import.meta.url)
const resolve = (...paths: string[]) => resolver.resolve(...paths)

export default defineNuxtConfig({
  modules: [NuxtEndpoints],
  endpoints: {
    openApi: true,
    client: {
      query: true,
    },
  },
  compatibilityDate: '2024-08-24',
  future: {
    compatibilityVersion: 4,
  },
  nitro: {
    scanDirs: [resolve('server')],
  },
})
