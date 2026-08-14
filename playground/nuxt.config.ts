import { createResolver } from '@nuxt/kit'
import NuxtEndpoints from '../src/module'

const resolver = createResolver(import.meta.url)
const resolve = (...paths: string[]) => resolver.resolve(...paths)

export default defineNuxtConfig({
  css: ['~/assets/css/base.css'],
  modules: [NuxtEndpoints],
  devtools: { enabled: true },
  compatibilityDate: '2024-08-24',
  future: {
    compatibilityVersion: 4,
  },
  endpoints: {
    openApi: true,
    client: {
      query: {
        setup: 'auto',
      },
    },
  },
  runtimeConfig: {
    playgroundDatabasePath: resolve('.data/playground.sqlite'),
  },
  nitro: {
    scanDirs: [resolve('server')],
  },
})
