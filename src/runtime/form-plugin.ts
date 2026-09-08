import { formRoutes } from '#nuxt-endpoints/form-routes'
import type { EndpointFormRouteEntry } from '../codegen/form-routes'
import { setFormRoutes } from './form-routes-state'
import { defineRuntimePlugin } from './platform'

/** Initializes only the generated native-form projection map. */
export default defineRuntimePlugin(() => {
  setFormRoutes(formRoutes as Readonly<Record<string, EndpointFormRouteEntry>>)
})
