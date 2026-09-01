import type { InternalRouteSchema, TypedFetchMetadataField } from 'nitro/types'
import type { NitroRouteSchema } from './.nuxt/types/nitro/nitro-route-schema'

type PublicContract = TypedFetchMetadataField<InternalRouteSchema, '/api/users', 'contract', 'post'>
type GeneratedContract = TypedFetchMetadataField<NitroRouteSchema, '/api/users', 'contract', 'post'>

type HasPublicRoutes = '/api' extends keyof InternalRouteSchema ? true : false
type HasPublicContract = [PublicContract] extends [never] ? false : true
type HasGeneratedContract = [GeneratedContract] extends [never] ? false : true

const hasPublicRoutes: true = null as unknown as HasPublicRoutes
const hasPublicContract: true = null as unknown as HasPublicContract
const hasGeneratedContract: true = null as unknown as HasGeneratedContract
const publicHasResponses: true = null as unknown as 'responses' extends keyof PublicContract
  ? true
  : false
const generatedHasResponses: true = null as unknown as 'responses' extends keyof GeneratedContract
  ? true
  : false

export {
  generatedHasResponses,
  hasGeneratedContract,
  hasPublicContract,
  hasPublicRoutes,
  publicHasResponses,
}
