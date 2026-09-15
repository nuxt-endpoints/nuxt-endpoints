import type { ServerRoutes } from '@nuxt/schema'
import type { TypedFetchMetadataField } from 'nuxt/app'

type PublicContract = TypedFetchMetadataField<ServerRoutes, '/api/users', 'contract', 'post'>
type FormContract = TypedFetchMetadataField<ServerRoutes, '/api/notes', 'contract', 'post'>
type FormHandler = typeof import('./server/api/notes.post').default
type ExplicitFormContract = FormHandler['~routeContract']['default']['definition']

type HasPublicRoutes = '/api' extends keyof ServerRoutes ? true : false
type HasPublicContract = [PublicContract] extends [never] ? false : true

const hasPublicRoutes: true = null as unknown as HasPublicRoutes
const hasPublicContract: true = null as unknown as HasPublicContract
const publicHasResponses: true = null as unknown as 'responses' extends keyof PublicContract
  ? true
  : false
const publicHasForm: true = null as unknown as FormContract extends {
  form: { action: string }
}
  ? true
  : false
const handlerHasForm: true = null as unknown as ExplicitFormContract extends {
  form: { action: string }
}
  ? true
  : false

export { handlerHasForm, hasPublicContract, hasPublicRoutes, publicHasForm, publicHasResponses }

// Check the canonical wire path independently of the NE-generated route list.
type NormalizedContract = TypedFetchMetadataField<
  ServerRoutes,
  '/normalized/@handle',
  'contract',
  'get'
>
export const normalizedMetadataPresent: true = null as unknown as [NormalizedContract] extends [
  never,
]
  ? false
  : true
