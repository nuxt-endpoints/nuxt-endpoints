import type { ServerRoutes } from '@nuxt/schema'
import type { TypedFetchMetadataField } from 'nuxt/app'

type PublicContract = TypedFetchMetadataField<ServerRoutes, '/api/users', 'contract', 'post'>

type HasPublicRoutes = '/api' extends keyof ServerRoutes ? true : false
type HasPublicContract = [PublicContract] extends [never] ? false : true

const hasPublicRoutes: true = null as unknown as HasPublicRoutes
const hasPublicContract: true = null as unknown as HasPublicContract
const publicHasResponses: true = null as unknown as 'responses' extends keyof PublicContract
  ? true
  : false

export { hasPublicContract, hasPublicRoutes, publicHasResponses }
