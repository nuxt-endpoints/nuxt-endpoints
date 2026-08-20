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
    // A route registered by configuration instead of by file scanning. It
    // lives outside every scanned directory, so it exists only because
    // discovery reads Nitro's configured handlers too.
    handlers: [
      {
        route: '/custom/report',
        method: 'get',
        handler: resolve('server/custom-routes/report.get.ts'),
      },
    ],
  },
})
